// Today's and this week's birthdays and wedding anniversaries, as a card for the Today page: the Almanac's rules
// (the living, with a full date) for the next seven days, and the next one after that when the week is quiet. The
// dates are counted from the reader's own day, so the server draws only the frame (see src/lib/clock.ts).
//
//   <DatesCard tree={tree} />
import { Link } from '@tanstack/react-router';
import { CalendarHeart } from 'lucide-react';
import { useId, useMemo } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { useToday } from '~/lib/clock';
import { useFamily } from '~/lib/family';
import { displayName, type Family } from '~/lib/graph';
import { formatDate, ordinal, useT, type Locale } from '~/lib/i18n';
import './today.css';

const FULL = /^(\d{4})-(\d\d)-(\d\d)$/;
const DAY = 86_400_000;
const WEEK = 7;

/** "9th" in English, as the Almanac writes it; the other languages have their own forms. */
export function nth(n: number, locale: Locale): string {
  if (locale !== 'en') return ordinal(n, locale);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}

export interface DateEvent { key: string; kind: 'birthday' | 'anniversary'; ids: string[]; days: number; date: Date; n: number }

/** The next time a month and day come round, today included; 29 February falls on the 28th in other years. */
function next(month: number, day: number, today: Date): Date {
  for (let y = today.getFullYear(); ; y++) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const d = new Date(y, month - 1, month === 2 && day === 29 && !leap ? 28 : day);
    if (d >= today) return d;
  }
}

/** Birthdays of the living and wedding anniversaries of living couples, the soonest first. */
export function comingUp(f: Family, today: Date): DateEvent[] {
  const out: DateEvent[] = [];
  const add = (key: string, kind: DateEvent['kind'], ids: string[], iso: string | undefined) => {
    const m = iso ? FULL.exec(iso) : null;
    if (!m) return;
    const date = next(+m[2]!, +m[3]!, today);
    const n = date.getFullYear() - +m[1]!;
    if (n > 0) out.push({ key, kind, ids, date, n, days: Math.round((date.getTime() - today.getTime()) / DAY) });
  };
  for (const p of f.graph.people) if (p.living) add(`b:${p.id}`, 'birthday', [p.id], p.born);
  for (const u of f.graph.unions) {
    if (u.kind !== 'marriage' || u.end || !f.byId.get(u.a)?.living || !f.byId.get(u.b)?.living) continue;
    add(`a:${u.id}`, 'anniversary', [u.a, u.b], u.start);
  }
  return out.sort((a, b) => a.days - b.days || a.kind.localeCompare(b.kind));
}

export function DatesCard({ tree }: { tree: string }) {
  const t = useT();
  const f = useFamily();
  const id = useId();
  const today = useToday();
  const all = useMemo(() => (today ? comingUp(f, today) : []), [f, today]);
  const week = all.filter((e) => e.days < WEEK);
  const later = all.find((e) => e.days >= WEEK);
  const when = (e: DateEvent) =>
    e.days === 0 ? t('almanac.today') : e.days === 1 ? t('almanac.tomorrow') : formatDate(e.date, t.locale, { weekday: 'long', year: undefined, month: undefined, day: undefined });
  const names = (e: DateEvent) => e.ids.map((pid) => { const p = f.byId.get(pid); return p ? displayName(p, f) : ''; }).filter(Boolean);

  return (
    <section className="ui-card td-card td-dates" aria-labelledby={`${id}-h`}>
      <h2 className="td-h" id={`${id}-h`}><CalendarHeart size={18} aria-hidden /> {t('today.dates.title')}</h2>
      {today && week.length === 0 && (
        <p className="td-note muted">
          {later
            ? t(later.kind === 'birthday' ? 'today.dates.quiet_next_birthday' : 'today.dates.quiet_next_anniversary', { names: names(later).join(' & '), date: formatDate(later.date, t.locale, { year: undefined }) })
            : t('today.dates.quiet')}
        </p>
      )}
      {week.length > 0 && (
        <ul className="td-date-list">
          {week.map((e) => (
            <li key={e.key} data-today={e.days === 0 || undefined}>
              <span className="td-date-when">{when(e)}</span>
              <span className="td-date-faces" aria-hidden>
                {e.ids.map((pid) => { const p = f.byId.get(pid); return p ? <Portrait key={pid} person={p} tree={tree} size={34} decorative /> : null; })}
              </span>
              <span className="td-date-text">
                <span className="td-date-names">
                  {e.ids.map((pid, i) => {
                    const p = f.byId.get(pid);
                    if (!p) return null;
                    return <span key={pid}>{i > 0 && ' & '}<Link to="/$tree/person/$id" params={{ tree, id: pid }}>{displayName(p, f)}</Link></span>;
                  })}
                </span>
                <span className="muted">
                  <GameIcon name={e.kind === 'birthday' ? 'cake-slice' : 'linked-rings'} size={13} />{' '}
                  {e.kind === 'birthday' ? t('almanac.turns', { count: e.n }) : t('almanac.anniversary', { ord: nth(e.n, t.locale) })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link className="td-more-link" to="/$tree/almanac" params={{ tree }}>{t('today.dates.almanac')}</Link>
    </section>
  );
}
