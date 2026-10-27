import "server-only";
import type { SimilarClip } from "@/lib/agent/prompts";
import type { Db } from "@/lib/db/client";
import { MIN_FACE_FRAMES, NO_SPEAKER_REASON, shouldCut } from "@/lib/agent/rules";
import { extractFrames } from "@/lib/frames";
import {
  addUsage,
  calibrateBatch,
  emptyUsage,
  estimateCostUsd,
  scoreClip,
  SCORING_MODEL,
  type ClipScore,
  type ClipVision,
  type TokenUsage,
} from "@/lib/integrations/claude";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { listClipsCached } from "@/lib/integrations/opus";

// Scores candidate clips with Claude in two passes (each clip from its frames and
// transcript, then each source video's clips compared side by side) and saves the results: only unscored clips by default,
// or every clip up for review (kept and cut) to re-score after the prompt changes. Used by
// the Review page buttons and the weekly candidates job. Each run is logged to agent_runs
// with its token usage and estimated cost.

const PAST_CLIPS_FOR_CALIBRATION = 20;
// Clips scored at once. Keeps a 70 clip run to a few minutes without tripping rate limits.
const CONCURRENCY = 8;

export type ScoringRun = {
  model: string;
  scored: number;
  /** All cuts, including no-speaker cuts. */
  cut: number;
  /** Cut by the face rule. */
  noSpeaker: number;
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

/** Fresh Opus preview links, keyed by composite clip ID, for pulling frames. */
async function loadPreviewUrls(opusClipIds: (string | null)[]) {
  const urls = new Map<string, string>();
  if (!isIntegrationConnected("opus")) return urls;
  const projectIds = [...new Set(opusClipIds.flatMap((id) => (id ? [id.split(".")[0]] : [])))];
  const results = await Promise.allSettled(projectIds.map((id) => listClipsCached(id)));
  for (const r of results) {
    if (r.status === "fulfilled") for (const c of r.value) if (c.previewUrl) urls.set(c.id, c.previewUrl);
  }
  return urls;
}

function describeVision(vision: ClipVision | null) {
  if (!vision) return "frames not checked";
  return `face in ${vision.faceFrames} of ${vision.framesChecked} frames, up to ${vision.peopleCount} people, on-screen text ${vision.textReadable ? "readable" : "not readable"} on a phone`;
}

export async function runScoring(db: Db, { all = false, log = () => {} }: ScoringOptions = {}): Promise<ScoringRun> {
  const model = isIntegrationConnected("claude") ? SCORING_MODEL : "mock";
  const { data: run, error: runError } = await db.from("agent_runs").insert({ kind: "scoring", model }).select("id").single();
  if (runError) throw new Error(`Failed to start the scoring run log: ${runError.message}`);

  const result: ScoringRun = { model, scored: 0, cut: 0, noSpeaker: 0, failed: [], usage: emptyUsage(), costUsd: 0 };
  let fatal: string | null = null;
  try {
    let query = db.from("clips").select("id, opus_clip_id, title, transcript, format, duration_seconds, source_videos (title)");
    // Cut clips are saved as rejected. Approved, scheduled, and posted clips are never re-scored.
    query = all ? query.in("status", ["candidate", "rejected"]) : query.eq("status", "candidate").is("scored_at", null);
    const { data: clips, error } = await query.order("created_at");
    if (error) throw new Error(`Failed to load clips to score: ${error.message}`);
    const [pastClips, previews] = await Promise.all([loadPastClips(db), loadPreviewUrls(clips.map((c) => c.opus_clip_id))]);
    log(`${all ? "Re-scoring" : "Scoring"} ${clips.length} clips with ${model} and ${pastClips.length} past clips for calibration.`);

    // Pass 1: each clip on its own, from 3 frames and the transcript.
    type Scored = { clip: (typeof clips)[number]; score: ClipScore };
    const firstPass: Scored[] = [];
    const queue = [...clips];
    const worker = async () => {
      for (let clip = queue.shift(); clip; clip = queue.shift()) {
        try {
          if (!clip.transcript) throw new Error("no transcript");
          const previewUrl = clip.opus_clip_id ? previews.get(clip.opus_clip_id) : undefined;
          let frames: Buffer[] = [];
          if (previewUrl && clip.duration_seconds) {
            frames = await extractFrames(previewUrl, clip.duration_seconds).catch((e) => {
              log(`  No frames for "${clip!.title}": ${e instanceof Error ? e.message : e}. Scoring from the transcript.`);
              return [];
            });
          }
          const score = await scoreClip(
            {
              title: clip.title,
              transcript: clip.transcript,
              sourceVideoTitle: clip.source_videos.title,
              format: clip.format,
              durationSeconds: clip.duration_seconds,
            },
            pastClips.filter((p) => p.format === clip!.format),
            frames,
          );
          result.usage = addUsage(result.usage, score.usage);
          firstPass.push({ clip, score });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.failed.push({ title: clip.title, error: message });
          log(`  Failed "${clip.title}": ${message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Pass 2: compare the clips from each source video side by side to spread the scores.
    const batches = Map.groupBy(firstPass, (s) => s.clip.opus_clip_id?.split(".")[0] ?? s.clip.source_videos.title);
    const final = new Map<string, { scores: ClipScore["scores"]; reasoning: string }>();
    await Promise.all(
      [...batches.values()].map(async (batch) => {
        const keyed = batch.map((s, i) => ({ key: `c${i + 1}`, ...s }));
        try {
          const { results, usage } = await calibrateBatch(
            batch[0].clip.source_videos.title,
            keyed.map(({ key, clip, score }) => ({
              key,
              title: clip.title,
              format: clip.format,
              durationSeconds: clip.duration_seconds,
              transcript: clip.transcript!,
              scores: score.scores,
              reasoning: score.reasoning,
              visual: describeVision(score.vision),
            })),
          );
          result.usage = addUsage(result.usage, usage);
          for (const { key, clip } of keyed) {
            const calibrated = results.get(key);
            if (calibrated) final.set(clip.id, calibrated);
          }
          log(`  Compared ${batch.length} clips from "${batch[0].clip.source_videos.title}"; adjusted ${results.size}.`);
        } catch (error) {
          // Keep the first-pass scores for this batch rather than failing the run.
          log(`  Couldn't compare "${batch[0].clip.source_videos.title}": ${error instanceof Error ? error.message : error}`);
        }
      }),
    );

    // Save, applying the face rule over the rubric.
    await Promise.all(
      firstPass.map(async ({ clip, score }) => {
        const { scores, reasoning } = final.get(clip.id) ?? score;
        const noSpeaker = score.vision !== null && score.vision.faceFrames < MIN_FACE_FRAMES;
        const cut = noSpeaker || shouldCut(scores);
        const { error: saveError } = await db
          .from("clips")
          .update({
            score_hook: scores.hook,
            score_tension: scores.tension,
            score_standalone: scores.standalone,
            score_payoff: scores.payoff,
            score_loopability: scores.loopability,
            hook_type: score.hookType,
            // Hidden until there's real performance data to predict from (Phase 3).
            predicted_views_youtube: null,
            predicted_views_tiktok: null,
            predicted_views_instagram: null,
            score_reasoning: reasoning,
            suggested_title: score.suggestedTitle,
            youtube_title: score.youtube.title,
            youtube_description: score.youtube.description,
            frames_checked: score.vision?.framesChecked ?? 0,
            face_frames: score.vision?.faceFrames ?? null,
            people_count: score.vision?.peopleCount ?? null,
            text_readable: score.vision?.textReadable ?? null,
            cut_reason: noSpeaker ? NO_SPEAKER_REASON : null,
            scored_at: new Date().toISOString(),
            status: cut ? "rejected" : "candidate",
          })
          .eq("id", clip.id);
        if (saveError) {
          result.failed.push({ title: clip.title, error: `save failed: ${saveError.message}` });
          return;
        }
        result.scored++;
        if (cut) result.cut++;
        if (noSpeaker) result.noSpeaker++;
        const total = Object.values(scores).reduce((a, b) => a + b, 0);
        log(`  ${noSpeaker ? "Cut (no speaker)" : cut ? "Cut" : "Kept"} "${clip.title}": ${total}/25.`);
      }),
    );
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
