import "server-only";
import { accuracyMetrics, median, type PredictionOutcome } from "@/lib/accuracy";
import type { ReportAccuracy, ReportClipRow, ReportGroupStat, ReportShortRow } from "@/lib/agent/prompts";
import { channelMedianSettled, recentBacktestSample, runBacktest } from "@/lib/backtest";
import type { Db } from "@/lib/db/client";
import { estimateCostUsd, REPORT_MODEL, writeWeeklyReport } from "@/lib/integrations/claude";
import { applyTextChange, getActivePrompt } from "@/lib/prompt-versions";
import { addDays, easternDate } from "@/lib/schedule-slots";
import { shortFormatLabels, type ShortFormat } from "@/lib/youtube-marks";

// The weekly learning loop: measure prediction accuracy (our posted clips by prompt
// version, plus the latest backtest on channel Shorts), find patterns, write a learnings
// entry with up to 3 proposed prompt changes, and backtest each proposal against the
// current prompt on the same Shorts. Nothing changes until a person approves a proposal
// on the Learnings page.

/** Proposals are backtested on the most recent eligible Shorts, with a baseline on the same set. */
const PROPOSAL_SAMPLE = 120;
const EXTREMES = 25;
const PAGE = 1000;

export type WeeklyReportResult = {
  learningId: string;
  weekStart: string;
  proposals: number;
  dropped: string[];
  costUsd: number;
};

