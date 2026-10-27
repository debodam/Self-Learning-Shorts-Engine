import type { ClipFormat, Platform } from "@/lib/clips";

export type PlatformMetrics = {
  views: number;
  /** Average share of the clip watched, 0 to 100. */
  avgPercentWatched: number;
  shares: number;
};

export type PostedClip = {
  id: string;
  title: string;
  format: ClipFormat;
  /** ISO timestamp. Clips go out at 12pm Eastern on all three platforms. */
  postedAt: string;
  metrics: Record<Platform, PlatformMetrics>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Splits clips into the 7 days ending at the latest post and the 7 days before that.
 * Anchoring on the latest post keeps "this week" meaningful for fixed mock data.
 */
export function splitWeeks(clips: PostedClip[]) {
  if (clips.length === 0) return { thisWeek: [], lastWeek: [], weekStart: null, weekEnd: null };
  const latest = Math.max(...clips.map((c) => Date.parse(c.postedAt)));
  const weekStartMs = latest - 6 * DAY_MS;
  const lastWeekStartMs = weekStartMs - 7 * DAY_MS;
  const thisWeek: PostedClip[] = [];
  const lastWeek: PostedClip[] = [];
  for (const clip of clips) {
    const t = Date.parse(clip.postedAt);
    if (t >= weekStartMs) thisWeek.push(clip);
    else if (t >= lastWeekStartMs) lastWeek.push(clip);
  }
  return { thisWeek, lastWeek, weekStart: new Date(weekStartMs), weekEnd: new Date(latest) };
}

export function totalViews(clips: PostedClip[], platform: Platform) {
  return clips.reduce((sum, c) => sum + c.metrics[platform].views, 0);
}
