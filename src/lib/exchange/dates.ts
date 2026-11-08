// Dates between Kindred and GEDCOM. Kindred stores partial dates ("1953", "1953-08", "1953-08-08") and a
// "~" for about ("~1953"). GEDCOM writes "1953", "AUG 1953", "8 AUG 1953", and "ABT" for about. Ranges and
// "before"/"after" have no Kindred form: they are kept as about their nearest year, and the reader is told.
import { validDate } from '../dates.ts';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A Kindred date as GEDCOM writes it. `~1953-08-08` → `ABT 8 AUG 1953`. */
export function toGedcomDate(date: string): string {
  const approx = date.startsWith('~');
  const [year, month, day] = (approx ? date.slice(1) : date).split('-');
  const parts: string[] = [];
  if (day) parts.push(String(Number(day)));
  if (month) parts.push(MONTHS[Number(month) - 1]);
  parts.push(year);
  return `${approx ? 'ABT ' : ''}${parts.join(' ')}`;
}

export interface ParsedDate {
  /** A Kindred date, or null when the text is not one Kindred can store. */
  date: string | null;
  /** Why the date was changed or dropped, for the reader's report. */
  note?: string;
}

/** A GEDCOM DATE value as a Kindred date. Calendar-invalid dates (31 FEB) are dropped with a note. */
export function fromGedcomDate(text: string): ParsedDate {
  let s = text.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!s) return { date: null };
  const shown = text.trim();
  let approx = false;
  let note: string | undefined;

  const about = /^(ABT|CAL|EST)\s+(.*)$/.exec(s);
  const before = /^(BEF|AFT)\s+(.*)$/.exec(s);
  const between = /^BET\s+(.+?)\s+AND\s+(.+)$/.exec(s);
  const from = /^FROM\s+(.+?)(?:\s+TO\s+.+)?$/.exec(s);
  if (about) {
    approx = true;
    s = about[2];
  } else if (before) {
    approx = true;
    note = `"${shown}" read as about ${before[2]}`;
    s = before[2];
  } else if (between) {
    approx = true;
    note = `"${shown}" read as about its earlier year`;
    s = between[1];
  } else if (from) {
    approx = true;
    note = `"${shown}" read as about its start`;
    s = from[1];
  }

  const m = /^(?:(\d{1,2})\s)?(?:([A-Z]{3})\s)?(\d{3,4})$/.exec(s);
  if (!m) return { date: null, note: `"${shown}" is not a date Kindred can store` };
  const [, day, mon, year] = m;
  if (day && !mon) return { date: null, note: `"${shown}" has a day but no month` };
  let iso = year;
  if (mon) {
    const i = MONTHS.indexOf(mon);
    if (i < 0) return { date: null, note: `"${shown}" has an unknown month` };
    iso += `-${String(i + 1).padStart(2, '0')}`;
  }
  if (day) iso += `-${day.padStart(2, '0')}`;
  if (!validDate(iso)) return { date: null, note: `"${shown}" is not a real date` };
  return note ? { date: (approx ? '~' : '') + iso, note } : { date: (approx ? '~' : '') + iso };
}
