// Partial dates for the date picker: the stored shape is the archive's (see dates.ts): "1953", "1953-08",
// "1953-08-08", with "~" in front for "about". Nothing here changes that format. The picker works on parts
// (day, month, year, a precision and the about flag) and turns them into the stored string; the reverse
// reads a stored string back into parts. Free text ("8. August 1953", "08.08.1953", "c. 1200") is read in
// the reader's language too. No React here, so the test runner loads it.
import { formatDate, locales, namesInEveryLanguage, tablesVersion, type Locale } from './i18n/dictionary.ts';
import { LANGUAGES, type Language } from './i18n/languages.ts';
import { validDate } from './dates.ts';

/** How much of the date is known: a day, a month of a year, or the year alone. */
export type Precision = 'day' | 'month' | 'year';

/** A date as the picker edits it. Segments are text, so a half-typed segment is representable. */
export interface DateParts {
  about: boolean;
  precision: Precision;
  year: string;
  month: string;
  day: string;
}

/** Why a date is not acceptable as it stands. `incomplete` is a segment still to fill in. */
export type DateIssue = 'year' | 'month' | 'day' | 'future' | 'before' | 'invalid';

const SHAPE = /^(~?)(\d{3,4})(?:-(\d\d)(?:-(\d\d))?)?$/;
const pad2 = (n: number) => String(n).padStart(2, '0');

export const emptyParts = (precision: Precision = 'day'): DateParts => ({ about: false, precision, year: '', month: '', day: '' });

/** The parts of a stored partial date. '' is an empty date; anything else that is not stored shape gives null. */
export function partsOf(stored: string, precision: Precision = 'day'): DateParts | null {
  const s = (stored ?? '').trim();
  if (s === '') return emptyParts(precision);
  const m = SHAPE.exec(s);
  if (!m) return null;
  const [, about, year, month, day] = m;
  return {
    about: about === '~',
    precision: day !== undefined ? 'day' : month !== undefined ? 'month' : 'year',
    year,
    month: month ?? '',
    day: day ?? '',
  };
}

/** The stored string for some parts. Empty when nothing is typed; a segment still missing reads "??", which is never valid. */
export function composeParts(p: DateParts): string {
  if (!p.year && !p.month && !p.day) return '';
  // A year is stored as it is written: "886" stays "886", as the archive has it. Comparisons pad (see periodOf).
  const y = /^\d{3,4}$/.test(p.year) ? p.year : '????';
  const about = p.about ? '~' : '';
  if (p.precision === 'year') return `${about}${y}`;
  const m = isMonth(p.month) ? pad2(Number(p.month)) : '??';
  if (p.precision === 'month') return `${about}${y}-${m}`;
  const d = isDay(p.month, p.day, p.year) ? pad2(Number(p.day)) : '??';
  return `${about}${y}-${m}-${d}`;
}

const isMonth = (s: string) => /^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 12;
const isDay = (month: string, day: string, year: string) => {
  if (!/^\d{1,2}$/.test(day) || Number(day) < 1) return false;
  if (!/^\d{3,4}$/.test(year) || !isMonth(month)) return Number(day) >= 1 && Number(day) <= 31;
  return Number(day) <= daysIn(Number(year), Number(month));
};

/** Days in a month, leap years included. Years are at least 100 here, so Date.UTC keeps them as they are. */
export const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The first problem with the parts as typed, or null when they are a date (or nothing). */
export function partsIssue(p: DateParts): DateIssue | null {
  if (!p.year && !p.month && !p.day) return null;
  if (!/^\d{3,4}$/.test(p.year)) return 'year';
  if (p.precision === 'year') return null;
  if (!isMonth(p.month)) return 'month';
  if (p.precision === 'month') return null;
  if (!/^\d{1,2}$/.test(p.day) || !isDay(p.month, p.day, p.year)) return 'day';
  return null;
}

