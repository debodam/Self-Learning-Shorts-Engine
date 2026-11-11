import "server-only";
import { accuracyMetrics, median, type AccuracyMetrics, type PredictionOutcome } from "@/lib/accuracy";
import type { Db } from "@/lib/db/client";
import { addUsage, emptyUsage, estimateCostUsd, predictForBacktest, SCORING_MODEL, type TokenUsage } from "@/lib/integrations/claude";
import { rankScores } from "@/lib/ranking";
import { shortFormatLabels, type ShortFormat } from "@/lib/youtube-marks";

// Backtests a scoring prompt on the channel's Shorts: each Short is scored as if it were
// new, with only the 5 most similar Shorts published before it (never itself or anything
// newer), and the predictions are compared with its actual settled views.
//
// Known leak: the earlier Shorts' settled views are as of today, not as of the day the
// Short was published. For Shorts over 30 days old that's their total, which is close to
// what they had settled to by then.

const CONCURRENCY = 8;
const PAGE = 1000;
const SIMILAR_COUNT = 5;
/** The backtest's top 7 is per calendar month (Eastern): the channel rarely posts 8+ a week. */
const TOP_N = 7;
const MIN_GROUP_SIZE = TOP_N + 1;

export type BacktestOptions = {
  promptText: string;
  label: string;
  promptVersion: number | null;
  proposalId?: string;
  /** Only these Shorts; all eligible Shorts when left out. */
  videoIds?: string[];
  /** Save the result to accuracy_snapshots for the chart. Baselines only. */
  recordSnapshot?: boolean;
  log?: (line: string) => void;
};

export type BacktestResult = AccuracyMetrics & { runId: string; skipped: number; failed: number; usage: TokenUsage; costUsd: number | null };

type EligibleShort = {
  video_id: string;
  title: string;
  description: string;
  format: string | null;
  duration_seconds: number;
  published_at: string;
  settled_views: number;
  embedding: string;
};

async function loadEligible(db: Db, videoIds?: string[]) {
  const rows: EligibleShort[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from("youtube_shorts")
      .select("video_id, title, description, format, duration_seconds, published_at, settled_views, embedding")
      .not("settled_views", "is", null)
      .not("embedding", "is", null)
      .order("published_at");
    if (videoIds) q = q.in("video_id", videoIds);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load Shorts to backtest: ${error.message}`);
    rows.push(...(data as EligibleShort[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

/** The channel's median settled views right now, the bar the top 7 must beat. */
export async function channelMedianSettled(db: Db) {
  const values: number[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("youtube_shorts").select("settled_views").not("settled_views", "is", null).range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load settled views: ${error.message}`);
    values.push(...data.map((r) => r.settled_views!));
    if (data.length < PAGE) break;
  }
  return median(values);
}

/** The most recent eligible Shorts, for a cheaper backtest of proposals. */
export async function recentBacktestSample(db: Db, size: number) {
  const all = await loadEligible(db);
  return all.slice(-size).map((s) => s.video_id);
}

const monthKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));

