import "server-only";
import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { listChannelShorts, youtubeConnected } from "@/lib/integrations/youtube";
import { engagementRate, settledViews, type Confidence, type ShortFormat } from "@/lib/youtube-marks";

export type ShortRow = {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes: number | null;
  comments: number | null;
  views48h: number | null;
  views7d: number | null;
  /** The main performance number: see settledViews. Null until a newer Short has 7-day views. */
  settledViews: number | null;
  engagement: number | null;
  /** Claude's label. Null until labeled. */
  format: ShortFormat | null;
  formatConfidence: Confidence | null;
  formatReason: string | null;
  fromPipeline: boolean;
};

export type UnmatchedPost = { id: string; title: string; expectedAt: string; note: string };

export type ShortsPerformance = {
  shorts: ShortRow[];
  unmatched: UnmatchedPost[];
  lastPulledAt: string | null;
  /** Sample data: YouTube or Supabase isn't connected. Nothing here is saved. */
  mock: boolean;
};

const PAGE = 1000;

/** Every saved Short with its latest metrics, plus our YouTube posts that couldn't be matched. */
export async function getShortsPerformance(): Promise<ShortsPerformance> {
  await connection();
  const db = getDb();
  if (!db || !youtubeConnected()) {
    const { shorts } = await listChannelShorts();
    const now = Date.now();
    return {
      mock: true,
      unmatched: [],
      lastPulledAt: null,
      shorts: shorts.map((s) => ({
        ...s,
        views48h: null,
        views7d: null,
        settledViews: settledViews(s.publishedAt, s.views, null, now),
        engagement: engagementRate(s.views, s.likes, s.comments),
        format: /\bmock\b/i.test(s.title) ? "mock_interview" : "conversational",
        formatConfidence: null,
        formatReason: "Sample data",
        fromPipeline: false,
      })),
    };
  }

  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("youtube_shorts")
      .select("video_id, title, published_at, duration_seconds, views, likes, comments, views_48h, views_7d, format, format_confidence, format_reason, post_id, last_pulled_at")
      .order("published_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load Shorts: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const { data: flagged, error: flaggedError } = await db
    .from("posts")
    .select("id, caption, posted_at, scheduled_for, match_note, clips (title, youtube_title)")
    .eq("platform", "youtube")
    .not("match_note", "is", null);
  if (flaggedError) throw new Error(`Failed to load unmatched posts: ${flaggedError.message}`);

  const now = Date.now();
  return {
    mock: false,
    lastPulledAt: rows.reduce<string | null>((latest, r) => (!latest || r.last_pulled_at > latest ? r.last_pulled_at : latest), null),
    unmatched: flagged.map((p) => ({
      id: p.id,
      title: p.caption?.trim().split("\n")[0].trim() || p.clips.youtube_title || p.clips.title,
      expectedAt: (p.posted_at ?? p.scheduled_for)!,
      note: p.match_note!,
    })),
    shorts: rows.map((r) => ({
      videoId: r.video_id,
      title: r.title,
      publishedAt: r.published_at,
      durationSeconds: r.duration_seconds,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      views48h: r.views_48h,
      views7d: r.views_7d,
      // Computed here too, so a Short crossing 30 days counts before the next pull.
      settledViews: settledViews(r.published_at, r.views, r.views_7d, now),
      engagement: engagementRate(r.views, r.likes, r.comments),
      format: r.format as ShortFormat | null,
      formatConfidence: r.format_confidence as Confidence | null,
      formatReason: r.format_reason,
      fromPipeline: r.post_id !== null,
    })),
  };
}
