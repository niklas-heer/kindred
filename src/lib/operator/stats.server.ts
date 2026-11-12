// The operator's statistics of the whole server (docs/hosting-many-families.md, "Statistics"): one row a day of aggregates in
// the accounts table `instance_daily` (migration 0038), written by the daily job (src/lib/jobs/instance-stats.ts), and what
// the console's Statistics tab reads. Only counts: no row names a person, and nothing here opens a family's records.
//
// The row for a day is written the morning after, so its flows (new accounts, page views, sign-ins) cover the whole day.
// Levels that can be read for any past day (families and accounts by when they were made) are counted as of that day's end;
// what only exists as it is now (who was active, storage, suspended families, open requests) is the value at the snapshot.
// The first run reconstructs the days before it from what the accounts database still holds: families and accounts by their
// creation, page views from the families' daily counters. The rest of a reconstructed day is NULL, and it is marked as such.
import { q, store } from '../store/index.ts';
import { median, shown, type AiMonth, type FamilyCohort, type StorageSummary, type InstanceDay, type OperatorStatistics, type RetentionRow, type StatsFamily } from './stats-shared.ts';

const accounts = () => store.accounts();
const DAY = 86_400_000;
/** How far back the first run reconstructs: the families' daily counters are kept three years (src/lib/stats). */
export const BACKFILL_MAX_DAYS = 3 * 366;
const BATCH = 50;
/** Kept three years, like the families' own daily counters. */
export const KEEP_DAYS = 3 * 366;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayEnd = (day: string) => Date.parse(`${day}T00:00:00Z`) + DAY - 1;
const addDays = (day: string, n: number) => utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY);

interface Facts {
  /** Each current family and when it was made, as best known (the console, else its first membership); null when unknown. */
  families: { tree: string; created: number | null }[];
  accountsCreated: number[];
  /** Page views per UTC day, from the families' daily counters (none from a family with statistics off). */
  views: Map<string, number>;
}

async function facts(trees: string[]): Promise<Facts> {
  const [admin, first, users, views] = (await accounts().readBatch([
    q('SELECT tree, created_at FROM family_admin'),
    q('SELECT tree, min(created) AS first FROM membership GROUP BY tree'),
    q('SELECT created FROM user'),
    q("SELECT day, sum(n) AS n FROM stats_daily WHERE kind = 'view' GROUP BY day"),
  ])) as unknown as [{ tree: string; created_at: number | null }[], { tree: string; first: number | null }[], { created: number }[], { day: string; n: number }[]];
  const a = new Map(admin.map((r) => [r.tree, r.created_at]));
  const m = new Map(first.map((r) => [r.tree, r.first]));
  return {
    families: trees.map((tree) => ({ tree, created: a.get(tree) ?? m.get(tree) ?? null })),
    accountsCreated: users.map((u) => u.created),
    views: new Map(views.map((r) => [r.day, Number(r.n ?? 0)])),
  };
}

/** The part of a day that can be counted for any day still in the accounts database. */
type Reconstructable = Pick<InstanceDay, 'day' | 'families' | 'familiesNew' | 'accounts' | 'accountsNew' | 'pageViews' | 'backfilled'>;
function reconstructable(day: string, f: Facts): Reconstructable {
  const start = Date.parse(`${day}T00:00:00Z`), end = dayEnd(day);
  // A family whose making is unknown has been there all along.
  const families = f.families.filter((x) => x.created === null || x.created <= end).length;
  const familiesNew = f.families.filter((x) => x.created !== null && x.created >= start && x.created <= end).length;
  const accountsNow = f.accountsCreated.filter((c) => c <= end).length;
  const accountsNew = f.accountsCreated.filter((c) => c >= start && c <= end).length;
  return { day, families, familiesNew, accounts: accountsNow, accountsNew, pageViews: f.views.get(day) ?? 0, backfilled: false };
}

