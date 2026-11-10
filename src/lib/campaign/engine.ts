// The Campaign's rules, as one pure module: building the map from places, the opening position, the daily levy, the
// three orders (muster, march, attack), the dice, the regent that plays a house nobody is playing, and the season's
// score. It reads no clock and no database and draws every random number from a seed, so the server (./campaign.server.ts)
// and the browser's practice skirmish play exactly the same game, and a day that is replayed comes out the same.
//
// Nothing here knows a person: a side is a house's id, a province is a place's name. No rule reads a lifespan, a cause
// of death or a number of children.
import { between, rng } from './rng.ts';
import { MARCH_NAMES } from './names.ts';

/** The numbers of the game. Tuned with the regents playing each other (see engine.test.ts, "a season stays close"). */
export const RULES = {
  /** A season's length in days; the map resets after it. */
  SEASON_DAYS: 28,
  /** The practice skirmish is over in this many turns. */
  PRACTICE_DAYS: 10,
  /** Orders a member gets each day, and how many they can save up. */
  ORDERS_PER_DAY: 3,
  ORDERS_BANK: 6,
  /** One bonus order (the daily quiz) may sit on top of the bank. */
  ORDERS_MAX: 7,
  /** Troops one muster order can place. */
  MUSTER_MAX: 5,
  /** A house's unplaced levy stops growing here. */
  POOL_CAP: 12,
  /** A province can feed this many troops and no more, so no stack grows beyond reach. */
  GARRISON_MAX: 10,
  /** Every house's daily levy before renown. */
  BASE_LEVY: 2,
  /** The most renown can add to the daily levy. */
  RENOWN_MAX_BONUS: 2,
  /** The realm rallies to a house that trails: one more troop a day for every province behind the leader, up to this many. */
  RALLY_MAX: 2,
  /** An attack order fights at most this many rounds of dice. */
  BATTLE_ROUNDS: 3,
  /** A regent keeps this many at home when another house borders the province it attacks from. */
  REGENT_KEEPS: 2,
  /** With this many in a province a regent stops waiting for good odds and attacks at even ones, so the map never freezes. */
  REGENT_RESTLESS: 6,
  /** A regent attacks this often a day at most: a member with three orders can always outpace it. */
  REGENT_ATTACKS: 1,
  MIN_PROVINCES: 10,
  MAX_PROVINCES: 24,
  MIN_SIDES: 3,
  MAX_SIDES: 6,
  /** A battle cry's longest length, in characters. */
  CRY_MAX: 80,
} as const;

export const MAP_W = 1000;
export const MAP_H = 720;
const MARGIN = 70;

export type Pt = [number, number];

/** A place the map can be made from. `people` orders them; `byHouse` (a side's id to a count) decides whose home it is. */
export interface PlaceIn { name: string; lat: number; lng: number; people: number; byHouse?: Record<string, number> }

export interface Province {
  id: number;
  name: string;
  /** Where its banner stands, in the map's box (MAP_W × MAP_H). */
  x: number;
  y: number;
  /** Its land: a polygon in the same box. */
  cell: Pt[];
  /** False for an invented march that fills a map with too few real places. */
  real: boolean;
}

export interface GameMap {
  provinces: Province[];
  /** Pairs of province ids that share a border, the smaller id first. */
  borders: [number, number][];
}

/** The position: who holds what, with how many, and each house's levy still to be placed. */
export interface State {
  /** The day being played, from 0. The season is over when it reaches its length. */
  day: number;
  /** Each province's holder (a side's id), or null for a free march nobody has claimed. */
  holder: (string | null)[];
  troops: number[];
  /** Each side's levy waiting to be mustered. */
  pool: Record<string, number>;
  /** Each side's seat: the province that can never be attacked, so no house is ever out of the game. */
  seats: Record<string, number>;
  /** The sides a member gave an order for today: the regent leaves those alone at nightfall. */
  acted: string[];
}