export async function runBacktest(db: Db, options: BacktestOptions): Promise<BacktestResult> {
  const log = options.log ?? (() => {});
  const shorts = await loadEligible(db, options.videoIds);
  const { data: run, error: runError } = await db
    .from("backtest_runs")
    .insert({ label: options.label, prompt_version: options.promptVersion, proposal_id: options.proposalId ?? null, model: SCORING_MODEL })
    .select("id")
    .single();
  if (runError) throw new Error(`Failed to start the backtest log: ${runError.message}`);
  log(`Backtest "${options.label}": ${shorts.length} Shorts with ${SCORING_MODEL}.`);

  let usage = emptyUsage();
  let skipped = 0;
  const failed: string[] = [];
  const done: (PredictionOutcome & { publishedAt: string; rubricTotal: number; reason: string })[] = [];
  let fatal: string | null = null;
  let result: BacktestResult | null = null;
  try {
    const queue = [...shorts];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          const { data: similar, error } = await db.rpc("match_similar_shorts_before", {
            query_embedding: s.embedding,
            published_before: s.published_at,
            match_count: SIMILAR_COUNT,
          });
          if (error) throw new Error(error.message);
          // The channel's first Shorts have too little history to predict from.
          if (similar.length < SIMILAR_COUNT) {
            skipped++;
            continue;
          }
          const p = await predictForBacktest(
            options.promptText,
            {
              title: s.title,
              description: s.description,
              format: s.format ? shortFormatLabels[s.format as ShortFormat] : null,
              durationSeconds: s.duration_seconds,
            },
            similar.map((m) => ({
              title: m.title,
              format: m.format ? shortFormatLabels[m.format as ShortFormat] : null,
              settledViews: m.settled_views,
              similarity: m.similarity,
            })),
          );
          usage = addUsage(usage, p.usage);
          done.push({
            id: s.video_id,
            publishedAt: s.published_at,
            rubricTotal: p.rubricTotal,
            predictedLow: p.low,
            predictedExpected: p.expected,
            predictedHigh: p.high,
            actual: s.settled_views,
            reason: p.reason,
          });
          if (done.length % 50 === 0) log(`  Predicted ${done.length} of ${shorts.length}.`);
        } catch (e) {
          failed.push(`${s.title}: ${e instanceof Error ? e.message : e}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    for (let i = 0; i < done.length; i += 500) {
      const { error } = await db.from("backtest_predictions").insert(
        done.slice(i, i + 500).map((d) => ({
          run_id: run.id,
          video_id: d.id,
          rubric_total: d.rubricTotal,
          predicted_low: d.predictedLow,
          predicted_expected: d.predictedExpected,
          predicted_high: d.predictedHigh,
          actual_settled: d.actual,
          reason: d.reason,
        })),
      );
      if (error) throw new Error(`Failed to save backtest predictions: ${error.message}`);
    }
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    // Metrics: rank within each month the way the top 7 is picked each week.
    const groups = [...Map.groupBy(done, (d) => monthKey(d.publishedAt)).values()]
      .filter((g) => g.length >= MIN_GROUP_SIZE)
      .map((g) => {
        const scores = rankScores(g.map((d) => ({ id: d.id, rubricTotal: d.rubricTotal, expectedViews: d.predictedExpected })));
        return [...g].sort((a, b) => scores.get(b.id)! - scores.get(a.id)!).slice(0, TOP_N);
      });
    const metrics = accuracyMetrics(done, groups, await channelMedianSettled(db));
    const costUsd = estimateCostUsd(SCORING_MODEL, usage);
    await db
      .from("backtest_runs")
      .update({
        finished_at: new Date().toISOString(),
        shorts_count: metrics.count,
        spearman: metrics.spearman,
        range_hit_rate: metrics.rangeHitRate,
        top7_hit_rate: metrics.top7HitRate,
        top7_groups: metrics.top7Groups,
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
        cost_usd: costUsd,
        error: fatal ?? (failed.length ? failed.slice(0, 20).join("\n") : null),
      })
      .eq("id", run.id);
    if (!fatal && options.recordSnapshot) {
      await db.from("accuracy_snapshots").insert({
        source: "backtest",
        prompt_version: options.promptVersion,
        items_count: metrics.count,
        spearman: metrics.spearman,
        range_hit_rate: metrics.rangeHitRate,
        top7_hit_rate: metrics.top7HitRate,
        backtest_run_id: run.id,
      });
    }
    const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
    log(
      `Backtest "${options.label}": ${metrics.count} predicted, ${skipped} skipped (under ${SIMILAR_COUNT} earlier Shorts), ${failed.length} failed. ` +
        `Spearman ${metrics.spearman?.toFixed(3) ?? "n/a"}, range hit ${pct(metrics.rangeHitRate)}, top 7 hit ${pct(metrics.top7HitRate)} over ${metrics.top7Groups} months. ` +
        `Cost about $${costUsd?.toFixed(4) ?? "unknown"}.`,
    );
    result = { runId: run.id, ...metrics, skipped, failed: failed.length, usage, costUsd };
  }
  return result;
}
