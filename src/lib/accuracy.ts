// How good the scoring agent's view predictions are. Shared by the weekly report, the
// backtest, and the Learnings page. Pure functions, no I/O.

export type PredictionOutcome = {
  id: string;
  predictedLow: number;
  predictedExpected: number;
  predictedHigh: number;
  actual: number;
};

export type AccuracyMetrics = {
  count: number;
  /** Spearman rank correlation between expected and actual views, -1 to 1. Null under 3 items. */
  spearman: number | null;
  /** Share of items whose actual views fell inside the predicted low to high range, 0 to 1. */
  rangeHitRate: number | null;
  /** Share of top 7 picks that beat the channel's median settled views, 0 to 1. */
  top7HitRate: number | null;
  /** How many groups (weeks, or months in a backtest) the top 7 rate covers. */
  top7Groups: number;
};

export function median(values: number[]) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Average ranks, 1-based, with ties sharing the mean of their positions. */
function ranks(values: number[]) {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].v === order[start].v) end++;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) out[order[k].i] = rank;
    start = end + 1;
  }
  return out;
}

/** Spearman's rho: Pearson correlation of the ranks, so ties are handled. Null under 3 pairs. */
export function spearman(xs: number[], ys: number[]) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

export function rangeHitRate(items: PredictionOutcome[]) {
  if (items.length === 0) return null;
  return items.filter((i) => i.actual >= i.predictedLow && i.actual <= i.predictedHigh).length / items.length;
}

/**
 * Share of each group's top 7 (already chosen) that beat the channel median. Groups with
 * no picks are skipped.
 */
export function top7HitRate(groups: { id: string; actual: number }[][], channelMedian: number) {
  const picks = groups.flat();
  if (picks.length === 0) return { rate: null, groups: 0 };
  return { rate: picks.filter((p) => p.actual > channelMedian).length / picks.length, groups: groups.filter((g) => g.length).length };
}

export function accuracyMetrics(items: PredictionOutcome[], top7Groups: { id: string; actual: number }[][], channelMedian: number | null): AccuracyMetrics {
  const top7 = channelMedian === null ? { rate: null, groups: 0 } : top7HitRate(top7Groups, channelMedian);
  return {
    count: items.length,
    spearman: spearman(
      items.map((i) => i.predictedExpected),
      items.map((i) => i.actual),
    ),
    rangeHitRate: rangeHitRate(items),
    top7HitRate: top7.rate,
    top7Groups: top7.groups,
  };
}
