// The Campaign on the server: the season's state in the family database (migrations/tree/0025_campaign.sql), a
// member's orders, the regents catching up, the season's end and the hall of fame. The rules are in ./engine.ts, which
// the browser's practice skirmish uses too; this module only decides who may do what, and writes.
//
// What it promises:
// - It reads the family's records (houses, places, how well people are recorded) and never writes to them. Every write
//   goes to a `campaign*` table.
// - Dice are rolled here, from a seed made here and kept with the battle. A browser sends an order, never a result.
// - A member can act only for the side they fight for, and only with orders they have: both are checked on fresh
//   reads and restated as guards in the batch, so two requests at once cannot spend the same order.
// - Time moves by UTC days. Nothing runs on a timer of its own: whoever opens the game, or the daily job, plays the
//   missed nights in order, and the same nights always come out the same (the regents draw from the season's seed).
import { accounts } from '../auth/store.server.ts';
import { db, guard, NOT_A_RECORD, once, q, type Db, type Query } from '../db.server.ts';
import { readOnly } from '../read-only.ts';
import type { House } from '../types.ts';
import {
  RULES, addLevy, applyOrder, buildMap, endDay, levyOf, ordersOn, provinceCount, provincesOf, standings, startState, troopsOf, validState,
  type GameEvent, type GameMap, type Order, type PlaceIn, type SideRules, type State,
} from './engine.ts';
import { RIVALS, isRival } from './names.ts';
import { RIVAL_RENOWN, renownOf, type Renown, type RenownCounts } from './renown.ts';
import type { CampaignBoard, CampaignMe, CampaignStatus, CampaignView, FameEntry, LogEntry, LogKind, OrderResult, SideView, StoredSide } from './types.ts';

const DAY_MS = 86_400_000;
/** The UTC day a moment falls on, as days since 1970. */
export const dayNumber = (now: Date) => Math.floor(now.getTime() / DAY_MS);
const dayText = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Who is asking: an account, the name it shows, and the person it stands for in this family (null for nobody). */
export interface Who { account: string; name: string; person: string | null }

/** A province that changed hands, for the push to the house that lost it. */
export interface Fallen { season: number; day: number; province: string; from: string; to: string; by: string | null }

interface CampaignRow { enabled: number; season: number }
interface SeasonRow { season: number; seed: string; started: number; map: string; sides: string; state: string; rev: number; ended: string | null; winner: string | null; result: string | null }
interface MemberRow { season: number; account: string; name: string; side: string | null; pledged: number; orders: number; orders_day: number; bonus_day: string | null; seen: number }
interface Season { row: SeasonRow; map: GameMap; sides: StoredSide[]; state: State }

const campaignRow = (d: Db) => d.get<CampaignRow>('SELECT enabled, season FROM campaign WHERE id = 1');

async function loadSeason(d: Db, season: number): Promise<Season | undefined> {
  const row = await d.get<SeasonRow>('SELECT * FROM campaign_season WHERE season = ?', season);
  if (!row) return undefined;
  const map = JSON.parse(row.map) as GameMap;
  const state = JSON.parse(row.state) as State;
  if (!validState(state, map)) throw new Error('campaign.err.broken');
  return { row, map, sides: JSON.parse(row.sides) as StoredSide[], state };
}

// ---------- reading the family (never writing it) ----------

type Counts = Record<string, number>;
const byHouse = (rows: { house: string; n: number }[]): Counts => Object.fromEntries(rows.map((r) => [r.house, r.n]));

/** A count per house from a table that may not exist in this database yet: then it is null, and nothing fails. */
async function countIfThere(d: Db, sql: string): Promise<Counts | null> {
  try {
    return byHouse(await d.all<{ house: string; n: number }>(sql));
  } catch {
    return null;
  }
}

/** Each renown input is its own small query, so one of them can change or be missing without touching the rest. */
const RENOWN_QUERIES = {
  people: 'SELECT house, count(*) AS n FROM person WHERE house IS NOT NULL GROUP BY house',
  portraits: `SELECT p.house AS house, count(*) AS n FROM person p WHERE p.house IS NOT NULL
    AND (EXISTS (SELECT 1 FROM photo ph WHERE ph.person = p.id) OR EXISTS (SELECT 1 FROM portrait pt WHERE pt.person = p.id AND pt.accepted = 1)) GROUP BY p.house`,
  dated: `SELECT house, count(*) AS n FROM person WHERE house IS NOT NULL AND born IS NOT NULL AND born <> ''
    AND (living = 1 OR (died IS NOT NULL AND died <> '')) GROUP BY house`,
  placed: "SELECT house, count(*) AS n FROM person WHERE house IS NOT NULL AND born_place IS NOT NULL AND born_place <> '' GROUP BY house",
  memories: 'SELECT p.house AS house, count(*) AS n FROM story s JOIN person p ON p.id = s.person WHERE p.house IS NOT NULL GROUP BY p.house',
  // Life events and sources arrive with tree migration 0024. Until a database has those tables, both count as none
  // and are left out of what the page shows and suggests.
  events: 'SELECT p.house AS house, count(*) AS n FROM life_event e JOIN person p ON p.id = e.person WHERE p.house IS NOT NULL GROUP BY p.house',
  // A citation names its person directly (birth, death, name, a parent link) or through the event it is about.
  sources: `SELECT p.house AS house, count(*) AS n FROM citation c LEFT JOIN life_event e ON e.id = c.event
    JOIN person p ON p.id = coalesce(c.person, e.person) WHERE p.house IS NOT NULL GROUP BY p.house`,
} as const;

