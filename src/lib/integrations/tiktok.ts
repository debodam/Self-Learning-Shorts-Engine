import "server-only";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { fetchJson, requireEnv, type PlatformVideo, type VideoMetrics } from "@/lib/integrations/shared";
import { mockRecentVideos, mockVideoMetrics } from "@/lib/mock/platform-videos";

// TikTok API v2 (Display API). Docs: https://developers.tiktok.com/doc/tiktok-api-v2-video-list
// Needs a user access token with the video.list scope.
// Every function returns mock data when the TikTok env vars aren't set.

const API = "https://open.tiktokapis.com/v2";
const VIDEO_FIELDS = "id,title,video_description,create_time,duration,share_url,view_count,like_count,comment_count,share_count";

type TikTokVideo = {
  id: string;
  title?: string;
  video_description?: string;
  create_time: number;
  duration?: number;
  share_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

type TikTokResponse<T> = { data: T; error: { code: string; message: string } };

const connected = () => isIntegrationConnected("tiktok");

async function post<T>(path: string, body: unknown) {
  // TODO(tiktok): access tokens expire after 24 hours. Add a refresh using
  // TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and a stored refresh token
  // (POST /v2/oauth/token/, grant_type=refresh_token) before running this on a schedule.
  const res = await fetchJson<TikTokResponse<T>>("TikTok", `${API}/${path}?fields=${VIDEO_FIELDS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("TIKTOK_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.error.code !== "ok") throw new Error(`TikTok: ${res.error.code} ${res.error.message}`);
  return res.data;
}

/** Most recent videos on the authorized account, newest first. */
export async function listRecentVideos(limit = 20): Promise<PlatformVideo[]> {
  if (!connected()) return mockRecentVideos("tiktok", limit);

  const videos: TikTokVideo[] = [];
  let cursor: number | undefined;
  while (videos.length < limit) {
    // max_count is capped at 20 per page.
    const page = await post<{ videos: TikTokVideo[]; cursor: number; has_more: boolean }>("video/list/", {
      max_count: Math.min(limit - videos.length, 20),
      ...(cursor !== undefined && { cursor }),
    });
    videos.push(...page.videos);
    if (!page.has_more) break;
    cursor = page.cursor;
  }
  return videos.map((v) => ({
    platform: "tiktok",
    id: v.id,
    title: v.title || v.video_description?.split("\n")[0] || "",
    url: v.share_url ?? null,
    publishedAt: new Date(v.create_time * 1000).toISOString(),
    durationSeconds: v.duration ?? null,
  }));
}

/** Current counts for one video. */
export async function getVideoMetrics(videoId: string): Promise<VideoMetrics> {
  if (!connected()) return mockVideoMetrics("tiktok", videoId);

  const data = await post<{ videos: TikTokVideo[] }>("video/query/", { filters: { video_ids: [videoId] } });
  const v = data.videos[0];
  if (!v) throw new Error(`TikTok: video ${videoId} not found on this account`);
  return {
    platform: "tiktok",
    videoId,
    capturedAt: new Date().toISOString(),
    views: v.view_count ?? null,
    // TODO(tiktok): the Display API has no watch time, saves, or follows. Those need the
    // TikTok Business API (business account analytics) or manual export.
    avgPercentWatched: null,
    avgWatchSeconds: null,
    shares: v.share_count ?? null,
    saves: null,
    followsGained: null,
    comments: v.comment_count ?? null,
    likes: v.like_count ?? null,
  };
}
