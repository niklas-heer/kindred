// The Campaign's continent: an invented land, the same for the same seed. A sheet of small six-sided tiles is cut into
// land and sea by a noise field that falls off towards the sheet's edges; the land is shared out among the provinces,
// each a cluster of tiles around its own centre, so every border is a wandering line and the coast has bays and capes.
// Where provinces meet, the border is open country, a river (an attack across it is shorter) or a mountain ridge (no way
// through); one or two sea lanes join harbours that the land keeps far apart. Then the land is dressed: towns, highland,
// forest and marsh by where the ground is high, wet and low, and a name for everything from ./names.ts.
//
// Nothing here knows the family: no place, no person, no house. Pure: no clock, no database, every number from the seed.
import { hashSeed, rng } from './rng.ts';
import { dealName, type NameKind } from './names.ts';
import type { GameMap, Province, Pt, Terrain } from './engine.ts';

export const MAP_W = 1000;
export const MAP_H = 720;

// The tiles: pointy-topped hexagons in rows, every other row half a tile to the right.
const R = 24;
const W = Math.sqrt(3) * R;
const H = 1.5 * R;
const COLS = 23;
const ROWS = 19;
const N = COLS * ROWS;
const X0 = (MAP_W - W * (COLS + 0.5)) / 2 + W / 2;
const Y0 = (MAP_H - (H * (ROWS - 1) + 2 * R)) / 2 + R;
/** How far a tile's corner strays from the honeycomb, so no border is a row of sixty-degree turns. */
const JITTER = 0.34 * R;
/** About this share of the tiles inside the sheet's rim is land. */
const LAND_SHARE = 0.56;

const col = (t: number) => t % COLS;
const row = (t: number) => Math.floor(t / COLS);
const centre = (t: number): Pt => [X0 + W * (col(t) + (row(t) & 1) / 2), Y0 + H * row(t)];

/** The tile across side `k` (east, south-east, south-west, west, north-west, north-east), or -1 off the sheet. */
function across(t: number, k: number): number {
  const c = col(t), r = row(t), odd = r & 1;
  const [dc, dr] = [[1, 0], [odd, 1], [odd - 1, 1], [-1, 0], [odd - 1, -1], [odd, -1]][k];
  const nc = c + dc, nr = r + dr;
  return nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS ? -1 : nr * COLS + nc;
}

// A tile's six corners on a lattice of half-widths and half-radii, so two tiles name a shared corner alike.
const CORNERS: readonly [number, number][] = [[1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1], [0, -2]];
const cornerOf = (t: number, k: number): number => {
  const [dx, dy] = CORNERS[k % 6];
  return (3 * row(t) + dy + 2) * 64 + (2 * col(t) + (row(t) & 1) + dx + 2);
};

/** Smooth noise from 0 to 1 over the sheet, the same for the same seed: random values on a grid, eased between. */
function noise(seed: string, period: number): (x: number, y: number) => number {
  const at = (ix: number, iy: number) => hashSeed(`${seed}:${ix}:${iy}`) / 4294967296;
  const ease = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / period, gy = y / period;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = ease(gx - ix), fy = ease(gy - iy);
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const low = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return top + (low - top) * fy;
  };
}

