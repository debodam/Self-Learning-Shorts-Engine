// Views at fixed ages (48 hours and 7 days after publish) from timestamped snapshots, so
// Shorts posted on different days compare fairly. The public API only reports current
// totals, so a mark is only known when a pull ran close to it.

const HOUR_MS = 60 * 60 * 1000;

export type Mark = {
  key: "views_48h" | "views_7d";
  ageMs: number;
  /** Interpolate between snapshots (or publish, at 0 views) at most this far apart. */
  maxGapMs: number;
  /** With nothing usable before the mark, accept the first snapshot this soon after it. */
  maxLateMs: number;
};

export const MARKS: Mark[] = [
  { key: "views_48h", ageMs: 48 * HOUR_MS, maxGapMs: 24 * HOUR_MS, maxLateMs: 6 * HOUR_MS },
  { key: "views_7d", ageMs: 7 * 24 * HOUR_MS, maxGapMs: 48 * HOUR_MS, maxLateMs: 24 * HOUR_MS },
];

/** The latest age at which a new snapshot can still settle every mark. */
export const MARK_WINDOW_MS = Math.max(...MARKS.map((m) => m.ageMs + Math.max(m.maxGapMs, m.maxLateMs)));

export type Snapshot = { capturedAt: string; views: number };

/** Views at `mark` after `publishedAt`, or null when no snapshot was close enough. */
export function viewsAtMark(publishedAt: string, snapshots: Snapshot[], mark: Mark): number | null {
  const published = Date.parse(publishedAt);
  const target = published + mark.ageMs;
  // A Short has 0 views when it goes live, which anchors the first stretch.
  const points = [{ t: published, views: 0 }, ...snapshots.map((s) => ({ t: Date.parse(s.capturedAt), views: s.views }))]
    .filter((p) => p.t >= published)
    .sort((a, b) => a.t - b.t);

  const before = points.filter((p) => p.t <= target).at(-1);
  const after = points.find((p) => p.t >= target);
  if (before && before.t === target) return before.views;
  if (before && after && after.t - before.t <= mark.maxGapMs) {
    const share = (target - before.t) / (after.t - before.t);
    return Math.round(before.views + (after.views - before.views) * share);
  }
  if (after && after.t - target <= mark.maxLateMs) return after.views;
  return null;
}

/** (likes + comments) / views, or null without views. Hidden counts count as 0. */
export function engagementRate(views: number, likes: number | null, comments: number | null) {
  return views > 0 ? ((likes ?? 0) + (comments ?? 0)) / views : null;
}
