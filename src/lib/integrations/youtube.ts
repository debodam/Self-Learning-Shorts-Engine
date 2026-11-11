import "server-only";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { fetchJson, requireEnv, type PlatformVideo, type VideoMetrics } from "@/lib/integrations/shared";
import { mockChannelShorts } from "@/lib/mock/channel-shorts";
import { mockLongFormUploads, mockRecentVideos, mockVideoMetrics } from "@/lib/mock/platform-videos";

// YouTube Data API v3 and YouTube Analytics API v2.
// Docs: https://developers.google.com/youtube/v3/docs and https://developers.google.com/youtube/analytics
//
// MVP 2 metrics use a plain API key (YOUTUBE_API_KEY) and the channel ID: public data
// only, so views, likes, and comments, but no retention or subscribers gained.
// The older helpers below (listRecentVideos, listRecentUploads, getVideoMetrics) use an
// OAuth client for the channel owner and stay on mock data until those vars are set.

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

/** API key and channel ID are set: public metrics are live. */
export const youtubeConnected = () => isIntegrationConnected("youtube");

const OAUTH_VARS = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN", "YOUTUBE_CHANNEL_ID"];
const connected = () => OAUTH_VARS.every((name) => process.env[name]?.trim());

let token: { value: string; expiresAt: number } | null = null;

