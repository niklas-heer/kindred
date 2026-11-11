// The Campaign's rules, as one pure module: the map made from the family's places (with its terrain), the opening, a
// turn's levy, the moves of a reign (place a troop, march, attack, end the turn), the dice and the exact odds of an
// attack, the regents that play the other houses, and the score. It reads no clock and no database and draws every
// random number from a seed, so the browser plays a reign and the server replays the same moves to the same score.
//
// Nothing here knows a person: a side is a house's id, a province is a place's name. No rule reads a lifespan, a cause
// of death or a number of children.
import { between, rng } from './rng.ts';
import { MARCH_NAMES } from './names.ts';

/** The numbers of the game. Tuned with regents playing every side (see engine.test.ts, "a reign between regents"). */
export const RULES = {
  /** A reign lasts this many turns. */
  TURNS: 12,
  /** Marches and attacks a turn; placing the levy costs none. */
  ORDERS_PER_TURN: 3,
  /** The sides of a reign: the family's houses, and invented regents when it has fewer. */
  SIDES: 4,
  /** The provinces of a reign's map. */
  PROVINCES: 16,
  MIN_PROVINCES: 10,
  MAX_PROVINCES: 24,
  /** The most-peopled real places are towns (the seats are too). */
  TOWN_PLACES: 1,
  /** About this share of the map is plains; forest and highland share the rest. */
  PLAINS_SHARE: 0.45,
  /** A province holds at most this many troops; a town more. */
  GARRISON_MAX: 10,
  TOWN_GARRISON_MAX: 12,
  /** Every side's levy a turn, before its towns and renown. */
  BASE_LEVY: 2,
  /** What each town held adds to the levy. */
  TOWN_LEVY: 1,
  /** The most renown adds to the levy a turn. */
  RENOWN_MAX_BONUS: 2,
  /** A right answer in the daily quiz: this much more levy on the first turn of the next reign that day. */
  QUIZ_LEVY: 2,
  /** An attack is fought for at most this many rounds of dice. */
  BATTLE_ROUNDS: 3,
  /** A regent keeps this many at home when another house borders the province it attacks from. */
  REGENT_KEEPS: 2,
  /** A regent attacks when its chance is at least this. */
  REGENT_NERVE: 0.6,
  /** With this many in one province a regent grows restless and settles for a lower chance. */
  REGENT_RESTLESS: 7,
  REGENT_RESTLESS_NERVE: 0.4,
  /** A regent attacks this often a turn at most. */
  REGENT_ATTACKS: 2,
  /** The score at the end: per province, per town (instead), per battle won, and taken off per troop lost. */
  SCORE_PROVINCE: 10,
  SCORE_TOWN: 20,
  SCORE_BATTLE: 2,
  SCORE_TROOP: 1,
  /** The longest list of moves a reign can have: a guard against a forged one, far above any real reign. */
  MAX_MOVES: 1500,
} as const;

export const MAP_W = 1000;
export const MAP_H = 720;
const MARGIN = 70;

export type Pt = [number, number];

/** Game terrain, one rule each (docs/campaign.md). Not the real country's. */
export type Terrain = 'plains' | 'forest' | 'highland' | 'town';
export const TERRAINS: readonly Terrain[] = ['plains', 'forest', 'highland', 'town'];

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
  /** Its terrain; a map stored before there was terrain has none, which reads as plains. */
  terrain?: Terrain;
}

export interface GameMap {
  provinces: Province[];
  /** Pairs of province ids that share a border, the smaller id first. */
  borders: [number, number][];
}

/** The position of a reign. */
export interface State {
  /** The turn being played, from 0. The reign is over when it reaches RULES.TURNS. */
  turn: number;
  /** Each province's holder (a side's id), or null for a free march nobody has claimed. */
  holder: (string | null)[];
  troops: number[];
  /** Each side's levy still to be placed. */
  pool: Record<string, number>;
  /** Each side's seat: it can never be attacked, so no side is ever out. */
  seats: Record<string, number>;
  /** The player's marches and attacks left this turn. */
  orders: number;
  /** Battles each side has won (a province taken, or an attack thrown back), and troops each has lost. */
  won: Record<string, number>;
  lost: Record<string, number>;
  /** How many attacks the player has made: each one's dice come from its own number. */
  attacks: number;
}