/** The whole of a day's row: the reconstructable part for `day`, and the rest as it is at `now`. */
export async function liveDay(day: string, trees: string[], now: number, f?: Facts): Promise<InstanceDay> {
  const base = reconstructable(day, f ?? await facts(trees));
  const [members, status, active, storage, visits, signIns, reqs] = (await accounts().readBatch([
    q('SELECT tree, count(*) AS n FROM membership GROUP BY tree'),
    q("SELECT tree, closed FROM family_admin WHERE status = 'suspended'"),
    q('SELECT sum(last_seen >= ?) AS d, sum(last_seen >= ?) AS w, sum(last_seen >= ?) AS m FROM user WHERE last_seen IS NOT NULL', now - DAY, now - 7 * DAY, now - 30 * DAY),
    q('SELECT tree, sum(bytes) AS n FROM media_usage GROUP BY tree'),
    q('SELECT tree, max(last_seen) AS at FROM family_visit GROUP BY tree'),
    // Counted as each session starts (accounts migration 0048): a session row is gone once its account signs in again.
    q('SELECT method, count AS n FROM signin_daily WHERE day = ?', day),
    q("SELECT (SELECT count(*) FROM family_request WHERE status = 'open') AS family, (SELECT count(*) FROM data_request WHERE status != 'done') AS data"),
  ])) as unknown as [
    { tree: string; n: number }[], { tree: string; closed: number }[], [{ d: number | null; w: number | null; m: number | null }],
    { tree: string; n: number }[], { tree: string; at: number | null }[], { method: string; n: number }[], [{ family: number; data: number }],
  ];
  const current = new Set(trees);
  const sizes = new Map(members.filter((r) => current.has(r.tree)).map((r) => [r.tree, r.n]));
  const counts = trees.map((t) => sizes.get(t) ?? 0);
  const suspended = status.filter((r) => current.has(r.tree));
  return {
    ...base,
    familiesSuspended: suspended.filter((r) => r.closed !== 1).length,
    familiesClosed: suspended.filter((r) => r.closed === 1).length,
    membersMedian: median(counts),
    membersMax: counts.length ? Math.max(...counts) : null,
    activeDay: Number(active[0]?.d ?? 0), activeWeek: Number(active[0]?.w ?? 0), activeMonth: Number(active[0]?.m ?? 0),
    activeFamilies: visits.filter((r) => current.has(r.tree) && (r.at ?? 0) >= now - 30 * DAY).length,
    storageBytes: storage.filter((r) => current.has(r.tree)).reduce((s, r) => s + Number(r.n ?? 0), 0),
    signIns: Object.fromEntries(signIns.map((r) => [r.method, r.n])),
    requestsOpen: reqs[0]?.family ?? 0, dataRequestsOpen: reqs[0]?.data ?? 0,
  };
}

const COLUMNS = [
  'day', 'families', 'families_new', 'families_suspended', 'families_closed', 'accounts', 'accounts_new', 'members_median', 'members_max',
  'active_day', 'active_week', 'active_month', 'active_families', 'storage_bytes', 'page_views', 'sign_ins', 'requests_open', 'data_requests_open', 'backfilled', 'at',
] as const;

const insert = (d: InstanceDay, at: number, replace: boolean) => q(
  `INSERT INTO instance_daily (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')}) ${replace
    ? `ON CONFLICT(day) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'day').map((c) => `${c} = excluded.${c}`).join(', ')}`
    : 'ON CONFLICT(day) DO NOTHING'}`,
  d.day, d.families, d.familiesNew, d.familiesSuspended, d.familiesClosed, d.accounts, d.accountsNew, d.membersMedian, d.membersMax,
  d.activeDay, d.activeWeek, d.activeMonth, d.activeFamilies, d.storageBytes, d.pageViews, d.signIns ? JSON.stringify(d.signIns) : null, d.requestsOpen,
  d.dataRequestsOpen, d.backfilled ? 1 : 0, at,
);

/**
 * Tonight's work: yesterday's row (written again if the job runs twice), and on the first run the days before it, back to the
 * first account or family, reconstructed. Returns how many days were written.
 */
export async function snapshot(trees: string[], now: number): Promise<{ day: string; backfilled: number }> {
  const day = utcDay(now - DAY);
  const f = await facts(trees);
  const row = await liveDay(day, trees, now, f);
  const writes = [insert(row, now, true)];
  const first = await accounts().get<{ day: string }>('SELECT min(day) AS day FROM instance_daily');
  let backfilled = 0;
  if (!first?.day) {
    const earliest = Math.min(...f.accountsCreated, ...f.families.map((x) => x.created ?? Infinity));
    if (Number.isFinite(earliest)) {
      let d = utcDay(Math.max(earliest, now - BACKFILL_MAX_DAYS * DAY));
      for (; d < day; d = addDays(d, 1)) {
        const past = reconstructable(d, f);
        writes.push(insert({
          ...past, familiesSuspended: null, familiesClosed: null, membersMedian: null, membersMax: null, activeDay: null, activeWeek: null,
          activeMonth: null, activeFamilies: null, storageBytes: null, signIns: null, requestsOpen: null, dataRequestsOpen: null, backfilled: true,
        }, now, false));
        backfilled += 1;
      }
    }
  }
  // Yesterday's row first, then the reconstructed days in batches small enough for D1.
  for (let i = 0; i < writes.length; i += BATCH) await accounts().batch(writes.slice(i, i + BATCH));
  return { day, backfilled };
}

