import "server-only";
import { connection } from "next/server";
import { rubricCategories, totalScore, type CandidateClip, type OpusMedia } from "@/lib/clips";
import { getLastScoringRun } from "@/lib/clip-scoring";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { listClipsCached, opusEditorUrl } from "@/lib/integrations/opus";
import { mockCandidateClips } from "@/lib/mock/candidate-clips";

export type ReviewClips = {
  /** Kept clips by rubric score, then unscored, then cut. */
  clips: CandidateClip[];
  scoredCount: number;
  unscoredCount: number;
};

/** Higher total first, then by each rubric category in order. Opus's score never counts. */
function byRubric(a: CandidateClip, b: CandidateClip) {
  const total = totalScore(b.scores!) - totalScore(a.scores!);
  if (total) return total;
  for (const c of rubricCategories) if (b.scores![c] !== a.scores![c]) return b.scores![c] - a.scores![c];
  return 0;
}

/** Every clip up for review: candidates, cut clips, and synced clips not scored yet. */
export async function getReviewClips(): Promise<ReviewClips> {
  await connection();
  const db = getDb();
  if (!db) {
    const clips = mockCandidateClips.map((c) => ({ ...c, cut: false }));
    return { clips, scoredCount: clips.length, unscoredCount: 0 };
  }

  const { data, error } = await db
    .from("clips")
    .select(
      "id, opus_clip_id, status, title, transcript, format, duration_seconds, scored_at, frames_checked, face_frames, people_count, text_readable, cut_reason, score_hook, score_tension, score_standalone, score_payoff, score_loopability, score_total, score_reasoning, suggested_title, youtube_title, youtube_description, picked, predicted_views_youtube, predicted_views_tiktok, predicted_views_instagram, source_videos (title, week_id)",
    )
    // Cut clips are saved as rejected.
    .in("status", ["candidate", "rejected"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load clips: ${error.message}`);

  const media = await getOpusMedia(data.map((row) => row.opus_clip_id));
  const all = data.map((row): CandidateClip => {
    // score_total is only set when all five scores are.
    const scores =
      row.scored_at && row.score_total !== null
        ? {
            hook: row.score_hook!,
            tension: row.score_tension!,
            standalone: row.score_standalone!,
            payoff: row.score_payoff!,
            loopability: row.score_loopability!,
          }
        : null;
    return {
      id: row.id,
      title: row.title,
      sourceVideo: row.source_videos.title,
      format: row.format,
      durationSeconds: row.duration_seconds,
      scores,
      // The scoring job sets all three together.
      predictedViews:
        scores && row.predicted_views_youtube !== null && row.predicted_views_tiktok !== null && row.predicted_views_instagram !== null
          ? { youtube: row.predicted_views_youtube, tiktok: row.predicted_views_tiktok, instagram: row.predicted_views_instagram }
          : null,
      reason: scores ? row.score_reasoning : null,
      suggestedTitle: scores ? row.suggested_title : null,
      // The scoring run decides cuts, including hard rules like the face rule, and saves them as rejected.
      cut: scores ? row.status === "rejected" : false,
      cutReason: scores ? row.cut_reason : null,
      vision:
        scores && row.frames_checked && row.face_frames !== null
          ? { framesChecked: row.frames_checked, faceFrames: row.face_frames, peopleCount: row.people_count ?? 0, textReadable: row.text_readable ?? true }
          : null,
      picked: row.picked,
      weekId: row.source_videos.week_id,
      youtubeTitle: row.youtube_title,
      youtubeDescription: row.youtube_description,
      // Composite Opus IDs are "{projectId}.{clipId}".
      batchId: row.opus_clip_id?.split(".")[0],
      transcript: row.transcript,
      opus: row.opus_clip_id ? media.get(row.opus_clip_id) : undefined,
    };
  });

  const kept = all.filter((c) => c.scores && !c.cut).sort(byRubric);
  const cut = all.filter((c) => c.scores && c.cut).sort(byRubric);
  const unscored = all.filter((c) => !c.scores);
  return { clips: [...kept, ...unscored, ...cut], scoredCount: kept.length + cut.length, unscoredCount: unscored.length };
}

export type WeekVideo = { id: string; title: string; youtubeUrl: string; status: string | null; checkedAt: string | null };
export type Week = { id: string; startsOn: string; createdAt: string; videos: WeekVideo[] };

/** Every week, newest first. The first is the current week. */
export async function getWeeks(): Promise<Week[]> {
  await connection();
  const db = getDb();
  if (!db) return [];

  const { data, error } = await db
    .from("weeks")
    .select("id, starts_on, created_at, source_videos (id, title, youtube_url, opus_status, opus_checked_at)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load weeks: ${error.message}`);
  return data.map((w) => ({
    id: w.id,
    startsOn: w.starts_on,
    createdAt: w.created_at,
    videos: w.source_videos.map((v) => ({ id: v.id, title: v.title, youtubeUrl: v.youtube_url, status: v.opus_status, checkedAt: v.opus_checked_at })),
  }));
}

export type UpcomingPost = { id: string; clipTitle: string; scheduledFor: string; status: string };

/** Posts scheduled from now on, soonest first. */
export async function getUpcomingPosts(): Promise<UpcomingPost[]> {
  await connection();
  const db = getDb();
  if (!db) return [];

  const { data, error } = await db
    .from("posts")
    .select("id, scheduled_for, status, clips (title, youtube_title)")
    .eq("status", "scheduled")
    .gte("scheduled_for", new Date().toISOString())
    .order("scheduled_for");
  if (error) throw new Error(`Failed to load the schedule: ${error.message}`);
  return data.map((p) => ({ id: p.id, clipTitle: p.clips.youtube_title ?? p.clips.title, scheduledFor: p.scheduled_for!, status: p.status }));
}

/** The most recent scoring run, or null before the first run or without Supabase. */
export async function getLastScoringRunSummary() {
  await connection();
  const db = getDb();
  return db ? getLastScoringRun(db) : null;
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
        editorUrl: opusEditorUrl(clip.projectId, clip.clipId),
        opusScore: clip.opusScore,
      });
    }
  });
  return media;
}