/** A reign's rules: the map, the sides in their order, the side played, the dice's seed, and what adds to the player's levy. */
export interface Reign {
  map: GameMap;
  sides: string[];
  player: string;
  seed: string;
  /** Renown's troops a turn for the player (0 to RULES.RENOWN_MAX_BONUS). */
  renown: number;
  /** Extra levy on the first turn (the daily quiz's reward). */
  grant: number;
}

/** One move of a reign: what the browser sends and the server replays. */
export type Move =
  | { t: 'place'; to: number }
  | { t: 'march'; from: number; to: number; troops: number }
  | { t: 'attack'; from: number; to: number; troops: number }
  | { t: 'end' };

export interface Round { a: number[]; d: number[]; aLost: number; dLost: number }

export type GameEvent =
  | { t: 'march'; side: string; from: number; to: number; troops: number }
  | {
    t: 'attack'; side: string; from: number; to: number; defender: string | null; committed: number; defenders: number;
    terrain: Terrain; rounds: Round[]; aLost: number; dLost: number; took: boolean; turn: number;
  };

export type ErrorCode =
  | 'over' | 'no_province' | 'not_yours' | 'not_adjacent' | 'no_levy' | 'troops' | 'own_province' | 'seat' | 'stay_one'
  | 'full' | 'no_orders' | 'unfinished' | 'too_long';

/** A refused move. The message is a translation key (`campaign.err.<code>`), which the browser shows in its language. */
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

  // The land: the most-peopled real places are towns (the real places come first, most-peopled first).
  const terrain = dealTerrain(n, new Set(Array.from({ length: Math.min(real.length, RULES.TOWN_PLACES) }, (_, i) => i)), random);

  return {
    provinces: sites.map((s, i) => ({
      id: i,
      name: names[i],
      x: round1(s[0]),
      y: round1(s[1]),
      cell: lands[i].map((p) => [round1(p[0]), round1(p[1])] as Pt),
      real: i < real.length,
      terrain: terrain[i],
    })),
    borders,
  };
}