type Row = Record<(typeof COLUMNS)[number], unknown>;
const toDay = (r: Row): InstanceDay => {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  let signIns: Record<string, number> | null = null;
  try { signIns = r.sign_ins ? JSON.parse(String(r.sign_ins)) : null; } catch { signIns = null; }
  return {
    day: String(r.day), families: Number(r.families), familiesNew: n(r.families_new), familiesSuspended: n(r.families_suspended),
    familiesClosed: n(r.families_closed), accounts: Number(r.accounts), accountsNew: n(r.accounts_new), membersMedian: n(r.members_median),
    membersMax: n(r.members_max), activeDay: n(r.active_day), activeWeek: n(r.active_week), activeMonth: n(r.active_month), activeFamilies: n(r.active_families),
    storageBytes: n(r.storage_bytes), pageViews: n(r.page_views), signIns, requestsOpen: n(r.requests_open), dataRequestsOpen: n(r.data_requests_open),
    backfilled: r.backfilled === 1,
  };
};

export async function storedDays(): Promise<InstanceDay[]> {
  return (await accounts().all<Row>(`SELECT ${COLUMNS.join(', ')} FROM instance_daily ORDER BY day`)).map(toDay);
}

/** Retention by weekly cohort, for the last `weeks` weeks: accounts made that week, and how many of them were active in the last 7 days. */
export async function retention(now: number, weeks = 12): Promise<RetentionRow[]> {
  const rows = await accounts().all<{ created: number; last_seen: number | null }>('SELECT created, last_seen FROM user WHERE created >= ?', now - (weeks + 1) * 7 * DAY);
  const out: RetentionRow[] = [];
  for (let w = 1; w <= weeks; w++) {
    const from = now - (w + 1) * 7 * DAY, to = now - w * 7 * DAY;
    const cohort = rows.filter((r) => r.created >= from && r.created < to);
    out.push({ weeksAgo: w, created: cohort.length, activeLastWeek: cohort.filter((r) => (r.last_seen ?? 0) >= now - 7 * DAY).length });
  }
  return out;
}

/** Families made at least `weeks` weeks ago (a week's grace), and how many of them had a member's visit in the last 7 days. */
const COHORT_WEEKS = [1, 4, 12] as const;

/**
 * Everything the Statistics tab shows, read from the accounts database alone: no family's database is opened (so no Durable
 * Object wakes) and no record is read. A family whose stewards turned usage statistics off is counted in every total, but its
 * own activity (when it was last opened, its page views) is not shown on its row.
 */
