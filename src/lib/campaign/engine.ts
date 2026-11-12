// The Campaign's rules, as one pure module: the field (an invented continent from ./geography.ts, with its terrain), the
// opening, a turn's levy, the moves of a reign (place a troop, march, attack, end the turn), the dice and the exact odds
// of an attack, the regents that play the other houses, and the score. It reads no clock and no database and draws every
// random number from a seed, so the browser plays a reign and the server replays the same moves to the same score.
//
// Nothing here knows a person or a place of the family's: a side is a house's id, a province is an invented name. No
// rule reads a lifespan, a cause of death or a number of children.
import { between, rng } from './rng.ts';
import { MAP_H, MAP_W, dress, layoutOf } from './geography.ts';

export { MAP_H, MAP_W };

/**
 * The rules' version. A field says which rules it was laid out for (`map.v`; a field from before there were versions
 * is 1). Scores are only compared within one version: 1 was the map made from the family's places, 2 is the invented
 * continent with marsh, rivers, ridges and sea lanes.
 */
export const RULESET = 2;

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
  /** Towns beside the seats (which are towns too), and the provinces of each other kind; the rest is plains. */
  FREE_TOWNS: 2,
  HIGHLANDS: 2,
  MARSHES: 2,
  FORESTS: 2,
  /** A province holds at most this many troops; a town more, a marsh fewer. */
  GARRISON_MAX: 10,
  TOWN_GARRISON_MAX: 12,
  MARSH_GARRISON_MAX: 6,
  /** Every side's levy a turn, before its towns and renown. */
  BASE_LEVY: 2,
  /** What each town held adds to the levy. */
  TOWN_LEVY: 1,
  /** The most renown adds to the levy a turn. */
  RENOWN_MAX_BONUS: 2,
  /** A right answer in the daily quiz: this much more levy on the first turn of the next reign that day. */
  QUIZ_LEVY: 2,
  /** An attack is fought for at most this many rounds of dice; across a river or the sea, for fewer. */
  BATTLE_ROUNDS: 3,
  CROSSING_ROUNDS: 2,
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

export type Pt = [number, number];

/** Game terrain, one rule each (docs/campaign.md). */
export type Terrain = 'plains' | 'forest' | 'highland' | 'marsh' | 'town';
export const TERRAINS: readonly Terrain[] = ['plains', 'forest', 'highland', 'marsh', 'town'];

/** What an attack has to cross to reach its target, beside open country. */
export type Crossing = 'river' | 'sea';

export interface Province {
  id: number;
  name: string;
  /** Where its banner stands, in the map's box (MAP_W × MAP_H). */
  x: number;
  y: number;
  /** Its land: a polygon in the same box. */
  cell: Pt[];
  /** Its terrain; a map stored before there was terrain has none, which reads as plains. */
  terrain?: Terrain;
  /** Whether it lies on the sea. */
  coast?: boolean;
}

