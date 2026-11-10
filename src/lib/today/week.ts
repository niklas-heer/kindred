// The question of the week: which ISO week a moment falls in, and which of the curated questions a family is asked
// that week. Pure: no clock, no database. The words are in src/lib/i18n/areas/today-questions.ts, one key per id.
import { rng } from '../campaign/rng.ts';

const DAY_MS = 86_400_000;

/** How many curated questions there are: `q01` to `q60`. A new one gets the next number; none is ever renumbered. */
export const QUESTION_COUNT = 60;
export const QUESTION_IDS: readonly string[] = Array.from({ length: QUESTION_COUNT }, (_, i) => `q${String(i + 1).padStart(2, '0')}`);
/** The id kept with an answer to a steward's own question. */
export const CUSTOM = 'custom';

export const WEEK_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

/** The UTC day of a moment, as "2026-11-10". */
export const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** The ISO week a moment falls in (UTC), as "2026-W46". */
export function weekOf(now: Date): string {
  const day = Math.floor(now.getTime() / DAY_MS);
  // 1970-01-01 was a Thursday; ISO weekdays run Monday 1 to Sunday 7.
  const weekday = ((((day + 3) % 7) + 7) % 7) + 1;
  const thursday = new Date((day + 4 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const first = Math.floor(Date.UTC(year, 0, 1) / DAY_MS);
  return `${year}-W${String(Math.floor((day + 4 - weekday - first) / 7) + 1).padStart(2, '0')}`;
}

/** The Monday a week starts on, as a UTC day number. */
function mondayOf(week: string): number {
  const [year, n] = [Number(week.slice(0, 4)), Number(week.slice(6))];
  const jan4 = Math.floor(Date.UTC(year, 0, 4) / DAY_MS);
  const weekday = ((((jan4 + 3) % 7) + 7) % 7) + 1;
  return jan4 - (weekday - 1) + (n - 1) * 7;
}

/** The first day of a week (a Monday, UTC). */
export const weekStart = (week: string) => new Date(mondayOf(week) * DAY_MS);

/** Weeks counted from 1970: one more every Monday, across the turn of a year. */
export const weekNumber = (week: string) => Math.floor((mondayOf(week) + 3) / 7);

/** The `count` weeks before `week`, the latest first. */
export function weeksBefore(week: string, count: number): string[] {
  const monday = mondayOf(week);
  return Array.from({ length: count }, (_, i) => weekOf(new Date((monday - (i + 1) * 7) * DAY_MS)));
}

/** The ids in an order of the family's own, a new one for each time round the list. */
function round(tree: string, cycle: number): string[] {
  const random = rng(`${tree}:question-of-the-week:${cycle}`);
  const ids = [...QUESTION_IDS];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

/**
 * The curated question a family is asked in a week: the same for every member and on every server, different from
 * family to family, and every question once before any comes round again.
 */
export function questionOfWeek(tree: string, week: string): string {
  const n = weekNumber(week);
  const cycle = Math.floor(n / QUESTION_COUNT);
  const at = n - cycle * QUESTION_COUNT;
  const ids = round(tree, cycle);
  // The last question of one round is never the first of the next.
  if (at === 0 && cycle > 0 && round(tree, cycle - 1)[QUESTION_COUNT - 1] === ids[0]) return ids[1]!;
  if (at === 1 && cycle > 0 && round(tree, cycle - 1)[QUESTION_COUNT - 1] === ids[0]) return ids[0]!;
  return ids[at]!;
}
