// The reminder rules, without storage or network: which occasions fall on a day, what a device's reminder says, and
// the choices a device may make. Ported from an earlier family site's push code and aligned with the Almanac:
// birthdays of living people, wedding anniversaries of living couples without an end, and memorial days, from full
// ISO dates only (a year on its own, as protected dates often are, never matches).
import type { Graph, GPerson } from './types';
import { translate, type Key, type Locale } from './i18n/dictionary.ts';
import { fitsPush } from './webpush.ts';

/** Days before the occasion a device can be reminded: on the day, the day before, a week before. */
export const OFFSETS = [0, 1, 7] as const;
export const KINDS = ['birthday', 'wedding', 'memorial'] as const;
export type Offset = (typeof OFFSETS)[number];
export type Kind = (typeof KINDS)[number];

/** Birthdays up to this age only: beyond it a date is a mistake, not a celebration (push.js's rule). */
export const MAX_BIRTHDAY_AGE = 100;
/** Memorial days are remembered for this long, as the Almanac does ("Remembering · n years"). */
export const MAX_MEMORIAL_YEARS = 30;
/** A push service only guarantees about 4 KB: at most this many lines, then a count of the rest. */
export const MAX_LINES = 6;

export interface Occasion { kind: Kind; ids: string[]; years: number }

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A full ISO date, or null. Partial dates ("1950", "~1950-05") are not remembered. */
export function fullDate(value: string | undefined | null): { year: number; month: number; day: number } | null {
  const match = ISO_DAY.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Whether an occasion's date is `target`'s day. A 29 February is remembered on 28 February in other years. */
export function fallsOn(date: { month: number; day: number }, target: Date): boolean {
  const month = target.getUTCMonth() + 1;
  const day = target.getUTCDate();
  if (date.month !== month) return false;
  if (date.day === day) return true;
  return date.month === 2 && date.day === 29 && !leap(target.getUTCFullYear()) && day === 28;
}

/** The name a reminder shows: the name the person goes by now, as the Almanac and the tree do. */
export const displayNameOf = (p: GPerson) => [p.currentGiven ?? p.given, p.currentSurname ?? p.surname].filter(Boolean).join(' ');

/** Birthdays, wedding anniversaries and memorial days on `target` (a UTC day), from the family's graph. */
export function occasionsOn(graph: Pick<Graph, 'people' | 'unions'>, target: Date): Occasion[] {
  const year = target.getUTCFullYear();
  const people = new Map(graph.people.map((p) => [p.id, p]));
  const found: Occasion[] = [];
  for (const p of graph.people) {
    if (p.living) {
      const born = fullDate(p.born);
      if (!born || !fallsOn(born, target)) continue;
      const years = year - born.year;
      if (years > 0 && years <= MAX_BIRTHDAY_AGE) found.push({ kind: 'birthday', ids: [p.id], years });
    } else {
      const died = fullDate(p.died);
      if (!died || !fallsOn(died, target)) continue;
      const years = year - died.year;
      if (years > 0 && years <= MAX_MEMORIAL_YEARS) found.push({ kind: 'memorial', ids: [p.id], years });
    }
  }
  for (const union of graph.unions) {
    if (union.kind !== 'marriage' || union.end) continue;
    const a = people.get(union.a);
    const b = people.get(union.b);
    const start = fullDate(union.start);
    if (!a?.living || !b?.living || !start || !fallsOn(start, target)) continue;
    const years = year - start.year;
    if (years > 0) found.push({ kind: 'wedding', ids: [union.a, union.b], years });
  }
  return found;
}

/** The choices a device made for one family, as the server stores and checks them. */
export interface Choices { offsets: Offset[]; kinds: Kind[] }

/** Validates a device's choices: at least one day and one kind, both from the known sets. Null when they are not. */
export function parseChoices(offsets: unknown, kinds: unknown): Choices | null {
  if (!Array.isArray(offsets) || !Array.isArray(kinds)) return null;
  const days = [...new Set(offsets)];
  const chosen = [...new Set(kinds)];
  if (!days.length || days.some((d) => !(OFFSETS as readonly unknown[]).includes(d))) return null;
  if (!chosen.length || chosen.some((k) => !(KINDS as readonly unknown[]).includes(k))) return null;
  return { offsets: (days as Offset[]).sort((a, b) => a - b), kinds: chosen as Kind[] };
}

const WHEN: Record<Offset, Key> = { 0: 'reminders.push.today', 1: 'reminders.push.tomorrow', 7: 'reminders.push.inAWeek' };
const TEXT: Record<Kind, Key> = { birthday: 'reminders.push.birthday', wedding: 'reminders.push.wedding', memorial: 'reminders.push.memorial' };

export interface ReminderMessage { title: string; body: string; tag: string; url: string }

/**
 * One message per device per day: every chosen occasion at every chosen day, nearest first. Null when nothing is
 * due. `occasionsByOffset` holds the occasions for each offset's day, already worked out from the family's graph.
 */
export function reminderMessage(
  { tree, locale, choices, day }: { tree: string; locale: Locale; choices: Choices; day: string },
  occasionsByOffset: ReadonlyMap<number, Occasion[]>,
  names: ReadonlyMap<string, string>,
): ReminderMessage | null {
  const lines: string[] = [];
  let only: Occasion | undefined;
  let count = 0;
  for (const offset of choices.offsets) {
    for (const occasion of occasionsByOffset.get(offset) ?? []) {
      if (!choices.kinds.includes(occasion.kind)) continue;
      only ??= occasion;
      count += 1;
      const people = occasion.ids.map((id) => names.get(id) ?? id);
      const vars = { years: occasion.years, name: people[0] ?? '', names: people.join(' & ') };
      lines.push(`${translate(locale, WHEN[offset])}: ${translate(locale, TEXT[occasion.kind], vars)}`);
    }
  }
  if (!lines.length || !only) return null;
  const lead: Occasion = only;
  const title = translate(locale, 'reminders.push.title');
  const message = (body: string): ReminderMessage => ({
    title,
    body,
    tag: `kindred-${tree}-${day}`,
    // One occasion opens its person; several open the Almanac, which lists them all.
    url: count === 1 ? `/${tree}?sel=${encodeURIComponent(lead.ids[0])}` : `/${tree}/almanac`,
  });
  // The lines shown, then one count line for the rest. Fewer lines are shown when the message is over the push budget
  // (measured in UTF-8 bytes of its JSON, the encryption's own overhead included); a single line that is still too long
  // is cut between characters, never inside one.
  const bodyOf = (shown: number) => {
    const hidden = lines.length - shown;
    return (hidden > 0 ? [...lines.slice(0, shown), translate(locale, 'reminders.push.more', { count: hidden })] : lines.slice(0, shown)).join('\n');
  };
  let shown = lines.length > MAX_LINES ? MAX_LINES - 1 : lines.length;
  while (shown > 1 && !fitsPush(message(bodyOf(shown)))) shown -= 1;
  const full = message(bodyOf(shown));
  return fitsPush(full) ? full : { ...full, body: longestFitting(full.body, (body) => fitsPush(message(body))) };
}

/** The longest prefix of `text` that `fits` accepts, cut between code points so that no character is split. */
function longestFitting(text: string, fits: (candidate: string) => boolean): string {
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(chars.slice(0, mid).join(''))) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join('');
}

/** The message a device gets from its "Test" button: the same shape as a reminder, with nothing from the family. */
export function testMessage(tree: string, locale: Locale): ReminderMessage {
  return { title: translate(locale, 'reminders.push.title'), body: translate(locale, 'reminders.push.testBody'), tag: `kindred-test-${tree}`, url: `/${tree}` };
}

/**
 * The UTC calendar day a run is for, as YYYY-MM-DD. Days are counted in UTC, not in each device's zone. The run is at
 * 06:00 UTC, which is the same morning for most of the world but the evening before for a device far west of UTC: a
 * device at UTC-10 gets "Today" for a birthday at about 20:00 the evening before its local day.
 */
export const dayKey = (date: Date) => date.toISOString().slice(0, 10);