async function accessToken() {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetchJson<{ access_token: string; expires_in: number }>("YouTube", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("YOUTUBE_CLIENT_ID"),
      client_secret: requireEnv("YOUTUBE_CLIENT_SECRET"),
      refresh_token: requireEnv("YOUTUBE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  token = { value: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
  return token.value;
}

async function get<T>(url: string) {
  return fetchJson<T>("YouTube", url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
}

/** ISO 8601 duration like "PT1M5S" to seconds. */
function parseDuration(iso: string) {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Most recent uploads on the channel, newest first. Includes long-form uploads, not only Shorts. */
export async function listRecentVideos(limit = 20): Promise<PlatformVideo[]> {
  if (!connected()) return mockRecentVideos("youtube", limit);

  // The uploads playlist is much cheaper on quota than search.list (1 unit vs 100).
  const channelId = requireEnv("YOUTUBE_CHANNEL_ID");
  const channels = await get<{ items: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
    `${DATA_API}/channels?${new URLSearchParams({ part: "contentDetails", id: channelId })}`,
  );
  const uploads = channels.items[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error(`YouTube: channel ${channelId} not found`);

  const playlist = await get<{ items: { contentDetails: { videoId: string } }[] }>(
    `${DATA_API}/playlistItems?${new URLSearchParams({ part: "contentDetails", playlistId: uploads, maxResults: String(Math.min(limit, 50)) })}`,
  );
  const ids = playlist.items.map((i) => i.contentDetails.videoId);
  if (ids.length === 0) return [];

  const videos = await get<{
    items: { id: string; snippet: { title: string; publishedAt: string }; contentDetails: { duration: string } }[];
  }>(`${DATA_API}/videos?${new URLSearchParams({ part: "snippet,contentDetails", id: ids.join(",") })}`);
  // TODO(youtube): there's no API flag for "is a Short". Filter by duration (3 minutes or
  // less) or by our own posts table if long-form uploads get in the way.
  return videos.items.map((v) => ({
    platform: "youtube",
    id: v.id,
    title: v.snippet.title,
    url: `https://www.youtube.com/shorts/${v.id}`,
    publishedAt: v.snippet.publishedAt,
    durationSeconds: parseDuration(v.contentDetails.duration),
  }));
}

/**
 * The channel name for any public video. Uses oEmbed, which needs no key, so it works
 * before the YouTube integration is connected. Null if the lookup fails.
 */
export async function getChannelTitle(videoUrl: string): Promise<string | null> {
  return (await getVideoInfo(videoUrl))?.channelTitle ?? null;
}

/** Title and channel for any public video, via keyless oEmbed. Null if the video can't be found. */
export async function getVideoInfo(videoUrl: string): Promise<{ title: string; channelTitle: string } | null> {
  try {
    const res = await fetchJson<{ title?: string; author_name?: string }>(
      "YouTube",
      `https://www.youtube.com/oembed?${new URLSearchParams({ url: videoUrl, format: "json" })}`,
    );
    return res.title ? { title: res.title, channelTitle: res.author_name ?? "" } : null;
  } catch {
    return null;
  }
}

/** The canonical watch URL for any YouTube link (watch, youtu.be, shorts, embed, live), or null. */
export function normalizeYouTubeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

export type LongFormUpload = PlatformVideo & { url: string; channelTitle: string };

/** Recent long-form uploads (the source videos Shorts are cut from), newest first. */
export async function listRecentUploads(options: { limit?: number; minDurationSeconds?: number } = {}): Promise<LongFormUpload[]> {
  const { limit = 25, minDurationSeconds = 180 } = options;
  if (!connected()) return mockLongFormUploads.slice(0, limit);

  const videos = await listRecentVideos(limit);
  const longForm = videos.filter((v) => (v.durationSeconds ?? 0) >= minDurationSeconds);
  if (longForm.length === 0) return [];
  const details = await get<{ items: { id: string; snippet: { channelTitle: string } }[] }>(
    `${DATA_API}/videos?${new URLSearchParams({ part: "snippet", id: longForm.map((v) => v.id).join(",") })}`,
  );
  const channelById = new Map(details.items.map((d) => [d.id, d.snippet.channelTitle]));
  return longForm.map((v) => ({
    ...v,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    channelTitle: channelById.get(v.id) ?? "",
  }));
}

/** Lifetime metrics for one video, from the Analytics API. */
export async function getVideoMetrics(videoId: string, options: { publishedAt?: string } = {}): Promise<VideoMetrics> {
  if (!connected()) return mockVideoMetrics("youtube", videoId);

  const metricNames = ["views", "averageViewPercentage", "shares", "subscribersGained", "comments", "likes"];
  const today = new Date().toISOString().slice(0, 10);
  // Analytics needs a date range. Start at publish time so totals cover the video's whole life.
  const startDate = (options.publishedAt ?? "2020-01-01").slice(0, 10);
  const res = await get<{ columnHeaders: { name: string }[]; rows?: (string | number)[][] }>(
    `${ANALYTICS_API}?${new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate: today,
      metrics: metricNames.join(","),
      filters: `video==${videoId}`,
    })}`,
  );
  // TODO(youtube): Analytics data lags by up to 2 to 3 days, so very new Shorts report zeros.
  const row = res.rows?.[0];
  const value = (name: string) => {
    const i = res.columnHeaders.findIndex((h) => h.name === name);
    return row && i >= 0 ? Number(row[i]) : 0;
  };
  return {
    platform: "youtube",
    videoId,
    capturedAt: new Date().toISOString(),
    views: value("views"),
    avgPercentWatched: value("averageViewPercentage"),
    avgWatchSeconds: null,
    shares: value("shares"),
    // YouTube doesn't report saves for videos.
    saves: null,
    followsGained: value("subscribersGained"),
    comments: value("comments"),
    likes: value("likes"),
  };
}

// Public metrics with the API key --------------------------------------------------

/** Shorts are videos 3 minutes or under. The API has no "is a Short" flag. */
export const SHORT_MAX_SECONDS = 180;
/** videos.list and playlistItems.list take up to 50 IDs or items per call, 1 quota unit each. */
const PAGE_SIZE = 50;

export type ChannelShort = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  /** Null when the channel hides like counts. */
  likes: number | null;
  /** Null when comments are off. */
  comments: number | null;
};

export type ChannelShortsResult = {
  shorts: ChannelShort[];
  /** Every public upload checked, Shorts or not. */
  videosChecked: number;
  /** API calls made. Each costs 1 quota unit of the 10,000 daily default. */
  quotaUnits: number;
  mock: boolean;
};

// The key goes in a header, not the URL, so it never shows up in error messages or logs.
async function keyGet<T>(path: string, params: Record<string, string>) {
  return fetchJson<T>("YouTube", `${DATA_API}/${path}?${new URLSearchParams(params)}`, {
    headers: { "X-Goog-Api-Key": requireEnv("YOUTUBE_API_KEY") },
  });
}

/**
 * Every public Short on the channel (YOUTUBE_CHANNEL_ID) with its current views, likes,
 * and comments. Reads the uploads playlist 50 at a time and looks up each page of 50 IDs
 * in one videos.list call, so a full pull of ~850 uploads costs about 35 quota units.
 * Mock Shorts when the key or channel ID is missing.
 */
export async function listChannelShorts(): Promise<ChannelShortsResult> {
  if (!youtubeConnected()) return { shorts: mockChannelShorts(), videosChecked: 0, quotaUnits: 0, mock: true };

  const channelId = requireEnv("YOUTUBE_CHANNEL_ID");
  let quotaUnits = 1;
  const channels = await keyGet<{ items?: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>("channels", {
    part: "contentDetails",
    id: channelId,
  });
  const uploads = channels.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error(`YouTube: channel ${channelId} not found. Check YOUTUBE_CHANNEL_ID.`);

  const shorts: ChannelShort[] = [];
  let videosChecked = 0;
  let pageToken: string | undefined;
  do {
    const page = await keyGet<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>("playlistItems", {
      part: "contentDetails",
      playlistId: uploads,
      maxResults: String(PAGE_SIZE),
      fields: "nextPageToken,items/contentDetails/videoId",
      ...(pageToken && { pageToken }),
    });
    quotaUnits++;
    pageToken = page.nextPageToken;
    const ids = page.items.map((i) => i.contentDetails.videoId);
    if (ids.length === 0) continue;

    const videos = await keyGet<{
      items: {
        id: string;
        snippet: { title: string; description: string; publishedAt: string; liveBroadcastContent: string };
        contentDetails: { duration: string };
        statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
      }[];
    }>("videos", {
      part: "snippet,contentDetails,statistics",
      id: ids.join(","),
      maxResults: String(PAGE_SIZE),
      fields:
        "items(id,snippet(title,description,publishedAt,liveBroadcastContent),contentDetails/duration,statistics(viewCount,likeCount,commentCount))",
    });
    quotaUnits++;
    videosChecked += videos.items.length;
    for (const v of videos.items) {
      const durationSeconds = parseDuration(v.contentDetails.duration);
      // Live streams and premieres report a zero duration until they end.
      if (!durationSeconds || durationSeconds > SHORT_MAX_SECONDS || v.snippet.liveBroadcastContent !== "none") continue;
      const count = (value?: string) => (value === undefined ? null : Number(value));
      shorts.push({
        videoId: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: v.snippet.publishedAt,
        durationSeconds,
        views: count(v.statistics.viewCount) ?? 0,
        likes: count(v.statistics.likeCount),
        comments: count(v.statistics.commentCount),
      });
    }
  } while (pageToken);

  return { shorts, videosChecked, quotaUnits, mock: false };
}