/** Every tile reachable from `from` through tiles that `ok`. */
function flood(from: number[], ok: (t: number) => boolean): Set<number> {
  const seen = new Set(from.filter(ok));
  const queue = [...seen];
  while (queue.length) {
    const t = queue.pop()!;
    for (let k = 0; k < 6; k++) {
      const n = across(t, k);
      if (n >= 0 && !seen.has(n) && ok(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen;
}

const pairKey = (a: number, b: number) => (a < b ? a * 100 + b : b * 100 + a);
const pairOf = (key: number): [number, number] => [Math.floor(key / 100), key % 100];

function linked(count: number, borders: [number, number][]): boolean {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const at = queue.pop()!;
    for (const [a, b] of borders) {
      const next = a === at ? b : b === at ? a : -1;
      if (next >= 0 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size === count;
}

/** Steps from each province to every other over `borders`. */
function stepsFrom(count: number, borders: [number, number][], from: number): number[] {
  const steps = Array.from({ length: count }, () => Infinity);
  steps[from] = 0;
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    for (const [a, b] of borders) {
      const next = a === at ? b : b === at ? a : -1;
      if (next >= 0 && steps[next] === Infinity) { steps[next] = steps[at] + 1; queue.push(next); }
    }
  }
  return steps;
}

/** The land before it is dressed: the map without terrain and names, and what the dressing reads. */
export interface Land {
  map: GameMap;
  /** How high and how wet each province's ground is, 0 to 1, and whether it has a coast. */
  height: number[];
  damp: number[];
  coastal: boolean[];
}

interface Stretch { pair: number; line: number[]; edges: number }

function attempt(seed: string, count: number): Land | null {
  const random = rng(seed);
  const shape = noise(`${seed}:shape`, 250);
  const detail = noise(`${seed}:detail`, 105);
  const high = noise(`${seed}:high`, 210);
  const wet = noise(`${seed}:wet`, 170);
  const at = Array.from({ length: N }, (_, t) => centre(t));

  // ----- land and sea -----
  const inside = (t: number) => col(t) >= 1 && col(t) < COLS - 1 && row(t) >= 1 && row(t) < ROWS - 1;
  const score = at.map(([x, y], t) => {
    if (!inside(t)) return -Infinity;
    const d = Math.hypot((x - MAP_W / 2) / (MAP_W * 0.47), (y - MAP_H / 2) / (MAP_H * 0.47));
    return 0.7 * shape(x, y) + 0.3 * detail(x, y) - 0.62 * d * d;
  });
  const ranked = score.map((s, t) => [s, t] as const).filter(([s]) => s > -Infinity).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const chosen = new Set(ranked.slice(0, Math.round(ranked.length * LAND_SHARE)).map(([, t]) => t));
  // One continent: the largest piece of land, with its lakes filled in.
  let land = new Set<number>();
  const left = new Set(chosen);
  while (left.size) {
    const piece = flood([left.values().next().value!], (t) => chosen.has(t));
    for (const t of piece) left.delete(t);
    if (piece.size > land.size) land = piece;
  }
  const openSea = flood(Array.from({ length: N }, (_, t) => t).filter((t) => !inside(t)), (t) => !land.has(t));
  for (let t = 0; t < N; t++) if (!land.has(t) && !openSea.has(t)) land.add(t);
  if (land.size < count * 8) return null;
  const tiles = [...land].sort((a, b) => a - b);

  // ----- the provinces -----
  const d2 = (a: number, b: number) => (at[a][0] - at[b][0]) ** 2 + (at[a][1] - at[b][1]) ** 2;
  let centres = [tiles[Math.floor(random() * tiles.length)]];
  while (centres.length < count) {
    let best = tiles[0], far = -1;
    for (const t of tiles) {
      const near = Math.min(...centres.map((c) => d2(t, c)));
      if (near > far) { far = near; best = t; }
    }
    centres.push(best);
  }
  const owner = new Int16Array(N).fill(-1);
  for (let pass = 0; pass < 6; pass++) {
    owner.fill(-1);
    const queue = [...centres];
    centres.forEach((c, i) => { owner[c] = i; });
    // Every province grows a ring at a time, so each tile goes to the centre fewest steps away over land.
    for (let head = 0; head < queue.length; head++) {
      const t = queue[head];
      for (let k = 0; k < 6; k++) {
        const n = across(t, k);
        if (n >= 0 && land.has(n) && owner[n] < 0) { owner[n] = owner[t]; queue.push(n); }
      }
    }
    if (pass === 5) break;
    centres = centres.map((c, i) => {
      const mine = tiles.filter((t) => owner[t] === i);
      const cx = mine.reduce((s, t) => s + at[t][0], 0) / mine.length, cy = mine.reduce((s, t) => s + at[t][1], 0) / mine.length;
      let best = c, near = Infinity;
      for (const t of mine) {
        const d = (at[t][0] - cx) ** 2 + (at[t][1] - cy) ** 2;
        if (d < near) { near = d; best = t; }
      }
      return best;
    });
  }
  const members = Array.from({ length: count }, (_, i) => tiles.filter((t) => owner[t] === i));
  if (members.some((m) => m.length < 6)) return null;

  // ----- corners, borders and the coast -----
  const where = new Map<number, Pt>();
  const pos = (v: number): Pt => {
    let p = where.get(v);
    if (!p) {
      const ix = (v % 64) - 2, iy = Math.floor(v / 64) - 2;
      const r = rng(`${seed}:v:${v}`);
      p = [Math.round(X0 + (ix * W) / 2 + (r() - 0.5) * 2 * JITTER), Math.round(Y0 + (iy * R) / 2 + (r() - 0.5) * 2 * JITTER)];
      where.set(v, p);
    }
    return p;
  };
  const rim = members.map(() => new Map<number, number>());
  const shared = new Map<number, [number, number][]>();
  const coastEdges = Array.from({ length: count }, () => 0);
  const coastCorners = members.map(() => new Set<number>());
  for (const t of tiles) {
    const me = owner[t];
    for (let k = 0; k < 6; k++) {
      const n = across(t, k);
      const other = n >= 0 && land.has(n) ? owner[n] : -1;
      if (other === me) continue;
      const a = cornerOf(t, k), b = cornerOf(t, k + 1);
      rim[me].set(a, b);
      if (other < 0) { coastEdges[me]++; coastCorners[me].add(a); coastCorners[me].add(b); }
      else if (me < other) { const key = pairKey(me, other); shared.set(key, [...(shared.get(key) ?? []), [a, b]]); }
    }
  }
  /** A province's outline: its rim's corners in order. A province around another has two; the longer is its own. */
  const outline = (edges: Map<number, number>): number[] => {
    const todo = new Map(edges);
    let best: number[] = [];
    while (todo.size) {
      const first = todo.keys().next().value!;
      const loop: number[] = [];
      for (let v = first; todo.has(v);) { loop.push(v); const next = todo.get(v)!; todo.delete(v); v = next; }
      if (loop.length > best.length) best = loop;
    }
    return best;
  };
  /** The border two provinces share, as corners in order from one end to the other (the longest piece of it). */
  const lineOf = (edges: [number, number][]): number[] => {
    const next = new Map<number, number[]>();
    for (const [a, b] of edges) { next.set(a, [...(next.get(a) ?? []), b]); next.set(b, [...(next.get(b) ?? []), a]); }
    const ends = [...next].filter(([, to]) => to.length === 1).map(([v]) => v).sort((a, b) => a - b);
    let best: number[] = [];
    const seen = new Set<number>();
    for (const start of ends.length ? ends : [edges[0][0]]) {
      if (seen.has(start)) continue;
      const line = [start];
      seen.add(start);
      for (let v = start; ;) {
        const to = (next.get(v) ?? []).find((n) => !seen.has(n));
        if (to === undefined) break;
        line.push(to);
        seen.add(to);
        v = to;
      }
      if (line.length > best.length) best = line;
    }
    return best;
  };
  const stretches: Stretch[] = [...shared].sort((a, b) => a[0] - b[0]).map(([pair, edges]) => ({ pair, line: lineOf(edges), edges: edges.length }));
  // Provinces that only touch at a corner are not neighbours, unless leaving those out would cut the land in two.
  let touching = stretches.filter((s) => s.edges >= 2);
  if (!linked(count, touching.map((s) => pairOf(s.pair)))) touching = stretches;
  if (!linked(count, touching.map((s) => pairOf(s.pair)))) return null;
  const coast = new Set(coastCorners.flatMap((set) => [...set]));

  // ----- rivers: from a meeting of borders deep inland, along the borders, down to the sea -----
  const ends = (s: Stretch): [number, number] => [s.line[0], s.line[s.line.length - 1]];
  const rivers: { between: [number, number][]; line: Pt[] }[] = [];
  const wetted = new Set<Stretch>();
  const riverCorners = new Set<number>();
  const wanted = 1 + (random() < 0.6 ? 1 : 0);
  for (let n = 0; n < wanted; n++) {
    const open = touching.filter((s) => !wetted.has(s));
    const to = new Map<number, number>();
    const queue: number[] = [];
    for (const s of open) for (const v of ends(s)) if ((coast.has(v) || riverCorners.has(v)) && !to.has(v)) { to.set(v, 0); queue.push(v); }
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      for (const s of open) {
        const [a, b] = ends(s);
        const next = a === v ? b : b === v ? a : -1;
        if (next >= 0 && !to.has(next)) { to.set(next, to.get(v)! + 1); queue.push(next); }
      }
    }
    const deepest = Math.max(0, ...to.values());
    if (deepest < 1) break;
    const springs = [...to].filter(([, d]) => d === Math.min(deepest, 3)).map(([v]) => v).sort((a, b) => a - b);
    let v = springs[Math.floor(random() * springs.length)];
    const river = { between: [] as [number, number][], line: [pos(v)] };
    while (to.get(v)! > 0) {
      const ways = open.filter((s) => {
        const [a, b] = ends(s);
        return (a === v && to.get(b) === to.get(v)! - 1) || (b === v && to.get(a) === to.get(v)! - 1);
      });
      const s = ways[Math.floor(random() * ways.length)];
      const forward = s.line[0] === v ? s.line : [...s.line].reverse();
      river.line.push(...forward.slice(1).map(pos));
      river.between.push(pairOf(s.pair));
      wetted.add(s);
      for (const c of forward) riverCorners.add(c);
      v = forward[forward.length - 1];
    }
    rivers.push(river);
  }

  // ----- ridges: a few borders on the highest ground are mountains nobody crosses -----
  const middle = (s: Stretch): Pt => pos(s.line[Math.floor(s.line.length / 2)]);
  const heightAt = ([x, y]: Pt) => high(x, y);
  let open = touching.map((s) => pairOf(s.pair));
  const ridges: { between: [number, number]; line: Pt[] }[] = [];
  const ridgeTarget = 2 + Math.floor(random() * 3);
  const ways = (p: number, borders: [number, number][]) => borders.filter(([a, b]) => a === p || b === p).length;
  for (const s of touching.filter((s) => !wetted.has(s) && s.edges >= 3).sort((a, b) => heightAt(middle(b)) - heightAt(middle(a)) || a.pair - b.pair)) {
    if (ridges.length >= ridgeTarget) break;
    const [a, b] = pairOf(s.pair);
    const without = open.filter(([x, y]) => !(x === a && y === b));
    if (!linked(count, without) || ways(a, without) < 2 || ways(b, without) < 2) continue;
    open = without;
    ridges.push({ between: [a, b], line: s.line.map(pos) });
  }

  // ----- where each banner stands: the tile deepest inside the province, nearest its middle -----
  const provinces: Province[] = members.map((mine, i) => {
    const set = new Set(mine);
    const depth = new Map<number, number>();
    let ring = mine.filter((t) => [0, 1, 2, 3, 4, 5].some((k) => !set.has(across(t, k))));
    for (let d = 0; ring.length; d++) {
      for (const t of ring) depth.set(t, d);
      ring = [...new Set(ring.flatMap((t) => [0, 1, 2, 3, 4, 5].map((k) => across(t, k))))].filter((t) => set.has(t) && !depth.has(t));
    }
    const cx = mine.reduce((s, t) => s + at[t][0], 0) / mine.length, cy = mine.reduce((s, t) => s + at[t][1], 0) / mine.length;
    const best = [...mine].sort((a, b) => depth.get(b)! - depth.get(a)! || ((at[a][0] - cx) ** 2 + (at[a][1] - cy) ** 2) - ((at[b][0] - cx) ** 2 + (at[b][1] - cy) ** 2) || a - b)[0];
    // A banner near the middle reads best, so the deepest tile is pulled a little towards it.
    const x = Math.round(at[best][0] * 0.7 + cx * 0.3), y = Math.round(at[best][1] * 0.7 + cy * 0.3);
    return { id: i, name: '', x, y, cell: outline(rim[i]).map(pos), coast: coastEdges[i] >= 2 };
  });

  // ----- a sea lane or two: harbours the land keeps far apart, on the same side of the continent -----
  const mid: Pt = [tiles.reduce((s, t) => s + at[t][0], 0) / tiles.length, tiles.reduce((s, t) => s + at[t][1], 0) / tiles.length];
  const harbour = (p: number): Pt => [...coastCorners[p]].map(pos).sort((a, b) => Math.hypot(b[0] - mid[0], b[1] - mid[1]) - Math.hypot(a[0] - mid[0], a[1] - mid[1]) || a[0] - b[0] || a[1] - b[1])[0];
  const lanes: { between: [number, number]; line: Pt[] }[] = [];
  const laneTarget = 1 + (random() < 0.45 ? 1 : 0);
  const docked = new Set<number>();
  while (lanes.length < laneTarget) {
    let best: { a: number; b: number; worth: number } | undefined;
    for (let a = 0; a < count; a++) {
      if (!provinces[a].coast || docked.has(a)) continue;
      const steps = stepsFrom(count, open, a);
      const ha = harbour(a);
      for (let b = a + 1; b < count; b++) {
        if (!provinces[b].coast || docked.has(b) || steps[b] < 3 || shared.has(pairKey(a, b))) continue;
        const hb = harbour(b);
        const length = Math.hypot(ha[0] - hb[0], ha[1] - hb[1]);
        const turn = Math.abs(Math.atan2(ha[1] - mid[1], ha[0] - mid[0]) - Math.atan2(hb[1] - mid[1], hb[0] - mid[0]));
        if (length > 560 || length < 140 || Math.min(turn, 2 * Math.PI - turn) > 1.9) continue;
        const worth = steps[b] * 100 - length / 10 + random();
        if (!best || worth > best.worth) best = { a, b, worth };
      }
    }
    if (!best) break;
    const ha = harbour(best.a), hb = harbour(best.b);
    const mx = (ha[0] + hb[0]) / 2, my = (ha[1] + hb[1]) / 2;
    const out = Math.hypot(mx - mid[0], my - mid[1]) || 1;
    const push = Math.hypot(ha[0] - hb[0], ha[1] - hb[1]) * 0.42;
    const bend: Pt = [Math.round(Math.max(14, Math.min(MAP_W - 14, mx + ((mx - mid[0]) / out) * push))), Math.round(Math.max(14, Math.min(MAP_H - 14, my + ((my - mid[1]) / out) * push)))];
    lanes.push({ between: [best.a, best.b], line: [ha, bend, hb] });
    open = [...open, [best.a, best.b]];
    docked.add(best.a);
    docked.add(best.b);
  }

  // A province with one way out is a dead end nobody would fight for: such a layout is dealt again.
  if (provinces.some((p) => ways(p.id, open) < 2)) return null;

  // ----- the open sea's widest waters, where a name has room -----
  const fromLand = new Map<number, number>();
  let ring = tiles;
  for (let d = 0; ring.length; d++) {
    for (const t of ring) if (!fromLand.has(t)) fromLand.set(t, d);
    ring = [...new Set(ring.flatMap((t) => [0, 1, 2, 3, 4, 5].map((k) => across(t, k))))].filter((t) => t >= 0 && !fromLand.has(t));
  }
  const waters = Array.from({ length: N }, (_, t) => t)
    .filter((t) => !land.has(t) && at[t][0] > 150 && at[t][0] < MAP_W - 150 && at[t][1] > 50 && at[t][1] < MAP_H - 40)
    .sort((a, b) => fromLand.get(b)! - fromLand.get(a)! || a - b);
  const seas: { name: string; x: number; y: number }[] = [];
  for (const t of waters) {
    if (seas.length >= 2 || fromLand.get(t)! < 2) break;
    if (seas.every((s) => Math.hypot(s.x - at[t][0], s.y - at[t][1]) > 420)) seas.push({ name: '', x: Math.round(at[t][0]), y: Math.round(at[t][1]) });
  }

  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  return {
    map: {
      v: 2,
      name: '',
      seas,
      provinces,
      borders: open.map(([a, b]) => (a < b ? [a, b] : [b, a]) as [number, number]).sort((x, y) => x[0] - y[0] || x[1] - y[1]),
      rivers,
      ridges,
      lanes,
    },
    // High ground is high in the noise and beside a ridge; the coast is low.
    height: members.map((mine, i) => mean(mine.map((t) => high(at[t][0], at[t][1]))) + (ridges.some((r) => r.between.includes(i)) ? 0.25 : 0) - (provinces[i].coast ? 0.08 : 0)),
    damp: members.map((mine, i) => mean(mine.map((t) => wet(at[t][0], at[t][1]))) + (rivers.some((r) => r.between.some((b) => b.includes(i))) ? 0.12 : 0)),
    coastal: provinces.map((p) => !!p.coast),
  };
}

/**
 * The continent for a seed: its coast, `count` provinces with their borders, its rivers, ridges and sea lanes. A layout
 * that comes out badly (a sliver of a province, land in two pieces) is dealt again; the same seed always gives the same.
 */
export function layoutOf(seed: string, count: number): Land {
  for (let n = 0; n < 40; n++) {
    const land = attempt(`${seed}:land:${n}`, count);
    if (land) return land;
  }
  throw new Error('campaign: no continent could be laid out');
}

/** How many provinces of each kind a map has, beside its towns: the rest is plains. */
export interface Shares { highland: number; marsh: number; forest: number }

/**
 * Dresses the land once the seats are known: `towns` are towns (the seats castles), the highest ground is highland, the
 * lowest ground by the water is marsh, the wettest of the rest is forest, and what remains is plains. Then every
 * province, the seas and the continent itself get a name. Changes `land.map`.
 */
export function dress(land: Land, seats: number[], towns: number[], shares: Shares, seed: string) {
  const { map } = land;
  const random = rng(`${seed}:names`);
  const terrain = new Map<number, Terrain>(towns.map((t) => [t, 'town']));
  const free = () => map.provinces.map((p) => p.id).filter((i) => !terrain.has(i));
  const take = (kind: Terrain, n: number, order: (a: number, b: number) => number, only: (i: number) => boolean = () => true) => {
    for (const i of free().filter(only).sort((a, b) => order(a, b) || a - b).slice(0, n)) terrain.set(i, kind);
  };
  take('highland', shares.highland, (a, b) => land.height[b] - land.height[a]);
  const byWater = (i: number) => land.coastal[i] || !!map.rivers?.some((r) => r.between.some((b) => b.includes(i)));
  take('marsh', shares.marsh, (a, b) => land.height[a] - land.height[b], byWater);
  take('forest', shares.forest, (a, b) => land.damp[b] - land.damp[a]);

  const taken = new Set<string>();
  const roots = new Set<string>();
  map.name = dealName('continent', random, taken, roots);
  for (const sea of map.seas ?? []) sea.name = dealName('sea', random, taken, roots);
  for (const p of map.provinces) {
    p.terrain = terrain.get(p.id) ?? 'plains';
    const kind: NameKind = p.terrain !== 'town' ? p.terrain : seats.includes(p.id) ? 'seat' : p.coast ? 'haven' : 'town';
    p.name = dealName(kind, random, taken, roots);
  }
}
