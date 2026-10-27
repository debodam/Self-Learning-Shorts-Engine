import "server-only";
import type { SimilarClip } from "@/lib/agent/prompts";
import type { Db } from "@/lib/db/client";
import { addUsage, emptyUsage, estimateCostUsd, scoreClip, SCORING_MODEL, type TokenUsage } from "@/lib/integrations/claude";
import { isIntegrationConnected } from "@/lib/integrations/config";

// Scores candidate clips with Claude and saves the results: only unscored clips by default,
// or every clip up for review (kept and cut) to re-score after the prompt changes. Used by
// the Review page buttons and the weekly candidates job. Each run is logged to agent_runs
// with its token usage and estimated cost.

const PAST_CLIPS_FOR_CALIBRATION = 20;
// Clips scored at once. Keeps a 40 clip run to about a minute without tripping rate limits.
const CONCURRENCY = 4;

export type ScoringRun = {
  model: string;
  scored: number;
  cut: number;
  failed: { title: string; error: string }[];
  usage: TokenUsage;
  /** Null when the model's price isn't known. */
  costUsd: number | null;
};

/** Recently posted clips with their latest views, so the agent can calibrate predictions. */
export async function loadPastClips(db: Db): Promise<SimilarClip[]> {
  const { data, error } = await db
    .from("clips")
    .select("title, format, hook_type, score_total, posts (platform, metrics (views, captured_at))")
    .eq("status", "posted")
    .order("created_at", { ascending: false })
    .order("captured_at", { referencedTable: "posts.metrics", ascending: false })
    .limit(1, { referencedTable: "posts.metrics" })
    .limit(PAST_CLIPS_FOR_CALIBRATION);
  if (error) throw new Error(`Failed to load past clips: ${error.message}`);
  return data.map((r) => ({
    title: r.title,
    format: r.format,
    hookType: r.hook_type,
    scoreTotal: r.score_total,
    views: Object.fromEntries(r.posts.flatMap((p) => (p.metrics[0]?.views != null ? [[p.platform, p.metrics[0].views]] : []))),
  }));
}

export type ScoringOptions = {
  /** Re-score every clip up for review, not only unscored ones. */
  all?: boolean;
  log?: (line: string) => void;
};

export async function runScoring(db: Db, { all = false, log = () => {} }: ScoringOptions = {}): Promise<ScoringRun> {
  const model = isIntegrationConnected("claude") ? SCORING_MODEL : "mock";
  const { data: run, error: runError } = await db.from("agent_runs").insert({ kind: "scoring", model }).select("id").single();
  if (runError) throw new Error(`Failed to start the scoring run log: ${runError.message}`);

  const result: ScoringRun = { model, scored: 0, cut: 0, failed: [], usage: emptyUsage(), costUsd: 0 };
  let fatal: string | null = null;
  try {
    let query = db.from("clips").select("id, title, transcript, format, duration_seconds, source_videos (title)");
    // Cut clips are saved as rejected. Approved, scheduled, and posted clips are never re-scored.
    query = all ? query.in("status", ["candidate", "rejected"]) : query.eq("status", "candidate").is("scored_at", null);
    const { data: clips, error } = await query.order("created_at");
    if (error) throw new Error(`Failed to load clips to score: ${error.message}`);
    const pastClips = await loadPastClips(db);
    log(`${all ? "Re-scoring" : "Scoring"} ${clips.length} clips with ${model} and ${pastClips.length} past clips for calibration.`);

    const queue = [...clips];
    const worker = async () => {
      for (let clip = queue.shift(); clip; clip = queue.shift()) {
        try {
          if (!clip.transcript) throw new Error("no transcript");
          const score = await scoreClip(
            {
              title: clip.title,
              transcript: clip.transcript,
              sourceVideoTitle: clip.source_videos.title,
              format: clip.format,
              durationSeconds: clip.duration_seconds,
            },
            pastClips.filter((p) => p.format === clip!.format),
          );
          result.usage = addUsage(result.usage, score.usage);
          const { error: saveError } = await db
            .from("clips")
            .update({
              score_hook: score.scores.hook,
              score_tension: score.scores.tension,
              score_standalone: score.scores.standalone,
              score_payoff: score.scores.payoff,
              score_loopability: score.scores.loopability,
              hook_type: score.hookType,
              predicted_views_youtube: score.predictedViews.youtube,
              predicted_views_tiktok: score.predictedViews.tiktok,
              predicted_views_instagram: score.predictedViews.instagram,
              score_reasoning: score.reasoning,
              suggested_title: score.suggestedTitle,
              youtube_title: score.youtube.title,
              youtube_description: score.youtube.description,
              scored_at: new Date().toISOString(),
              // Under 3 on Hook or Standalone: cut from the shortlist.
              status: score.cut ? "rejected" : "candidate",
            })
            .eq("id", clip.id);
          if (saveError) throw new Error(`save failed: ${saveError.message}`);
          result.scored++;
          if (score.cut) result.cut++;
          log(`  ${score.cut ? "Cut" : "Kept"} "${clip.title}": ${score.total}/25.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.failed.push({ title: clip.title, error: message });
          log(`  Failed "${clip.title}": ${message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    result.costUsd = model === "mock" ? 0 : estimateCostUsd(model, result.usage);
    const { usage } = result;
    log(
      `Tokens: ${usage.input} input, ${usage.output} output, ${usage.cacheRead} cache read, ${usage.cacheWrite} cache write. ` +
        `Estimated cost: ${result.costUsd === null ? "unknown" : `$${result.costUsd.toFixed(4)}`}.`,
    );
    const { error } = await db
      .from("agent_runs")
      .update({
        finished_at: new Date().toISOString(),
        items_processed: result.scored,
        items_failed: result.failed.length,
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
        cost_usd: result.costUsd,
        error: fatal ?? (result.failed.length ? result.failed.map((f) => `${f.title}: ${f.error}`).join("\n") : null),
      })
      .eq("id", run.id);
    if (error) console.error(`Failed to finish the scoring run log: ${error.message}`);
  }
  return result;
}

export type LastRun = { finishedAt: string; model: string; scored: number; failed: number; costUsd: number | null; tokens: number };

/** The most recent finished scoring run, for showing what the last one cost. */
export async function getLastScoringRun(db: Db): Promise<LastRun | null> {
  const { data, error } = await db
    .from("agent_runs")
    .select("finished_at, model, items_processed, items_failed, cost_usd, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens")
    .eq("kind", "scoring")
    .not("finished_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the last scoring run: ${error.message}`);
  if (!data) return null;
  return {
    finishedAt: data.finished_at!,
    model: data.model,
    scored: data.items_processed,
    failed: data.items_failed,
    costUsd: data.cost_usd,
    tokens: data.input_tokens + data.output_tokens + data.cache_read_input_tokens + data.cache_creation_input_tokens,
  };
}