export async function readStatistics(now = Date.now()): Promise<OperatorStatistics> {
  const trees = await store.treeIds();
  const current = new Set(trees);
  const since = utcDay(now - 29 * DAY);
  const [off, views, ai, members, used, admin, visits, actives] = (await accounts().readBatch([
    q('SELECT tree FROM stats_setting WHERE collect = 0'),
    q("SELECT tree, sum(n) AS n FROM stats_daily WHERE kind = 'view' AND day >= ? GROUP BY tree", since),
    q('SELECT month, sum(micros) AS micros FROM ai_spend GROUP BY month ORDER BY month'),
    q('SELECT tree, count(*) AS n, min(created) AS first FROM membership GROUP BY tree'),
    q('SELECT tree, sum(bytes) AS n FROM media_usage GROUP BY tree'),
    q('SELECT tree, status, closed, cap_bytes, created_at FROM family_admin'),
    q('SELECT tree, max(last_seen) AS at FROM family_visit GROUP BY tree'),
    q('SELECT tree, count(*) AS n FROM family_visit WHERE last_seen >= ? GROUP BY tree', now - 30 * DAY),
  ])) as unknown as [
    { tree: string }[], { tree: string; n: number }[], { month: string; micros: number }[], { tree: string; n: number; first: number | null }[],
    { tree: string; n: number }[], { tree: string; status: string; closed: number; cap_bytes: number | null; created_at: number | null }[],
    { tree: string; at: number | null }[], { tree: string; n: number }[],
  ];
  const by = <T extends { tree: string }>(rows: T[]) => new Map(rows.filter((r) => current.has(r.tree)).map((r) => [r.tree, r]));
  const offSet = new Set(off.map((r) => r.tree));
  const v = by(views), m = by(members), u = by(used), a = by(admin), last = by(visits), act = by(actives);
  const table: StatsFamily[] = trees.map((id) => {
    const collecting = !offSet.has(id);
    const ad = a.get(id);
    return {
      id, members: m.get(id)?.n ?? 0, usedBytes: Number(u.get(id)?.n ?? 0), capBytes: ad?.cap_bytes ?? null,
      status: (ad?.status === 'suspended' ? (ad.closed === 1 ? 'closed' : 'suspended') : 'active') as StatsFamily['status'], collecting,
      lastActivity: collecting ? last.get(id)?.at ?? null : null, views30: collecting ? Number(v.get(id)?.n ?? 0) : null,
    };
  }).sort((x, y) => y.usedBytes - x.usedBytes || x.id.localeCompare(y.id));
  const created = (id: string) => a.get(id)?.created_at ?? m.get(id)?.first ?? null;
  const cohorts: FamilyCohort[] = COHORT_WEEKS.map((weeks) => {
    const old = trees.filter((id) => { const c = created(id); return c !== null && c <= now - weeks * 7 * DAY; });
    return { weeks, families: old.length, visitedLastWeek: old.filter((id) => (last.get(id)?.at ?? 0) >= now - 7 * DAY).length };
  });
  const capped = table.filter((f) => f.capBytes !== null);
  const storage: StorageSummary = {
    usedBytes: table.reduce((s, f) => s + f.usedBytes, 0),
    cappedFamilies: capped.length,
    cappedUsedBytes: capped.reduce((s, f) => s + f.usedBytes, 0),
    capBytes: capped.reduce((s, f) => s + (f.capBytes ?? 0), 0),
    nearCap: capped.filter((f) => f.capBytes! > 0 ? f.usedBytes / f.capBytes! >= 0.8 : f.usedBytes > 0).length,
  };
  const [days, today, ret] = await Promise.all([storedDays(), liveDay(utcDay(now), trees, now), retention(now)]);
  // Sign-ins over the 30 days up to today, by method, summed before they are suppressed.
  const todayKey = utcDay(now);
  const signIns30: Record<string, number> = {};
  for (const d of [...days.filter((x) => x.day >= since && x.day < todayKey), today]) {
    for (const [k, v] of Object.entries(d.signIns ?? {})) signIns30[k] = (signIns30[k] ?? 0) + (v ?? 0);
  }
  // Every breakdown below five is suppressed here, so the browser never receives it (stats-shared.ts, SMALL).
  return {
    days: days.map(suppressDay), now: suppressDay(today), families: table,
    retention: ret.map((r) => { const created = shown(r.created); return { ...r, created, activeLastWeek: created === null ? null : shown(r.activeLastWeek) }; }),
    cohorts: cohorts.map((c) => ({ ...c, visitedLastWeek: shown(c.visitedLastWeek) })),
    signIns30: suppressCounts(signIns30),
    busyFamilies: trees.filter((id) => (act.get(id)?.n ?? 0) >= 3).length,
    storage,
    ai: ai.map((r): AiMonth => ({ month: r.month, micros: Number(r.micros ?? 0) })),
    statsOff: trees.filter((id) => offSet.has(id)).length,
  };
}

/** A breakdown's counts with each one below five replaced by null. */
const suppressCounts = (m: Record<string, number | null>): Record<string, number | null> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, shown(v)]));
/** A day as the Statistics tab receives it: its sign-ins by method suppressed below five. */
const suppressDay = (d: InstanceDay): InstanceDay => (d.signIns ? { ...d, signIns: suppressCounts(d.signIns) } : d);

/** Rows older than the three years the statistics are kept. */
export async function pruneInstanceDays(now: number): Promise<void> {
  await accounts().run('DELETE FROM instance_daily WHERE day < ?', utcDay(now - KEEP_DAYS * DAY));
}
