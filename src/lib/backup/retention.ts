// Which backups to keep (docs/hosting-many-families.md, "Backups"), counted back from today (UTC): the newest of each day of the
// last `daily` days, of each ISO week of the last `weekly` weeks and of each month of the last `monthly` months, so with the
// default 7, 4 and 12 nothing is older than 12 months, however long ago the backups stopped. The one exception: the newest
// backup of a family is always kept, as long as the family lives (a deleted family's backups wait out the grace period
// instead). Plain code: the console and its tests use it.

export interface Keep { daily: number; weekly: number; monthly: number }
export const DEFAULT_KEEP: Keep = { daily: 7, weekly: 4, monthly: 12 };
/** The most of each the console accepts. */
export const KEEP_MAX: Keep = { daily: 60, weekly: 52, monthly: 120 };
export const DEFAULT_GRACE_DAYS = 30;
export const GRACE_MAX_DAYS = 365;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const month = (t: number) => new Date(t).toISOString().slice(0, 7);
/** The ISO week a moment is in: its Thursday's year and the week number. */
function week(t: number) {
  const d = new Date(t);
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)));
  const first = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((thursday.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${n}`;
}

/** The moment `months` calendar months before `t` (UTC; the 31st of a shorter month falls back to that month's last day). */
function monthsBefore(t: number, months: number): number {
  const d = new Date(t);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months + 1, 0)).getUTCDate();
  return first + (Math.min(d.getUTCDate(), last) - 1) * 86_400_000 + (t - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Of backups made at `times` (ms), the indexes to keep `now`. */
export function keepIndexes(times: readonly number[], keep: Keep, now: number): Set<number> {
  const order = times.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0]);
  const kept = new Set<number>();
  if (order.length) kept.add(order[0]![1]);
  const windows = [
    [keep.daily, day, now - keep.daily * 86_400_000],
    [keep.weekly, week, now - keep.weekly * 7 * 86_400_000],
    [keep.monthly, month, monthsBefore(now, keep.monthly)],
  ] as const;
  for (const [n, bucket, since] of windows) {
    const seen = new Set<string>();
    for (const [t, i] of order) {
      if (seen.size >= n || t <= since) break;
      const b = bucket(t);
      if (seen.has(b)) continue;
      seen.add(b);
      kept.add(i);
    }
  }
  return kept;
}

/** "7,4,12" as stored, or the default for anything else. */
export function parseKeep(v: string | undefined | null): Keep {
  const [daily, weekly, monthly] = String(v ?? '').split(',').map(Number);
  const ok = (n: number | undefined, max: number) => n !== undefined && Number.isInteger(n) && n >= 1 && n <= max;
  return ok(daily, KEEP_MAX.daily) && ok(weekly, KEEP_MAX.weekly) && ok(monthly, KEEP_MAX.monthly) ? { daily: daily!, weekly: weekly!, monthly: monthly! } : DEFAULT_KEEP;
}
