// How the campaign's map is drawn from its numbers: outlines as flowing lines, the coast around all the land, where the
// little trees and hills stand, where the sheet's title and compass find room, and how far the view moves in to an order
// on a narrow screen. Pure geometry for ./CampaignMap.tsx; the rules know none of it.
import { MAP_H, MAP_W, type GameMap, type Province, type Pt, type Terrain } from '~/lib/campaign/engine';
import { rng } from '~/lib/campaign/rng';

const n1 = (v: number) => Math.round(v * 10) / 10;
const at = (p: Pt) => `${n1(p[0])} ${n1(p[1])}`;
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** A closed outline as one flowing line: it runs through the middle of each side and bends at each corner. */
export function smoothClosed(points: Pt[]): string {
  const n = points.length;
  if (n < 3) return '';
  let d = `M${at(mid(points[n - 1], points[0]))}`;
  for (let i = 0; i < n; i++) d += `Q${at(points[i])} ${at(mid(points[i], points[(i + 1) % n]))}`;
  return `${d}Z`;
}

/** An open line (a river, a ridge) drawn the same way, from its first point to its last. */
export function smoothOpen(points: Pt[]): string {
  const n = points.length;
  if (n < 2) return '';
  if (n === 2) return `M${at(points[0])}L${at(points[1])}`;
  let d = `M${at(points[0])}L${at(mid(points[0], points[1]))}`;
  for (let i = 1; i < n - 1; i++) d += `Q${at(points[i])} ${at(mid(points[i], points[i + 1]))}`;
  return `${d}L${at(points[n - 1])}`;
}