/** The earliest and latest day a stored date could be: "1953" is 1953-01-01 to 1953-12-31. Null when not a valid date. */
export function periodOf(stored: string): { from: string; to: string } | null {
  if (!validDate(stored)) return null;
  const m = SHAPE.exec(stored.trim());
  if (!m) return null;
  const y = m[2].padStart(4, '0');
  if (m[3] === undefined) return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (m[4] === undefined) {
    const mo = m[3];
    return { from: `${y}-${mo}-01`, to: `${y}-${mo}-${pad2(daysIn(Number(y), Number(mo)))}` };
  }
  const day = `${y}-${m[3]}-${m[4]}`;
  return { from: day, to: day };
}

/** The ISO day for a local Date, the way the reader's calendar sees it (not UTC). */
export const isoOfDate = (d: Date) => `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * The first problem with a stored date, for the form's validators and the picker's messages. `notAfter` is the latest
 * day allowed (today for a birth), `notBefore` the earliest (the birth, for a death). A partial date is only refused when
 * the whole period falls outside the bounds: "1953" is not too late for a birth on 8 August 1953.
 */
export function storedIssue(stored: string, bounds: { notAfter?: string; notBefore?: string } = {}): DateIssue | null {
  const s = (stored ?? '').trim();
  if (s === '') return null;
  const period = periodOf(s);
  if (!period) return 'invalid';
  if (bounds.notAfter && period.from > bounds.notAfter) return 'future';
  if (bounds.notBefore && period.to < bounds.notBefore) return 'before';
  return null;
}

/** The reader's words for a date, in the reader's order and language: "8 August 1953", "c. 1200". Empty for no date. */
export function displayDate(stored: string, locale: Locale, opts: { weekday?: boolean } = {}): string {
  if (!stored) return '';
  const p = partsOf(stored);
  const weekday = opts.weekday && p?.precision === 'day';
  return formatDate(stored, locale, weekday ? { weekday: 'long' } : undefined);
}

/** The month names of a locale, January first. */
export function monthNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(locales[locale], { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2000, i, 15))));
}

/** Weekday headers, Monday first, short form, in the locale. */
export function weekdayNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(locales[locale], { weekday: 'short', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

/** A full date's age today and the next birthday: "turns 74 on 8 August 2027". Null unless the date is a whole day. */
export function birthdayInfo(stored: string, today: string): { age: number; turns: number; next: string } | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(stored);
  if (!m || !validDate(stored)) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = /^(\d{4})-(\d\d)-(\d\d)$/.exec(today);
  if (!t) return null;
  const [ty, tm, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  // The next birthday after today: this year's if it is still ahead, else next year's. A 29 February birthday falls
  // on 28 February in a year without one. On the birthday itself `age` already counts the new year, so it is the
  // one after that which is next.
  const onYear = (year: number) => {
    const day = mo === 2 && d === 29 && daysIn(year, 2) < 29 ? 28 : d;
    return `${String(year).padStart(4, '0')}-${pad2(mo)}-${pad2(day)}`;
  };
  const thisYear = onYear(ty);
  const next = thisYear > today ? thisYear : onYear(ty + 1);
  return { age, turns: age + 1, next };
}

/** Accents and dots folded, so typed month names match whatever the reader wrote. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[.,]/g, '').trim().toLowerCase();

/** The words that mean "about" before a typed date, in every language this page has (date.aboutWords), and "~". */
let about: { version: number; re: RegExp } | undefined;
function aboutWords(): RegExp {
  const version = tablesVersion();
  if (about?.version === version) return about.re;
  const words = ['~', ...namesInEveryLanguage('date.aboutWords').flatMap((list) => list.split(','))].map((w) => w.trim()).filter(Boolean);
  const re = new RegExp(`^(${[...new Set(words)].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*`, 'iu');
  about = { version, re };
  return re;
}

/** Month number for a typed name: the locale's own names first, then English, from three letters on. */
function monthNumber(word: string, locale: Locale): number | null {
  const w = fold(word);
  if (w.length < 3) return null;
  for (const names of [monthNames(locale), monthNames('en')]) {
    const exact = names.findIndex((n) => fold(n) === w);
    if (exact >= 0) return exact + 1;
    const prefix = names.findIndex((n) => fold(n).startsWith(w));
    if (prefix >= 0) return prefix + 1;
  }
  return null;
}

/**
 * Reads a date typed as text into the stored form, or null when it is not a real date. Accepted: "1953", "~1953",
 * "c. 1953", "1953-08", "1953-08-08", "1953/8/8", "1953年8月8日", "08.1953", "8.8.1953" and "08/08/1953" (day first
 * unless the language writes month first), and a month name in the reader's language or English: "8. August 1953",
 * "8 Augustus 1953", "August 1953".
 */
export function parseTyped(text: string, locale: Locale = 'en'): string | null {
  let s = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let about = false;
  const lead = aboutWords().exec(s);
  if (lead) {
    about = true;
    s = s.slice(lead[0].length);
  }
  const pre = about ? '~' : '';
  const done = (y: string, m: string | null, d: string | null) => {
    const stored = pre + y + (m !== null ? `-${pad2(Number(m))}` : '') + (d !== null ? `-${pad2(Number(d))}` : '');
    return validDate(stored) ? stored : null;
  };
  let hit: RegExpExecArray | null;
  if ((hit = /^(\d{3,4})$/.exec(s))) return done(hit[1], null, null);
  if ((hit = /^(\d{3,4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s))) return done(hit[1], hit[2], hit[3] ?? null);
  // Year first, as Japanese and Chinese write it: "1953/8/8", "1953.8.8", "1953年8月8日", "1953年8月".
  if ((hit = /^(\d{4})[./](\d{1,2})(?:[./](\d{1,2}))?$/.exec(s))) return done(hit[1], hit[2], hit[3] ?? null);
  if ((hit = /^(\d{3,4})年\s*(\d{1,2})月(?:\s*(\d{1,2})日?)?$/u.exec(s))) return done(hit[1], hit[2], hit[3] ?? null);
  // Numbers in the language's order: "8.8.1953" (day first), "8/9/1953" (month first in a language that writes it so).
  if ((hit = /^(\d{1,2})[./\- ](\d{1,2})[./\- ](\d{3,4})$/.exec(s))) return (LANGUAGES[locale] as Language).dateOrder === 'mdy' ? done(hit[3], hit[1], hit[2]) : done(hit[3], hit[2], hit[1]);
  if ((hit = /^(\d{1,2})[./-](\d{3,4})$/.exec(s))) return done(hit[2], hit[1], null);
  if ((hit = /^(\d{1,2})\.? ([\p{L}.]+),? (\d{3,4})$/u.exec(s))) {
    const m = monthNumber(hit[2], locale);
    return m === null ? null : done(hit[3], String(m), hit[1]);
  }
  if ((hit = /^([\p{L}.]+),? (\d{3,4})$/u.exec(s))) {
    const m = monthNumber(hit[1], locale);
    return m === null ? null : done(hit[2], String(m), null);
  }
  return null;
}

/** The parts a stored date shows as, for a picker that starts from a stored value. Unknown text gives empty parts. */
export function partsForValue(stored: string, precision: Precision = 'day'): DateParts {
  return partsOf(stored, precision) ?? emptyParts(precision);
}

/** Changing precision keeps what is typed where it still shows, and clears what the new precision hides. */
export function withPrecision(p: DateParts, precision: Precision): DateParts {
  if (precision === 'year') return { ...p, precision, month: '', day: '' };
  if (precision === 'month') return { ...p, precision, day: '' };
  return { ...p, precision };
}

/** The parts of a whole day, as the calendar picks it. */
export function partsOfDay(year: number, month: number, day: number, about = false): DateParts {
  return { about, precision: 'day', year: String(year), month: pad2(month), day: pad2(day) };
}
