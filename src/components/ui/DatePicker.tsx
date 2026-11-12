// DatePicker: a family date. The stored value is the archive's partial date ("1953", "1953-08", "1953-08-08", "~" for
// about), and the picker never asks for more than the reader knows.
//
//   <DatePicker label="Born" value={born} onChange={setBorn} notAfter={today} showAge />
//   <DatePicker label="Died" value={died} onChange={setDied} notBefore={born} notBeforeWhat={t('date.whatBirth')} />
//   <DatePicker label="From" value={from} onChange={setFrom} precisions={['year']} />
//
// - Precision: "Exact day", "Month" or "Year only" (`precisions` limits the choice), and an "About" switch for `~`.
// - Segments: day, month and year in the reader's order (`dateOrder` of the language: day first, but year first in
//   Japanese and Chinese). English names the month in a list; every other language types it as a number, as the app writes
//   dates, with the language's separator. Digits move the focus on; a separator does too;
//   a whole date pasted or typed into any segment ("8.8.1953", "8. August 1953", "1953-08-08") fills them all. ↑/↓ change
//   a segment, Shift+↑/↓ or PageUp/PageDown move the year by ten.
// - Calendar: opens under the field, and as a bottom sheet on a phone. Month is a list, the year a grid of twelve that
//   pages by 12 or by 100 years. The grid takes the arrow keys, Home/End (the week), PageUp/PageDown (month) and
//   Shift+PageUp/PageDown (year). The footer sets "only the year" or "only the month" of the month shown.
// - Checks: a real calendar date, nothing after `notAfter`, nothing before `notBefore`. A partial date is refused only
//   when the whole period it covers falls outside the bounds. The messages are translated and shown under the field.
// - Controlled: `value` is the stored string. An incomplete segment reports a string that is never a valid date, so a
//   form refuses to save it, while the picker keeps what is typed on screen.
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import {
  Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent,
  type ReactNode, type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { LANGUAGES, useT, type Locale } from '~/lib/i18n';
import type { Language } from '~/lib/i18n/languages';
import {
  birthdayInfo, composeParts, daysIn, displayDate, emptyParts, isoOfDate, monthNames, parseTyped, partsForValue,
  partsIssue, partsOfDay, periodOf, storedIssue, weekdayNames, withPrecision, type DateIssue, type DateParts, type Precision,
} from '~/lib/partial-date';
import { Select } from './Select';
import { Switch } from './Switch';
import { Segmented } from './Segmented';
import './datepicker.css';

export interface DatePickerProps {
  /** The stored partial date; '' for none. */
  value: string;
  onChange: (value: string) => void;
  /** The visible label. */
  label: ReactNode;
  id?: string;
  /** Which precisions the reader may choose. Default: all three. */
  precisions?: readonly Precision[];
  /** The precision an empty field starts on. Default: exact day (year only when that is the only choice). */
  defaultPrecision?: Precision;
  /** The calendar and the year list start here. Default 100. Typing is never blocked by it. */
  minYear?: number;
  /** The calendar and the year list end here. Default: this year. */
  maxYear?: number;
  /** The latest day allowed, as an ISO day (today for a birth). A later date is refused. */
  notAfter?: string;
  /** A stored date the value may not come before, such as a birth for a death. */
  notBefore?: string;
  /** What `notBefore` is called in a message, translated, such as "the birth". */
  notBeforeWhat?: string;
  /** Show the age and the next birthday once a whole birth date is entered. */
  showAge?: boolean;
  /** Shown faintly in the year field, e.g. the year the person was born: a hint, never a value. */
  yearHint?: string;
  /** An error from the form (for example "Required"), shown when the picker itself has none. */
  error?: string;
  /** Help text under the field. */
  hint?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  /** The first segment, e.g. to focus the field from outside. */
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

type Seg = 'day' | 'month' | 'year';
const ALL: readonly Precision[] = ['day', 'month', 'year'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const SEGMENT: Record<string, Seg> = { d: 'day', m: 'month', y: 'year' };
/** Phone width: the calendar becomes a bottom sheet. Matches the stylesheet. */
const PHONE = '(max-width: 600px)';

const isoOf = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
const isMonthNumber = (s: string) => /^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 12;
/** Day arithmetic in UTC, so no time zone can move a day. */
function addDays(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
/** Monday = 0 … Sunday = 6. */
const weekIndex = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

export function DatePicker({
  value, onChange, label, id, precisions = ALL, defaultPrecision, minYear = 100, maxYear, notAfter, notBefore,
  notBeforeWhat, showAge = false, yearHint, error, hint, disabled = false, required = false, autoFocus = false,
  inputRef, className = '',
}: DatePickerProps) {
  const t = useT();
  const locale = t.locale as Locale;
  const uid = useId();
  const labelId = `${id ?? uid}-label`;
  const helpId = `${id ?? uid}-help`;
  const today = isoOfDate(new Date());
  const thisYear = Number(today.slice(0, 4));
  const topYear = Math.max(maxYear ?? thisYear, minYear);
  const onlyYear = precisions.length === 1 && precisions[0] === 'year';
  const fallback: Precision = defaultPrecision ?? (precisions.includes('day') ? 'day' : precisions.includes('month') ? 'month' : 'year');

  // Segments are local, so a half-typed date stays on screen. A value changed from outside (a reset, a rebase) is taken
  // in, with the precision it implies.
  const [st, setSt] = useState<{ value: string; parts: DateParts }>(() => ({ value, parts: partsForValue(value, fallback) }));
  const synced = value === st.value
    ? st
    : { value, parts: value === '' ? emptyParts(st.parts.precision) : partsForValue(value, st.parts.precision) };
  if (synced !== st) setSt(synced);
  const parts = synced.parts;
  const emit = (next: DateParts) => {
    const s = composeParts(next);
    setSt({ value: s, parts: next });
    onChange(s);
  };

  // Checks: the segments first (what is typed), then the whole date against the bounds.
  const lo = notBefore ? periodOf(notBefore)?.from : undefined;
  const composed = composeParts(parts);
  const issue: DateIssue | null = partsIssue(parts) ?? (composed && !composed.includes('?') ? storedIssue(composed, { notAfter, notBefore: lo }) : null);
  const message = (i: DateIssue): string => {
    switch (i) {
      case 'year': return t('date.err.year');
      case 'month': return parts.month === '' ? t('date.err.monthMissing') : t('date.err.month');
      case 'day': return parts.day === '' ? t('date.err.dayMissing') : t('date.err.day');
      case 'future': return t('date.err.future');
      case 'before': return t('date.err.before', { what: notBeforeWhat ?? '', date: displayDate(notBefore ?? '', locale) });
      default: return t('date.err.invalid');
    }
  };
  // While a segment is still being typed, its "not finished" message waits until the reader leaves the picker.
  // A date that cannot be right (a future birth, month 13) is said at once.
  const [focused, setFocused] = useState(false);
  const unfinished = (issue === 'year' && parts.year.length < 3) || (issue === 'day' && parts.day === '') || (issue === 'month' && parts.month === '');
  const hushed = focused && unfinished;
  const shown = issue && !hushed ? message(issue) : !issue ? error : undefined;
  const complete = !issue && !!composed && !composed.includes('?');
  const age = showAge && complete && parts.precision === 'day' && !parts.about ? birthdayInfo(composed, today) : null;
  const hasHelp = !!shown || complete || !!hint;

  // Which segments the precision shows, in reading order.
  const shows = {
    day: parts.precision === 'day',
    month: parts.precision !== 'year',
  };
  // The language's order (day-month-year, or year-month-day), without the segments the precision hides.
  const lang: Language = LANGUAGES[locale];
  const order: Seg[] = [...lang.dateOrder].map((c) => SEGMENT[c]).filter((name) => name === 'year' || shows[name]);
  const root = useRef<HTMLDivElement>(null);
  const segments = useRef<HTMLDivElement>(null);
  const focusSeg = (name: Seg) => requestAnimationFrame(() => {
    const el = segments.current?.querySelector<HTMLElement>(`[data-seg="${name}"]`);
    (el?.tagName === 'INPUT' ? el : el?.querySelector<HTMLElement>('button'))?.focus();
  });

  /** Digits only, at most the segment's length. Typing a separator, or a day that cannot take a second digit, moves on. */
  const typeSegment = (name: Seg, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, name === 'year' ? 4 : 2);
    emit({ ...parts, [name]: digits } as DateParts);
    const separated = raw.length > digits.length && digits.length > 0;
    const next = order[order.indexOf(name) + 1];
    if (!next) return;
    if (name === 'day' && (digits.length === 2 || (digits.length === 1 && Number(digits) > 3) || separated)) focusSeg(next);
    if (name === 'month' && (digits.length === 2 || (digits.length === 1 && Number(digits) > 1) || separated)) focusSeg(next);
    if (name === 'year' && digits.length === 4) focusSeg(next);
  };
  const padSegment = (name: 'day' | 'month') => {
    if (parts[name].length === 1) emit({ ...parts, [name]: pad2(Number(parts[name])) });
  };
  /** A whole date pasted into any segment fills them all, at the precision it has. */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const stored = parseTyped(e.clipboardData.getData('text'), locale);
    if (stored === null) return;
    e.preventDefault();
    const p = partsForValue(stored);
    emit(precisions.includes(p.precision) ? p : withPrecision(p, fallback));
  };
  /** Arrow keys change the segment; the year moves by ten with Shift or PageUp/PageDown. Edges move between segments. */
  const stepSegment = (name: Seg, by: number) => {
    if (name === 'year') {
      const y = Number(parts.year) || thisYear;
      emit({ ...parts, year: String(Math.min(9999, Math.max(100, y + by))) });
    } else if (name === 'month') {
      const m = Number(parts.month) || (by > 0 ? 0 : 1);
      emit({ ...parts, month: pad2(((m - 1 + by + 24) % 12) + 1) });
    } else {
      const y = Number(parts.year) || thisYear;
      const m = isMonthNumber(parts.month) ? Number(parts.month) : 1;
      const max = daysIn(y, m);
      const d = Number(parts.day) || (by > 0 ? 0 : 1);
      emit({ ...parts, day: pad2(((d - 1 + by + max * 2) % max) + 1) });
    }
  };
  const onSegKey = (name: Seg) => (e: KeyboardEvent<HTMLInputElement>) => {
    const i = order.indexOf(name);
    const input = e.currentTarget;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const by = e.key === 'ArrowUp' ? 1 : -1;
      stepSegment(name, name === 'year' && e.shiftKey ? by * 10 : by);
    } else if (name === 'year' && (e.key === 'PageUp' || e.key === 'PageDown')) {
      e.preventDefault();
      stepSegment('year', (e.key === 'PageUp' ? 1 : -1) * 10);
    } else if (e.key === 'Backspace' && input.value === '' && i > 0) {
      e.preventDefault();
      focusSeg(order[i - 1]);
    } else if (e.key === 'ArrowLeft' && input.selectionStart === 0 && i > 0) {
      e.preventDefault();
      focusSeg(order[i - 1]);
    } else if (e.key === 'ArrowRight' && input.selectionEnd === input.value.length && i < order.length - 1) {
      e.preventDefault();
      focusSeg(order[i + 1]);
    }
  };

  // The calendar. Its month, year page and cursor are its own; the parts change only by a choice.
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'days' | 'years'>('days');
  const [view, setView] = useState({ y: thisYear, m: 1 });
  const [cursor, setCursor] = useState({ y: thisYear, m: 1, d: 1 });
  const [yearPage, setYearPage] = useState(thisYear - 6);
  const [pos, setPos] = useState<CSSProperties>({});
  const [sheet, setSheet] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Where focus goes after the next render: into the calendar (on open or a key move), or back to the trigger (on close).
  const focusNext = useRef<'calendar' | 'trigger' | null>(null);

  const clampYear = (y: number) => Math.max(minYear, Math.min(topYear, y));
  const openCalendar = () => {
    setHost((trigger.current?.closest('dialog') as HTMLElement | null) ?? document.body);
    setSheet(window.matchMedia(PHONE).matches);
    const y = /^\d{3,4}$/.test(parts.year) ? clampYear(Number(parts.year)) : clampYear(thisYear);
    const m = isMonthNumber(parts.month) ? Number(parts.month) : Number(today.slice(5, 7));
    const shownToday = y === thisYear && m === Number(today.slice(5, 7));
    const dayShown = parts.precision === 'day' && isMonthNumber(parts.month) && /^\d{1,2}$/.test(parts.day) && Number(parts.day) <= daysIn(y, m);
    const d = dayShown ? Number(parts.day) : shownToday ? Number(today.slice(8, 10)) : 1;
    setView({ y, m });
    setCursor({ y, m, d });
    setYearPage(Math.max(minYear, Math.min(topYear - 11, y - 6)));
    setMode(onlyYear || (!precisions.includes('day') && !precisions.includes('month')) ? 'years' : 'days');
    focusNext.current = 'calendar';
    setOpen(true);
  };
  const closeCalendar = (back: boolean) => {
    if (back) focusNext.current = 'trigger';
    setOpen(false);
  };
  useEffect(() => {
    if (!open) {
      if (focusNext.current === 'trigger') {
        focusNext.current = null;
        requestAnimationFrame(() => trigger.current?.focus());
      }
      return;
    }
    if (focusNext.current === 'calendar') {
      focusNext.current = null;
      pop.current?.querySelector<HTMLElement>('[data-focus]')?.focus({ preventScroll: true });
    }
  }, [open, mode, cursor, view, yearPage]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (window.matchMedia(PHONE).matches) { setPos({}); return; }
      const r = trigger.current?.getBoundingClientRect();
      const el = pop.current;
      if (!r || !el) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
      const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, mode]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const at = e.target as Node;
      if (pop.current?.contains(at) || root.current?.contains(at)) return;
      closeCalendar(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  /** A day chosen in the calendar: an exact date. */
  const pick = (y: number, m: number, d: number) => {
    emit(partsOfDay(y, m, d, parts.about));
    closeCalendar(true);
  };
  const moveCursor = (next: { y: number; m: number; d: number }) => {
    setCursor(next);
    setView({ y: next.y, m: next.m });
    focusNext.current = 'calendar';
  };
  const moveMonth = (n: number) => {
    const t = new Date(Date.UTC(view.y, view.m - 1 + n, 1));
    const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
    if (y < minYear || y > topYear) return;
    setView({ y, m });
    setCursor({ y, m, d: Math.min(cursor.d, daysIn(y, m)) });
    focusNext.current = 'calendar';
  };
  const moveYear = (n: number) => {
    const y = clampYear(view.y + n);
    setView({ y, m: view.m });
    setCursor({ y, m: view.m, d: Math.min(cursor.d, daysIn(y, view.m)) });
    focusNext.current = 'calendar';
  };
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const c = cursor;
    const wd = weekIndex(c.y, c.m, c.d);
    const by = (n: number) => { const next = addDays(c.y, c.m, c.d, n); moveCursor(next); };
    const keys: Record<string, () => void> = {
      ArrowLeft: () => by(-1),
      ArrowRight: () => by(1),
      ArrowUp: () => by(-7),
      ArrowDown: () => by(7),
      Home: () => by(-wd),
      End: () => by(6 - wd),
      PageUp: () => (e.shiftKey ? moveYear(-1) : moveMonth(-1)),
      PageDown: () => (e.shiftKey ? moveYear(1) : moveMonth(1)),
    };
    const act = keys[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  };
  const onPopKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'years' && !onlyYear) { setMode('days'); focusNext.current = 'calendar'; setYearPage(Math.max(minYear, Math.min(topYear - 11, view.y - 6))); return; }
    closeCalendar(true);
  };

  const monthList = monthNames(locale);
  const monthOptions = monthList.map((name, i) => ({ value: pad2(i + 1), label: name }));
  const firstCell = weekIndex(view.y, view.m, 1);
  const cells: (number | null)[] = [...Array(firstCell).fill(null), ...Array.from({ length: daysIn(view.y, view.m) }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const sameDay = (d: number) => parts.precision === 'day' && Number(parts.year) === view.y && Number(parts.month) === view.m && Number(parts.day) === d;
  const dayDisabled = (d: number) => {
    const iso = isoOf(view.y, view.m, d);
    return (notAfter !== undefined && iso > notAfter) || (lo !== undefined && iso < lo);
  };
  const pageFirst = Math.max(minYear, Math.min(yearPage, topYear - 11));
  const pageLast = Math.min(topYear, pageFirst + 11);
  const yearList = Array.from({ length: pageLast - pageFirst + 1 }, (_, i) => pageFirst + i);

  const yearFocus = (y: number) => (y === view.y ? true : y === pageFirst && !yearList.includes(view.y));
  const popover = open && host ? (
    <>
      {sheet && <div className="dp-scrim" aria-hidden onPointerDown={() => closeCalendar(false)} />}
      <div
        ref={pop}
        role="dialog"
        aria-modal="false"
        aria-label={typeof label === 'string' ? label : t('date.chooseDate')}
        className={`dp-pop ${sheet ? 'sheet' : ''}`}
        style={pos}
        onKeyDown={onPopKey}
        onBlur={(e) => {
          // Focus that leaves for somewhere else closes it; a click on a plain part of the calendar does not.
          const next = e.relatedTarget as Node | null;
          if (next && !pop.current?.contains(next) && !trigger.current?.contains(next)) closeCalendar(false);
        }}
      >
        {sheet && <div className="dp-grab" aria-hidden />}
        {mode === 'days' ? (
          <>
            <div className="dp-pop-head">
              <button type="button" className="btn icon ghost dp-nav" aria-label={t('date.prevMonth')} title={t('date.prevMonth')} onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></button>
              <Select
                size="sm"
                aria-label={t('date.month')}
                value={pad2(view.m)}
                options={monthOptions}
                onChange={(v) => { const m = Number(v); setView({ y: view.y, m }); setCursor({ y: view.y, m, d: Math.min(cursor.d, daysIn(view.y, m)) }); }}
                className="dp-month"
              />
              <button
                type="button"
                className="btn dp-year-btn"
                aria-label={`${t('date.pickYear')}: ${view.y}`}
                aria-expanded={false}
                onClick={() => { setYearPage(Math.max(minYear, Math.min(topYear - 11, view.y - 6))); setMode('years'); focusNext.current = 'calendar'; }}
              >
                {view.y}<ChevronDown size={14} aria-hidden />
              </button>
              <button type="button" className="btn icon ghost dp-nav" aria-label={t('date.nextMonth')} title={t('date.nextMonth')} onClick={() => moveMonth(1)}><ChevronRight size={18} /></button>
            </div>
            <div className="dp-grid" role="grid" aria-label={`${monthList[view.m - 1]} ${view.y}`} onKeyDown={onGridKey}>
              <div className="dp-row" role="row">
                {weekdayNames(locale).map((w) => <span key={w} role="columnheader" className="dp-wd" title={w}>{w.slice(0, 2)}</span>)}
              </div>
              {Array.from({ length: cells.length / 7 }, (_, r) => (
                <div key={r} className="dp-row" role="row">
                  {cells.slice(r * 7, r * 7 + 7).map((d, c) => d === null ? (
                    <span key={c} className="dp-cell" role="gridcell" aria-hidden />
                  ) : (
                    <span key={c} className="dp-cell" role="gridcell" aria-selected={sameDay(d) || undefined}>
                      <button
                        type="button"
                        className="dp-day"
                        data-focus={cursor.y === view.y && cursor.m === view.m && cursor.d === d ? '' : undefined}
                        tabIndex={cursor.y === view.y && cursor.m === view.m && cursor.d === d ? 0 : -1}
                        aria-pressed={sameDay(d)}
                        aria-disabled={dayDisabled(d) || undefined}
                        aria-label={displayDate(isoOf(view.y, view.m, d), locale, { weekday: true })}
                        aria-current={isoOf(view.y, view.m, d) === today ? 'date' : undefined}
                        data-today={isoOf(view.y, view.m, d) === today || undefined}
                        onClick={() => { if (!dayDisabled(d)) pick(view.y, view.m, d); }}
                        onFocus={() => { if (cursor.d !== d || cursor.m !== view.m || cursor.y !== view.y) setCursor({ y: view.y, m: view.m, d }); }}
                      >{d}</button>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="dp-pop-head">
              <button type="button" className="btn icon ghost dp-nav" aria-label={t('date.back100')} title={t('date.back100')} disabled={pageFirst <= minYear} onClick={() => setYearPage((p) => Math.max(minYear, p - 100))}><ChevronsLeft size={18} /></button>
              <button type="button" className="btn icon ghost dp-nav" aria-label={t('date.back12')} title={t('date.back12')} disabled={pageFirst <= minYear} onClick={() => setYearPage((p) => Math.max(minYear, p - 12))}><ChevronLeft size={18} /></button>
              <span className="dp-range" aria-live="polite">{pageFirst}–{pageLast}</span>
              <button type="button" className="btn icon ghost dp-nav" aria-label={t('date.fwd12')} title={t('date.fwd12')} disabled={pageLast >= topYear} onClick={() => setYearPage((p) => Math.min(topYear - 11, p + 12))}><ChevronRight size={18} /></button>
              <button type="button" className="btn icon ghost dp-nav" aria-label={t('date.fwd100')} title={t('date.fwd100')} disabled={pageLast >= topYear} onClick={() => setYearPage((p) => Math.min(topYear - 11, p + 100))}><ChevronsRight size={18} /></button>
            </div>
            <div className="dp-years" role="group" aria-label={t('date.pickYear')}>
              {yearList.map((y) => (
                <button
                  key={y}
                  type="button"
                  className="dp-year"
                  data-focus={yearFocus(y) ? '' : undefined}
                  tabIndex={yearFocus(y) ? 0 : -1}
                  aria-pressed={y === view.y}
                  aria-label={String(y)}
                  onClick={() => {
                    setView({ y, m: view.m });
                    setCursor({ y, m: view.m, d: Math.min(cursor.d, daysIn(y, view.m)) });
                    if (onlyYear) { emit({ ...partsOfDay(y, 1, 1, parts.about), precision: 'year', month: '', day: '' }); closeCalendar(true); return; }
                    setMode('days');
                    focusNext.current = 'calendar';
                  }}
                >{y}</button>
              ))}
            </div>
          </>
        )}

        {!onlyYear && (
          <div className="dp-pop-foot">
            {precisions.includes('year') && (
              <button type="button" className="btn" onClick={() => { emit({ ...parts, precision: 'year', year: String(view.y), month: '', day: '' }); closeCalendar(true); }}>
                {t('date.onlyYear', { year: String(view.y) })}
              </button>
            )}
            {precisions.includes('month') && mode === 'days' && (
              <button type="button" className="btn" onClick={() => { emit({ ...parts, precision: 'month', year: String(view.y), month: pad2(view.m), day: '' }); closeCalendar(true); }}>
                {t('date.onlyMonth', { month: monthList[view.m - 1], year: String(view.y) })}
              </button>
            )}
            <span className="spacer" />
            {value !== '' && <button type="button" className="btn ghost" onClick={() => { emit(emptyParts(parts.precision)); closeCalendar(true); }}>{t('date.clear')}</button>}
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <div ref={root} className={`field dp ${className}${issue || error ? ' invalid' : ''}${disabled ? ' disabled' : ''}`} data-precision={parts.precision}>
      <span id={labelId}>{label}{required && <span className="dp-req" aria-hidden> *</span>}</span>
      {precisions.length > 1 && (
        <Segmented
          size="sm"
          aria-labelledby={labelId}
          className="dp-precision"
          value={parts.precision}
          onChange={(p) => emit(withPrecision(parts, p))}
          options={precisions.map((p) => ({ value: p, label: t(p === 'day' ? 'date.exact' : p === 'month' ? 'date.monthOnly' : 'date.yearOnly') }))}
        />
      )}
      <div className="dp-line">
        <div
          ref={segments}
          className="dp-segments"
          role="group"
          aria-labelledby={labelId}
          aria-describedby={hasHelp ? helpId : undefined}
          onFocus={() => setFocused(true)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
        >
          {order.map((name, i) => {
            const first = i === 0;
            const sep = i < order.length - 1 ? <span className="dp-sep" aria-hidden>{lang.dateSeparator}</span> : null;
            if (name === 'month' && lang.monthList) {
              return (
                <span key={name} className="dp-month-wrap" data-seg="month">
                  <Select
                    size="sm"
                    aria-label={t('date.month')}
                    value={isMonthNumber(parts.month) ? pad2(Number(parts.month)) : ''}
                    placeholder={t('date.month')}
                    disabled={disabled}
                    options={monthOptions}
                    onChange={(v) => { emit({ ...parts, month: v }); focusSeg(order[i + 1] ?? 'year'); }}
                    className="dp-month-select"
                  />
                </span>
              );
            }
            return (
              <Fragment key={name}>
                <input
                  ref={first ? inputRef : undefined}
                  data-seg={name}
                  className={`input dp-seg dp-${name[0]}`}
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus={first && autoFocus}
                  disabled={disabled}
                  maxLength={name === 'year' ? 4 : 3}
                  placeholder={name === 'year' ? (yearHint ?? t('date.yyyy')) : t(name === 'day' ? 'date.dd' : 'date.mm')}
                  aria-label={t(name === 'day' ? 'date.day' : name === 'month' ? 'date.month' : 'date.year')}
                  aria-invalid={issue ? true : undefined}
                  value={parts[name]}
                  onChange={(e) => typeSegment(name, e.target.value)}
                  onBlur={name === 'year' ? undefined : () => padSegment(name)}
                  onKeyDown={onSegKey(name)}
                  onPaste={onPaste}
                  onFocus={(e) => e.currentTarget.select()}
                />
                {sep}
              </Fragment>
            );
          })}
        </div>
        <button
          ref={trigger}
          type="button"
          className="btn icon dp-cal"
          aria-label={t('date.openCalendar')}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => (open ? closeCalendar(true) : openCalendar())}
        >
          <CalendarDays size={18} />
        </button>
      </div>

      <div className="dp-foot">
        <Switch size="sm" checked={parts.about} disabled={disabled} onChange={(on) => emit({ ...parts, about: on })}>{t('date.about')}</Switch>
        {/* What the date reads as, in words. A year alone needs no words; "about" is already said by the switch. */}
        {!shown && complete && (parts.precision !== 'year' || parts.about) && (
          <span className="dp-read" aria-hidden={false}>
            {displayDate(composed, locale, { weekday: true })}
            {age && <span className="dp-age">{t('date.ageTurns', { age: String(age.age), turns: String(age.turns), date: displayDate(age.next, locale) })}</span>}
          </span>
        )}
        {shown ? (
          <em id={helpId} className="err dp-msg" role="alert">{shown}</em>
        ) : hint && !complete ? (
          <span id={helpId} className="dp-msg subtle">{hint}</span>
        ) : null}
      </div>
      {popover ? createPortal(popover, host!) : null}
    </div>
  );
}
