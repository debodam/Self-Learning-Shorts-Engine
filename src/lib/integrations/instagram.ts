import "server-only";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { fetchJson, requireEnv, type PlatformVideo, type VideoMetrics } from "@/lib/integrations/shared";
import { mockRecentVideos, mockVideoMetrics } from "@/lib/mock/platform-videos";

// Instagram Graph API (Instagram API with Facebook Login, for a business account).
// Docs: https://developers.facebook.com/docs/instagram-platform
// Every function returns mock data when the Instagram env vars aren't set.

// TODO(instagram): confirm the API version to pin. The docs listed v26.0 as latest when
// this was written. If the token comes from Instagram Login instead of Facebook Login,
// the host is graph.instagram.com.
const GRAPH_API = "https://graph.facebook.com/v26.0";

const connected = () => isIntegrationConnected("instagram");

async function get<T>(path: string, params: Record<string, string>) {
  const query = new URLSearchParams({ ...params, access_token: requireEnv("INSTAGRAM_ACCESS_TOKEN") });
  return fetchJson<T>("Instagram", `${GRAPH_API}/${path}?${query}`);
}

/** Most recent Reels on the business account, newest first. */
export async function listRecentVideos(limit = 20): Promise<PlatformVideo[]> {
  if (!connected()) return mockRecentVideos("instagram", limit);

  type Media = {
    id: string;
    caption?: string;
    media_type: string;
    media_product_type?: string;
    permalink?: string;
    timestamp: string;
  };
  const res = await get<{ data: Media[] }>(`${requireEnv("INSTAGRAM_BUSINESS_ACCOUNT_ID")}/media`, {
    fields: "id,caption,media_type,media_product_type,permalink,timestamp",
    // Ask for extra since non-Reels posts are filtered out below.
    limit: String(Math.min(limit * 2, 100)),
  });
  return res.data
    .filter((m) => m.media_product_type === "REELS")
    .slice(0, limit)
    .map((m) => ({
      platform: "instagram",
      id: m.id,
      // Reels have no title. Use the caption's first line, which is our hook line.
      title: m.caption?.split("\n")[0] ?? "",
      url: m.permalink ?? null,
      publishedAt: m.timestamp,
      // Not exposed on media objects.
      durationSeconds: null,
    }));
}

/** Lifetime insights for one Reel. */
export async function getVideoMetrics(mediaId: string): Promise<VideoMetrics> {
  if (!connected()) return mockVideoMetrics("instagram", mediaId);

  // TODO(instagram): `views` is marked "in development" in the docs. If it errors, fall
  // back to `reach` for a rough count. `follows` isn't available for Reels.
  const metricNames = ["views", "ig_reels_avg_watch_time", "shares", "saved", "comments", "likes"];
  const res = await get<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
    `${mediaId}/insights`,
    { metric: metricNames.join(",") },
  );
  const value = (name: string) => {
    const entry = res.data.find((d) => d.name === name);
    return entry?.total_value?.value ?? entry?.values?.[0]?.value ?? null;
  };
  const avgWatchMs = value("ig_reels_avg_watch_time");
  return {
    platform: "instagram",
    videoId: mediaId,
    capturedAt: new Date().toISOString(),
    views: value("views"),
    // Instagram reports average watch time, not percent. Callers convert using the
    // clip's duration from our clips table.
    avgPercentWatched: null,
    avgWatchSeconds: avgWatchMs === null ? null : avgWatchMs / 1000,
    shares: value("shares"),
    saves: value("saved"),
    followsGained: null,
    comments: value("comments"),
    likes: value("likes"),
  };
}
