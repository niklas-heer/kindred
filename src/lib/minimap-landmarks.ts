// Where the house shields sit on the minimap: one per house, at the middle of its largest cluster of people,
// nudged off each other where two would collide. Past a handful of houses the rest become small plain markers,
// so a big family's map stays readable and every house can still be jumped to. Pure geometry with no React, so the rules are unit-tested
// (minimap-landmarks.test.ts). The minimap says how world units map onto its pixels with `frame`.

/** One placed card of the layout: which house its person belongs to, and the card's centre in world units. */
export interface LandmarkPerson {
  id: string;
  house: string; // '' when the person has none
  x: number;
  y: number;
}

/** How world units become minimap pixels: px = world * s + o. */
export interface MinimapFrame {
  s: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

export interface LandmarkGrid {
  /** Card width and row height of the layout, in world units. */
  cardW: number;
  rowH: number;
  /** Shield width in minimap pixels (the shield is 5 wide to 6 tall). */
  size: number;
}

export interface HouseLandmark {
  house: string;
  /** Distinct people of this house in the layout. */
  people: number;
  /** Shield centre, minimap pixels. */
  x: number;
  y: number;
  /** Where a jump lands, world units: the middle of the house's largest cluster. */
  wx: number;
  wy: number;
  /** Width in minimap pixels, the height being 1.2 times that. */
  size: number;
  /** A small plain marker in the house's colour rather than the full shield. */
  compact: boolean;
  /** Tooltip side and alignment, so it stays inside the minimap. */
  tip: 'above' | 'below';
  align: 'start' | 'center' | 'end';
}

const SHIELD_ASPECT = 1.2; // height over width, as Arms draws it
const NUDGE_STEP = 4; // minimap px per ring when a shield looks for a free place
const GAP = 2; // clear space kept between two shields
export const MAX_SHIELDS = 6; // full shields on one map: the point where they begin to hide the people under them
const MAX_MARKERS = 12; // small markers on one map, for the same reason
const MARKER_NUDGE = 24; // minimap px a marker may move to find a free place
const TIP_ROOM = 44; // a shield this close to the top gets its tooltip below
const RING: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

/**
 * The shields for the houses in view. One house (or none) gets no landmark at all: the whole map is that house.
 * Biggest houses are placed first, so when two would overlap the smaller one moves. The first MAX_SHIELDS get a
 * full shield; the rest, and any shield with no free place near its house, get a small marker instead, and a
 * marker with no free place is left out rather than piled on another.
 */
export function houseLandmarks(people: LandmarkPerson[], frame: MinimapFrame, grid: LandmarkGrid): HouseLandmark[] {
  const groups = new Map<string, { pts: LandmarkPerson[]; ids: Set<string> }>();
  for (const p of people) {
    if (!p.house) continue;
    const g = groups.get(p.house) ?? { pts: [], ids: new Set<string>() };
    g.pts.push(p);
    g.ids.add(p.id);
    groups.set(p.house, g);
  }
  if (groups.size < 2) return [];

  const houses = [...groups].map(([house, g]) => ({ house, people: g.ids.size, ...largestCluster(g.pts, grid) }))
    .sort((a, b) => b.people - a.people || (a.house < b.house ? -1 : a.house > b.house ? 1 : 0));

  const markerSize = grid.size / 2;
  const taken: Placed[] = [];
  const out: HouseLandmark[] = [];
  let shields = 0, markers = 0;
  for (const m of houses) {
    const ax = m.x * frame.s + frame.ox, ay = m.y * frame.s + frame.oy;
    let spot = shields < MAX_SHIELDS ? nearestFree(ax, ay, taken, frame, grid.size, grid.size + 8) : null;
    const compact = !spot;
    if (compact) {
      if (markers >= MAX_MARKERS) continue;
      spot = nearestFree(ax, ay, taken, frame, markerSize, MARKER_NUDGE);
    }
    if (!spot) continue;
    if (compact) markers++; else shields++;
    const size = compact ? markerSize : grid.size;
    taken.push({ ...spot, size });
    out.push({
      house: m.house,
      people: m.people,
      x: spot.x,
      y: spot.y,
      wx: m.x,
      wy: m.y,
      size,
      compact,
      tip: spot.y - (size * SHIELD_ASPECT) / 2 < TIP_ROOM ? 'below' : 'above',
      align: spot.x < frame.width * 0.35 ? 'start' : spot.x > frame.width * 0.65 ? 'end' : 'center',
    });
  }
  // Reading order, so keyboard focus moves down the tree as the eye does.
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The middle of the largest group of a house's cards. Cards link when they sit side by side, or one generation
 * apart and near each other, so a house that is split across the tree gives its biggest branch.
 */
export function largestCluster(pts: LandmarkPerson[], grid: LandmarkGrid): { x: number; y: number } {
  const linkX = grid.cardW * 2.5, linkY = grid.rowH * 1.5;
  const parent = pts.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const byX = pts.map((_, i) => i).sort((a, b) => pts[a].x - pts[b].x);
  for (let a = 0; a < byX.length; a++) {
    const i = byX[a];
    for (let b = a + 1; b < byX.length; b++) {
      const j = byX[b];
      if (pts[j].x - pts[i].x > linkX) break;
      if (Math.abs(pts[j].y - pts[i].y) <= linkY) parent[root(j)] = root(i);
    }
  }
  const sums = new Map<number, { n: number; x: number; y: number }>();
  pts.forEach((p, i) => {
    const r = root(i);
    const s = sums.get(r) ?? { n: 0, x: 0, y: 0 };
    s.n++; s.x += p.x; s.y += p.y;
    sums.set(r, s);
  });
  let best = { n: 0, x: 0, y: 0 };
  for (const s of sums.values()) if (s.n > best.n) best = s;
  return { x: best.x / best.n, y: best.y / best.n };
}

interface Placed { x: number; y: number; size: number }

/** The nearest spot to (ax, ay), within `maxNudge`, inside the minimap where a mark of this width does not touch one already placed. */
function nearestFree(ax: number, ay: number, taken: Placed[], frame: MinimapFrame, size: number, maxNudge: number): { x: number; y: number } | null {
  const hw = size / 2, hh = (size * SHIELD_ASPECT) / 2;
  const clampX = (x: number) => Math.min(frame.width - hw, Math.max(hw, x));
  const clampY = (y: number) => Math.min(frame.height - hh, Math.max(hh, y));
  for (let d = 0; d <= maxNudge; d += NUDGE_STEP) {
    const offsets: [number, number][] = d === 0 ? [[0, 0]] : RING.map(([dx, dy]) => [dx * d, dy * d]);
    for (const [dx, dy] of offsets) {
      const x = clampX(ax + dx), y = clampY(ay + dy);
      const clear = taken.every((t) => Math.abs(t.x - x) >= (t.size + size) / 2 + GAP || Math.abs(t.y - y) >= ((t.size + size) * SHIELD_ASPECT) / 2 + GAP);
      if (clear) return { x, y };
    }
  }
  return null;
}