export interface GameMap {
  /** The rules it was laid out for (RULESET); none on a map from before there were versions, which is 1. */
  v?: number;
  /** The continent's name, and where the open sea's names stand. */
  name?: string;
  seas?: { name: string; x: number; y: number }[];
  provinces: Province[];
  /** Pairs of province ids one can go between, the smaller id first: a shared border that is no ridge, or a sea lane. */
  borders: [number, number][];
  /** Rivers: the borders each runs along (an attack across is shorter), and its course from the spring to the sea. */
  rivers?: { between: [number, number][]; line: Pt[] }[];
  /** Mountain ridges: a border nobody crosses, so the two provinces are not neighbours. */
  ridges?: { between: [number, number]; line: Pt[] }[];
  /** Sea lanes: two harbours that are neighbours over the water, and the course between them (start, bend, end). */
  lanes?: { between: [number, number]; line: Pt[] }[];
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

/** What happened, for the page to show. `fromLeft` and `toLeft` are the two garrisons afterwards. */
export type GameEvent =
  | { t: 'march'; side: string; from: number; to: number; troops: number; fromLeft: number; toLeft: number }
  | {
    t: 'attack'; side: string; from: number; to: number; defender: string | null; committed: number; defenders: number;
    terrain: Terrain; crossing: Crossing | null; chance: number; rounds: Round[]; aLost: number; dLost: number; took: boolean; turn: number;
    fromLeft: number; toLeft: number;
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
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- the map ----------

/** The rules a map was laid out for. */
export const rulesetOf = (map: Pick<GameMap, 'v'> | undefined | null): number => map?.v ?? 1;

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

/** How many troops a province of this terrain holds at most. */
export const capOn = (terrain: Terrain) => (terrain === 'town' ? RULES.TOWN_GARRISON_MAX : terrain === 'marsh' ? RULES.MARSH_GARRISON_MAX : RULES.GARRISON_MAX);
export const capOf = (map: GameMap, id: number) => capOn(terrainOf(map, id));

const same = (pair: [number, number], a: number, b: number) => (pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a);

/** What lies between two neighbours beside open country: a sea lane, a river, or nothing. */
export function crossingOf(map: GameMap, a: number, b: number): Crossing | null {
  if (map.lanes?.some((l) => same(l.between, a, b))) return 'sea';
  if (map.rivers?.some((r) => r.between.some((pair) => same(pair, a, b)))) return 'river';
  return null;
}

/** The ground an attack is fought on: the target's terrain, and what the attackers cross to reach it. */
export interface Ground { terrain: Terrain; crossing?: Crossing | null }
const OPEN: Ground = { terrain: 'plains' };
export const groundOf = (map: GameMap, from: number, to: number): Ground => ({ terrain: terrainOf(map, to), crossing: crossingOf(map, from, to) });
/** How many rounds a battle on this ground is fought for at most. */
export const roundsOn = (ground: Ground) => (ground.crossing ? RULES.CROSSING_ROUNDS : RULES.BATTLE_ROUNDS);

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

const blank = (n: number): State => ({
  turn: 0, holder: Array.from({ length: n }, () => null), troops: Array.from({ length: n }, () => 0), pool: {}, seats: {}, orders: RULES.ORDERS_PER_TURN, won: {}, lost: {}, attacks: 0,
});

/**
 * The first morning. Every side gets a seat, far from the seats already chosen, and one neighbouring province; the rest
 * are free marches with a small garrison, there to be taken.
 */
export function startState(map: GameMap, sides: string[], seed: string): State {
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
    const room = (i: number) => (taken.length ? Math.min(...taken.map((s) => dist(at(i), at(s)))) : MAP_W);
    // The first seat is dealt; each later one stands as far from the others as the land allows, with room around it.
    const pool = open.map((i) => ({ i, room: room(i), ways: neighbours(map, i).length, tie: random() })).filter((s, _, all) => s.ways >= 2 || all.every((o) => o.ways < 2));
    pool.sort((a, b) => b.room - a.room || a.tie - b.tie);
    const seat = pool[0].i;
    seats[side] = seat;
    holder[seat] = side;
    troops[seat] = 4;
  }
  for (const side of sides) {
    const seat = seats[side];
    if (seat === undefined) continue;
    // Overland first: a harbour across the water is nobody's home ground.
    const near = neighbours(map, seat).filter((i) => holder[i] === null)
      .sort((a, b) => Number(crossingOf(map, seat, a) === 'sea') - Number(crossingOf(map, seat, b) === 'sea') || dist(at(a), at(seat)) - dist(at(b), at(seat)) || a - b)[0];
    if (near === undefined) { troops[seat] += 3; continue; }
    holder[near] = side;
    troops[near] = 3;
  }
  return state;
}

/** A reign's field: the map and the opening. The same sides and seed give the same field. */
export interface Field { map: GameMap; start: State }

/**
 * Lays out a field: the continent for the seed, a seat for each side, the towns (every seat, and the free towns that lie
 * furthest from all of them), the rest of the terrain by the lie of the land, and a name for everything.
 */
export function setupField(sides: string[], seed: string, count: number = RULES.PROVINCES): Field {
  const land = layoutOf(seed, count);
  const { map } = land;
  const start = startState(map, sides, seed);
  const seats = Object.values(start.seats);
  const towns = [...seats];
  const random = rng(`${seed}:towns`);
  const ties = map.provinces.map(() => random());
  for (let n = 0; n < RULES.FREE_TOWNS; n++) {
    // A free town is a prize between the houses: as many steps from every seat and town as the land allows.
    const far = map.provinces.map((p) => p.id).filter((i) => !towns.includes(i))
      .map((i) => ({ i, steps: Math.min(...towns.map((t) => stepsBetween(map, t, i))) }))
      .sort((a, b) => b.steps - a.steps || ties[a.i] - ties[b.i])[0];
    if (!far) break;
    towns.push(far.i);
  }
  dress(land, seats, towns, { highland: RULES.HIGHLANDS, marsh: RULES.MARSHES, forest: RULES.FORESTS }, seed);
  // A marsh holds fewer than the opening may have dealt it.
  map.provinces.forEach((p) => { start.troops[p.id] = Math.min(start.troops[p.id], capOf(map, p.id)); });
  return { map, start };
}

/** How many borders lie between two provinces by the shortest way. */
function stepsBetween(map: GameMap, from: number, to: number): number {
  const steps = new Map([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (at === to) return steps.get(at)!;
    for (const n of neighbours(map, at)) if (!steps.has(n)) { steps.set(n, steps.get(at)! + 1); queue.push(n); }
  }
  return Infinity;
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
export const attackDice = (a: number, terrain: Terrain) => Math.min(terrain === 'highland' ? 2 : 3, a);
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
 * A battle of at most three rounds (two across a river or the sea), with Risk's dice: the attacker rolls up to three
 * (two into highland), the defender up to two (the highest one better by one in a forest), the highest are compared pair
 * by pair, and a tie goes to the defender. The same seed rolls the same dice.
 */
export function battle(attackers: number, defenders: number, seed: string, ground: Ground = OPEN): { rounds: Round[]; aLost: number; dLost: number } {
  const random = rng(`${seed}:dice`);
  const rounds: Round[] = [];
  const { terrain } = ground;
  let a = attackers, d = defenders;
  while (rounds.length < roundsOn(ground) && a > 0 && d > 0) {
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
 * The exact chance that `attackers` take a province held by `defenders` on this ground within the battle's rounds: every
 * roll of every round counted, not sampled. 0 to 1.
 */
export function winChance(attackers: number, defenders: number, ground: Ground = OPEN): number {
  if (!(attackers >= 1)) return 0;
  if (!(defenders >= 1)) return 1;
  const { terrain } = ground;
  const rounds = roundsOn(ground);
  const key = `${attackers}:${defenders}:${terrain}:${rounds}`;
  const known = chanceCache.get(key);
  if (known !== undefined) return known;
  let at = new Map<string, number>([[`${attackers}:${defenders}`, 1]]);
  let win = 0;
  for (let round = 0; round < rounds && at.size; round++) {
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
    return { t: 'march', side, from: m.from, to: m.to, troops: m.troops, fromLeft: s.troops[m.from], toLeft: s.troops[m.to] };
  }

  const defender = s.holder[m.to];
  if (defender === side) throw new CampaignError('own_province');
  if (defender !== null && s.seats[defender] === m.to) throw new CampaignError('seat');
  const ground = groundOf(map, m.from, m.to);
  const defenders = s.troops[m.to];
  const fought = battle(m.troops, defenders, seed, ground);
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
  return {
    t: 'attack', side, from: m.from, to: m.to, defender, committed: m.troops, defenders, terrain: ground.terrain, crossing: ground.crossing ?? null,
    chance: winChance(m.troops, defenders, ground), rounds: fought.rounds, aLost: fought.aLost, dLost: fought.dLost, took, turn: s.turn,
    fromLeft: s.troops[m.from], toLeft: s.troops[m.to],
  };
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
        const chance = winChance(send, s().troops[to], groundOf(map, from, to));
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
