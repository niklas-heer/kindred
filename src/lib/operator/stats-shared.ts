// What the operator's Statistics tab and the server share (docs/hosting-many-families.md, "Statistics"): the shape of one
// day's aggregates of the whole server (accounts table `instance_daily`, migration 0038), the ranges the tab offers and how
// a long range is thinned to one point a week or a month. No server imports.

/** One day of the whole server, as stored: counts only, never a record or a person. NULL where it could not be known. */
export interface InstanceDay {
  /** YYYY-MM-DD (UTC). */
  day: string;
  families: number;
  familiesNew: number | null;
  familiesSuspended: number | null;
  familiesClosed: number | null;
  accounts: number;
  accountsNew: number | null;
  membersMedian: number | null;
  membersMax: number | null;
  /** Accounts that used Kindred in the 24 hours, 7 days and 30 days up to the snapshot. */
  activeDay: number | null;
  activeWeek: number | null;
  activeMonth: number | null;
  /** Families with a member's visit in the 30 days up to the snapshot. */
  activeFamilies: number | null;
  storageBytes: number | null;
  /** Page views of families that collect usage statistics. */
  pageViews: number | null;
  /**
   * Sign-ins that day by method ('passkey', 'other'), from the sessions started that day. As the Statistics tab receives it, a
   * count below five is null ("fewer than 5"; readStatistics suppresses it on the server).
   */
  signIns: Record<string, number | null> | null;
  requestsOpen: number | null;
  dataRequestsOpen: number | null;
  /** Reconstructed after the fact (the first run's backfill), not counted on the day. */
  backfilled: boolean;
}

export const STATS_RANGES = ['30d', '12m', 'all'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

/** One family in the statistics table: its size and storage, and its activity only when it collects usage statistics. */
export interface StatsFamily {
  /** The family's id: its name is in its own database, which the statistics never open. */
  id: string;
  members: number;
  usedBytes: number;
  capBytes: number | null;
  status: 'active' | 'suspended' | 'closed';
  /** False when a steward turned usage statistics off: its activity is not shown (lastActivity and views are null). */
  collecting: boolean;
  lastActivity: number | null;
  /** Page views in the last 30 days. */
  views30: number | null;
}

/**
 * "Of the accounts made in the week N weeks ago, how many used Kindred in the last 7 days." A count below five is null ("fewer
 * than 5"), and a cohort that is hidden hides its share too.
 */
export interface RetentionRow { weeksAgo: number; created: number | null; activeLastWeek: number | null }

/** AI spending of the whole server per UTC month, in micro-dollars (from ai_spend). */
export interface AiMonth { month: string; micros: number }

/** Of the families made at least `weeks` weeks ago, how many had a member's visit in the last 7 days (null: fewer than five). */
export interface FamilyCohort { weeks: number; families: number; visitedLastWeek: number | null }

/** Storage against the caps: everything used, and the families with a cap (their use, their caps, those at 80% or more). */
export interface StorageSummary { usedBytes: number; cappedFamilies: number; cappedUsedBytes: number; capBytes: number; nearCap: number }

/**
 * A breakdown (a cohort, a sign-in method) smaller than this is shown as "fewer than 5", so it cannot point at a few people. The
 * server suppresses it before the statistics leave it (stats.server.ts, readStatistics): the browser never receives the count.
 */
export const SMALL = 5;
/** A count for a breakdown, or null when it is too small to show (or already suppressed). */
export const shown = (n: number | null) => (n === null || (n > 0 && n < SMALL) ? null : n);

export interface OperatorStatistics {
  days: InstanceDay[];
  /** The live numbers now, so the headline does not wait for tonight's snapshot. */
  now: InstanceDay;
  families: StatsFamily[];
  retention: RetentionRow[];
  cohorts: FamilyCohort[];
  /** Families with 3 or more members who visited in the last 30 days. */
  busyFamilies: number;
  /** Sign-ins in the 30 days up to today, by method, summed on the server before suppression (null: fewer than five). */
  signIns30: Record<string, number | null>;
  storage: StorageSummary;
  ai: AiMonth[];
  /** Families with usage statistics off: counted in every aggregate, their activity not shown per family. */
  statsOff: number;
}

/** A point of a chart: the period it stands for (its first day) and the value; null for a period with nothing known. */
export interface Point { day: string; value: number | null }

/** How a series sums up over a longer period: a level (families, storage) takes the period's last value, a flow (new accounts, page views) the sum. */
export type Kind = 'level' | 'flow';

/** Monday of the ISO week a UTC day falls in. */
const weekOf = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** The days in range, oldest first: 30 days, a year or everything since the first snapshot. */
export function inRange(days: InstanceDay[], range: StatsRange, today: string): InstanceDay[] {
  if (range === 'all') return days;
  const from = new Date(`${today}T00:00:00Z`);
  if (range === '30d') from.setUTCDate(from.getUTCDate() - 29);
  else from.setUTCFullYear(from.getUTCFullYear() - 1);
  const start = from.toISOString().slice(0, 10);
  return days.filter((d) => d.day >= start);
}

/**
 * One series over the range: daily for 30 days, weekly for a year, monthly for everything once that is longer than a year
 * (and weekly while it is not), so a chart stays readable.
 */
export function series(days: InstanceDay[], pick: (d: InstanceDay) => number | null, kind: Kind, range: StatsRange): Point[] {
  const span = days.length;
  const bucket = range === '30d' ? (d: string) => d : range === '12m' || span <= 400 ? weekOf : monthOf;
  const out: Point[] = [];
  for (const d of days) {
    const key = bucket(d.day);
    const v = pick(d);
    const last = out[out.length - 1];
    if (!last || last.day !== key) { out.push({ day: key, value: v }); continue; }
    if (v === null) continue;
    last.value = kind === 'level' ? v : (last.value ?? 0) + v;
  }
  return out;
}

/** The change from the first known value to the last: { from, to } or null when there is not one known value. */
export function growth(points: Point[]): { from: number; to: number } | null {
  const known = points.filter((p) => p.value !== null) as { day: string; value: number }[];
  return known.length ? { from: known[0]!.value, to: known[known.length - 1]!.value } : null;
}

/** The middle value of a list of whole numbers; null for none. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
