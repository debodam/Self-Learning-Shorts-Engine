import "server-only";
import { connection } from "next/server";
import type { CandidateClip } from "@/lib/clips";
import { getDb } from "@/lib/db/client";
import { mockCandidateClips } from "@/lib/mock/candidate-clips";

const SHORTLIST_SIZE = 10;

/** This week's scored shortlist, best total score first. */
export async function getCandidateClips(): Promise<CandidateClip[]> {
  await connection();
  const db = getDb();
  if (!db) return mockCandidateClips;

  const { data, error } = await db
    .from("clips")
    .select(
      "id, title, format, duration_seconds, score_hook, score_tension, score_standalone, score_payoff, score_loopability, predicted_views_youtube, predicted_views_tiktok, predicted_views_instagram, source_videos (title)",
    )
    .eq("status", "candidate")
    .not("score_total", "is", null)
    .order("score_total", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(SHORTLIST_SIZE);
  if (error) throw new Error(`Failed to load candidate clips: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    sourceVideo: row.source_videos.title,
    format: row.format,
    durationSeconds: row.duration_seconds,
    // score_total is only set when all five scores are, so these are non-null.
    scores: {
      hook: row.score_hook!,
      tension: row.score_tension!,
      standalone: row.score_standalone!,
      payoff: row.score_payoff!,
      loopability: row.score_loopability!,
    },
    // The scoring job sets all three together.
    predictedViews:
      row.predicted_views_youtube !== null && row.predicted_views_tiktok !== null && row.predicted_views_instagram !== null
        ? { youtube: row.predicted_views_youtube, tiktok: row.predicted_views_tiktok, instagram: row.predicted_views_instagram }
        : null,
  }));
}