/** Monday of last week, Eastern. */
export function lastWeekStart(now = new Date()) {
  const today = easternDate(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = addDays(today, -((weekday + 6) % 7));
  return addDays(thisMonday, -7);
}

/** Accuracy of our own posted clips that have settled views, per prompt version. */
async function postedAccuracy(db: Db, channelMedian: number | null) {
  const { data, error } = await db
    .from("youtube_shorts")
    .select(
      "settled_views, views, published_at, posts!inner (clip_id, clips!inner (id, title, format, hook_type, picked, prompt_version, predicted_views_low, predicted_views_expected, predicted_views_high, source_videos (week_id)))",
    )
    .not("post_id", "is", null);
  if (error) throw new Error(`Failed to load our posted clips: ${error.message}`);
  const rows = data.map((r) => ({ ...r.posts.clips, settled: r.settled_views, views: r.views, publishedAt: r.published_at, weekId: r.posts.clips.source_videos.week_id }));

  const byVersion = Map.groupBy(
    rows.filter((r) => r.settled !== null && r.predicted_views_expected !== null && r.prompt_version !== null),
    (r) => r.prompt_version!,
  );
  const accuracy: (ReportAccuracy & { version: number })[] = [];
  for (const [version, items] of byVersion) {
    const outcomes: PredictionOutcome[] = items.map((r) => ({
      id: r.id,
      predictedLow: r.predicted_views_low!,
      predictedExpected: r.predicted_views_expected!,
      predictedHigh: r.predicted_views_high!,
      actual: r.settled!,
    }));
    // Each week's top 7 is the week's picks.
    const groups = [...Map.groupBy(items.filter((r) => r.picked), (r) => r.weekId ?? "none").values()].map((g) => g.map((r) => ({ id: r.id, actual: r.settled! })));
    const m = accuracyMetrics(outcomes, groups, channelMedian);
    accuracy.push({ version, label: `Our posted clips, prompt v${version}`, count: m.count, spearman: m.spearman, rangeHitRate: m.rangeHitRate, top7HitRate: m.top7HitRate });
  }
  return { rows, accuracy };
}

const COMPANIES = /\b(google|amazon|meta|facebook|apple|microsoft|netflix|stripe|openai|anthropic|nvidia|deepmind|uber|airbnb|linkedin|tesla|spotify|salesforce|adobe|tiktok|bytedance)\b/i;

/** Headline style buckets for a Short's title. */
function headlineStyles(title: string): string[] {
  const styles: string[] = [];
  if (title.includes("?")) styles.push("question");
  if (/\d/.test(title)) styles.push("has a number");
  if (COMPANIES.test(title)) styles.push("names a company");
  if (/^(how|why|what|when|which)\b/i.test(title.trim())) styles.push("starts with how/why/what");
  if (/#\w/.test(title)) styles.push("hashtags in title");
  if (/\p{Extended_Pictographic}/u.test(title)) styles.push("emoji in title");
  styles.push(title.length < 35 ? "short title (<35 chars)" : title.length <= 60 ? "medium title (35-60 chars)" : "long title (60+ chars)");
  return styles;
}

/** Backtest results for the active version: grouped stats and the biggest misses. */
async function backtestPatterns(db: Db, version: number) {
  const { data: run, error } = await db
    .from("backtest_runs")
    .select("id, shorts_count, spearman, range_hit_rate, top7_hit_rate, label")
    .eq("prompt_version", version)
    .is("proposal_id", null)
    .not("finished_at", "is", null)
    .order("shorts_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the latest backtest: ${error.message}`);
  if (!run) return null;

  const preds: { title: string; format: string | null; predicted: number; low: number; high: number; actual: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: predError } = await db
      .from("backtest_predictions")
      .select("predicted_low, predicted_expected, predicted_high, actual_settled, youtube_shorts (title, format)")
      .eq("run_id", run.id)
      .range(from, from + PAGE - 1);
    if (predError) throw new Error(`Failed to load backtest predictions: ${predError.message}`);
    preds.push(
      ...data.map((d) => ({
        title: d.youtube_shorts.title,
        format: d.youtube_shorts.format ? shortFormatLabels[d.youtube_shorts.format as ShortFormat] : null,
        predicted: d.predicted_expected ?? 0,
        low: d.predicted_low ?? 0,
        high: d.predicted_high ?? 0,
        actual: d.actual_settled,
      })),
    );
    if (data.length < PAGE) break;
  }
  const withRatio = preds.filter((p) => p.predicted > 0).map((p) => ({ ...p, ratio: p.actual / p.predicted }));
  const groups: ReportGroupStat[] = [];
  const addGroups = (dimension: string, keyOf: (p: (typeof withRatio)[number]) => string[]) => {
    const buckets = new Map<string, typeof withRatio>();
    for (const p of withRatio) for (const k of keyOf(p)) buckets.set(k, [...(buckets.get(k) ?? []), p]);
    for (const [group, items] of buckets) {
      if (items.length < 5) continue;
      groups.push({
        dimension,
        group,
        count: items.length,
        medianRatio: median(items.map((i) => i.ratio))!,
        rangeHitRate: items.filter((i) => i.actual >= i.low && i.actual <= i.high).length / items.length,
      });
    }
  };
  addGroups("format", (p) => [p.format ?? "unknown"]);
  addGroups("headline style", (p) => headlineStyles(p.title));
  const toRow = (p: (typeof withRatio)[number]): ReportShortRow => ({ title: p.title, format: p.format, predicted: p.predicted, actual: p.actual, ratio: p.ratio });
  const sorted = [...withRatio].sort((a, b) => a.ratio - b.ratio);
  return {
    run,
    groups,
    overPredicted: sorted.slice(0, EXTREMES).map(toRow),
    underPredicted: sorted.slice(-EXTREMES).reverse().map(toRow),
  };
}

export async function runWeeklyReport(db: Db, options: { log?: (line: string) => void; weekStart?: string } = {}): Promise<WeeklyReportResult> {
  const log = options.log ?? (() => {});
  const weekStart = options.weekStart ?? lastWeekStart();
  const prompt = await getActivePrompt(db);
  const channelMedian = await channelMedianSettled(db);
  log(`Weekly report for the week of ${weekStart}, prompt v${prompt.version}. Channel median settled views: ${channelMedian}.`);

  // 1. Accuracy on our own posted clips, saved per version for the chart.
  const posted = await postedAccuracy(db, channelMedian);
  for (const a of posted.accuracy) {
    await db.from("accuracy_snapshots").insert({
      source: "posted",
      prompt_version: a.version,
      items_count: a.count,
      spearman: a.spearman,
      range_hit_rate: a.rangeHitRate,
      top7_hit_rate: a.top7HitRate,
    });
  }
  log(`Our posted clips with settled views and a prediction: ${posted.accuracy.reduce((n, a) => n + a.count, 0)}.`);

  // Last week's clips, settled or not, so the report can comment on them.
  const weekEnd = addDays(weekStart, 7);
  const ownClips: ReportClipRow[] = posted.rows
    .filter((r) => easternDate(new Date(r.publishedAt)) >= addDays(weekStart, -21) && easternDate(new Date(r.publishedAt)) < weekEnd)
    .map((r) => ({
      title: r.title,
      format: r.format,
      hookType: r.hook_type,
      predicted: r.predicted_views_expected,
      actual: r.settled ?? r.views,
      settled: r.settled !== null,
    }));

  // 2. Patterns from the latest full backtest of the active prompt.
  const patterns = await backtestPatterns(db, prompt.version);
  if (!patterns) throw new Error(`No backtest of prompt v${prompt.version} yet. Run npm run job:backtest first.`);
  const accuracy: ReportAccuracy[] = [
    {
      label: `Backtest on ${patterns.run.shorts_count} channel Shorts, prompt v${prompt.version} (top 7 per month)`,
      count: patterns.run.shorts_count,
      spearman: patterns.run.spearman,
      rangeHitRate: patterns.run.range_hit_rate,
      top7HitRate: patterns.run.top7_hit_rate,
    },
    ...posted.accuracy,
  ];

  // 3. Learnings and proposals.
  const draft = await writeWeeklyReport({
    weekStart,
    promptVersion: prompt.version,
    promptText: prompt.text,
    accuracy,
    ownClips,
    groups: patterns.groups,
    overPredicted: patterns.overPredicted,
    underPredicted: patterns.underPredicted,
  });
  let costUsd = estimateCostUsd(REPORT_MODEL, draft.usage) ?? 0;
  log(`Wrote learnings with ${draft.proposals.length} proposals${draft.dropped.length ? ` (dropped ${draft.dropped.length} whose text didn't match the prompt)` : ""}.`);

  const { data: learning, error: learningError } = await db
    .from("learnings")
    .upsert(
      {
        week_start: weekStart,
        what_worked: draft.whatWorked,
        what_didnt_work: draft.whatDidntWork,
        what_changed: draft.proposals.map((p) => p.title),
        reasoning: draft.reasoning,
        patterns: draft.patterns,
        accuracy,
      },
      { onConflict: "week_start" },
    )
    .select("id")
    .single();
  if (learningError) throw new Error(`Failed to save the learnings entry: ${learningError.message}`);
  // A rerun for the same week replaces its pending proposals; decided ones stay.
  await db.from("prompt_proposals").delete().eq("learning_id", learning.id).eq("status", "pending");

  // 4. Backtest each proposal against the current prompt on the same recent Shorts.
  if (draft.proposals.length) {
    const sample = await recentBacktestSample(db, PROPOSAL_SAMPLE);
    const baseline = await runBacktest(db, {
      promptText: prompt.text,
      label: `Week of ${weekStart}: v${prompt.version} on ${sample.length} recent Shorts`,
      promptVersion: prompt.version,
      videoIds: sample,
      log,
    });
    costUsd += baseline.costUsd ?? 0;
    for (const p of draft.proposals) {
      const { data: proposal, error } = await db
        .from("prompt_proposals")
        .insert({
          learning_id: learning.id,
          base_version: prompt.version,
          title: p.title,
          reasoning: p.reasoning,
          old_text: p.oldText,
          new_text: p.newText,
          baseline_run_id: baseline.runId,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Failed to save proposal "${p.title}": ${error.message}`);
      const test = await runBacktest(db, {
        promptText: applyTextChange(prompt.text, p.oldText, p.newText),
        label: `Proposal: ${p.title}`,
        promptVersion: prompt.version,
        proposalId: proposal.id,
        videoIds: sample,
        log,
      });
      costUsd += test.costUsd ?? 0;
      await db.from("prompt_proposals").update({ backtest_run_id: test.runId }).eq("id", proposal.id);
    }
  }

  await db.from("learnings").update({ cost_usd: Math.round(costUsd * 10000) / 10000 }).eq("id", learning.id);
  log(`Weekly report done. Cost about $${costUsd.toFixed(4)}.`);
  return { learningId: learning.id, weekStart, proposals: draft.proposals.length, dropped: draft.dropped, costUsd };
}