export type Order =
  | { type: 'muster'; to: number; troops: number }
  | { type: 'march'; from: number; to: number; troops: number }
  | { type: 'attack'; from: number; to: number; troops: number };

export interface Round { a: number[]; d: number[]; aLost: number; dLost: number }

export type GameEvent =
  | { t: 'muster'; side: string; to: number; troops: number }
  | { t: 'march'; side: string; from: number; to: number; troops: number }
  | { t: 'attack'; side: string; from: number; to: number; defender: string | null; committed: number; defenders: number; rounds: Round[]; aLost: number; dLost: number; took: boolean; seed: string };

export type ErrorCode = 'season_over' | 'no_province' | 'not_yours' | 'not_adjacent' | 'no_levy' | 'troops' | 'own_province' | 'seat' | 'stay_one' | 'full';

/** A refused order. The message is a translation key (`campaign.err.<code>`), which the browser shows in its language. */
export class CampaignError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode) {
    super(`campaign.err.${code}`);
    this.code = code;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- the map ----------

/** How many provinces a campaign of this many sides is fought over: four each, within 10 to 24. */
export const provinceCount = (sides: number) => clamp(sides * 4, RULES.MIN_PROVINCES, RULES.MAX_PROVINCES);

/** Cuts a polygon down to the side of the line a·x + b·y ≤ c. */
function clip(poly: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const n = poly[(i + 1) % poly.length];
    const dp = a * p[0] + b * p[1] - c;
    const dn = a * n[0] + b * n[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dn > 0) || (dp > 0 && dn < 0)) {
      const k = dp / (dp - dn);
      out.push([p[0] + (n[0] - p[0]) * k, p[1] + (n[1] - p[1]) * k]);
    }
  }
  return out;
}

/** Each site's land: everything in the box nearer to it than to any other site. */
function cellsOf(sites: Pt[]): Pt[][] {
  return sites.map((s, i) => {
    let poly: Pt[] = [[0, 0], [MAP_W, 0], [MAP_W, MAP_H], [0, MAP_H]];
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === i) continue;
      const o = sites[j];
      poly = clip(poly, o[0] - s[0], o[1] - s[1], (o[0] * o[0] + o[1] * o[1] - s[0] * s[0] - s[1] * s[1]) / 2);
    }
    return poly;
  });
}

function centroid(poly: Pt[]): Pt {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-6) return poly[0] ?? [MAP_W / 2, MAP_H / 2];
  return [cx / (3 * area), cy / (3 * area)];
}

/** The length of the border two lands share. */
function sharedBorder(cell: Pt[], a: Pt, b: Pt): number {
  let length = 0;
  for (let i = 0; i < cell.length; i++) {
    const p = cell[i];
    const n = cell[(i + 1) % cell.length];
    const mid: Pt = [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2];
    if (Math.abs(dist(mid, a) - dist(mid, b)) < 0.01) length += dist(p, n);
  }
  return length;
}