/** How well each side's people are recorded. */
export async function renownOfSides(tree: string, sides: StoredSide[]): Promise<Map<string, Renown>> {
  const d = db(tree);
  const read = (sql: string) => d.all<{ house: string; n: number }>(sql).then(byHouse);
  const [people, portraits, dated, placed, memories, events, sources] = await Promise.all([
    read(RENOWN_QUERIES.people), read(RENOWN_QUERIES.portraits), read(RENOWN_QUERIES.dated), read(RENOWN_QUERIES.placed), read(RENOWN_QUERIES.memories),
    countIfThere(d, RENOWN_QUERIES.events), countIfThere(d, RENOWN_QUERIES.sources),
  ]);
  const out = new Map<string, Renown>();
  for (const side of sides) {
    if (side.rival) { out.set(side.id, RIVAL_RENOWN); continue; }
    const sum = (c: Counts | null) => side.houses.reduce((n, h) => n + (c?.[h] ?? 0), 0);
    const counts: RenownCounts = { people: sum(people), portraits: sum(portraits), dated: sum(dated), placed: sum(placed), memories: sum(memories), events: sum(events), sources: sum(sources) };
    out.set(side.id, renownOf(counts, [...(events ? [] : ['events' as const]), ...(sources ? [] : ['sources' as const])]));
  }
  return out;
}

/**
 * The season's sides: the six largest houses, each with the smaller houses that are nearest to it by marriage; a small
 * house married into none of them sits out. A family with fewer than three houses gets regent companies to play against.
 */
export async function sidesOf(tree: string): Promise<StoredSide[]> {
  const d = db(tree);
  const [houses, links] = await Promise.all([
    d.all<{ id: string; name: string; arms: string; n: number }>('SELECT h.id, h.name, h.arms, count(p.id) AS n FROM house h JOIN person p ON p.house = h.id GROUP BY h.id ORDER BY n DESC, h.id'),
    d.all<{ a: string; b: string; n: number }>(`SELECT pa.house AS a, pb.house AS b, count(*) AS n FROM partnership u JOIN person pa ON pa.id = u.a JOIN person pb ON pb.id = u.b
      WHERE pa.house IS NOT NULL AND pb.house IS NOT NULL AND pa.house <> pb.house GROUP BY pa.house, pb.house`),
  ]);
  const main = houses.slice(0, RULES.MAX_SIDES);
  const sides: StoredSide[] = main.map((h) => ({ id: h.id, name: h.name, arms: JSON.parse(h.arms) as House['arms'], rival: false, houses: [h.id], allies: [], bonus: 0 }));
  for (const small of houses.slice(RULES.MAX_SIDES)) {
    const ties = new Map<string, number>();
    for (const l of links) {
      const other = l.a === small.id ? l.b : l.b === small.id ? l.a : null;
      if (other && sides.some((s) => s.id === other)) ties.set(other, (ties.get(other) ?? 0) + l.n);
    }
    const nearest = [...ties].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0];
    const side = sides.find((s) => s.id === nearest);
    if (!side) continue;
    side.houses.push(small.id);
    side.allies.push({ id: small.id, name: small.name });
  }
  for (const rival of RIVALS) {
    if (sides.length >= RULES.MIN_SIDES) break;
    sides.push({ id: rival.id, name: rival.name, arms: rival.arms, rival: true, houses: [], allies: [], bonus: RIVAL_RENOWN.bonus });
  }
  return sides;
}

/** The family's places with coordinates, with how many people are linked to each, in all and for each side. */
async function placesOf(tree: string, sides: StoredSide[]): Promise<PlaceIn[]> {
  const d = db(tree);
  const [pins, used] = await Promise.all([
    d.all<{ name: string; lat: number; lng: number }>('SELECT name, lat, lng FROM place'),
    d.all<{ place: string; house: string | null; n: number }>(`SELECT place, house, count(*) AS n FROM (
        SELECT born_place AS place, house FROM person WHERE born_place IS NOT NULL AND born_place <> ''
        UNION ALL SELECT died_place, house FROM person WHERE died_place IS NOT NULL AND died_place <> ''
        UNION ALL SELECT u.place, p.house FROM partnership u JOIN person p ON p.id = u.a WHERE u.place IS NOT NULL AND u.place <> ''
      ) GROUP BY place, house`),
  ]);
  const sideOfHouse = new Map(sides.flatMap((s) => s.houses.map((h) => [h, s.id] as const)));
  const places = new Map<string, PlaceIn>(pins.map((p) => [p.name, { name: p.name, lat: p.lat, lng: p.lng, people: 0, byHouse: {} }]));
  for (const u of used) {
    const place = places.get(u.place);
    if (!place) continue;
    place.people += u.n;
    const side = u.house ? sideOfHouse.get(u.house) : undefined;
    if (side) place.byHouse![side] = (place.byHouse![side] ?? 0) + u.n;
  }
  return [...places.values()];
}

