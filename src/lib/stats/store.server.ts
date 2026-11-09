// Usage statistics on the server: adding a browser's report to the daily counters, the steward's off switch, the numbers for the
// Statistics page, and the daily clean-up. In the accounts database (migrations/accounts/0016_statistics.sql); read
// docs/roles-and-privacy.md for what is and is not stored. Counting must never get in anyone's way: the writers swallow their errors.
import { q, store, type Query } from '../store/index.ts';
import { accounts } from '../auth/store.server.ts';
import { buildOverview, CHANGE_KINDS, type ChangeKind, type ChangeRow, type DailyRow, type Overview } from './overview.ts';
import { CHANGE_OF_ACTION, CATEGORIES, dayBefore, dayOf, LEGACY, ONCE_EVENTS, type Category, type EventName, type RangeDays, type StatsBatch, type StoredCategory } from './shared.ts';
import type { Action, Role } from '../roles.ts';

/** How long a member's last-seen marker lasts: past the longest range the page shows. */
export const MEMBER_KEEP_DAYS = 100;
/** How long the daily counters last. */
export const DAILY_KEEP_DAYS = 3 * 366;
/** At most this many guest visits are counted per family per day: guests are not signed in, so nothing else limits them. */
export const GUEST_DAILY_CAP = 2000;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** A member's pseudonym in one family's statistics: one-way, and different in every family. */
export async function actorKey(tree: string, user: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kindred-stats|${tree}|${user}`))).slice(0, 32);
}

export async function isCollecting(tree: string): Promise<boolean> {
  const row = await accounts().get<{ collect: number }>('SELECT collect FROM stats_setting WHERE tree = ?', tree);
  return row ? row.collect === 1 : true;
}

/** True inside a write's own statement: the steward has not turned collection off. Checked there, not before, so turning it off cannot lose a race with a write already under way. */
const ON = "NOT EXISTS (SELECT 1 FROM stats_setting WHERE tree = ? AND collect = 0)";

const bump = (tree: string, day: string, kind: DailyRow['kind'], cat: Category, name: string, n: number): Query =>
  q(`INSERT INTO stats_daily (tree, day, kind, cat, name, n) SELECT ?, ?, ?, ?, ?, ? WHERE ${ON} ON CONFLICT (tree, day, kind, cat, name) DO UPDATE SET n = n + excluded.n`, tree, day, kind, cat, name, n, tree);

/** The category of a member right now, read from the membership on the server. A role is a category; null when not a member. */
export async function categoryOf(user: string, tree: string): Promise<Category | null> {
  const row = await accounts().get<{ role: Role }>('SELECT role FROM membership WHERE user = ? AND tree = ?', user, tree);
  return row && (CATEGORIES as readonly string[]).includes(row.role) ? row.role : null;
}

/** Counts `name` only for a member not yet counted for it, in one statement with the check. */
function onceWrites(tree: string, day: string, cat: Category, actor: string, name: EventName): Query[] {
  return [
    q(`INSERT INTO stats_daily (tree, day, kind, cat, name, n) SELECT ?, ?, 'event', ?, ?, 1
       WHERE ${ON} AND NOT EXISTS (SELECT 1 FROM stats_once WHERE tree = ? AND actor = ? AND name = ?)
       ON CONFLICT (tree, day, kind, cat, name) DO UPDATE SET n = n + 1`, tree, day, cat, name, tree, tree, actor, name),
    q(`INSERT INTO stats_once (tree, actor, name) SELECT ?, ?, ? WHERE ${ON} ON CONFLICT (tree, actor, name) DO NOTHING`, tree, actor, name, tree),
  ];
}

/** Marks a member as seen today; the day's "active" counter goes up only the first time. */
function activeWrites(tree: string, day: string, cat: Category, actor: string): Query[] {
  return [
    q(`INSERT INTO stats_daily (tree, day, kind, cat, name, n) SELECT ?, ?, 'active', ?, 'member', 1
       WHERE ${ON} AND NOT EXISTS (SELECT 1 FROM stats_member WHERE tree = ? AND actor = ? AND last_day = ?)
       ON CONFLICT (tree, day, kind, cat, name) DO UPDATE SET n = n + 1`, tree, day, cat, tree, tree, actor, day),
    q(`INSERT INTO stats_member (tree, actor, last_day, cat) SELECT ?, ?, ?, ? WHERE ${ON}
       ON CONFLICT (tree, actor) DO UPDATE SET last_day = excluded.last_day, cat = excluded.cat WHERE last_day <> excluded.last_day OR cat IS NOT excluded.cat`, tree, actor, day, cat, tree),
  ];
}

/**
 * Adds a member's report under the category they hold now. The category comes from the membership on the server (or from the caller
 * that has just checked it), never from the report. Nothing is written when the family has collection off or the user is no member.
 */
export async function recordMemberBatch(user: string, batch: StatsBatch, now = Date.now(), known?: Category): Promise<void> {
  const { tree } = batch;
  if (!(await isCollecting(tree))) return;
  const cat = known ?? (await categoryOf(user, tree));
  if (!cat) return;
  const day = dayOf(now);
  const actor = await actorKey(tree, user);
  const writes = activeWrites(tree, day, cat, actor);
  if (batch.visit) writes.push(bump(tree, day, 'visit', cat, 'member', 1));
  for (const [name, n] of Object.entries(batch.views ?? {})) writes.push(bump(tree, day, 'view', cat, name, n));
  for (const [name, n] of Object.entries(batch.events ?? {}) as [EventName, number][]) {
    if (ONCE_EVENTS.includes(name)) writes.push(...onceWrites(tree, day, cat, actor, name));
    else writes.push(bump(tree, day, 'event', cat, name, n));
  }
  await accounts().batch(writes);
}

/** Counts one anonymous visit from a share link: nothing about the visitor, and up to a daily limit. */
export async function recordGuestVisit(tree: string, now = Date.now()): Promise<void> {
  if (!(await isCollecting(tree))) return;
  await accounts().run(
    `INSERT INTO stats_daily (tree, day, kind, cat, name, n) SELECT ?, ?, 'visit', 'guest', 'guest', 1 WHERE ${ON}
     ON CONFLICT (tree, day, kind, cat, name) DO UPDATE SET n = n + 1 WHERE n < ?`,
    tree, dayOf(now), tree, GUEST_DAILY_CAP,
  );
}

/**
 * Counts something a member did, from a server function. Never throws and honours Do Not Track, so a feature can call it and carry on.
 */
export async function countFeature(tree: string, user: string, name: EventName, now = Date.now()): Promise<void> {
  try {
    const { getRequest } = await import('@tanstack/react-start/server');
    const { headersRefuseTracking } = await import('./shared.ts');
    if (headersRefuseTracking(getRequest().headers)) return;
  } catch {}
  await recordMemberBatch(user, { tree, events: { [name]: 1 } }, now).catch(() => {});
}

/**
 * Counts that a member saved a change (a person, a photo, a story, research), by the role the permission check has just confirmed.
 * Called once a write has reached the database (`onChangeCommitted` in auth/guard.server.ts); never throws, honours Do Not Track like every other count.
 */
export async function countChange(tree: string, user: string, role: Role, action: Action, now = Date.now()): Promise<void> {
  const kind = CHANGE_OF_ACTION[action];
  if (!kind) return;
  try {
    const { getRequest } = await import('@tanstack/react-start/server');
    const { headersRefuseTracking } = await import('./shared.ts');
    if (headersRefuseTracking(getRequest().headers)) return;
  } catch {}
  try {
    if (!(await isCollecting(tree))) return;
    await accounts().batch([...activeWrites(tree, dayOf(now), role, await actorKey(tree, user)), bump(tree, dayOf(now), 'change', role, kind, 1)]);
  } catch {}
}

/** The off switch. Turning off also forgets who was seen, leaving only the anonymous counts. */
export async function setCollecting(tree: string, on: boolean, now = Date.now()): Promise<void> {
  const writes = [q('INSERT INTO stats_setting (tree, collect, changed_at) VALUES (?, ?, ?) ON CONFLICT (tree) DO UPDATE SET collect = excluded.collect, changed_at = excluded.changed_at', tree, on ? 1 : 0, now)];
  if (!on) writes.push(q('DELETE FROM stats_member WHERE tree = ?', tree), q('DELETE FROM stats_once WHERE tree = ?', tree));
  await accounts().batch(writes);
}

/** What the family added or changed, per day, from its own dated records: no extra writes, and it reaches back before statistics began. */
async function changeRows(tree: string, sinceDay: string): Promise<ChangeRow[]> {
  const d = store.tree(tree);
  const sources: [ChangeKind, string, string][] = [
    ['people', 'person', 'updated_at'],
    ['photos', 'media', 'uploaded_at'],
    ['photos', 'photo', 'at'],
    ['photos', 'portrait', 'created_at'],
    ['stories', 'story', 'at'],
    ['research', 'research_project', 'created_at'],
    ['research', 'research_document', 'created_at'],
    ['research', 'research_note', 'created_at'],
  ];
  const results = await Promise.all(sources.map(async ([kind, table, column]) => {
    const rows = await d.all<{ day: string; n: number }>(`SELECT substr(${column}, 1, 10) AS day, COUNT(*) AS n FROM ${table} WHERE ${column} >= ? GROUP BY day`, sinceDay);
    return rows.map((r) => ({ day: r.day, kind, n: Number(r.n) }));
  }));
  return results.flat().filter((r) => CHANGE_KINDS.includes(r.kind) && /^\d{4}-\d{2}-\d{2}$/.test(r.day));
}

/** Everything the Statistics page shows. */
export async function readOverview(tree: string, days: RangeDays, now = Date.now()): Promise<Overview> {
  const db = accounts();
  const today = dayOf(now);
  const since = dayBefore(today, days * 2 - 1);
  const [collecting, rows, first, categorized, seen, members, lifetime, changes, feedback] = await Promise.all([
    isCollecting(tree),
    db.all<DailyRow>('SELECT day, kind, cat, name, n FROM stats_daily WHERE tree = ? AND day >= ?', tree, since),
    db.get<{ day: string | null }>('SELECT MIN(day) AS day FROM stats_daily WHERE tree = ?', tree),
    db.get<{ day: string | null }>("SELECT MIN(day) AS day FROM stats_daily WHERE tree = ? AND cat <> 'legacy'", tree),
    db.all<{ cat: string | null; d7: number | null; d30: number | null; d90: number | null }>(
      'SELECT cat, SUM(last_day >= ?) AS d7, SUM(last_day >= ?) AS d30, SUM(last_day >= ?) AS d90 FROM stats_member WHERE tree = ? GROUP BY cat',
      dayBefore(today, 6), dayBefore(today, 29), dayBefore(today, 89), tree,
    ),
    db.all<{ role: Category; n: number }>('SELECT role, COUNT(*) AS n FROM membership WHERE tree = ? GROUP BY role', tree),
    db.all<{ name: EventName; n: number }>(`SELECT name, SUM(n) AS n FROM stats_daily WHERE tree = ? AND kind = 'event' AND name IN ('tour.finished', 'tour.skipped') GROUP BY name`, tree),
    changeRows(tree, since),
    db.get<{ n: number }>('SELECT COUNT(*) AS n FROM feedback WHERE tree = ?', tree),
  ]);
  return buildOverview({
    days, today, collecting, since: first?.day ?? null, categorized: categorized?.day ?? null, rows, changes,
    active: Object.fromEntries(seen.map((r) => [(CATEGORIES as readonly string[]).includes(r.cat ?? '') ? r.cat : LEGACY, { d7: Number(r.d7 ?? 0), d30: Number(r.d30 ?? 0), d90: Number(r.d90 ?? 0) }])) as Partial<Record<StoredCategory, { d7: number; d30: number; d90: number }>>,
    members: Object.fromEntries(members.map((r) => [r.role, Number(r.n)])),
    lifetime: Object.fromEntries(lifetime.map((r) => [r.name, Number(r.n)])),
    feedback: Number(feedback?.n ?? 0),
  });
}

/** Removes what has passed its retention. Daily, for the whole server. */
export async function pruneStats(now = Date.now()): Promise<void> {
  const today = dayOf(now);
  await accounts().batch([
    q('DELETE FROM stats_daily WHERE day < ?', dayBefore(today, DAILY_KEEP_DAYS)),
    q('DELETE FROM stats_member WHERE last_day < ?', dayBefore(today, MEMBER_KEEP_DAYS)),
    q('DELETE FROM stats_once WHERE NOT EXISTS (SELECT 1 FROM stats_member m WHERE m.tree = stats_once.tree AND m.actor = stats_once.actor)'),
  ]);
}