function connected(count: number, borders: [number, number][]): boolean {
  if (!count) return true;
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

/**
 * The map: the `count` places most people are linked to, laid out by their coordinates and then eased apart so every
 * land has room for a banner, with invented marches where the family has too few places. Lands that share a border are
 * neighbours, so the map is always one piece.
 */
export function buildMap(places: PlaceIn[], count: number, seed: string): GameMap {
  const random = rng(`${seed}:map`);
  const n = clamp(Math.round(count), RULES.MIN_PROVINCES, RULES.MAX_PROVINCES);
  const real = places
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .filter((p, i, all) => all.findIndex((o) => o.name === p.name) === i)
    .sort((a, b) => b.people - a.people || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, n);

  // Longitudes shrink towards the poles; then each axis is part true distance and part rank, so a cousin in Melbourne
  // does not squeeze the rest of the family into one corner.
  const meanLat = real.reduce((s, p) => s + p.lat, 0) / (real.length || 1);
  const xs = real.map((p) => p.lng * Math.cos((meanLat * Math.PI) / 180));
  const ys = real.map((p) => -p.lat);
  const spread = (values: number[]) => {
    const lo = Math.min(...values), hi = Math.max(...values);
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const rank = new Map(order.map(([, i], r) => [i, values.length > 1 ? r / (values.length - 1) : 0.5]));
    return values.map((v, i) => 0.4 * (hi > lo ? (v - lo) / (hi - lo) : 0.5) + 0.6 * rank.get(i)!);
  };
  const us = spread(xs), vs = spread(ys);
  let sites: Pt[] = real.map((_, i) => [
    MARGIN + us[i] * (MAP_W - 2 * MARGIN) + (random() - 0.5) * 16,
    MARGIN + vs[i] * (MAP_H - 2 * MARGIN) + (random() - 0.5) * 16,
  ]);

  const names = real.map((p) => p.name);
  const taken = new Set(names);
  const spare = MARCH_NAMES.filter((name) => !taken.has(name));
  // A seeded shuffle, so two families do not get the same marches in the same order.
  for (let i = spare.length - 1; i > 0; i--) {
    const j = between(random, 0, i);
    [spare[i], spare[j]] = [spare[j], spare[i]];
  }
  while (sites.length < n) {
    names.push(spare[sites.length - real.length] ?? `${MARCH_NAMES[0]} ${sites.length}`);
    sites.push([MARGIN + random() * (MAP_W - 2 * MARGIN), MARGIN + random() * (MAP_H - 2 * MARGIN)]);
  }

  // Ease the sites apart: each moves most of the way to the middle of its own land, a few times over.
  for (let pass = 0; pass < 5; pass++) {
    const lands = cellsOf(sites);
    sites = sites.map((s, i) => {
      const c = centroid(lands[i]);
      return [s[0] + (c[0] - s[0]) * 0.8, s[1] + (c[1] - s[1]) * 0.8] as Pt;
    });
  }
  const lands = cellsOf(sites);

  const bordersLongerThan = (least: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (sharedBorder(lands[i], sites[i], sites[j]) > least) out.push([i, j]);
    return out;
  };
  // Two lands that touch at a corner are not neighbours, unless leaving such borders out would cut the map in two.
  let borders = bordersLongerThan(24);
  if (!connected(n, borders)) borders = bordersLongerThan(0.5);

  return {
    provinces: sites.map((s, i) => ({
      id: i,
      name: names[i],
      x: round1(s[0]),
      y: round1(s[1]),
      cell: lands[i].map((p) => [round1(p[0]), round1(p[1])] as Pt),
      real: i < real.length,
    })),
    borders,
  };
}

/** A province's neighbours. */
export function neighbours(map: GameMap, id: number): number[] {
  const out: number[] = [];
  for (const [a, b] of map.borders) {
    if (a === id) out.push(b);
    else if (b === id) out.push(a);
  }
  return out;
}

export const adjacent = (map: GameMap, a: number, b: number) => map.borders.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// ---------- the opening position ----------

/**
 * The season's first morning. Every side gets a seat (its people's own place when the map has it, else a place far
 * from the other seats) and one neighbouring province; the rest are free marches with a small garrison, there to be
 * taken. `homes` is each side's count of people per place name.
 */
export function startState(map: GameMap, sides: string[], seed: string, homes: Record<string, Record<string, number>> = {}): State {
  const random = rng(`${seed}:start`);
  const n = map.provinces.length;
  const holder: (string | null)[] = Array.from({ length: n }, () => null);
  const troops = map.provinces.map(() => between(random, 2, 3));
  const seats: Record<string, number> = {};
  const at = (i: number): Pt => [map.provinces[i].x, map.provinces[i].y];
  const free = () => map.provinces.map((p) => p.id).filter((i) => holder[i] === null);

  for (const side of sides) {
    const open = free();
    if (!open.length) break;
    const taken = Object.values(seats);
    // Far from the seats already chosen counts in both cases: two houses from the same town still get room.
    const room = (i: number) => (taken.length ? Math.min(...taken.map((s) => dist(at(i), at(s)))) : MAP_W);
    const home = homes[side] ?? {};
    const scored = open.map((i) => ({ i, people: home[map.provinces[i].name] ?? 0, room: room(i), tie: random() }));
    const withRoom = scored.filter((s) => s.room > 150);
    const pool = withRoom.some((s) => s.people > 0) ? withRoom.filter((s) => s.people > 0) : scored;
    pool.sort((a, b) => (pool === scored ? b.room - a.room : b.people - a.people || b.room - a.room) || a.tie - b.tie);
    const seat = pool[0].i;
    seats[side] = seat;
    holder[seat] = side;
    troops[seat] = 4;
  }
  for (const side of sides) {
    const seat = seats[side];
    if (seat === undefined) continue;
    const near = neighbours(map, seat).filter((i) => holder[i] === null).sort((a, b) => dist(at(a), at(seat)) - dist(at(b), at(seat)) || a - b)[0];
    if (near === undefined) { troops[seat] += 3; continue; }
    holder[near] = side;
    troops[near] = 3;
  }
  const state: State = { day: 0, holder, troops, pool: {}, seats, acted: [] };
  return state;
}

// ---------- counting ----------

export const provincesOf = (state: State, side: string) => state.holder.reduce((n, h) => n + (h === side ? 1 : 0), 0);
export const troopsOf = (state: State, side: string) => state.holder.reduce((n, h, i) => n + (h === side ? state.troops[i] : 0), 0);

export interface Levy { base: number; renown: number; rally: number; total: number }

/**
 * A side's daily levy: the base, what its renown adds, and one more for every province it trails the leader by (up to
 * RALLY_MAX), so a house that falls behind is never out of troops. Holding more land brings no more levy: the prize is
 * the land itself, and a season stays close.
 */
export function levyOf(state: State, side: string, renownBonus: number, sides: string[]): Levy {
  const mine = provincesOf(state, side);
  const most = Math.max(0, ...sides.map((s) => provincesOf(state, s)));
  const renown = clamp(Math.floor(renownBonus), 0, RULES.RENOWN_MAX_BONUS);
  const rally = clamp(most - mine, 0, RULES.RALLY_MAX);
  return { base: RULES.BASE_LEVY, renown, rally, total: RULES.BASE_LEVY + renown + rally };
}

export interface Standing { side: string; provinces: number; troops: number }

/** The sides in order: most provinces first, then most troops, then the order given. */
export function standings(state: State, sides: string[]): Standing[] {
  return sides
    .map((side, i) => ({ side, provinces: provincesOf(state, side), troops: troopsOf(state, side), i }))
    .sort((a, b) => b.provinces - a.provinces || b.troops - a.troops || a.i - b.i)
    .map(({ side, provinces, troops }) => ({ side, provinces, troops }));
}

// ---------- dice ----------

/**
 * A battle of at most three rounds, with Risk's dice: the attacker rolls up to three, the defender up to two, the
 * highest are compared pair by pair, and a tie goes to the defender. The same seed rolls the same dice.
 */
export function battle(attackers: number, defenders: number, seed: string): { rounds: Round[]; aLost: number; dLost: number } {
  const random = rng(`${seed}:dice`);
  const rounds: Round[] = [];
  let a = attackers, d = defenders;
  while (rounds.length < RULES.BATTLE_ROUNDS && a > 0 && d > 0) {
    const roll = (count: number) => Array.from({ length: count }, () => between(random, 1, 6)).sort((x, y) => y - x);
    const ad = roll(Math.min(3, a));
    const dd = roll(Math.min(2, d));
    let aLost = 0, dLost = 0;
    for (let i = 0; i < Math.min(ad.length, dd.length); i++) {
      if (ad[i] > dd[i]) dLost++;
      else aLost++;
    }
    a -= aLost;
    d -= dLost;
    rounds.push({ a: ad, d: dd, aLost, dLost });
  }
  return { rounds, aLost: attackers - a, dLost: defenders - d };
}

// ---------- orders ----------

const copy = (state: State): State => ({ ...state, holder: [...state.holder], troops: [...state.troops], pool: { ...state.pool }, acted: [...state.acted] });
const whole = (n: number) => Number.isInteger(n) && n >= 1;

/**
 * One order for a side, checked against the position: it returns the new position and what happened, or throws a
 * CampaignError and changes nothing. `seed` rolls an attack's dice. `seasonDays` is the season's length.
 */
export function applyOrder(state: State, map: GameMap, side: string, order: Order, seed: string, seasonDays: number = RULES.SEASON_DAYS): { state: State; event: GameEvent } {
  if (state.day >= seasonDays) throw new CampaignError('season_over');
  const n = map.provinces.length;
  const known = (i: number) => Number.isInteger(i) && i >= 0 && i < n;
  if (!known(order.to) || (order.type !== 'muster' && !known(order.from))) throw new CampaignError('no_province');
  if (!whole(order.troops)) throw new CampaignError('troops');
  const next = copy(state);
  if (!next.acted.includes(side)) next.acted.push(side);

  if (order.type === 'muster') {
    if (state.holder[order.to] !== side) throw new CampaignError('not_yours');
    const pool = state.pool[side] ?? 0;
    if (pool < 1) throw new CampaignError('no_levy');
    if (order.troops > pool || order.troops > RULES.MUSTER_MAX) throw new CampaignError('troops');
    if (state.troops[order.to] + order.troops > RULES.GARRISON_MAX) throw new CampaignError('full');
    next.pool[side] = pool - order.troops;
    next.troops[order.to] += order.troops;
    return { state: next, event: { t: 'muster', side, to: order.to, troops: order.troops } };
  }

  if (state.holder[order.from] !== side) throw new CampaignError('not_yours');
  if (!adjacent(map, order.from, order.to)) throw new CampaignError('not_adjacent');
  // One always stays behind to hold the province.
  if (order.troops > state.troops[order.from] - 1) throw new CampaignError('stay_one');

  if (order.type === 'march') {
    if (state.holder[order.to] !== side) throw new CampaignError('not_yours');
    if (state.troops[order.to] + order.troops > RULES.GARRISON_MAX) throw new CampaignError('full');
    next.troops[order.from] -= order.troops;
    next.troops[order.to] += order.troops;
    return { state: next, event: { t: 'march', side, from: order.from, to: order.to, troops: order.troops } };
  }

  const defender = state.holder[order.to];
  if (defender === side) throw new CampaignError('own_province');
  if (defender !== null && state.seats[defender] === order.to) throw new CampaignError('seat');
  const defenders = state.troops[order.to];
  const fought = battle(order.troops, defenders, seed);
  const took = fought.dLost >= defenders;
  next.troops[order.from] -= took ? order.troops : fought.aLost;
  if (took) {
    next.holder[order.to] = side;
    next.troops[order.to] = order.troops - fought.aLost;
  } else {
    next.troops[order.to] = defenders - fought.dLost;
  }
  return {
    state: next,
    event: { t: 'attack', side, from: order.from, to: order.to, defender, committed: order.troops, defenders, rounds: fought.rounds, aLost: fought.aLost, dLost: fought.dLost, took, seed },
  };
}

// ---------- the regent ----------

/** The odds a regent wants before it attacks: troops sent for each defender. A bold one runs a house nobody plays; a cautious one keeps a played house on a day its members were away. */
export const REGENT_ODDS = { bold: 1.5, cautious: 2 } as const;
export type Temper = keyof typeof REGENT_ODDS;

export interface RegentOptions { temper?: Temper; orders?: number; attacksADay?: number; seasonDays?: number }

/**
 * A regent's day for one side, with as many orders as one member has: it musters where the front needs it, attacks
 * where the odds are good, and walks troops out of the hinterland. Simple on purpose, and the same for the same seed.
 */
export function regentTurn(state: State, map: GameMap, side: string, seed: string, options: RegentOptions = {}): { state: State; events: GameEvent[] } {
  const { temper = 'bold', orders = RULES.ORDERS_PER_DAY, attacksADay = RULES.REGENT_ATTACKS, seasonDays = RULES.SEASON_DAYS } = options;
  const random = rng(`${seed}:regent:${side}`);
  const events: GameEvent[] = [];
  let now = state;
  const play = (order: Order, n: number) => {
    const done = applyOrder(now, map, side, order, `${seed}:${side}:${n}`, seasonDays);
    now = done.state;
    events.push(done.event);
  };
  const mine = () => map.provinces.map((p) => p.id).filter((i) => now.holder[i] === side);
  const attackable = (i: number) => {
    const h = now.holder[i];
    return h !== side && !(h !== null && now.seats[h] === i);
  };
  const foes = (i: number) => neighbours(map, i).filter((j) => now.holder[j] !== side);
  const room = (i: number) => RULES.GARRISON_MAX - now.troops[i];
  const bestAttack = (extra: Map<number, number> = new Map()) => {
    let best: { from: number; to: number; send: number; score: number } | undefined;
    for (const from of mine()) {
      const have = now.troops[from] + (extra.get(from) ?? 0);
      // A large garrison grows restless: it goes at even odds rather than wait for better.
      const wanted = have >= RULES.REGENT_RESTLESS ? 1 : REGENT_ODDS[temper];
      for (const to of neighbours(map, from)) {
        if (!attackable(to)) continue;
        // With another house at the gate, more stay behind to hold what the regent already has.
        const threatened = neighbours(map, from).some((j) => j !== to && now.holder[j] !== side && now.holder[j] !== null);
        const send = have - (threatened ? RULES.REGENT_KEEPS : 1);
        if (send < 2) continue;
        const odds = send / now.troops[to];
        if (odds < wanted) continue;
        // A free march is the easier prize; a tie is broken by the seed, not by the map's order.
        const score = odds + (now.holder[to] === null ? 0.4 : 0) + random() * 0.2;
        if (!best || score > best.score) best = { from, to, send, score };
      }
    }
    return best;
  };

  let attacks = 0;
  for (let n = 0; n < orders; n++) {
    if (now.day >= seasonDays) break;
    const pool = now.pool[side] ?? 0;
    const attack = attacks < attacksADay ? bestAttack() : undefined;
    const placing = (i: number) => Math.min(RULES.MUSTER_MAX, pool, room(i));
    const fields = mine().filter((i) => placing(i) > 0);
    if (fields.length && (n === 0 || !attack)) {
      // Where the new troops make an attack possible; else the border under the most pressure; else the seat.
      const opens = fields.map((i) => ({ i, attack: bestAttack(new Map([[i, placing(i)]])) })).filter((o) => o.attack?.from === o.i).sort((a, b) => b.attack!.score - a.attack!.score)[0];
      const pressed = fields
        .map((i) => ({ i, pressure: foes(i).reduce((sum, j) => sum + (now.holder[j] === null ? 0 : now.troops[j]), 0) - now.troops[i], front: foes(i).length > 0 }))
        .filter((o) => o.front)
        .sort((a, b) => b.pressure - a.pressure || a.i - b.i)[0];
      const seat = now.seats[side];
      const to = opens?.i ?? pressed?.i ?? (fields.includes(seat) ? seat : fields[0]);
      play({ type: 'muster', to, troops: placing(to) }, n);
      continue;
    }
    if (attack) {
      play({ type: 'attack', from: attack.from, to: attack.to, troops: attack.send }, n);
      attacks++;
      continue;
    }
    // Nothing to place and nothing worth attacking: bring troops from behind the lines one step nearer the border.
    const own = mine();
    const front = new Set(own.filter((i) => foes(i).length > 0));
    const steps = new Map<number, number>([...front].map((i) => [i, 0]));
    const queue = [...front];
    while (queue.length) {
      const at = queue.shift()!;
      for (const j of neighbours(map, at)) {
        if (now.holder[j] !== side || steps.has(j)) continue;
        steps.set(j, steps.get(at)! + 1);
        queue.push(j);
      }
    }
    let moved = false;
    for (const behind of own.filter((i) => !front.has(i) && now.troops[i] > 1).sort((a, b) => now.troops[b] - now.troops[a] || a - b)) {
      const toward = neighbours(map, behind)
        .filter((j) => now.holder[j] === side && steps.has(j) && steps.get(j)! < (steps.get(behind) ?? Infinity) && room(j) > 0)
        .sort((a, b) => steps.get(a)! - steps.get(b)! || a - b)[0];
      if (toward === undefined) continue;
      play({ type: 'march', from: behind, to: toward, troops: Math.min(now.troops[behind] - 1, room(toward)) }, n);
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return { state: now, events };
}

// ---------- nightfall ----------

export interface SideRules {
  id: string;
  /** What this side's renown adds to its levy (0 to RULES.RENOWN_MAX_BONUS). */
  bonus: number;
  /** How its regent plays when no member gave an order that day. */
  temper: Temper;
  /** How often its regent attacks in a day; the rules' number when left out. */
  attacksADay?: number;
}

/** Gives each side its levy for the day that has just begun. */
export function addLevy(state: State, sides: SideRules[]): State {
  const next = copy(state);
  const ids = sides.map((s) => s.id);
  for (const s of sides) next.pool[s.id] = Math.min(RULES.POOL_CAP, (next.pool[s.id] ?? 0) + levyOf(state, s.id, s.bonus, ids).total);
  return next;
}

/**
 * The end of a day: a regent plays every side no member gave an order for (in an order that turns with the days, so
 * nobody always moves first), then the next day begins and its levy arrives. The last day of a season brings no levy.
 */
export function endDay(state: State, map: GameMap, sides: SideRules[], seed: string, seasonDays: number = RULES.SEASON_DAYS): { state: State; events: GameEvent[] } {
  if (state.day >= seasonDays) return { state, events: [] };
  const events: GameEvent[] = [];
  let now = state;
  const first = sides.length ? state.day % sides.length : 0;
  const order = [...sides.slice(first), ...sides.slice(0, first)];
  for (const s of order) {
    if (state.acted.includes(s.id)) continue;
    const turn = regentTurn(now, map, s.id, `${seed}:day${state.day}`, { temper: s.temper, attacksADay: s.attacksADay, seasonDays });
    now = turn.state;
    events.push(...turn.events);
  }
  now = { ...copy(now), day: state.day + 1, acted: [] };
  if (now.day < seasonDays) now = addLevy(now, sides);
  return { state: now, events };
}

/** Whether a position is one this map and these sides could have: used before trusting a stored one. */
export function validState(state: State, map: GameMap): boolean {
  const n = map.provinces.length;
  return Array.isArray(state.holder) && Array.isArray(state.troops) && state.holder.length === n && state.troops.length === n
    && state.troops.every((t) => Number.isInteger(t) && t >= 1) && Number.isInteger(state.day) && state.day >= 0;
}

/** Orders a member has on `day`, from what they had on `since`: three more each day, saved up to the bank (a bonus may sit on top). */
export function ordersOn(day: number, had: number, since: number): number {
  const gained = Math.max(0, day - since) * RULES.ORDERS_PER_DAY;
  return gained ? Math.max(had, Math.min(RULES.ORDERS_BANK, had + gained)) : had;
}
