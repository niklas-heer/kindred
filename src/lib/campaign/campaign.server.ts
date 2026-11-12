// The Campaign on the server: the week's challenge (its field and seed), a member's reigns (migrations/tree/0032), the
// family's tables, and the seasons of the old shared game (migrations/tree/0025), closed once and kept as the hall of fame.
// The rules are in ./engine.ts, which the browser plays with; this module decides who may do what, and writes.
//
// What it promises:
// - It reads the family's records (houses, places, how well people are recorded) and never writes to them. Every write
//   goes to a `campaign*` table, as NOT_A_RECORD.
// - It never accepts a score. A reign is begun here (its field, renown and reward are fixed then), the browser sends the
//   moves it played, and the score is what this module gets by playing them again. A reign is finished once.
// - The week's seed (which lays out the field) mixes the server's secret into the family's id and the week, so a browser
//   cannot work out next week's field. A reign's dice come from a seed of its own (the secret and the reign's id), so
//   playing the week again never meets the same dice. Without a secret there is no ranked play (`campaign.err.no_secret`).
// - Every member plays the same field all week: the first reign of a week stores it in `campaign_week` (migration 0034), and
//   every later reign that week reads it back, whoever leaves and however many begin at once.
// - The field is an invented continent (./geography.ts) laid out from the week's seed alone. Nothing of the family's is
//   on the board but its houses: no place, no person.
// - A reign and a week's field carry the rules' version (RULESET, migration 0035). The tables rank a reign only among
//   reigns of the same rules; reigns of earlier rules are listed apart, and one begun under them can no longer be sent.
import { db, guard, NOT_A_RECORD, once, q, store, type Db, type Query } from '../db.server.ts';
import { readOnly } from '../read-only.ts';
import { dayOf, weekOf, weekStart } from '../today/week.ts';
import type { House } from '../types.ts';
import { chronicleOf, isTitle, type Title } from './chronicle.ts';
import { CampaignError, RULES, RULESET, rulesetOf, setupField, standings, type Move, type State } from './engine.ts';
import { RIVALS, isRival } from './names.ts';
import { RIVAL_RENOWN, renownOf, type Renown, type RenownCounts } from './renown.ts';
import type { BoardRow, CampaignStatus, CampaignView, Challenge, FameEntry, FieldView, FinishResult, HouseTotal, Leaderboard, RunStart, SideView, StoredSide } from './types.ts';

const DAY_MS = 86_400_000;

/** Who is asking: an account, the name it shows, and the person it stands for in this family (null for nobody). */
export interface Who { account: string; name: string; person: string | null }

interface CampaignRow { enabled: number; season: number }
interface RunRow { id: string; account: string; name_then: string; side: string; week: string; seed: string; field: string; orders: string | null; score: number | null; result: string | null; finished_at: string | null; created_at: string; ruleset: number }
/** A reign's field as it is kept: the week's field, and what the player's levy had when it began. */
interface StoredField extends FieldView { renown: number; grant: number }

const campaignRow = (d: Db) => d.get<CampaignRow>('SELECT enabled, season FROM campaign WHERE id = 1');
const sameCampaign = (c: CampaignRow | undefined): Query =>
  c ? guard('EXISTS (SELECT 1 FROM campaign WHERE id = 1 AND enabled = ? AND season = ?)', c.enabled, c.season) : guard('NOT EXISTS (SELECT 1 FROM campaign WHERE id = 1)');

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
 * A reign's four sides: the family's largest houses, each with the smaller houses that are nearest to it by marriage (a
 * small house married into none of them sits out), and invented regent companies when the family has fewer than four.
 */