const homesOf = (places: PlaceIn[], map: GameMap, sides: StoredSide[]) => {
  const onMap = new Set(map.provinces.map((p) => p.name));
  const homes: Record<string, Record<string, number>> = Object.fromEntries(sides.map((s) => [s.id, {}]));
  for (const place of places) {
    if (!onMap.has(place.name)) continue;
    for (const [side, n] of Object.entries(place.byHouse ?? {})) if (homes[side]) homes[side][place.name] = n;
  }
  return homes;
};

// ---------- who fights for whom ----------

/** The side a house's people fight for. */
const sideOfHouse = (sides: StoredSide[], house: string | null | undefined) => (house ? sides.find((s) => s.houses.includes(house))?.id ?? null : null);

/** Every member's side: the house of the person they stand for, else the side they chose for the season. */
async function sidesOfMembers(tree: string, season: Season): Promise<Map<string, string>> {
  const d = db(tree);
  const [members, pledges] = await Promise.all([
    accounts().all<{ user: string; person: string | null }>('SELECT user, person FROM membership WHERE tree = ?', tree),
    d.all<{ account: string; side: string }>('SELECT account, side FROM campaign_member WHERE season = ? AND pledged = 1 AND side IS NOT NULL', season.row.season),
  ]);
  const people = [...new Set(members.map((m) => m.person).filter((p): p is string => !!p && p !== '-'))];
  const houses = new Map(
    people.length ? (await d.all<{ id: string; house: string | null }>('SELECT id, house FROM person WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(people))).map((r) => [r.id, r.house]) : [],
  );
  const pledged = new Map(pledges.map((p) => [p.account, p.side]));
  const out = new Map<string, string>();
  for (const m of members) {
    const own = sideOfHouse(season.sides, m.person ? houses.get(m.person) : null);
    const side = own ?? pledged.get(m.user);
    if (side && season.sides.some((s) => s.id === side && !s.rival)) out.set(m.user, side);
  }
  return out;
}

/** The side one member fights for, and whether it is theirs to choose. */
async function sideOf(d: Db, season: Season, who: Who, row: MemberRow | undefined): Promise<{ side: string | null; chooses: boolean }> {
  const person = who.person && who.person !== '-' ? await d.get<{ house: string | null }>('SELECT house FROM person WHERE id = ?', who.person) : undefined;
  const own = sideOfHouse(season.sides, person?.house);
  if (own) return { side: own, chooses: false };
  const chosen = row?.pledged && row.side && season.sides.some((s) => s.id === row.side && !s.rival) ? row.side : null;
  return { side: chosen, chooses: true };
}

const memberRow = (d: Db, season: number, account: string) => d.get<MemberRow>('SELECT * FROM campaign_member WHERE season = ? AND account = ?', season, account);

/** Guards that a member's row is still as it was read (or still absent), so nothing is decided on a stale count. */
const sameMember = (season: number, account: string, row: MemberRow | undefined): Query =>
  row
    ? guard('EXISTS (SELECT 1 FROM campaign_member WHERE season = ? AND account = ? AND orders = ? AND orders_day = ? AND bonus_day IS ? AND side IS ? AND pledged = ?)', season, account, row.orders, row.orders_day, row.bonus_day, row.side, row.pledged)
    : guard('NOT EXISTS (SELECT 1 FROM campaign_member WHERE season = ? AND account = ?)', season, account);

const sameSeason = (s: Season): Query => guard('EXISTS (SELECT 1 FROM campaign_season WHERE season = ? AND rev = ? AND ended IS NULL)', s.row.season, s.row.rev);
const sameCampaign = (c: CampaignRow | undefined): Query =>
  c ? guard('EXISTS (SELECT 1 FROM campaign WHERE id = 1 AND enabled = ? AND season = ?)', c.enabled, c.season) : guard('NOT EXISTS (SELECT 1 FROM campaign WHERE id = 1)');

// ---------- seasons ----------

const logRow = (season: number, day: number, at: string, kind: LogKind, fields: { side?: string | null; account?: string | null; name?: string | null; province?: number | null; took?: boolean; data?: unknown; cry?: string | null } = {}): Query =>
  q(
    'INSERT INTO campaign_log (season, day, at, kind, side, account, name, province, took, data, cry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    season, day, at, kind, fields.side ?? null, fields.account ?? null, fields.name ?? null, fields.province ?? null, fields.took ? 1 : 0,
    fields.data === undefined ? null : JSON.stringify(fields.data), fields.cry ?? null,
  );

/** What a new season is made of, read from the family as it is today. */
async function draftSeason(tree: string, number: number, started: number): Promise<{ seed: string; map: GameMap; sides: StoredSide[]; state: State }> {
  const sides = await sidesOf(tree);
  const [places, renown] = await Promise.all([placesOf(tree, sides), renownOfSides(tree, sides)]);
  for (const s of sides) s.bonus = renown.get(s.id)?.bonus ?? 0;
  // The seed names the family, the season and its first day: nobody chooses it, and a replay draws the same map.
  const seed = `${tree}:${number}:${started}`;
  const map = buildMap(places, provinceCount(sides.length), seed);
  const opening = startState(map, sides.map((s) => s.id), seed, homesOf(places, map, sides));
  return { seed, map, sides, state: addLevy(opening, rulesOf(sides, new Set())) };
}

/** Each side's rules for a night: its renown, and a bold regent for a house nobody plays, a cautious one otherwise. */
const rulesOf = (sides: StoredSide[], played: ReadonlySet<string>): SideRules[] => sides.map((s) => ({ id: s.id, bonus: s.bonus, temper: played.has(s.id) ? 'cautious' : 'bold' }));

function startWrites(number: number, started: number, draft: Awaited<ReturnType<typeof draftSeason>>, at: string): Query[] {
  return [
    q('INSERT INTO campaign_season (season, seed, started, map, sides, state, rev) VALUES (?, ?, ?, ?, ?, ?, 0)', number, draft.seed, started, JSON.stringify(draft.map), JSON.stringify(draft.sides), JSON.stringify(draft.state)),
    q('UPDATE campaign SET season = ?, updated_at = ? WHERE id = 1', number, at),
    logRow(number, 0, at, 'season_start'),
    // The hall of fame keeps every season; the chronicle, the members' rows and the push claims of older ones go.
    q('DELETE FROM campaign_log WHERE season < ?', number - 1),
    q('DELETE FROM campaign_member WHERE season < ?', number - 1),
    q('DELETE FROM campaign_push WHERE day < ?', dayText(started - 7)),
  ];
}

function finishWrites(s: Season, state: State, at: string): Query[] {
  const table = standings(state, s.sides.map((x) => x.id));
  const named = table.map((row) => ({ id: row.side, name: s.sides.find((x) => x.id === row.side)?.name ?? row.side, provinces: row.provinces, troops: row.troops }));
  const top = s.sides.find((x) => x.id === table[0]?.side);
  const result = { winner: top ? { id: top.id, name: top.name, arms: top.arms } : null, standings: named };
  return [
    q('UPDATE campaign_season SET state = ?, rev = rev + 1, ended = ?, winner = ?, result = ? WHERE season = ?', JSON.stringify(state), at, top?.id ?? null, JSON.stringify(result), s.row.season),
    logRow(s.row.season, Math.min(state.day, RULES.SEASON_DAYS), at, 'season_end', { side: top?.id ?? null, data: { winner: top?.id ?? null } }),
  ];
}

interface Step { done: boolean; fallen: Fallen[] }

/**
 * One step of catching up, as a plan: start the first season, play the nights that have passed, or close a season that
 * has run its days and open the next. The caller repeats it until nothing is left.
 */
async function planStep(tree: string, d: Db, now: Date) {
  const c = await campaignRow(d);
  if (!c?.enabled) return { history: NOT_A_RECORD, writes: [] as Query[], result: { done: true, fallen: [] } as Step };
  const today = dayNumber(now);
  const at = now.toISOString();
  const s = c.season > 0 ? await loadSeason(d, c.season) : undefined;
  if (!s) {
    const number = c.season + 1;
    return { history: NOT_A_RECORD, writes: [sameCampaign(c), ...startWrites(number, today, await draftSeason(tree, number, today), at)], result: { done: false, fallen: [] } as Step };
  }
  const next = async (state: State): Promise<Query[]> => {
    const number = s.row.season + 1;
    // Seasons follow each other without a gap, unless the game stood still for longer than a season: then the next starts today.
    const after = s.row.started + RULES.SEASON_DAYS;
    const started = s.row.ended || today - after >= RULES.SEASON_DAYS || state.day < RULES.SEASON_DAYS ? today : after;
    return startWrites(number, started, await draftSeason(tree, number, started), at);
  };
  if (s.row.ended) return { history: NOT_A_RECORD, writes: [sameCampaign(c), ...(await next(s.state))], result: { done: false, fallen: [] } as Step };

  const target = Math.max(0, Math.min(today - s.row.started, RULES.SEASON_DAYS));
  if (s.state.day >= target && s.state.day < RULES.SEASON_DAYS) return { history: NOT_A_RECORD, writes: [] as Query[], result: { done: true, fallen: [] } as Step };

  // The nights between the day the position is on and today, in order, with the family's renown as it is now.
  const [renown, members] = await Promise.all([renownOfSides(tree, s.sides), sidesOfMembers(tree, s)]);
  const sides = s.sides.map((side) => ({ ...side, bonus: renown.get(side.id)?.bonus ?? side.bonus }));
  const rules = rulesOf(sides, new Set(members.values()));
  let state = s.state;
  const logs: Query[] = [];
  const fallen: Fallen[] = [];
  while (state.day < target) {
    const day = state.day;
    const night = endDay(state, s.map, rules, s.row.seed);
    state = night.state;
    for (const e of night.events) {
      if (e.t !== 'attack') continue;
      logs.push(logRow(s.row.season, day, at, 'attack', { side: e.side, province: e.to, took: e.took, data: e }));
      if (e.took && e.defender) fallen.push({ season: s.row.season, day, province: s.map.provinces[e.to].name, from: e.defender, to: e.side, by: null });
    }
  }
  const writes: Query[] = [sameCampaign(c), sameSeason(s), ...logs];
  if (state.day >= RULES.SEASON_DAYS) writes.push(...finishWrites({ ...s, sides }, state, at), ...(await next(state)));
  else writes.push(q('UPDATE campaign_season SET state = ?, sides = ?, rev = rev + 1 WHERE season = ?', JSON.stringify(state), JSON.stringify(sides), s.row.season));
  return { history: NOT_A_RECORD, writes, result: { done: false, fallen } as Step };
}

/**
 * Brings the campaign up to `now`: every night that has passed is played, in order, and a finished season is closed
 * and followed by the next. Safe to call from any request and from the daily job at once: each step guards on what it
 * read, and the nights come out the same whoever plays them. Returns the provinces that fell to a regent.
 */
export async function advance(tree: string, now: Date = new Date()): Promise<Fallen[]> {
  const fallen: Fallen[] = [];
  for (let i = 0; i < 12; i++) {
    const step = await once<Step>(tree, undefined, 'campaignAdvance', (d) => planStep(tree, d, now));
    fallen.push(...step.fallen);
    if (step.done) break;
  }
  return fallen;
}

// ---------- the steward's switch ----------

export async function campaignSettings(tree: string): Promise<{ enabled: boolean; season: number }> {
  const c = await campaignRow(db(tree));
  return { enabled: !!c?.enabled, season: c?.season ?? 0 };
}

/** Turns the game on or off. Turning it on starts a season if none is running; turning it off keeps everything as it is. */
export async function setCampaignEnabled(tree: string, on: boolean, by: string, now: Date = new Date()): Promise<void> {
  await once(tree, undefined, 'campaignSwitch', async (d) => {
    const c = await campaignRow(d);
    return {
      // The game is not the family's records.
      history: NOT_A_RECORD,
      writes: [
        sameCampaign(c),
        q('INSERT INTO campaign (id, enabled, season, updated_at, updated_by) VALUES (1, ?, 0, ?, ?) ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by', on ? 1 : 0, now.toISOString(), by),
      ],
      result: undefined,
    };
  });
  if (on) await advance(tree, now);
}

/** A steward ends the season today: its standings go to the hall of fame, and a new season starts on a fresh map. */
export async function endSeasonNow(tree: string, now: Date = new Date()): Promise<void> {
  await advance(tree, now);
  await once(tree, undefined, 'campaignEndSeason', async (d) => {
    const c = await campaignRow(d);
    if (!c?.enabled) throw new Error('campaign.err.off');
    const s = await loadSeason(d, c.season);
    if (!s || s.row.ended) throw new Error('campaign.err.try_again');
    const number = s.row.season + 1;
    const today = dayNumber(now);
    const at = now.toISOString();
    return { history: NOT_A_RECORD, writes: [sameCampaign(c), sameSeason(s), ...finishWrites(s, s.state, at), ...startWrites(number, today, await draftSeason(tree, number, today), at)], result: undefined };
  });
}

// ---------- orders ----------

/** A battle cry as it is kept: one line, trimmed, at most 80 characters; nothing when empty. */
export const cleanCry = (cry: string | null | undefined): string | null => {
  const text = (cry ?? '').replace(/\s+/g, ' ').trim().slice(0, RULES.CRY_MAX);
  return text || null;
};

/** The season being played, brought up to today. Refuses when the game is off. */
async function current(d: Db, now: Date): Promise<{ c: CampaignRow; s: Season }> {
  const c = await campaignRow(d);
  if (!c?.enabled) throw new Error('campaign.err.off');
  const s = await loadSeason(d, c.season);
  // A night that has not been played yet (midnight passed between the catch-up and this read): the caller tries again.
  if (!s || s.row.ended || s.state.day < Math.min(dayNumber(now) - s.row.started, RULES.SEASON_DAYS)) throw new Error('campaign.err.try_again');
  return { c, s };
}

const upsertMember = (season: number, who: Who, set: { side: string | null; pledged: boolean; orders: number; ordersDay: number; bonusDay: string | null }): Query =>
  q(
    `INSERT INTO campaign_member (season, account, name, side, pledged, orders, orders_day, bonus_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (season, account) DO UPDATE SET name = excluded.name, side = excluded.side, pledged = excluded.pledged, orders = excluded.orders, orders_day = excluded.orders_day, bonus_day = excluded.bonus_day`,
    season, who.account, who.name, set.side, set.pledged ? 1 : 0, set.orders, set.ordersDay, set.bonusDay,
  );

const ordersLeft = (row: MemberRow | undefined, day: number) => (row ? ordersOn(day, row.orders, row.orders_day) : RULES.ORDERS_PER_DAY);

/**
 * A member's order: muster, march or attack, for the side they fight for, paid with one of their orders. The dice of an
 * attack are rolled here. With the same retry key the same result comes back, so an order sent twice is played once.
 */
export async function giveOrder(tree: string, who: Who, order: Order, cry: string | null, op: { key: string } | undefined, now: Date = new Date()): Promise<{ result: OrderResult; fallen: Fallen[] }> {
  await advance(tree, now);
  const words = cleanCry(cry);
  let fallen: Fallen[] = [];
  const result = await once<OrderResult>(tree, op && { key: op.key, user: who.account, payload: { order, cry: words } }, 'campaignOrder', async (d) => {
    const { c, s } = await current(d, now);
    const row = await memberRow(d, s.row.season, who.account);
    const { side } = await sideOf(d, s, who, row);
    if (!side) throw new Error('campaign.err.no_side');
    const orders = ordersLeft(row, s.state.day);
    if (orders < 1) throw new Error('campaign.err.no_orders');
    // The seed is made here and kept with the battle: the browser has no say in the dice.
    const seed = crypto.randomUUID();
    const played = applyOrder(s.state, s.map, side, order, seed);
    const e = played.event;
    fallen = e.t === 'attack' && e.took && e.defender ? [{ season: s.row.season, day: s.state.day, province: s.map.provinces[e.to].name, from: e.defender, to: side, by: who.account }] : [];
    return {
      // The game is not the family's records.
      history: NOT_A_RECORD,
      writes: [
        sameCampaign(c),
        sameSeason(s),
        sameMember(s.row.season, who.account, row),
        q('UPDATE campaign_season SET state = ?, rev = rev + 1 WHERE season = ?', JSON.stringify(played.state), s.row.season),
        upsertMember(s.row.season, who, { side: row?.pledged ? row.side : null, pledged: !!row?.pledged, orders: orders - 1, ordersDay: s.state.day, bonusDay: row?.bonus_day ?? null }),
        logRow(s.row.season, s.state.day, now.toISOString(), e.t, { side, account: who.account, name: who.name, province: e.to, took: e.t === 'attack' && e.took, data: e, cry: words }),
      ],
      result: { event: e, orders: orders - 1 },
    };
  });
  return { result, fallen };
}

/** A member who stands for nobody in a house chooses the house they serve this season. It can be chosen once a season. */
export async function pledge(tree: string, who: Who, side: string, now: Date = new Date()): Promise<void> {
  await advance(tree, now);
  await once(tree, undefined, 'campaignPledge', async (d) => {
    const { c, s } = await current(d, now);
    const row = await memberRow(d, s.row.season, who.account);
    const mine = await sideOf(d, s, who, row);
    if (!mine.chooses) throw new Error('campaign.err.has_house');
    if (mine.side) throw new Error('campaign.err.pledged');
    if (!s.sides.some((x) => x.id === side && !x.rival)) throw new Error('campaign.err.no_such_side');
    return {
      // The game is not the family's records.
      history: NOT_A_RECORD,
      writes: [
        sameCampaign(c),
        sameMember(s.row.season, who.account, row),
        upsertMember(s.row.season, who, { side, pledged: true, orders: ordersLeft(row, s.state.day), ordersDay: s.state.day, bonusDay: row?.bonus_day ?? null }),
        logRow(s.row.season, s.state.day, now.toISOString(), 'pledge', { side, account: who.account, name: who.name }),
      ],
      result: undefined,
    };
  });
}

/** Remembers the newest chronicle entry a member has seen, so the map can show what changed since. */
export async function markSeen(tree: string, who: Who, upTo: number): Promise<void> {
  const d = db(tree);
  const c = await campaignRow(d);
  if (!c?.enabled || c.season < 1) return;
  const newest = (await d.get<{ id: number | null }>('SELECT max(id) AS id FROM campaign_log WHERE season = ?', c.season))?.id ?? 0;
  const seen = Math.max(0, Math.min(Math.floor(upTo), newest));
  const s = await loadSeason(d, c.season);
  if (!s) return;
  // One statement: a row for a member who has only looked so far, or the mark moved forward, never back.
  await d.run(
    `INSERT INTO campaign_member (season, account, name, orders, orders_day, seen) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (season, account) DO UPDATE SET seen = max(seen, excluded.seen)`,
    c.season, who.account, who.name, RULES.ORDERS_PER_DAY, s.state.day, seen,
  );
}

/**
 * One more order for a member today, for something they did elsewhere in the family's pages (the daily quiz calls
 * this). At most one a day for each member, whatever the reason; nothing happens while the game is off. `reason` is a
 * short code such as `quiz`, kept with the chronicle entry. Returns whether the order was given.
 */
export async function grantOrder(tree: string, accountId: string, reason: string, now: Date = new Date()): Promise<{ granted: boolean; orders?: number }> {
  if (!/^[a-z0-9-]{1,32}$/.test(reason)) throw new Error('campaign.err.reason');
  const before = await campaignRow(db(tree));
  if (!before?.enabled) return { granted: false };
  const user = await accounts().get<{ name: string }>('SELECT u.name FROM user u JOIN membership m ON m.user = u.id WHERE u.id = ? AND m.tree = ?', accountId, tree);
  if (!user) return { granted: false };
  await advance(tree, now);
  const today = dayText(dayNumber(now));
  return once<{ granted: boolean; orders?: number }>(tree, undefined, 'campaignBonus', async (d) => {
    const { c, s } = await current(d, now);
    const row = await memberRow(d, s.row.season, accountId);
    if (row?.bonus_day === today) return { history: NOT_A_RECORD, writes: [], result: { granted: false, orders: ordersLeft(row, s.state.day) } };
    const orders = Math.min(RULES.ORDERS_MAX, ordersLeft(row, s.state.day) + 1);
    const who: Who = { account: accountId, name: user.name, person: null };
    return {
      // The game is not the family's records.
      history: NOT_A_RECORD,
      writes: [
        sameCampaign(c),
        sameMember(s.row.season, accountId, row),
        upsertMember(s.row.season, who, { side: row?.pledged ? row.side : null, pledged: !!row?.pledged, orders, ordersDay: s.state.day, bonusDay: today }),
        logRow(s.row.season, s.state.day, now.toISOString(), 'bonus', { account: accountId, name: user.name, data: { reason } }),
      ],
      result: { granted: true, orders },
    };
  });
}

// ---------- what the pages read ----------

/** The sides with their houses' names and arms as they are today, and their standing in a position. */
async function sideViews(tree: string, sides: StoredSide[], state: State | undefined, members: Map<string, string>, laurels: Map<string, number>): Promise<SideView[]> {
  const d = db(tree);
  const [houses, renown] = await Promise.all([d.all<{ id: string; name: string; arms: string }>('SELECT id, name, arms FROM house'), renownOfSides(tree, sides)]);
  const now = new Map(houses.map((h) => [h.id, h]));
  const ids = sides.map((s) => s.id);
  const count = new Map<string, number>();
  for (const side of members.values()) count.set(side, (count.get(side) ?? 0) + 1);
  return sides.map((s) => {
    const house = now.get(s.id);
    const r = renown.get(s.id) ?? RIVAL_RENOWN;
    return {
      ...s,
      name: house?.name ?? s.name,
      arms: house ? (JSON.parse(house.arms) as House['arms']) : s.arms,
      allies: s.allies.map((a) => ({ id: a.id, name: now.get(a.id)?.name ?? a.name })),
      provinces: state ? provincesOf(state, s.id) : 0,
      troops: state ? troopsOf(state, s.id) : 0,
      pool: state?.pool[s.id] ?? 0,
      levy: state ? levyOf(state, s.id, r.bonus, ids) : { base: RULES.BASE_LEVY, renown: r.bonus, rally: 0, total: RULES.BASE_LEVY + r.bonus },
      renown: r,
      members: count.get(s.id) ?? 0,
      laurels: laurels.get(s.id) ?? 0,
    };
  });
}

async function hallOfFame(d: Db): Promise<{ fame: FameEntry[]; laurels: Map<string, number> }> {
  const rows = await d.all<{ season: number; ended: string; result: string | null; winner: string | null }>('SELECT season, ended, result, winner FROM campaign_season WHERE ended IS NOT NULL ORDER BY season DESC LIMIT 24');
  const laurels = new Map<string, number>();
  const fame = rows.map((r): FameEntry => {
    const result = r.result ? (JSON.parse(r.result) as Pick<FameEntry, 'winner' | 'standings'>) : { winner: null, standings: [] };
    if (r.winner && !isRival(r.winner)) laurels.set(r.winner, (laurels.get(r.winner) ?? 0) + 1);
    return { season: r.season, ended: r.ended, winner: result.winner, standings: result.standings };
  });
  return { fame, laurels };
}

/** The map and sides as a season starting today would have them: what the practice skirmish plays on while the game is off. */
async function draftBoard(tree: string, laurels: Map<string, number>): Promise<CampaignBoard> {
  const sides = await sidesOf(tree);
  const places = await placesOf(tree, sides);
  const map = buildMap(places, provinceCount(sides.length), `${tree}:practice`);
  return { map, sides: await sideViews(tree, sides, undefined, new Map(), laurels), homes: homesOf(places, map, sides) };
}

/** Everything the campaign page shows a member. Plays the missed nights first. */
export async function campaignView(tree: string, who: Who, now: Date = new Date()): Promise<{ view: CampaignView; fallen: Fallen[] }> {
  const d = db(tree);
  const before = await campaignRow(d);
  if (!before?.enabled) {
    const { fame, laurels } = await hallOfFame(d);
    return { view: { enabled: false, board: await draftBoard(tree, laurels), fame }, fallen: [] };
  }
  // A demo and a steward's preview store nothing: the season is shown as it was last played (src/lib/read-only.ts).
  const fallen = readOnly() ? [] : await advance(tree, now);
  const c = (await campaignRow(d))!;
  const s = await loadSeason(d, c.season);
  if (!s) throw new Error('campaign.err.try_again');
  const [members, row, logs, { fame, laurels }, places] = await Promise.all([
    sidesOfMembers(tree, s),
    memberRow(d, s.row.season, who.account),
    d.all<{ id: number; day: number; at: string; kind: LogKind; side: string | null; account: string | null; name: string | null; data: string | null; cry: string | null }>(
      'SELECT id, day, at, kind, side, account, name, data, cry FROM campaign_log WHERE season = ? ORDER BY id DESC LIMIT 80', s.row.season,
    ),
    hallOfFame(d),
    placesOf(tree, s.sides),
  ]);
  const mine = await sideOf(d, s, who, row);
  const seen = row?.seen ?? 0;
  const log = logs.map((l): LogEntry => {
    const data = l.data ? (JSON.parse(l.data) as GameEvent & { winner?: string | null }) : undefined;
    const event = data && 't' in data ? (data as GameEvent) : undefined;
    return { id: l.id, day: l.day, at: l.at, kind: l.kind, side: l.side, name: l.name, mine: l.account === who.account, event, winner: l.kind === 'season_end' ? l.side : undefined, cry: l.cry };
  });
  const changed = [...new Set(logs.filter((l) => l.id > seen && l.kind === 'attack' && l.account !== who.account).map((l) => (l.data ? (JSON.parse(l.data) as GameEvent) : null)).filter((e): e is Extract<GameEvent, { t: 'attack' }> => !!e && e.t === 'attack' && e.took).map((e) => e.to))];
  const me: CampaignMe = { side: mine.side, chooses: mine.chooses, orders: ordersLeft(row, s.state.day), bonusToday: row?.bonus_day === dayText(dayNumber(now)) };
  return {
    view: {
      enabled: true,
      board: { map: s.map, sides: await sideViews(tree, s.sides, s.state, members, laurels), homes: homesOf(places, s.map, s.sides) },
      season: { number: s.row.season, day: s.state.day, days: RULES.SEASON_DAYS, started: dayText(s.row.started), ends: dayText(s.row.started + RULES.SEASON_DAYS) },
      state: s.state,
      me,
      log,
      changed,
      fame,
    },
    fallen,
  };
}

/** The few facts the Today page's card and the navigation need. Reads only: the nights are played when the page opens. */
export async function campaignStatus(tree: string, who: Who, now: Date = new Date()): Promise<CampaignStatus> {
  const d = db(tree);
  const c = await campaignRow(d);
  if (!c?.enabled) return { enabled: false };
  const s = c.season > 0 ? await loadSeason(d, c.season) : undefined;
  if (!s) return { enabled: true };
  const row = await memberRow(d, s.row.season, who.account);
  const mine = await sideOf(d, s, who, row);
  // The day by the calendar, even when its nights are still to be played: the count of orders follows it.
  const day = Math.max(0, Math.min(dayNumber(now) - s.row.started, RULES.SEASON_DAYS - 1));
  const table = standings(s.state, s.sides.map((x) => x.id));
  const stored = s.sides.find((x) => x.id === mine.side);
  const house = stored && !stored.rival ? await d.get<{ name: string; arms: string }>('SELECT name, arms FROM house WHERE id = ?', stored.id) : undefined;
  const at = table.findIndex((r) => r.side === mine.side);
  return {
    enabled: true,
    season: s.row.season,
    day,
    days: RULES.SEASON_DAYS,
    side: stored && at >= 0 ? { id: stored.id, name: house?.name ?? stored.name, arms: house ? (JSON.parse(house.arms) as House['arms']) : stored.arms, provinces: table[at].provinces, rank: at + 1, of: table.length } : null,
    orders: ordersLeft(row, day),
  };
}

/** The accounts that fight for a side this season: for the push when one of its provinces falls. */
export async function accountsOfSide(tree: string, season: number, side: string): Promise<string[]> {
  const s = await loadSeason(db(tree), season);
  if (!s) return [];
  return [...(await sidesOfMembers(tree, s))].filter(([, mine]) => mine === side).map(([account]) => account);
}

/** A side's name as its house is called today (a season keeps the name it started with). */
export async function sideName(tree: string, season: number, side: string): Promise<string> {
  const d = db(tree);
  const house = await d.get<{ name: string }>('SELECT name FROM house WHERE id = ?', side);
  if (house) return house.name;
  const s = await loadSeason(d, season);
  return s?.sides.find((x) => x.id === side)?.name ?? side;
}
