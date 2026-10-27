import type { Platform } from "@/lib/clips";
import * as instagram from "@/lib/integrations/instagram";
import type { PlatformVideo, VideoMetrics } from "@/lib/integrations/shared";
import * as tiktok from "@/lib/integrations/tiktok";
import * as youtube from "@/lib/integrations/youtube";
import { must, runJob } from "./lib";

// Metrics pull: for each platform, read recent videos, match them to our posts by
// platform_post_id, and save a metrics snapshot for each match.

const VIDEOS_PER_PLATFORM = 50;
const DRY_RUN_VIDEOS_PER_PLATFORM = 3;

const clients: Record<
  Platform,
  { listRecentVideos: (limit: number) => Promise<PlatformVideo[]>; getVideoMetrics: (id: string, v: PlatformVideo) => Promise<VideoMetrics> }
> = {
  youtube: { listRecentVideos: youtube.listRecentVideos, getVideoMetrics: (id, v) => youtube.getVideoMetrics(id, { publishedAt: v.publishedAt }) },
  tiktok: { listRecentVideos: tiktok.listRecentVideos, getVideoMetrics: (id) => tiktok.getVideoMetrics(id) },
  instagram: { listRecentVideos: instagram.listRecentVideos, getVideoMetrics: (id) => instagram.getVideoMetrics(id) },
};

/** Instagram reports seconds watched; convert to percent with the clip's length. */
function percentWatched(m: VideoMetrics, durationSeconds: number | null) {
  if (m.avgPercentWatched !== null) return m.avgPercentWatched;
  if (m.avgWatchSeconds === null || !durationSeconds) return null;
  return Math.min(100, Math.round((m.avgWatchSeconds / durationSeconds) * 10000) / 100);
}

runJob("Metrics pull", async ({ db, log }) => {
  let saved = 0;
  for (const platform of Object.keys(clients) as Platform[]) {
    const client = clients[platform];
    const videos = await client.listRecentVideos(db ? VIDEOS_PER_PLATFORM : DRY_RUN_VIDEOS_PER_PLATFORM);

    if (!db) {
      for (const video of videos) {
        const m = await client.getVideoMetrics(video.id, video);
        const pct = percentWatched(m, video.durationSeconds);
        log(`  ${platform} ${video.id}: ${m.views ?? "n/a"} views, ${pct === null ? "n/a" : `${pct}%`} watched, ${m.shares ?? "n/a"} shares`);
      }
      log(`${platform}: read ${videos.length} videos (dry run, not matched to posts).`);
      continue;
    }

    const posts = must(
      await db
        .from("posts")
        .select("id, platform_post_id, clips (duration_seconds)")
        .eq("platform", platform)
        .in("platform_post_id", videos.map((v) => v.id)),
      `load ${platform} posts`,
    );
    const postByVideoId = new Map(posts.map((p) => [p.platform_post_id!, p]));
    const matched = videos.filter((v) => postByVideoId.has(v.id));

    const rows = [];
    for (const video of matched) {
      const post = postByVideoId.get(video.id)!;
      const m = await client.getVideoMetrics(video.id, video);
      rows.push({
        post_id: post.id,
        captured_at: m.capturedAt,
        views: m.views,
        avg_percent_watched: percentWatched(m, post.clips.duration_seconds ?? video.durationSeconds),
        shares: m.shares,
        saves: m.saves,
        follows_gained: m.followsGained,
        comments: m.comments,
      });
    }
    if (rows.length) must(await db.from("metrics").insert(rows).select("id"), `save ${platform} metrics`);
    saved += rows.length;
    log(`${platform}: ${videos.length} recent videos, ${matched.length} matched to posts, ${rows.length} snapshots saved.`);
  }
  // TODO: posts only match once platform_post_id is set. Fill it in when Opus scheduling
  // reports the platform's post ID, or from the V1 import.
  if (db) log(`Saved ${saved} metrics snapshots.`);
});
