import "server-only";
import { connection } from "next/server";
import { shouldCut } from "@/lib/agent/rules";
import { totalScore, type CandidateClip, type OpusMedia } from "@/lib/clips";
import { getLastScoringRun } from "@/lib/clip-scoring";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { listClipsCached, opusProjectUrl } from "@/lib/integrations/opus";
import { mockCandidateClips } from "@/lib/mock/candidate-clips";

/**
 * Every scored clip still up for review, kept and cut, best total score first. Ties go
 * to the higher Opus score. The page takes the shortlist from the top of the kept clips.
 */
export async function getScoredClips(): Promise<CandidateClip[]> {
  await connection();
  const db = getDb();
  if (!db) return mockCandidateClips;

  const { data, error } = await db
    .from("clips")
    .select(
      "id, opus_clip_id, title, format, duration_seconds, score_hook, score_tension, score_standalone, score_payoff, score_loopability, score_total, score_reasoning, suggested_title, predicted_views_youtube, predicted_views_tiktok, predicted_views_instagram, source_videos (title)",
    )
    // Cut clips are saved as rejected.
    .in("status", ["candidate", "rejected"])
    .not("scored_at", "is", null)
    .not("score_total", "is", null)
    .order("score_total", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load scored clips: ${error.message}`);

  const media = await getOpusMedia(data.map((row) => row.opus_clip_id));
  const clips = data.map((row): CandidateClip => {
    // score_total is only set when all five scores are, so these are non-null.
    const scores = {
      hook: row.score_hook!,
      tension: row.score_tension!,
      standalone: row.score_standalone!,
      payoff: row.score_payoff!,
      loopability: row.score_loopability!,
    };
    return {
      id: row.id,
      title: row.title,
      sourceVideo: row.source_videos.title,
      format: row.format,
      durationSeconds: row.duration_seconds,
      scores,
      // The scoring job sets all three together.
      predictedViews:
        row.predicted_views_youtube !== null && row.predicted_views_tiktok !== null && row.predicted_views_instagram !== null
          ? { youtube: row.predicted_views_youtube, tiktok: row.predicted_views_tiktok, instagram: row.predicted_views_instagram }
          : null,
      reason: row.score_reasoning,
      suggestedTitle: row.suggested_title,
      cut: shouldCut(scores),
      opus: row.opus_clip_id ? media.get(row.opus_clip_id) : undefined,
    };
  });
  return clips.sort(
    (a, b) => totalScore(b.scores!) - totalScore(a.scores!) || (b.opus?.opusScore ?? -1) - (a.opus?.opusScore ?? -1),
  );
}

/** The most recent scoring run, or null before the first run or without Supabase. */
export async function getLastScoringRunSummary() {
  await connection();
  const db = getDb();
  return db ? getLastScoringRun(db) : null;
}

/** Clips synced from Opus that the agent hasn't scored yet, best Opus score first. */
export async function getUnscoredClips(): Promise<CandidateClip[]> {
  await connection();
  const db = getDb();
  // The mock shortlist is already scored.
  if (!db) return [];

  const { data, error } = await db
    .from("clips")
    .select("id, opus_clip_id, title, format, duration_seconds, source_videos (title)")
    .eq("status", "candidate")
    .is("scored_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load unscored clips: ${error.message}`);

  const media = await getOpusMedia(data.map((row) => row.opus_clip_id));
  const clips: CandidateClip[] = data.map((row) => ({
    id: row.id,
    title: row.title,
    sourceVideo: row.source_videos.title,
    format: row.format,
    durationSeconds: row.duration_seconds,
    scores: null,
    predictedViews: null,
    opus: row.opus_clip_id ? media.get(row.opus_clip_id) : undefined,
  }));
  return clips.sort((a, b) => (b.opus?.opusScore ?? -1) - (a.opus?.opusScore ?? -1));
}

/** Opus project IDs that already have a source video row. */
export async function getSyncedOpusProjectIds(): Promise<Set<string>> {
  await connection();
  const db = getDb();
  if (!db) return new Set();

  const { data, error } = await db.from("source_videos").select("opus_project_id").not("opus_project_id", "is", null);
  if (error) throw new Error(`Failed to load synced Opus projects: ${error.message}`);
  return new Set(data.map((row) => row.opus_project_id!));
}

/**
 * Fresh thumbnail and preview links from Opus, keyed by composite Opus clip ID.
 * One request per project. Clips are missing from the map when Opus is unreachable,
 * so the page still renders without media.
 */
async function getOpusMedia(opusClipIds: (string | null)[]): Promise<Map<string, OpusMedia>> {
  const media = new Map<string, OpusMedia>();
  if (!isIntegrationConnected("opus")) return media;

  // Composite IDs are "{projectId}.{clipId}".
  const projectIds = [...new Set(opusClipIds.flatMap((id) => (id ? [id.split(".")[0]] : [])))];
  const results = await Promise.allSettled(projectIds.map((projectId) => listClipsCached(projectId)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`Couldn't load Opus media for project ${projectIds[i]}:`, result.reason);
      return;
    }
    for (const clip of result.value) {
      media.set(clip.id, {
        thumbnailUrl: clip.thumbnailUrl,
        previewUrl: clip.previewUrl,
        projectUrl: opusProjectUrl(clip.projectId),
        opusScore: clip.opusScore,
      });
    }
  });
  return media;
}