export async function sidesOf(tree: string): Promise<StoredSide[]> {
  const d = db(tree);
  const [houses, links] = await Promise.all([
    d.all<{ id: string; name: string; arms: string; n: number }>('SELECT h.id, h.name, h.arms, count(p.id) AS n FROM house h JOIN person p ON p.house = h.id GROUP BY h.id ORDER BY n DESC, h.id'),
    d.all<{ a: string; b: string; n: number }>(`SELECT pa.house AS a, pb.house AS b, count(*) AS n FROM partnership u JOIN person pa ON pa.id = u.a JOIN person pb ON pb.id = u.b
      WHERE pa.house IS NOT NULL AND pb.house IS NOT NULL AND pa.house <> pb.house GROUP BY pa.house, pb.house`),
  ]);
  const sides: StoredSide[] = houses.slice(0, RULES.SIDES).map((h) => ({ id: h.id, name: h.name, arms: JSON.parse(h.arms) as House['arms'], rival: false, houses: [h.id], allies: [] }));
  for (const small of houses.slice(RULES.SIDES)) {
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
    if (sides.length >= RULES.SIDES) break;
    sides.push({ id: rival.id, name: rival.name, arms: rival.arms, rival: true, houses: [], allies: [] });
  }
  return sides;
}

/** The sides with their houses' names and arms as they are today, and their renown. */
async function sideViews(d: Db, sides: StoredSide[], renown: Map<string, Renown>): Promise<SideView[]> {
  const houses = new Map((await d.all<{ id: string; name: string; arms: string }>('SELECT id, name, arms FROM house')).map((h) => [h.id, h]));
  return sides.map((s) => {
    const house = houses.get(s.id);
    return {
      ...s,
      name: house?.name ?? s.name,
      arms: house ? (JSON.parse(house.arms) as House['arms']) : s.arms,
      allies: s.allies.map((a) => ({ id: a.id, name: houses.get(a.id)?.name ?? a.name })),
      renown: renown.get(s.id) ?? RIVAL_RENOWN,
    };
  });
}

// ---------- who plays which side ----------

/**
 * The side a member plays: the side of their own person's house, else (when they stand for nobody in a house) the side
 * they ask for, which must be a house's, or any side when the family has no house.
 */
async function sideFor(d: Db, who: Who, sides: StoredSide[], asked?: string | null): Promise<{ side: string | null; chooses: boolean }> {
  const person = who.person && who.person !== '-' ? await d.get<{ house: string | null }>('SELECT house FROM person WHERE id = ?', who.person) : undefined;
  const own = person?.house ? sides.find((s) => !s.rival && s.houses.includes(person.house!))?.id : undefined;
  if (own) return { side: own, chooses: false };
  const open = sides.some((s) => !s.rival) ? sides.filter((s) => !s.rival) : sides;
  return { side: asked && open.some((s) => s.id === asked) ? asked : null, chooses: true };
}

// ---------- the week ----------

/** The server's secret, or null on a Worker without KINDRED_SECRET (Node makes one in the data folder on first use). */
function secretOrNull(): string | null {
  try {
    return store.secret();
  } catch {
    return null;
  }
}