/** The coast: the sides of the provinces' outlines that no other province shares, joined into rings around the land. */
export function coastOf(map: GameMap): Pt[][] {
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const sides = new Map<string, [Pt, Pt]>();
  for (const p of map.provinces) p.cell.forEach((a, i) => { const b = p.cell[(i + 1) % p.cell.length]; sides.set(`${key(a)}>${key(b)}`, [a, b]); });
  const next = new Map<string, Pt>();
  const start = new Map<string, Pt>();
  for (const [id, [a, b]] of sides) {
    const [from, to] = id.split('>');
    if (sides.has(`${to}>${from}`)) continue;
    next.set(from, b);
    start.set(from, a);
  }
  const rings: Pt[][] = [];
  while (next.size) {
    const first = next.keys().next().value!;
    const ring: Pt[] = [];
    for (let k = first; next.has(k);) { ring.push(start.get(k)!); const to = next.get(k)!; next.delete(k); k = key(to); }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Whether a point lies inside an outline. */
const insideCell = (cell: Pt[], x: number, y: number) => inside(cell, x, y);
export function inside(cell: Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = cell.length - 1; i < cell.length; j = i++) {
    const [xi, yi] = cell[i], [xj, yj] = cell[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** A box on the sheet: left, top, right, bottom. */
export type Box = readonly [number, number, number, number];
const meets = (a: Box, b: Box, gap = 0) => a[0] < b[2] + gap && a[2] > b[0] - gap && a[1] < b[3] + gap && a[3] > b[1] - gap;
const holds = (b: Box, x: number, y: number, gap = 0) => x > b[0] - gap && x < b[2] + gap && y > b[1] - gap && y < b[3] + gap;

export type GlyphKind = 'tree' | 'pine' | 'hill' | 'peak' | 'reed' | 'grass' | 'town' | 'castle' | 'ship';
export interface Spot { x: number; y: number; kind: GlyphKind; size: number }

/** How far apart a terrain's little pictures stand, and which pictures they are. */
const SCATTER: Record<Terrain, { gap: number; kinds: GlyphKind[]; size: number }> = {
  forest: { gap: 31, kinds: ['tree', 'tree', 'pine'], size: 1.25 },
  highland: { gap: 40, kinds: ['hill'], size: 1.35 },
  marsh: { gap: 36, kinds: ['reed'], size: 1.2 },
  plains: { gap: 52, kinds: ['grass'], size: 1.15 },
  town: { gap: 64, kinds: ['grass'], size: 1.1 },
};

/**
 * Where a province's terrain is drawn: little pictures scattered over its land, the same every time, clear of its
 * border, its banner and its name. `room` is how much the banner is drawn larger (on a narrow screen).
 */
export function spotsIn(map: GameMap, p: Province, room = 1, avoid: readonly Box[] = []): Spot[] {
  const terrain = p.terrain ?? 'plains';
  const { gap, kinds, size } = SCATTER[terrain];
  const random = rng(`glyph:${map.name ?? ''}:${p.id}`);
  const xs = p.cell.map((c) => c[0]), ys = p.cell.map((c) => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: Spot[] = [];
  const edge = 13;
  for (let gy = y0 + gap / 2, r = 0; gy < y1; gy += gap * 0.86, r++) {
    for (let gx = x0 + (r % 2 ? gap : gap / 2); gx < x1; gx += gap) {
      const x = gx + (random() - 0.5) * gap * 0.45, y = gy + (random() - 0.5) * gap * 0.4;
      const kind = kinds[Math.floor(random() * kinds.length)];
      const scale = size * (0.88 + random() * 0.26);
      const dx = x - p.x, dy = y - p.y;
      // Clear of the banner and the token beside it, and of the name beneath.
      if (Math.abs(dx) < 46 * room && dy > -62 * room && dy < 34 * room) continue;
      if (Math.abs(dx) < 70 && dy >= 34 * room && dy < 34 * room + 34) continue;
      // Clear of every name as it is really written, a neighbour's too.
      if (avoid.some((b) => holds(b, x, y, 11 * scale))) continue;
      if (![[0, 0], [edge, 0], [-edge, 0], [0, edge], [0, -edge]].every(([ox, oy]) => inside(p.cell, x + ox, y + oy))) continue;
      out.push({ x: n1(x), y: n1(y), kind, size: n1(scale) });
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Where a town's houses or a seat's castle stand: beside the banner, on the province's own land; nowhere when there is no room. */
export function settlementAt(p: Province, room = 1, avoid: readonly Box[] = []): Pt | null {
  // To the left first: the garrison's token stands to the right of the banner.
  // Never under the banner, where the name is written.
  const tries: Pt[] = [[-62, 8], [-56, -36], [72, 2], [60, -40], [-84, 20], [88, 16], [0, -84], [-70, 44], [74, 44]];
  const fits = (x: number, y: number, margin: number) => [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([ox, oy]) => inside(p.cell, x + ox, y + oy));
  // Drawn larger (a narrow screen), the picture needs all its room: there it is left out sooner than drawn in the sea.
  for (const margin of room > 1 ? [18] : [14, 6]) {
    for (const [dx, dy] of tries) {
      const x = p.x + dx * room, y = p.y + dy * room;
      if (fits(x, y, margin) && !avoid.some((b) => holds(b, x, y, 24))) return [x, y];
    }
  }
  return null;
}

/** Where a name is written: the middle of its baseline, and half its width. */
export interface NameSpot { x: number; y: number; half: number }

/** The room a name takes, for whatever must keep clear of it. */
export const nameBox = (n: NameSpot, size = 21): Box => [n.x - n.half, n.y - size, n.x + n.half, n.y + size * 0.3];

/**
 * Where each province's name is written: under its banner, or, when that would run into a name already written, above the
 * banner or a line lower. `seats` have a crown above the banner, so a name above stands higher there. `only` names just
 * these provinces (an order being chosen on a narrow screen), `within` keeps every name inside what the view shows, and
 * `avoid` is what a name must not cover.
 */
export function namesAt(map: GameMap, seats: ReadonlySet<number>, room = 1, size = 21, opts: { only?: ReadonlySet<number>; within?: Box; avoid?: readonly Box[] } = {}): Map<number, NameSpot> {
  const out = new Map<number, NameSpot>();
  const written: Box[] = [...(opts.avoid ?? [])];
  const shield = 46 * room;
  const [x0, y0, x1, y1] = opts.within ?? [0, 0, MAP_W, MAP_H];
  const shown = map.provinces.filter((p) => !opts.only || opts.only.has(p.id));
  // A banner with its crown and its garrison: no other province's name is written over it.
  const banner = (p: Province): Box => [p.x - shield / 2 - 2, p.y - shield * 0.78 - (seats.has(p.id) ? 22 * room : 0), p.x + shield * 0.46 + 16 * room, p.y + shield * 0.3 + 16 * room];
  for (const p of [...shown].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const half = Math.min((p.name.length * size * 0.3) + 5, (x1 - x0) / 2 - 14);
    const fit = (x: number) => Math.max(x0 + half + 14, Math.min(x1 - half - 14, x));
    const below = p.y + shield * 0.62 + 22 * Math.max(room, 0.8);
    const above = p.y - shield * 0.78 - (seats.has(p.id) ? 26 * room : 8);
    // Under the banner first, then above it, then a little to either side, then a line further off.
    const tries: Pt[] = [];
    for (const y of [below, above, below + size, above - size]) for (const x of [p.x, p.x - half * 0.6, p.x + half * 0.6]) tries.push([fit(x), y]);
    const boxAt = ([x, y]: Pt): Box => [x - half, y - size, x + half, y];
    const others = shown.filter((q) => q.id !== p.id).map(banner);
    const inside = ([, y]: Pt) => y - size > y0 + 12 && y < y1 - 12;
    const free = (t: Pt) => inside(t) && written.every((b) => !meets(boxAt(t), b)) && others.every((b) => !meets(boxAt(t), b));
    // On the province's own land when it can be: a name out at sea reads as the sea's.
    const home = (t: Pt) => [-0.7, 0, 0.7].every((k) => insideCell(p.cell, t[0] + half * k, t[1] - size / 2));
    const at = tries.find((t) => free(t) && home(t)) ?? tries.find(free) ?? tries.find(inside) ?? tries[0];
    written.push(boxAt(at));
    out.set(p.id, { x: n1(at[0]), y: n1(at[1]), half: n1(half) });
  }
  return out;
}

/**
 * Where a badge (the chance of an attack, footprints, a lock) stands by a province's banner: above it, or, when a name
 * or another badge is there, beside or below it. The badge has the say: it is never left out, only moved. `taken` is
 * added to. Returns the badge's top left corner.
 */
export function badgeAt(p: { x: number; y: number }, w: number, h: number, room: number, taken: Box[], within: Box = [0, 0, MAP_W, MAP_H]): Pt {
  const shield = 46 * room;
  const top = p.y - shield * 0.78;
  const tries: Pt[] = [
    [p.x - w / 2, top - h - 2 * room],
    [p.x - shield / 2 - w - 5 * room, p.y - shield * 0.5],
    [p.x + shield / 2 + 18 * room, p.y - shield * 0.62],
    [p.x - w / 2, top - 2 * h - 8 * room],
    [p.x - w / 2, p.y + shield * 0.62 + 30 * room],
  ];
  const fit = ([x, y]: Pt): Pt => [Math.max(within[0] + 8, Math.min(within[2] - w - 8, x)), Math.max(within[1] + 8, Math.min(within[3] - h - 8, y))];
  const boxOf = ([x, y]: Pt): Box => [x, y, x + w, y + h];
  const at = tries.map(fit).find((t) => taken.every((b) => !meets(boxOf(t), b, 2))) ?? fit(tries[0]);
  taken.push(boxOf(at));
  return [n1(at[0]), n1(at[1])];
}

/** The room a ridge's peaks take, as boxes along its line: what a name keeps clear of, so the mountains stay on the map. */
export function ridgeBoxes(map: GameMap): Box[] {
  const out: Box[] = [];
  for (const ridge of map.ridges ?? []) {
    for (let i = 0; i + 1 < ridge.line.length; i++) {
      const [a, b] = [ridge.line[i], ridge.line[i + 1]];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 22));
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / steps, y = a[1] + ((b[1] - a[1]) * k) / steps;
        out.push([x - 15, y - 24, x + 15, y + 8]);
      }
    }
  }
  return out;
}

/** Peaks along a ridge: one every so often, each a little different, the same every time, and none over a banner or a name. */
export function peaksAlong(line: Pt[], seed: string, banners: Pt[] = [], room = 1, avoid: readonly Box[] = []): Spot[] {
  const clear = (x: number, y: number) => banners.every(([bx, by]) => Math.abs(x - bx) > 50 * room || y - by < -66 * room || y - by > 34 * room + 34) && !avoid.some((b) => holds(b, x, y - 4, 13));
  const random = rng(`ridge:${seed}`);
  const out: Spot[] = [];
  let carried = 10;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = carried; d < length; d += 21) {
      const k = d / length;
      const x = a[0] + (b[0] - a[0]) * k + (random() - 0.5) * 5, y = a[1] + (b[1] - a[1]) * k + (random() - 0.5) * 5;
      const size = 1.15 + random() * 0.55;
      if (clear(x, y)) out.push({ x: n1(x), y: n1(y), kind: 'peak', size: n1(size) });
      carried = d + 21 - length;
    }
    if (carried > 21) carried -= 21;
  }
  return out.sort((a, b) => a.y - b.y);
}

/** The corners of the sheet, by how much open water each has: the title takes the emptiest, the compass the next. */
export function cornersOf(map: GameMap): { title: Pt; compass: Pt } {
  const corners: Pt[] = [[150, 74], [MAP_W - 150, 74], [150, MAP_H - 70], [MAP_W - 150, MAP_H - 70]];
  const room = (c: Pt) => Math.min(...map.provinces.flatMap((p) => p.cell.map(([x, y]) => Math.hypot((x - c[0]) * 0.7, y - c[1]))));
  const ranked = corners.map((c) => ({ c, room: room(c) })).sort((a, b) => b.room - a.room);
  const compass = ranked[1].c;
  return { title: ranked[0].c, compass: [compass[0] < MAP_W / 2 ? 78 : MAP_W - 78, compass[1] < MAP_H / 2 ? 82 : MAP_H - 82] };
}

/** How the view is moved to show these provinces large: a scale, and the shift that keeps the sheet's edge at the frame. */
export interface Camera { k: number; x: number; y: number }

export function cameraFor(map: GameMap, ids: number[], most = 1.9): Camera | null {
  const points = ids.flatMap((id) => map.provinces[id]?.cell ?? []);
  if (!points.length) return null;
  const xs = points.map((c) => c[0]), ys = points.map((c) => c[1]);
  const pad = 46;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const k = Math.max(1, Math.min(most, MAP_W / (x1 - x0), MAP_H / (y1 - y0)));
  if (k < 1.12) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const x = Math.min(0, Math.max(MAP_W - MAP_W * k, MAP_W / 2 - cx * k));
  const y = Math.min(0, Math.max(MAP_H - MAP_H * k, MAP_H / 2 - cy * k));
  return { k: n1(k * 10) / 10, x: n1(x), y: n1(y) };
}

/** The course an order takes from one banner to another: a gentle bow, or out over the water along a sea lane. */
export function courseOf(map: GameMap, from: number, to: number, cut: number): { d: string; mid: Pt; end: Pt } | null {
  const a = map.provinces[from], b = map.provinces[to];
  if (!a || !b) return null;
  const lane = map.lanes?.find((l) => (l.between[0] === from && l.between[1] === to) || (l.between[0] === to && l.between[1] === from));
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const bow = Math.min(40, length * 0.18);
  const bend: Pt = lane ? lane.line[1] : [(a.x + b.x) / 2 - uy * bow, (a.y + b.y) / 2 + ux * bow];
  const short = Math.min(cut, length / 3);
  // Short of both banners, along the way to the bend.
  const lead = (p: Pt, q: Pt): Pt => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [p[0] + ((q[0] - p[0]) / l) * short, p[1] + ((q[1] - p[1]) / l) * short]; };
  const start = lead([a.x, a.y], bend), end = lead([b.x, b.y], bend);
  const half: Pt = [0.25 * start[0] + 0.5 * bend[0] + 0.25 * end[0], 0.25 * start[1] + 0.5 * bend[1] + 0.25 * end[1]];
  return { d: `M${at(start)}Q${at(bend)} ${at(end)}`, mid: half, end };
}
