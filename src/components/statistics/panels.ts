// Which series of a time chart may share one axis. Two measures on one axis are honest only while the smaller one stays readable;
// below this share of the larger one it would be a flat line, so it gets its own panel with its own axis (never a second y-scale
// drawn over the first), and the panels share one day axis and one hover.
export const SHARED_AXIS_MIN_SHARE = 0.25;

/** A round top for the axis: at least 2, so one member on one day is not a full-height column. */
export function niceMax(max: number): number {
  if (max <= 2) return 2;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * step >= max) return Math.ceil(m * step);
  return Math.ceil(max);
}

/** Groups of series indices, one group per panel, in series order. A series joins the first group whose largest value is within reach of its own. */
export function planPanels(peaks: number[]): number[][] {
  const groups: { peak: number; members: number[] }[] = [];
  peaks.forEach((peak, i) => {
    const home = groups.find((g) => Math.min(g.peak, peak) >= SHARED_AXIS_MIN_SHARE * Math.max(g.peak, peak));
    if (home) {
      home.members.push(i);
      home.peak = Math.max(home.peak, peak);
    } else groups.push({ peak, members: [i] });
  });
  return groups.map((g) => g.members);
}
