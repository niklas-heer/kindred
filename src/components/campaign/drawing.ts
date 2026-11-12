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
export function inside(cell: Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = cell.length - 1; i < cell.length; j = i++) {
    const [xi, yi] = cell[i], [xj, yj] = cell[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

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
export function spotsIn(map: GameMap, p: Province, room = 1): Spot[] {
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
      if (![[0, 0], [edge, 0], [-edge, 0], [0, edge], [0, -edge]].every(([ox, oy]) => inside(p.cell, x + ox, y + oy))) continue;
      out.push({ x: n1(x), y: n1(y), kind, size: n1(scale) });
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Where a town's houses or a seat's castle stand: beside the banner, on the province's own land; nowhere when there is no room. */
export function settlementAt(p: Province, room = 1): Pt | null {
  // To the left first: the garrison's token stands to the right of the banner.
  const tries: Pt[] = [[-62, 8], [-54, -38], [70, 4], [58, -40], [-44, 62], [44, 62], [0, 70], [0, -78]];
  const fits = (x: number, y: number, margin: number) => [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([ox, oy]) => inside(p.cell, x + ox, y + oy));
  for (const margin of [14, 4]) {
    for (const [dx, dy] of tries) {
      const x = p.x + dx * room, y = p.y + dy * room;
      if (fits(x, y, margin)) return [x, y];
    }
  }
  return null;
}

/**
 * Where each province's name is written: under its banner, or, when that would run into a name already written, above the
 * banner or a line lower. `seats` have a crown above the banner, so a name above stands higher there.
 */
export function namesAt(map: GameMap, seats: ReadonlySet<number>, room = 1, size = 21): Map<number, { x: number; y: number; anchor: 'start' | 'middle' | 'end' }> {
  const out = new Map<number, { x: number; y: number; anchor: 'start' | 'middle' | 'end' }>();
  const boxes: [number, number, number, number][] = [];
  const shield = 46 * room;
  for (const p of [...map.provinces].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const half = (p.name.length * size * 0.36) + 6;
    const cx = Math.max(half + 14, Math.min(MAP_W - half - 14, p.x));
    const below = p.y + shield * 0.62 + 22 * Math.max(room, 0.8);
    const above = p.y - shield * 0.78 - (seats.has(p.id) ? 26 * room : 8);
    const tries = [below, above, below + size, above - size];
    const free = (y: number) => y > 24 && y < MAP_H - 12 && boxes.every(([x0, y0, x1, y1]) => cx + half < x0 || cx - half > x1 || y < y0 || y - size > y1);
    const y = tries.find(free) ?? below;
    boxes.push([cx - half, y - size, cx + half, y]);
    out.set(p.id, { x: n1(cx), y: n1(y), anchor: 'middle' });
  }
  return out;
}

/** Peaks along a ridge: one every so often, each a little different, the same every time, and none over a banner or a name. */
export function peaksAlong(line: Pt[], seed: string, banners: Pt[] = [], room = 1): Spot[] {
  const clear = (x: number, y: number) => banners.every(([bx, by]) => Math.abs(x - bx) > 50 * room || y - by < -66 * room || y - by > 34 * room + 34);
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