/** A copy of `items` in an order dealt by `random`. */
function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = between(random, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Each province's terrain: `towns` are towns; of the rest, about RULES.PLAINS_SHARE of the whole map is plains and the
 * remainder is forest and highland in turn, dealt by `random`. Game terrain, not the real country's.
 */
function dealTerrain(n: number, towns: ReadonlySet<number>, random: () => number): Terrain[] {
  const terrain: Terrain[] = Array.from({ length: n }, (_, i) => (towns.has(i) ? 'town' : 'plains'));
  const open = shuffled(terrain.map((_, i) => i).filter((i) => !towns.has(i)), random);
  const plains = Math.round(n * RULES.PLAINS_SHARE);
  open.slice(0, Math.max(0, open.length - plains)).forEach((i, k) => { terrain[i] = k % 2 === 0 ? 'forest' : 'highland'; });
  return terrain;
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

/** A province's terrain: plains when the map was stored before there was terrain. */
export const terrainOf = (map: GameMap, id: number): Terrain => map.provinces[id]?.terrain ?? 'plains';

/** How many troops a province holds at most. */
export const capOf = (map: GameMap, id: number) => (terrainOf(map, id) === 'town' ? RULES.TOWN_GARRISON_MAX : RULES.GARRISON_MAX);

/** The most troops an order from `from` to `to` can send now: all but one, and for a march no more than `to` has room for. */
export function sendable(s: State, map: GameMap, side: string, from: number, to: number): number {
  const spare = s.troops[from] - 1;
  return s.holder[to] === side ? Math.min(spare, capOf(map, to) - s.troops[to]) : spare;
}

/**
 * The troops an order sends: what the player chose, kept between one and what the position allows now. The choice may
 * have been made on another position (an undo while the order bar was open), so it is clamped when the order is given.
 */
export const orderTroops = (wanted: number, s: State, map: GameMap, side: string, from: number, to: number) =>
  Math.max(1, Math.min(wanted, sendable(s, map, side, from, to)));

// ---------- the opening ----------

/** Each side's people per place on the map, from the places' `byHouse` counts: where a side's seat should be. */
export function homesFrom(places: PlaceIn[], map: GameMap): Record<string, Record<string, number>> {
  const onMap = new Set(map.provinces.map((p) => p.name));
  const homes: Record<string, Record<string, number>> = {};
  for (const place of places) {
    if (!onMap.has(place.name)) continue;
    for (const [side, n] of Object.entries(place.byHouse ?? {})) (homes[side] ??= {})[place.name] = n;
  }
  return homes;
}

const blank = (n: number): State => ({
  turn: 0, holder: Array.from({ length: n }, () => null), troops: Array.from({ length: n }, () => 0), pool: {}, seats: {}, orders: RULES.ORDERS_PER_TURN, won: {}, lost: {}, attacks: 0,
});

/**
 * The first morning. Every side gets a seat (its people's own place when the map has it, else a place far from the other
 * seats) and one neighbouring province; the rest are free marches with a small garrison, there to be taken. `homes` is
 * each side's count of people per place name.
 */
export function startState(map: GameMap, sides: string[], seed: string, homes: Record<string, Record<string, number>> = {}): State {
  const random = rng(`${seed}:start`);
  const state = blank(map.provinces.length);
  const { holder, troops, seats } = state;
  map.provinces.forEach((_, i) => { troops[i] = between(random, 2, 3); });
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
  return state;
}

/** A reign's field: the map, whose seats are made towns, and the opening. The same places, sides and seed give the same field. */
export interface Field { map: GameMap; start: State }

export function setupField(places: PlaceIn[], sides: string[], seed: string, count: number = RULES.PROVINCES): Field {
  const map = buildMap(places, count, seed);
  const start = startState(map, sides, seed, homesFrom(places, map));
  // The seats are towns too; the rest of the land is dealt again around them, so the shares hold.
  const towns = new Set([...Object.values(start.seats), ...map.provinces.filter((p) => p.real).slice(0, RULES.TOWN_PLACES).map((p) => p.id)]);
  const terrain = dealTerrain(map.provinces.length, towns, rng(`${seed}:terrain`));
  map.provinces.forEach((p, i) => { p.terrain = terrain[i]; });
  return { map, start };
}

// ---------- counting ----------

export const provincesOf = (state: Pick<State, 'holder'>, side: string) => state.holder.reduce((n, h) => n + (h === side ? 1 : 0), 0);
export const troopsOf = (state: Pick<State, 'holder' | 'troops'>, side: string) => state.holder.reduce((n, h, i) => n + (h === side ? state.troops[i] : 0), 0);
export const townsOf = (state: Pick<State, 'holder'>, map: GameMap, side: string) => state.holder.reduce((n, h, i) => n + (h === side && terrainOf(map, i) === 'town' ? 1 : 0), 0);

export interface Levy { base: number; towns: number; renown: number; grant: number; total: number }

/** A side's levy for a turn: the base, one for each town it holds, its renown, and a reward the turn carries. */
export function levyOf(state: State, map: GameMap, side: string, renown = 0, grant = 0): Levy {
  const towns = townsOf(state, map, side) * RULES.TOWN_LEVY;
  const r = clamp(Math.floor(renown), 0, RULES.RENOWN_MAX_BONUS);
  const g = Math.max(0, Math.floor(grant));
  return { base: RULES.BASE_LEVY, towns, renown: r, grant: g, total: RULES.BASE_LEVY + towns + r + g };
}

export interface Standing { side: string; provinces: number; troops: number }

/** The sides in order: most provinces first, then most troops, then the order given. */
export function standings(state: Pick<State, 'holder' | 'troops'>, sides: string[]): Standing[] {
  return sides
    .map((side, i) => ({ side, provinces: provincesOf(state, side), troops: troopsOf(state, side), i }))
    .sort((a, b) => b.provinces - a.provinces || b.troops - a.troops || a.i - b.i)
    .map(({ side, provinces, troops }) => ({ side, provinces, troops }));
}

export interface Score { provinces: number; towns: number; won: number; lost: number; total: number }

/** The score of a side: 10 a province (20 a town), 2 a battle won, less 1 a troop lost; never below nothing. */
export function scoreOf(state: State, map: GameMap, side: string): Score {
  const provinces = provincesOf(state, side);
  const towns = townsOf(state, map, side);
  const won = state.won[side] ?? 0;
  const lost = state.lost[side] ?? 0;
  const total = (provinces - towns) * RULES.SCORE_PROVINCE + towns * RULES.SCORE_TOWN + won * RULES.SCORE_BATTLE - lost * RULES.SCORE_TROOP;
  return { provinces, towns, won, lost, total: Math.max(0, total) };
}

// ---------- dice ----------

/** How many dice the attacker rolls: up to three, two at most into highland. */
const attackDice = (a: number, terrain: Terrain) => Math.min(terrain === 'highland' ? 2 : 3, a);
const defendDice = (d: number) => Math.min(2, d);

/** One round's comparison: dice sorted high to low, the defender's highest raised by one in a forest (to six at most). */
function compare(a: number[], d: number[], terrain: Terrain): { a: number[]; d: number[]; aLost: number; dLost: number } {
  const ad = [...a].sort((x, y) => y - x);
  const dd = [...d].sort((x, y) => y - x);
  if (terrain === 'forest' && dd.length) dd[0] = Math.min(6, dd[0] + 1);
  let aLost = 0, dLost = 0;
  for (let i = 0; i < Math.min(ad.length, dd.length); i++) {
    if (ad[i] > dd[i]) dLost++;
    else aLost++;
  }
  return { a: ad, d: dd, aLost, dLost };
}

/**
 * A battle of at most three rounds, with Risk's dice: the attacker rolls up to three (two into highland), the defender
 * up to two (the highest one better by one in a forest), the highest are compared pair by pair, and a tie goes to the
 * defender. The same seed rolls the same dice.
 */
export function battle(attackers: number, defenders: number, seed: string, terrain: Terrain = 'plains'): { rounds: Round[]; aLost: number; dLost: number } {
  const random = rng(`${seed}:dice`);
  const rounds: Round[] = [];
  let a = attackers, d = defenders;
  while (rounds.length < RULES.BATTLE_ROUNDS && a > 0 && d > 0) {
    const roll = (count: number) => Array.from({ length: count }, () => between(random, 1, 6));
    const r = compare(roll(attackDice(a, terrain)), roll(defendDice(d)), terrain);
    a -= r.aLost;
    d -= r.dLost;
    rounds.push(r);
  }
  return { rounds, aLost: attackers - a, dLost: defenders - d };
}

const roundCache = new Map<string, { aLost: number; dLost: number; p: number }[]>();

/** Every outcome of one round with these dice, with its chance: all 6^n rolls counted. */
function roundOdds(aDice: number, dDice: number, terrain: Terrain) {
  const key = `${aDice}:${dDice}:${terrain === 'forest' ? 'f' : ''}`;
  const known = roundCache.get(key);
  if (known) return known;
  const n = aDice + dDice;
  const total = 6 ** n;
  const tally = new Map<string, number>();
  for (let code = 0; code < total; code++) {
    const dice: number[] = [];
    for (let k = 0, c = code; k < n; k++, c = Math.floor(c / 6)) dice.push((c % 6) + 1);
    const r = compare(dice.slice(0, aDice), dice.slice(aDice), terrain);
    const id = `${r.aLost}:${r.dLost}`;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  const out = [...tally].map(([id, count]) => {
    const [aLost, dLost] = id.split(':').map(Number);
    return { aLost, dLost, p: count / total };
  });
  roundCache.set(key, out);
  return out;
}

const chanceCache = new Map<string, number>();

/**
 * The exact chance that `attackers` take a province held by `defenders` on this terrain within the battle's rounds: every
 * roll of every round counted, not sampled. 0 to 1.
 */
export function winChance(attackers: number, defenders: number, terrain: Terrain = 'plains'): number {
  if (!(attackers >= 1)) return 0;
  if (!(defenders >= 1)) return 1;
  const key = `${attackers}:${defenders}:${terrain}`;
  const known = chanceCache.get(key);
  if (known !== undefined) return known;
  let at = new Map<string, number>([[`${attackers}:${defenders}`, 1]]);
  let win = 0;
  for (let round = 0; round < RULES.BATTLE_ROUNDS && at.size; round++) {
    const next = new Map<string, number>();
    for (const [id, p] of at) {
      const [a, d] = id.split(':').map(Number);
      for (const o of roundOdds(attackDice(a, terrain), defendDice(d), terrain)) {
        const na = a - o.aLost, nd = d - o.dLost, q = p * o.p;
        if (nd <= 0) win += q;
        else if (na > 0) next.set(`${na}:${nd}`, (next.get(`${na}:${nd}`) ?? 0) + q);
      }
    }
    at = next;
  }
  chanceCache.set(key, win);
  return win;
}

// ---------- moves ----------

const copy = (s: State): State => ({ ...s, holder: [...s.holder], troops: [...s.troops], pool: { ...s.pool }, seats: { ...s.seats }, won: { ...s.won }, lost: { ...s.lost } });
const whole = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;
const add = (counts: Record<string, number>, side: string | null, n: number) => { if (side && n) counts[side] = (counts[side] ?? 0) + n; };

/** One troop of a side's waiting levy placed on a province it holds. Changes `s`. */
function placeOne(s: State, map: GameMap, side: string, to: number) {
  if (!Number.isInteger(to) || to < 0 || to >= map.provinces.length) throw new CampaignError('no_province');
  if (s.holder[to] !== side) throw new CampaignError('not_yours');
  if ((s.pool[side] ?? 0) < 1) throw new CampaignError('no_levy');
  if (s.troops[to] >= capOf(map, to)) throw new CampaignError('full');
  s.pool[side] -= 1;
  s.troops[to] += 1;
}

/** A march or an attack for a side, checked against the position. Changes `s`; returns what happened. */
function orderOne(s: State, map: GameMap, side: string, m: Extract<Move, { t: 'march' | 'attack' }>, seed: string): GameEvent {
  const n = map.provinces.length;
  const known = (i: number) => Number.isInteger(i) && i >= 0 && i < n;
  if (!known(m.from) || !known(m.to)) throw new CampaignError('no_province');
  if (!whole(m.troops)) throw new CampaignError('troops');
  if (s.holder[m.from] !== side) throw new CampaignError('not_yours');
  if (!adjacent(map, m.from, m.to)) throw new CampaignError('not_adjacent');
  // One always stays behind to hold the province.
  if (m.troops > s.troops[m.from] - 1) throw new CampaignError('stay_one');

  if (m.t === 'march') {
    if (s.holder[m.to] !== side) throw new CampaignError('not_yours');
    if (s.troops[m.to] + m.troops > capOf(map, m.to)) throw new CampaignError('full');
    s.troops[m.from] -= m.troops;
    s.troops[m.to] += m.troops;
    return { t: 'march', side, from: m.from, to: m.to, troops: m.troops };
  }

  const defender = s.holder[m.to];
  if (defender === side) throw new CampaignError('own_province');
  if (defender !== null && s.seats[defender] === m.to) throw new CampaignError('seat');
  const terrain = terrainOf(map, m.to);
  const defenders = s.troops[m.to];
  const fought = battle(m.troops, defenders, seed, terrain);
  const took = fought.dLost >= defenders;
  add(s.lost, side, fought.aLost);
  add(s.lost, defender, fought.dLost);
  if (took) {
    // The survivors move in, as many as the province holds; the rest go home.
    const survivors = m.troops - fought.aLost;
    const moved = Math.min(survivors, capOf(map, m.to));
    s.troops[m.from] -= m.troops - (survivors - moved);
    s.holder[m.to] = side;
    s.troops[m.to] = moved;
    add(s.won, side, 1);
  } else {
    s.troops[m.from] -= fought.aLost;
    s.troops[m.to] = defenders - fought.dLost;
    add(s.won, defender, 1);
  }
  return { t: 'attack', side, from: m.from, to: m.to, defender, committed: m.troops, defenders, terrain, rounds: fought.rounds, aLost: fought.aLost, dLost: fought.dLost, took, turn: s.turn };
}

/** The first turn of a reign: the opening, with the player's first levy waiting and their orders ready. */
export function openReign(start: State, reign: Reign): State {
  const s = copy(start);
  s.turn = 0;
  s.orders = RULES.ORDERS_PER_TURN;
  s.attacks = 0;
  s.pool[reign.player] = (s.pool[reign.player] ?? 0) + levyOf(s, reign.map, reign.player, reign.renown, reign.grant).total;
  return s;
}

/**
 * One move of the player's, checked against the position: it returns the new position and what happened, or throws a
 * CampaignError and changes nothing. Placing a troop is free; a march or an attack takes one of the turn's orders; the
 * end of the turn lets the regents play and brings the next turn's levy.
 */
export function play(state: State, reign: Reign, move: Move): { state: State; events: GameEvent[] } {
  if (state.turn >= RULES.TURNS) throw new CampaignError('over');
  const s = copy(state);
  switch (move?.t) {
    case 'place':
      placeOne(s, reign.map, reign.player, move.to);
      return { state: s, events: [] };
    case 'march':
    case 'attack': {
      if (s.orders < 1) throw new CampaignError('no_orders');
      const seed = `${reign.seed}:t${s.turn}:p${s.attacks}`;
      const event = orderOne(s, reign.map, reign.player, move, seed);
      s.orders -= 1;
      if (move.t === 'attack') s.attacks += 1;
      return { state: s, events: [event] };
    }
    case 'end':
      return endTurn(s, reign);
    default:
      throw new CampaignError('no_province');
  }
}

// ---------- the regents ----------

interface Actor {
  now: () => State;
  place: (to: number) => void;
  order: (m: Extract<Move, { t: 'march' | 'attack' }>) => void;
  ordersLeft: () => number;
}

/**
 * How a regent plays a side's turn: it places its levy where the new troops open a good attack (else on the border under
 * the most pressure, else at its seat), attacks where its chance is good, and walks troops out of the hinterland towards
 * the border. Simple on purpose, and the same for the same seed. It plays only through `act`, so it never does anything
 * a player could not.
 */
function regentPlays(act: Actor, map: GameMap, side: string, random: () => number) {
  const s = act.now;
  const mine = () => map.provinces.map((p) => p.id).filter((i) => s().holder[i] === side);
  const attackable = (i: number) => {
    const h = s().holder[i];
    return h !== side && !(h !== null && s().seats[h] === i);
  };
  const foes = (i: number) => neighbours(map, i).filter((j) => s().holder[j] !== side);
  const room = (i: number) => capOf(map, i) - s().troops[i];
  const bestAttack = (extra: Map<number, number> = new Map()) => {
    let best: { from: number; to: number; send: number; score: number } | undefined;
    for (const from of mine()) {
      const have = s().troops[from] + (extra.get(from) ?? 0);
      // A large garrison grows restless: it settles for a lower chance rather than wait.
      const nerve = have >= RULES.REGENT_RESTLESS ? RULES.REGENT_RESTLESS_NERVE : RULES.REGENT_NERVE;
      for (const to of neighbours(map, from)) {
        if (!attackable(to)) continue;
        // With another house at the gate, more stay behind to hold what the regent already has.
        const threatened = neighbours(map, from).some((j) => j !== to && s().holder[j] !== side && s().holder[j] !== null);
        const send = have - (threatened ? RULES.REGENT_KEEPS : 1);
        if (send < 1) continue;
        const chance = winChance(send, s().troops[to], terrainOf(map, to));
        if (chance < nerve) continue;
        // A free march and a town are the better prizes; a tie is broken by the seed, not by the map's order.
        const score = chance + (s().holder[to] === null ? 0.3 : 0) + (terrainOf(map, to) === 'town' ? 0.3 : 0) + random() * 0.1;
        if (!best || score > best.score) best = { from, to, send, score };
      }
    }
    return best;
  };

  // The levy, in as few places as it can.
  for (let guard = 0; guard < 8 && (s().pool[side] ?? 0) > 0; guard++) {
    const pool = s().pool[side] ?? 0;
    const fields = mine().filter((i) => room(i) > 0);
    if (!fields.length) break;
    const placing = (i: number) => Math.min(pool, room(i));
    const opens = fields
      .map((i) => ({ i, attack: bestAttack(new Map([[i, placing(i)]])) }))
      .filter((o) => o.attack?.from === o.i)
      .sort((a, b) => b.attack!.score - a.attack!.score)[0];
    const pressed = fields
      .map((i) => ({ i, pressure: foes(i).reduce((sum, j) => sum + (s().holder[j] === null ? 0 : s().troops[j]), 0) - s().troops[i], front: foes(i).length > 0 }))
      .filter((o) => o.front)
      .sort((a, b) => b.pressure - a.pressure || a.i - b.i)[0];
    const seat = s().seats[side];
    const to = opens?.i ?? pressed?.i ?? (fields.includes(seat) ? seat : fields[0]);
    for (let k = placing(to); k > 0; k--) act.place(to);
  }

  let attacks = 0;
  while (act.ordersLeft() > 0) {
    const attack = attacks < RULES.REGENT_ATTACKS ? bestAttack() : undefined;
    if (attack) {
      act.order({ t: 'attack', from: attack.from, to: attack.to, troops: attack.send });
      attacks++;
      continue;
    }
    // Nothing worth attacking: bring troops from behind the lines one step nearer the border.
    const own = mine();
    const front = new Set(own.filter((i) => foes(i).length > 0));
    const steps = new Map<number, number>([...front].map((i) => [i, 0]));
    const queue = [...front];
    while (queue.length) {
      const at = queue.shift()!;
      for (const j of neighbours(map, at)) {
        if (s().holder[j] !== side || steps.has(j)) continue;
        steps.set(j, steps.get(at)! + 1);
        queue.push(j);
      }
    }
    let moved = false;
    for (const behind of own.filter((i) => !front.has(i) && s().troops[i] > 1).sort((a, b) => s().troops[b] - s().troops[a] || a - b)) {
      const toward = neighbours(map, behind)
        .filter((j) => s().holder[j] === side && steps.has(j) && steps.get(j)! < (steps.get(behind) ?? Infinity) && room(j) > 0)
        .sort((a, b) => steps.get(a)! - steps.get(b)! || a - b)[0];
      if (toward === undefined) continue;
      act.order({ t: 'march', from: behind, to: toward, troops: Math.min(s().troops[behind] - 1, room(toward)) });
      moved = true;
      break;
    }
    if (!moved) break;
  }
}

/** A regent's turn for a side that is not the player's: its levy arrives, then it plays. Returns its attacks and marches. */
export function regentTurn(state: State, reign: Reign, side: string): { state: State; events: GameEvent[] } {
  let s = copy(state);
  s.pool[side] = (s.pool[side] ?? 0) + levyOf(s, reign.map, side).total;
  const events: GameEvent[] = [];
  let orders = RULES.ORDERS_PER_TURN;
  const act: Actor = {
    now: () => s,
    place: (to) => { placeOne(s, reign.map, side, to); },
    order: (m) => {
      const next = copy(s);
      events.push(orderOne(next, reign.map, side, m, `${reign.seed}:t${s.turn}:${side}:${RULES.ORDERS_PER_TURN - orders}`));
      s = next;
      orders -= 1;
    },
    ordersLeft: () => orders,
  };
  regentPlays(act, reign.map, side, rng(`${reign.seed}:t${state.turn}:regent:${side}`));
  return { state: s, events };
}

/** The end of the player's turn: every regent plays in an order that turns with the turns, then the next turn's levy arrives. */
function endTurn(state: State, reign: Reign): { state: State; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let s = state;
  const others = reign.sides.filter((x) => x !== reign.player);
  const first = others.length ? s.turn % others.length : 0;
  for (const side of [...others.slice(first), ...others.slice(0, first)]) {
    const turn = regentTurn(s, reign, side);
    s = turn.state;
    events.push(...turn.events);
  }
  s = copy(s);
  s.turn += 1;
  s.orders = RULES.ORDERS_PER_TURN;
  if (s.turn < RULES.TURNS) s.pool[reign.player] = (s.pool[reign.player] ?? 0) + levyOf(s, reign.map, reign.player, reign.renown).total;
  return { state: s, events };
}

/**
 * The moves a regent would make for the player's side this turn, ending it: for the simulations in the tests, and a
 * fair stand-in wherever a side must be played by nobody. They are played through `play`, so they are moves a player
 * could send.
 */
export function regentMoves(state: State, reign: Reign): Move[] {
  let s = state;
  const moves: Move[] = [];
  const go = (m: Move) => { s = play(s, reign, m).state; moves.push(m); };
  regentPlays({ now: () => s, place: (to) => go({ t: 'place', to }), order: (m) => go(m), ordersLeft: () => s.orders }, reign.map, reign.player, rng(`${reign.seed}:t${state.turn}:regent:${reign.player}`));
  go({ t: 'end' });
  return moves;
}

// ---------- a whole reign ----------

/**
 * Plays a reign's moves from its opening and returns where it ended and its score. Throws a CampaignError on the first
 * move the rules refuse, on a list that stops before the last turn, and on one longer than any reign could be: the
 * server's check of a reign the browser played.
 */
export function replay(start: State, reign: Reign, moves: Move[]): { state: State; score: Score } {
  if (!Array.isArray(moves) || moves.length > RULES.MAX_MOVES) throw new CampaignError('too_long');
  let s = openReign(start, reign);
  for (const move of moves) s = play(s, reign, move).state;
  if (s.turn < RULES.TURNS) throw new CampaignError('unfinished');
  return { state: s, score: scoreOf(s, reign.map, reign.player) };
}
