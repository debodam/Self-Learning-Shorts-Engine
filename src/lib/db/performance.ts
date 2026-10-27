import "server-only";
import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { mockPostedClips } from "@/lib/mock/posted-clips";
import type { PostedClip } from "@/lib/performance";

/** Posted clips with the latest metrics snapshot for each platform. */
export async function getPostedClips(): Promise<PostedClip[]> {
  await connection();
  const db = getDb();
  if (!db) return mockPostedClips;

  const { data, error } = await db
    .from("clips")
    .select(
      "id, title, format, posts (platform, posted_at, metrics (captured_at, views, avg_percent_watched, shares))",
    )
    .eq("posts.status", "posted")
    .not("posts.posted_at", "is", null)
    .order("captured_at", { referencedTable: "posts.metrics", ascending: false })
    .limit(1, { referencedTable: "posts.metrics" });
  if (error) throw new Error(`Failed to load posted clips: ${error.message}`);

  return data.flatMap((clip) => {
    if (clip.posts.length === 0) return [];
    const metrics: PostedClip["metrics"] = {};
    for (const post of clip.posts) {
      const latest = post.metrics[0];
      if (!latest) continue;
      metrics[post.platform] = {
        views: latest.views ?? 0,
        avgPercentWatched: Number(latest.avg_percent_watched ?? 0),
        shares: latest.shares ?? 0,
      };
    }
    // A clip goes out on all platforms the same day; use the earliest post time.
    const postedAt = clip.posts
      .map((p) => p.posted_at!)
      .reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
    return [{ id: clip.id, title: clip.title, format: clip.format, postedAt, metrics }];
  });
}
