// How the week's top 7 are ranked: the rubric and predicted views together. CLAUDE.md
// explains the formula; keep the two in sync.
//
//   rank score = 0.5 x rubric part + 0.5 x views part
//   rubric part = (rubric total - 5) / 20, so 5/25 is 0 and 25/25 is 1
//   views part  = where the clip's expected predicted views fall among the clips being
//                 ranked: 0 for the lowest, 1 for the highest (ties share a value)
//
// A clip without a prediction gets 0.5 for the views part, so missing data neither helps
// nor hurts it. Ties go to the higher rubric total, then the higher expected views.

export const RUBRIC_WEIGHT = 0.5;
export const VIEWS_WEIGHT = 0.5;

export type Rankable = { id: string; rubricTotal: number; expectedViews: number | null };

/** Percentile of each value among the values, 0 to 1. A single value is 0.5. */
function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return (v: number) => {
    if (sorted.length < 2) return 0.5;
    const below = sorted.filter((x) => x < v).length;
    const equal = sorted.filter((x) => x === v).length;
    return (below + (equal - 1) / 2) / (sorted.length - 1);
  };
}

/** Rank scores, 0 to 1, keyed by id. */
export function rankScores(clips: Rankable[]) {
  const viewsPart = percentiles(clips.flatMap((c) => (c.expectedViews === null ? [] : [c.expectedViews])));
  return new Map(
    clips.map((c) => {
      const rubric = (c.rubricTotal - 5) / 20;
      const views = c.expectedViews === null ? 0.5 : viewsPart(c.expectedViews);
      return [c.id, RUBRIC_WEIGHT * rubric + VIEWS_WEIGHT * views];
    }),
  );
}

/** Best first by rank score. */
export function rankClips<T extends Rankable>(clips: T[]): T[] {
  const scores = rankScores(clips);
  return [...clips].sort(
    (a, b) =>
      scores.get(b.id)! - scores.get(a.id)! ||
      b.rubricTotal - a.rubricTotal ||
      (b.expectedViews ?? -1) - (a.expectedViews ?? -1),
  );
}