async function hmacSeed(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(`campaign:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return [...mac.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The week's seed, which lays out the week's field: the server's secret mixed with the family and the week (HMAC-SHA-256),
 * so no browser can derive another week's field. Without a secret the field is still laid out (everyone sees it anyway, and
 * a practice or a demo plays it), but no reign is ranked: see `reignSeed`.
 */
export async function weekSeed(tree: string, week: string): Promise<string> {
  return hmacSeed(secretOrNull() ?? 'kindred-campaign-unranked', `${tree}|${week}`);
}

/**
 * A reign's dice: the server's secret mixed with the reign's own id, so replaying the week meets new dice, and nobody can
 * work them out before the reign begins. Never from a public constant: without a secret, ranked play is refused.
 */
export async function reignSeed(id: string): Promise<string> {
  const secret = secretOrNull();
  if (!secret) throw new Error('campaign.err.no_secret');
  return hmacSeed(secret, `reign|${id}`);
}

/** The last day of an ISO week (its Sunday), as "2026-11-15". */
const weekEnds = (week: string) => dayOf(new Date(weekStart(week).getTime() + 6 * DAY_MS));

/** The week's field as `campaign_week` keeps it, if a reign of that week has begun under today's rules. */
async function keptField(d: Db, week: string): Promise<FieldView | null> {
  const row = await d.get<{ field: string }>('SELECT field FROM campaign_week WHERE week = ? AND ruleset = ?', week, RULESET);
  if (!row) return null;
  const kept = JSON.parse(row.field) as FieldView;
  return { map: kept.map, sides: kept.sides, start: kept.start };
}

/** The week's field for a week no reign has begun yet: the continent the seed lays out, and the family's houses as they are today. */
async function freshField(tree: string, seed: string): Promise<FieldView> {
  const sides = await sidesOf(tree);
  const field = setupField(sides.map((s) => s.id), seed);
  return { map: field.map, sides, start: field.start };
}

/** The week's field: the one its first reign stored, or the one the seed and the family's houses give today. */
async function weekField(tree: string, d: Db, week: string, seed: string): Promise<FieldView> {
  return (await keptField(d, week)) ?? freshField(tree, seed);
}

/** A reign of this member's begun today that took the daily quiz's reward. */
const spentSql = "EXISTS (SELECT 1 FROM campaign_run WHERE account = ? AND created_at >= ? AND json_extract(field, '$.grant') > 0)";

/** The daily quiz's reward: a right answer today, not yet spent on a reign begun today. Never fails the reign. */
async function quizGrant(d: Db, account: string, now: Date): Promise<number> {
  try {
    const today = dayOf(now);
    const right = await d.get('SELECT 1 FROM quiz_answer WHERE day = ? AND account = ? AND correct = 1', today, account);
    if (!right) return 0;
    const spent = await d.get<{ ok: number }>(`SELECT ${spentSql} AS ok`, account, today);
    return spent?.ok ? 0 : RULES.QUIZ_LEVY;
  } catch {
    return 0;
  }
}

// ---------- the tables ----------

interface ScoreRow { account: string; name_then: string; side: string; score: number; week: string; result: string | null }

/** A reign's title as its result keeps it, if it has one the page knows. */
function titleIn(result: string | null): Title | undefined {
  try {
    const title = (JSON.parse(result ?? 'null') as { title?: unknown } | null)?.title;
    return isTitle(title) ? title : undefined;
  } catch {
    return undefined;
  }
}

const SCORE_COLUMNS = 'account, name_then, side, score, week, result';

/** Each member's best of a week under one ruleset, best first, with how many reigns they finished; `without` leaves one reign out. */
async function weekBests(d: Db, week: string, account: string, ruleset: number, without = ''): Promise<BoardRow[]> {
  const rows = await d.all<ScoreRow>(
    `SELECT ${SCORE_COLUMNS} FROM campaign_run WHERE week = ? AND ruleset = ? AND finished_at IS NOT NULL AND id <> ? ORDER BY score DESC, finished_at, id`, week, ruleset, without,
  );
  const best = new Map<string, BoardRow>();
  const runs = new Map<string, number>();
  for (const r of rows) {
    runs.set(r.account, (runs.get(r.account) ?? 0) + 1);
    if (!best.has(r.account)) best.set(r.account, { name: r.name_then, side: r.side, score: r.score, title: titleIn(r.result), mine: r.account === account });
  }
  return [...best].map(([acc, row]) => ({ ...row, runs: runs.get(acc) ?? 0 }));
}

/** Each house's total: the sum of its members' bests, by the side each one ruled. */
function houseTotals(rows: BoardRow[], sides: Pick<StoredSide, 'id' | 'name' | 'arms'>[]): HouseTotal[] {
  const houses = new Map<string, HouseTotal>();
  for (const row of rows) {
    const side = sides.find((s) => s.id === row.side);
    if (!side) continue;
    const total = houses.get(side.id) ?? { side: side.id, name: side.name, arms: side.arms, total: 0, members: 0 };
    total.total += row.score;
    total.members += 1;
    houses.set(side.id, total);
  }
  return [...houses.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * The family's tables. Only reigns under today's rules are ranked; reigns of earlier rules (this week's, and the best
 * ever) are listed apart in `earlier`, so an old score is still there and is never set against a new one.
 */
async function leaderboard(d: Db, week: string, account: string, sides: SideView[] | StoredSide[]): Promise<Leaderboard> {
  const top = (where: string, ...args: (string | number)[]) => d.all<ScoreRow>(`SELECT ${SCORE_COLUMNS} FROM campaign_run WHERE finished_at IS NOT NULL AND ${where} ORDER BY score DESC, finished_at, id LIMIT 10`, ...args);
  const listed = (rows: ScoreRow[]): BoardRow[] => rows.map((r) => ({ name: r.name_then, side: r.side, score: r.score, week: r.week, title: titleIn(r.result), mine: r.account === account }));
  const [weekRows, allTime, record, oldWeek, oldAll] = await Promise.all([
    weekBests(d, week, account, RULESET),
    top('ruleset = ?', RULESET),
    d.get<{ best: number | null }>('SELECT max(score) AS best FROM campaign_run WHERE account = ? AND ruleset = ? AND finished_at IS NOT NULL', account, RULESET),
    d.all<ScoreRow>(`SELECT ${SCORE_COLUMNS} FROM campaign_run WHERE week = ? AND ruleset < ? AND finished_at IS NOT NULL ORDER BY score DESC, finished_at, id LIMIT 10`, week, RULESET),
    top('ruleset < ?', RULESET),
  ]);
  const at = weekRows.findIndex((r) => r.mine);
  return {
    week: weekRows,
    allTime: listed(allTime),
    houses: houseTotals(weekRows, sides),
    me: { best: at >= 0 ? weekRows[at].score : null, runs: at >= 0 ? weekRows[at].runs ?? 0 : 0, rank: at >= 0 ? at + 1 : null, of: weekRows.length, record: record?.best ?? null },
    ...(oldAll.length ? { earlier: { week: listed(oldWeek), allTime: listed(oldAll) } } : {}),
  };
}

// ---------- the seasons of old ----------

interface SeasonRow { season: number; sides: string; state: string; ended: string | null }

/**
 * Closes a season of the old shared game that was still running, once: its standings as they stand go to the hall of
 * fame. Nothing else of the old game is played again. A demo and a preview leave it as it is.
 */
export async function closeOldSeason(tree: string, now: Date = new Date()): Promise<void> {
  if (readOnly()) return;
  const d = db(tree);
  const open = await d.get<SeasonRow>('SELECT season, sides, state, ended FROM campaign_season WHERE ended IS NULL ORDER BY season DESC LIMIT 1');
  if (!open) return;
  await once(tree, undefined, 'campaignCloseSeason', async (dd) => {
    const row = await dd.get<SeasonRow>('SELECT season, sides, state, ended FROM campaign_season WHERE season = ? AND ended IS NULL', open.season);
    if (!row) return { history: NOT_A_RECORD, writes: [], result: undefined };
    let named: FameEntry['standings'] = [];
    let winner: FameEntry['winner'] = null;
    try {
      const sides = JSON.parse(row.sides) as StoredSide[];
      const state = JSON.parse(row.state) as Pick<State, 'holder' | 'troops'>;
      if (Array.isArray(state.holder) && Array.isArray(state.troops)) {
        named = standings(state, sides.map((s) => s.id)).map((r) => ({ id: r.side, name: sides.find((s) => s.id === r.side)?.name ?? r.side, provinces: r.provinces, troops: r.troops }));
        const top = sides.find((s) => s.id === named[0]?.id);
        winner = top ? { id: top.id, name: top.name, arms: top.arms } : null;
      }
    } catch {
      // A season that cannot be read is closed without standings.
    }
    return {
      // The game is not the family's records.
      history: NOT_A_RECORD,
      writes: [
        guard('EXISTS (SELECT 1 FROM campaign_season WHERE season = ? AND ended IS NULL)', row.season),
        q('UPDATE campaign_season SET ended = ?, winner = ?, result = ?, rev = rev + 1 WHERE season = ?', now.toISOString(), winner?.id ?? null, JSON.stringify({ winner, standings: named }), row.season),
      ],
      result: undefined,
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

// ---------- the steward's switch ----------

export async function campaignSettings(tree: string): Promise<{ enabled: boolean }> {
  return { enabled: !!(await campaignRow(db(tree)))?.enabled };
}

/** Turns the game on or off. Nothing is lost either way: the tables and the seasons of old stay. */
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
  await closeOldSeason(tree, now);
}

/** Whether a right answer in the daily quiz earns something here now: the game must be on. */
export async function quizRewardOn(tree: string): Promise<boolean> {
  return !!(await campaignRow(db(tree)))?.enabled;
}

// ---------- reigns ----------

/** Begins a reign of this week's challenge for a member: the field, the seed, and what their levy has, fixed now. */
export async function startRun(tree: string, who: Who, asked: string | null, now: Date = new Date()): Promise<RunStart> {
  if (!(await campaignRow(db(tree)))?.enabled) throw new Error('campaign.err.off');
  const week = weekOf(now);
  const id = crypto.randomUUID();
  // The reign's own dice; refused before anything is written when the server has no secret.
  const seed = await reignSeed(id);
  return once(tree, undefined, 'campaignStartRun', async (dd) => {
    const c = await campaignRow(dd);
    if (!c?.enabled) throw new Error('campaign.err.off');
    // The week's field: read back when a reign of the week has stored it, else laid out now and stored with this reign,
    // only if nobody stored one meanwhile (the guard; on a race this plan runs again and reads the winner's back).
    const kept = await keptField(dd, week);
    const field = kept ?? (await freshField(tree, await weekSeed(tree, week)));
    const { side } = await sideFor(dd, who, field.sides, asked);
    if (!side) throw new Error('campaign.err.no_side');
    const renown = (await renownOfSides(tree, field.sides)).get(side)?.bonus ?? 0;
    const grant = await quizGrant(dd, who.account, now);
    const stored: StoredField = { ...field, renown, grant };
    const at = now.toISOString();
    return {
      // The game is not the family's records.
      history: NOT_A_RECORD,
      writes: [
        sameCampaign(c),
        // A week begun under earlier rules gets today's field in its place; the reigns played on the old one keep their own.
        ...(kept
          ? []
          : [
            guard('NOT EXISTS (SELECT 1 FROM campaign_week WHERE week = ? AND ruleset >= ?)', week, RULESET),
            q('INSERT INTO campaign_week (week, field, created_at, ruleset) VALUES (?, ?, ?, ?) ON CONFLICT (week) DO UPDATE SET field = excluded.field, created_at = excluded.created_at, ruleset = excluded.ruleset', week, JSON.stringify(field), at, RULESET),
          ]),
        // The quiz's reward is spent once a day: two reigns begun at once cannot both take it.
        ...(grant > 0 ? [guard(`NOT ${spentSql}`, who.account, dayOf(now))] : []),
        q('INSERT INTO campaign_run (id, account, name_then, side, week, seed, field, created_at, ruleset) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, who.account, who.name, side, week, seed, JSON.stringify(stored), at, RULESET),
        // A reign begun and never finished is forgotten after two weeks.
        q('DELETE FROM campaign_run WHERE account = ? AND finished_at IS NULL AND created_at < ?', who.account, new Date(now.getTime() - 14 * DAY_MS).toISOString()),
      ],
      result: { id, week, seed, field, side, renown, grant },
    };
  });
}

/**
 * Finishes a reign: the server plays the moves again from the reign's own field, and keeps the score that comes out.
 * A move the rules refuse, a list that stops early, someone else's reign, a reign finished before and one begun under
 * earlier rules are all refused.
 */
export async function finishRun(tree: string, who: Who, id: string, moves: Move[], op: { key: string } | undefined, now: Date = new Date()): Promise<FinishResult> {
  const done = await once(tree, op && { key: op.key, user: who.account, payload: { id, moves } }, 'campaignFinishRun', async (d) => {
    const c = await campaignRow(d);
    if (!c?.enabled) throw new Error('campaign.err.off');
    const row = await d.get<RunRow>('SELECT * FROM campaign_run WHERE id = ?', id);
    if (!row || row.account !== who.account) throw new Error('campaign.err.no_run');
    if (row.finished_at) throw new Error('campaign.err.finished');
    const field = JSON.parse(row.field) as StoredField;
    // The moves of a reign begun under earlier rules mean something else today: it cannot be scored any more.
    if (row.ruleset !== RULESET || rulesetOf(field.map) !== RULESET) throw new Error('campaign.err.old_rules');
    let played;
    try {
      if (!Array.isArray(moves) || moves.length > RULES.MAX_MOVES) throw new CampaignError('too_long');
      played = chronicleOf(field.start, { map: field.map, sides: field.sides.map((s) => s.id), player: row.side, seed: row.seed, renown: field.renown, grant: field.grant }, moves);
      if (played.state.turn < RULES.TURNS) throw new CampaignError('unfinished');
    } catch (e) {
      if (e instanceof CampaignError) throw new Error('campaign.err.forged');
      throw e;
    }
    return {
      // The game is not the family's records.
      history: NOT_A_RECORD,
      writes: [
        guard('EXISTS (SELECT 1 FROM campaign_run WHERE id = ? AND account = ? AND finished_at IS NULL)', id, who.account),
        q('UPDATE campaign_run SET orders = ?, score = ?, result = ?, finished_at = ? WHERE id = ?', JSON.stringify(moves), played.score.total, JSON.stringify({ ...played.score, title: played.title }), now.toISOString(), id),
      ],
      result: { score: played.score, title: played.title, week: row.week, side: row.side, sides: field.sides.map((s) => ({ id: s.id, name: s.name, arms: s.arms })) },
    };
  });
  const d = db(tree);
  const total = done.score.total;
  const [rows, before, others, record] = await Promise.all([
    weekBests(d, done.week, who.account, RULESET),
    weekBests(d, done.week, who.account, RULESET, id),
    d.get<{ n: number }>('SELECT count(*) AS n FROM campaign_run WHERE account = ? AND week = ? AND ruleset = ? AND finished_at IS NOT NULL AND id <> ? AND score >= ?', who.account, done.week, RULESET, id, total),
    d.get<{ n: number }>('SELECT count(*) AS n FROM campaign_run WHERE account = ? AND ruleset = ? AND finished_at IS NOT NULL AND id <> ? AND score >= ?', who.account, RULESET, id, total),
  ]);
  const at = rows.findIndex((r) => r.mine);
  // Where the member's house stands among the houses this week, and whether this reign lifted it.
  const houses = houseTotals(rows, done.sides);
  const place = houses.findIndex((h) => h.side === done.side);
  const was = houseTotals(before, done.sides).findIndex((h) => h.side === done.side);
  return {
    score: done.score,
    title: done.title,
    best: at >= 0 ? rows[at].score : total,
    rank: at >= 0 ? at + 1 : 1,
    of: rows.length,
    personalBest: !others?.n,
    record: !record?.n,
    house: place >= 0 ? { name: houses[place].name, rank: place + 1, of: houses.length, rose: was > place } : null,
  };
}

// ---------- what the pages read ----------

/** Everything the campaign page shows a member: the practice's kit, and while the game is on the week's challenge and tables. */
export async function campaignView(tree: string, who: Who, now: Date = new Date()): Promise<CampaignView> {
  await closeOldSeason(tree, now);
  const d = db(tree);
  const c = await campaignRow(d);
  const sides = await sidesOf(tree);
  const [renown, { fame }] = await Promise.all([renownOfSides(tree, sides), hallOfFame(d)]);
  const kit = { sides: await sideViews(d, sides, renown) };
  const mySide = (await sideFor(d, who, sides)).side;
  if (!c?.enabled) return { enabled: false, kit, mySide, fame };

  const week = weekOf(now);
  const seed = await weekSeed(tree, week);
  const field = await weekField(tree, d, week, seed);
  const fieldRenown = await renownOfSides(tree, field.sides);
  const shown = await sideViews(d, field.sides, fieldRenown);
  const mine = await sideFor(d, who, field.sides);
  const challenge: Challenge = {
    week,
    ends: weekEnds(week),
    seed,
    // The sides with their houses' names and arms as they are today.
    field: { ...field, sides: shown.map((s) => ({ id: s.id, name: s.name, arms: s.arms, rival: s.rival, houses: s.houses, allies: s.allies })) },
    side: mine.side,
    chooses: mine.chooses,
    renown: Object.fromEntries(shown.map((s) => [s.id, s.renown.bonus])),
    grant: await quizGrant(d, who.account, now),
  };
  return { enabled: true, kit, mySide, challenge, board: await leaderboard(d, week, who.account, shown), fame };
}

/** The few facts the Today page's card and the navigation need. Reads only. */
export async function campaignStatus(tree: string, who: Who, now: Date = new Date()): Promise<CampaignStatus> {
  const d = db(tree);
  if (!(await campaignRow(d))?.enabled) return { enabled: false };
  const week = weekOf(now);
  const { me } = await leaderboard(d, week, who.account, []);
  return { enabled: true, week, best: me.best, runs: me.runs, rank: me.rank, of: me.of, record: me.record };
}
