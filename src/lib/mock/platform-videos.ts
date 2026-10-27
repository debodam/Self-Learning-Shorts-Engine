import type { Platform } from "@/lib/clips";
import type { PlatformVideo, VideoMetrics } from "@/lib/integrations/shared";
import { mockPostedClips } from "@/lib/mock/posted-clips";

// Platform API stand-ins, built from the posted-clips mock so the numbers match the
// Performance page. Fields a platform's API doesn't report are null, as in real responses.

const mockIds: Record<Platform, (n: number) => string> = {
  youtube: (n) => `ytShort${String(n).padStart(4, "0")}`,
  tiktok: (n) => `74210000000000${String(n).padStart(5, "0")}`,
  instagram: (n) => `1798000000000${String(n).padStart(4, "0")}`,
};

const mockUrls: Record<Platform, (id: string) => string | null> = {
  youtube: (id) => `https://www.youtube.com/shorts/${id}`,
  tiktok: (id) => `https://www.tiktok.com/@aced/video/${id}`,
  instagram: (id) => `https://www.instagram.com/reel/${id}/`,
};

// Rough clip length so Instagram's average watch time converts back to the mock percent.
const MOCK_DURATION_SECONDS = 48;

export function mockRecentVideos(platform: Platform, limit: number): PlatformVideo[] {
  return mockPostedClips.slice(0, limit).map((clip, i) => {
    const id = mockIds[platform](i + 1);
    return {
      platform,
      id,
      title: clip.title,
      url: mockUrls[platform](id),
      publishedAt: clip.postedAt,
      durationSeconds: platform === "instagram" ? null : MOCK_DURATION_SECONDS,
    };
  });
}

export function mockVideoMetrics(platform: Platform, videoId: string): VideoMetrics {
  const index = mockPostedClips.findIndex((_, i) => mockIds[platform](i + 1) === videoId);
  const m = mockPostedClips[index >= 0 ? index : 0].metrics[platform];
  const views = m?.views ?? 0;
  const watched = m?.avgPercentWatched ?? 0;
  return {
    platform,
    videoId,
    capturedAt: new Date().toISOString(),
    views,
    avgPercentWatched: platform === "youtube" ? watched : null,
    avgWatchSeconds: platform === "instagram" ? Math.round((watched / 100) * MOCK_DURATION_SECONDS * 10) / 10 : null,
    shares: m?.shares ?? 0,
    saves: platform === "youtube" || platform === "tiktok" ? null : Math.round(views * 0.012),
    followsGained: platform === "youtube" ? Math.round(views * 0.0015) : null,
    comments: Math.round(views * 0.0011),
    likes: Math.round(views * 0.045),
  };
}
