import { PageSkeleton, PageHeader, ErrorState, EmptyState } from '~/components/ui';
import { useRouter, createFileRoute, Link } from '@tanstack/react-router';
import { CalendarPlus, Check, Hourglass } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GameIcon, type GameIconName } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { play } from '~/lib/sfx';
import { ancestorDepths, displayName, kinship, partnersOf, type Family, type Kinship } from '~/lib/graph';
import { kinshipLabel, locales, ordinal, translate, useT, type Key, type Locale, type Translator } from '~/lib/i18n';
import type { GPerson } from '~/lib/types';
import '~/styles/almanac.css';
import { useDealt } from '~/lib/dealt';
import { treeTitle } from '~/lib/title';
import { useToday } from '~/lib/clock';

export const Route = createFileRoute('/$tree/almanac')({
  pendingComponent: PageSkeleton,
  errorComponent: function PageError() { const router = useRouter(); const t = useT(); return <div className="page"><PageHeader title={t('almanac.title')} /><ErrorState message={t('almanac.error')} onRetry={() => { void router.invalidate(); }} /></div>; },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'almanac.title')) }] }),
  component: AlmanacPage,
});

// ---------- dates ----------

const FULL = /^(\d{4})-(\d\d)-(\d\d)$/;
const PARTIAL = /^(~?)(\d{3,4})(?:-(\d\d)(?:-(\d\d))?)?$/;
const DAY = 86_400_000;
/** A month's name in the reader's language. */
const monthName = (m: number, locale: Locale, style: 'long' | 'short' = 'long') =>
  new Intl.DateTimeFormat(locales[locale], { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 1)));

function full(d?: string) {
  const m = d && FULL.exec(d);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
function partial(d?: string) {
  const m = d && PARTIAL.exec(d);
  return m ? { approx: !!m[1], y: +m[2], m: m[3] ? +m[3] : undefined, d: m[4] ? +m[4] : undefined } : null;
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY);
/** English ordinals read "1st", "2nd"; the other languages have their own forms. */
const ordOf = (n: number, locale: Locale) => {
  if (locale !== 'en') return ordinal(n, locale);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** The next time month/day comes round, today included. */
function occurrence(m: number, d: number, today: Date): Date {
  for (let y = today.getFullYear(); ; y++) {
    const dt = new Date(y, m - 1, m === 2 && d === 29 && !isLeap(y) ? 28 : d);
    if (dt >= today) return dt;
  }
}

// ---------- the almanac itself ----------

type Kind = 'birthday' | 'anniversary' | 'memorial';
interface Ev {
  key: string;
  kind: Kind;
  date: Date;
  days: number;
  ids: string[];
  /** Age turned, years married, or years since. */
  n: number;
  milestone: boolean;
  note?: Key;
}

const ROUND_AGES = new Set([18, 30, 40, 50, 60, 70, 80, 90, 100]);
const WEDDING: Record<number, Key> = {
  1: 'almanac.wedding.paper', 5: 'almanac.wedding.wood', 10: 'almanac.wedding.tin', 15: 'almanac.wedding.crystal', 20: 'almanac.wedding.china',
  25: 'almanac.wedding.silver', 30: 'almanac.wedding.pearl', 35: 'almanac.wedding.coral', 40: 'almanac.wedding.ruby',
  45: 'almanac.wedding.sapphire', 50: 'almanac.wedding.golden', 55: 'almanac.wedding.emerald', 60: 'almanac.wedding.diamond',
  65: 'almanac.wedding.blue_sapphire', 70: 'almanac.wedding.platinum',
};

/** Everything that comes round again within the next year, soonest first. */
function upcoming(f: Family, today: Date): Ev[] {
  const out: Ev[] = [];
  for (const p of f.graph.people) {
    const b = full(p.born);
    if (p.living && b) {
      const date = occurrence(b.m, b.d, today);
      const n = date.getFullYear() - b.y;
      if (n > 0) out.push({ key: `b:${p.id}`, kind: 'birthday', date, days: daysBetween(date, today), ids: [p.id], n, milestone: ROUND_AGES.has(n) });
    }
    const d = full(p.died);
    if (!p.living && d && d.y >= today.getFullYear() - 30) {
      const date = occurrence(d.m, d.d, today);
      const n = date.getFullYear() - d.y;
      if (n > 0 && n <= 30) out.push({ key: `m:${p.id}`, kind: 'memorial', date, days: daysBetween(date, today), ids: [p.id], n, milestone: n % 10 === 0 });
    }
  }
  for (const u of f.graph.unions) {
    const s = full(u.start);
    if (u.kind !== 'marriage' || !s || u.end) continue;
    if (!f.byId.get(u.a)?.living || !f.byId.get(u.b)?.living) continue;
    const date = occurrence(s.m, s.d, today);
    const n = date.getFullYear() - s.y;
    if (n > 0)
      out.push({
        key: `a:${u.id}`, kind: 'anniversary', date, days: daysBetween(date, today), ids: [u.a, u.b], n,
        milestone: n >= 10 && n % 5 === 0, note: WEDDING[n],
      });
  }
  return out.filter((e) => e.days <= 365).sort((a, b) => a.days - b.days || a.kind.localeCompare(b.kind));
}

type HistType = 'born' | 'died' | 'married';
interface Hist {
  key: string;
  type: HistType;
  ids: string[];
  year: number;
  month: number;
  day?: number;
  approx: boolean;
}

/** Past births, deaths and weddings with at least a month, for "on this day". */
function history(f: Family): Hist[] {
  const out: Hist[] = [];
  const add = (key: string, type: HistType, ids: string[], date?: string) => {
    const p = partial(date);
    if (p?.m) out.push({ key, type, ids, year: p.y, month: p.m, day: p.d, approx: p.approx });
  };
  for (const p of f.graph.people) {
    if (!p.living) {
      add(`hb:${p.id}`, 'born', [p.id], p.born);
      add(`hd:${p.id}`, 'died', [p.id], p.died);
    }
  }
  for (const u of f.graph.unions) {
    if (u.kind !== 'marriage') continue;
    // Living couples still together have their anniversary in the list above.
    if (!u.end && f.byId.get(u.a)?.living && f.byId.get(u.b)?.living) continue;
    add(`hm:${u.id}`, 'married', [u.a, u.b], u.start);
  }
  return out;
}

function groupOf(e: Ev, today: Date, mode: 'soon' | 'month', tr: Translator): { id: string; label: string } {
  if (mode === 'month' || e.days > 60) {
    const y = e.date.getFullYear();
    return { id: `${y}-${e.date.getMonth()}`, label: monthName(e.date.getMonth() + 1, tr.locale) + (y !== today.getFullYear() ? ` ${y}` : '') };
  }
  if (e.days === 0) return { id: 'today', label: tr('almanac.today') };
  const toSunday = 6 - ((today.getDay() + 6) % 7);
  if (e.days <= toSunday) return { id: 'week', label: tr('almanac.week_this') };
  if (e.days <= toSunday + 7) return { id: 'next', label: tr('almanac.week_next') };
  if (e.date.getMonth() === today.getMonth() && e.date.getFullYear() === today.getFullYear()) return { id: 'later', label: tr('almanac.later_month') };
  return groupOf(e, today, 'month', tr);
}

const awayLabel = (n: number, tr: Translator) =>
  n === 0 ? tr('almanac.today') : n === 1 ? tr('almanac.tomorrow') : n < 60 ? tr('almanac.away_days', { count: n }) : tr('almanac.away_months', { count: Math.round(n / 30.4) });

// ---------- .ics ----------

const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
function fold(line: string) {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 72) out.push((i ? ' ' : '') + line.slice(i, i + 72));
  return out.join('\r\n');
}

function buildIcs(f: Family, treeName: string, tr: Translator): { text: string; count: number } {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kindred//Almanac//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(treeName)}`];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  let count = 0;
  const add = (uid: string, d: { y: number; m: number; d: number }, summary: string, description: string) => {
    const next = new Date(Date.UTC(d.y, d.m - 1, d.d + 1));
    const leapDay = d.m === 2 && d.d === 29;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@kindred`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(d.y, d.m, d.d)}`,
      `DTEND;VALUE=DATE:${ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())}`,
      leapDay ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'RRULE:FREQ=YEARLY',
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
    count++;
  };
  for (const p of f.graph.people) {
    const b = full(p.born);
    if (p.living && b) add(`birthday-${p.id}`, b, tr('almanac.ics_birthday', { name: displayName(p, f) }), tr('almanac.ics_born', { year: b.y, tree: treeName }));
  }
  for (const u of f.graph.unions) {
    const s = full(u.start);
    const a = f.byId.get(u.a);
    const b = f.byId.get(u.b);
    if (u.kind !== 'marriage' || !s || u.end || !a?.living || !b?.living) continue;
    add(`anniversary-${u.id}`, s, tr('almanac.ics_anniversary', { a: a.given, b: b.given }), tr('almanac.ics_married', { year: s.y, tree: treeName }));
  }
  lines.push('END:VCALENDAR');
  return { text: lines.map(fold).join('\r\n') + '\r\n', count };
}

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- page ----------

/**
 * The almanac counts from the reader's day, which the server can't know. Until the browser does, the server
 * draws the title alone; then the page (its header date, the month strip and every row) comes in.
 */
function AlmanacPage() {
  const t = useT();
  const today = useToday();
  if (!today) {
    return (
      <div className="page">
        <div className="page-inner alm">
          <PageHeader title={t('almanac.title')} />
        </div>
      </div>
    );
  }
  return <AlmanacView today={today} />;
}

function AlmanacView({ today: startDay }: { today: Date }) {
  const dealt = useDealt();
  const f = useFamily();
  // Kinship ("your aunt's birthday") only once the reader has said who they are.
  const me = useMeChosen();
  const tree = useTreeId();
  const t = useT();
  usePageTrail('almanac', tree, t.locale);
  // Frozen for the life of the page, so rows don't shuffle at midnight under your hands.
  const [today] = useState(startDay);
  const [month, setMonth] = useRememberedState<number | null>(`almanac:${tree}:month`, null);
  const [saved, setSaved] = useState(false);

  const all = useMemo(() => upcoming(f, today), [f, today]);
  const hist = useMemo(() => history(f), [f]);
  const myAnc = useMemo(() => (me ? ancestorDepths(f, me) : new Map<string, number>()), [f, me]);
  const hasLiving = f.graph.people.some((p) => p.living);

  const soon = useMemo(() => all.filter((e) => e.days <= 60), [all]);
  const shown = month === null ? soon : all.filter((e) => e.date.getMonth() + 1 === month);
  const nextBeyond = all.find((e) => e.days > 60);
  const mode = month === null ? 'soon' : 'month';

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; events: Ev[] }>();
    for (const e of shown) {
      const g = groupOf(e, today, mode, t);
      const cur = m.get(g.id) ?? { label: g.label, events: [] };
      cur.events.push(e);
      m.set(g.id, cur);
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, today, mode, t.locale]);

  // Birthdays per month for the strip; for a tree with nobody alive, everything that ever happened.
  const strip = useMemo(() => {
    const counts = new Array<number>(12).fill(0);
    if (hasLiving) {
      for (const p of f.graph.people) {
        const b = p.living ? partial(p.born) : null;
        if (b?.m && !b.approx) counts[b.m - 1]++;
      }
    } else {
      for (const h of hist) counts[h.month - 1]++;
    }
    return counts;
  }, [f, hist, hasLiving]);

  const todayM = today.getMonth() + 1;
  const histMonth = month ?? todayM;
  const onThisDay = hist
    .filter((h) => h.month === todayM && h.day === today.getDate() && !h.approx && h.year < today.getFullYear())
    .sort((a, b) => a.year - b.year);
  const monthHist = hist.filter((h) => h.month === histMonth).sort((a, b) => (a.day ?? 99) - (b.day ?? 99) || a.year - b.year);

  const exportIcs = () => {
    const { text, count } = buildIcs(f, f.graph.tree.name, t);
    if (!count) return;
    download(`${tree}-family-calendar.ics`, 'text/calendar', text);
    play('chime');
    setSaved(true);
    setTimeout(() => setSaved(false), 2400);
  };
  const recurring = hasLiving && (all.length > 0 || f.graph.unions.some((u) => full(u.start)));

  const dateLine = today.toLocaleDateString(locales[t.locale], { weekday: 'long', day: 'numeric', month: 'long' });

  const historyPanel = (
    <section className="alm-today ui-card" aria-labelledby="otd">
      <header>
        <span className="alm-today-date">
          <b>{today.getDate()}</b>
          <i>{monthName(todayM, t.locale, 'short')}</i>
        </span>
        <div>
          <h2 id="otd" className="display">{t('almanac.on_this_day')}</h2>
          <p className="muted">
            {onThisDay.length
              ? t('almanac.otd_things', { count: onThisDay.length, day: today.getDate(), month: monthName(todayM, t.locale) })
              : t('almanac.otd_quiet', { day: today.getDate(), month: monthName(todayM, t.locale) })}
          </p>
        </div>
      </header>
      {onThisDay.length > 0 && (
        <ol className="alm-hist">
          {onThisDay.map((h) => (
            <HistRow key={h.key} h={h} f={f} tree={tree} thisYear={today.getFullYear()} />
          ))}
        </ol>
      )}

    </section>
  );

  const monthPanel = (
    <section className="alm-month-hist" aria-labelledby="mih">
      <h2 id="mih" className="rule">
        {month === null ? t('almanac.month_history') : t('almanac.month_history_named', { month: monthName(month, t.locale) })}
        <span className="chip">{monthHist.length}</span>
      </h2>
      {monthHist.length ? (
        <MonthHistory key={histMonth} hist={monthHist} f={f} tree={tree} thisYear={today.getFullYear()} />
      ) : (
        <p className="muted alm-quiet">{t('almanac.month_quiet', { month: monthName(histMonth, t.locale) })}</p>
      )}
    </section>
  );

  return (
    <div className="page">
      <div className="page-inner alm">
        <PageHeader title={t('almanac.title')} subtitle={<>{dateLine}</>} actions={<>{hasLiving && (
            <button className="btn" onClick={exportIcs} disabled={!recurring} title={t('almanac.ics_title')}>
              {saved ? <Check size={16} /> : <CalendarPlus size={16} />}
              {saved ? t('almanac.saved') : t('almanac.add_calendar')}
            </button>
          )}</>} />

        <div className="alm-strip-wrap">
          <MonthStrip counts={strip} current={todayM} selected={month} onSelect={(m) => setMonth(month === m ? null : m)} noun={hasLiving ? 'almanac.noun.birthday' : 'almanac.noun.event'} />
          <p className="muted alm-strip-cap">
            {hasLiving ? t('almanac.strip_birthdays') : t('almanac.strip_events')}
            {month !== null && (
              <button className="btn ghost" onClick={() => setMonth(null)}>
                {t('almanac.back_today')}
              </button>
            )}
          </p>
        </div>

        {f.graph.people.length === 0 ? <EmptyState title={t('almanac.no_events_title')} text={t('almanac.no_events_text')} /> : !hasLiving ? (
          <div className="alm-solo">
            {historyPanel}
            {monthPanel}
          </div>
        ) : (
          <div className="alm-cols">
            <div className="alm-main">
              {groups.length === 0 ? (
                <div className="alm-empty ui-card">
                  <Hourglass size={26} />
                  <h2 className="display">{month === null ? t('almanac.quiet_title') : t('almanac.nothing_in', { month: monthName(month, t.locale) })}</h2>
                  <p className="muted">
                    {month === null
                      ? t('almanac.quiet_text')
                      : t('almanac.quiet_month_text', { month: monthName(month, t.locale) })}
                  </p>
                  {month === null && nextBeyond && (
                    <p>
                      {t('almanac.next_up')} <EventNames ev={nextBeyond} f={f} tree={tree} /> {awayLabel(nextBeyond.days, t).toLowerCase()},{' '}
                      {nextBeyond.date.toLocaleDateString(locales[t.locale], { day: 'numeric', month: 'long' })}.
                    </p>
                  )}
                </div>
              ) : (
                groups.map(([id, g], gi) => (
                  <section key={id} className="alm-group" data-group={id}>
                    <h2 className="rule">
                      {g.label}
                      <span className="chip">{g.events.length}</span>
                    </h2>
                    <ul className={`alm-list ${gi === 0 ? dealt : ''}`}>
                      {g.events.map((e) => (
                        <EventRow key={e.key} ev={e} f={f} tree={tree} me={me} myAnc={myAnc} />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
            <aside className="alm-aside">
              {historyPanel}
              {monthPanel}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- pieces ----------

/**
 * kinship() recurses forever for someone with no tie to you when you have a partner (graph.ts), so only ask
 * when some tie exists, and treat a stack overflow as "no relation".
 */
function relatedTo(f: Family, anc: Map<string, number>, id: string) {
  for (const a of ancestorDepths(f, id).keys()) if (anc.has(a)) return true;
  return false;
}
function safeKinship(f: Family, me: string, id: string, myAnc: Map<string, number>): Kinship | undefined {
  const tied =
    relatedTo(f, myAnc, id) ||
    partnersOf(f, me).some((s) => relatedTo(f, ancestorDepths(f, s), id)) ||
    partnersOf(f, id).some((s) => relatedTo(f, myAnc, s));
  if (!tied) return undefined;
  try {
    return kinship(f, me, id, myAnc);
  } catch {
    return undefined;
  }
}


function MonthStrip({ counts, current, selected, onSelect, noun }: { counts: number[]; current: number; selected: number | null; onSelect: (m: number) => void; noun: Key }) {
  const t = useT();
  const max = Math.max(1, ...counts);
  // Starts at this month so the strip reads as "the year ahead".
  const order = Array.from({ length: 12 }, (_, i) => ((current - 1 + i) % 12) + 1);
  return (
    <div className="alm-strip" role="group" aria-label={t('almanac.jump_month')}>
      {order.map((m) => {
        const c = counts[m - 1];
        return (
          <button
            key={m}
            className="alm-tile"
            style={{ '--heat': c / max } as React.CSSProperties}
            aria-pressed={selected === m}
            data-current={m === current || undefined}
            data-empty={c === 0 || undefined}
            title={`${monthName(m, t.locale)}: ${c} ${t(noun, { count: c })}`}
            onClick={() => onSelect(m)}
          >
            <span className="alm-tile-m">{monthName(m, t.locale, 'short')}</span>
            <span className="alm-tile-n">{c} <small>{t(noun, { count: c })}</small></span>
            <span className="alm-tile-gauge" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

const ICON: Record<Kind, GameIconName> = { birthday: 'cake-slice', anniversary: 'linked-rings', memorial: 'candle-light' };

function Name({ p, f, tree }: { p?: GPerson; f: Family; tree: string }) {
  const t = useT();
  if (!p) return <>{t('almanac.someone')}</>;
  return (
    <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="alm-name">
      {displayName(p, f)}
    </Link>
  );
}

function EventNames({ ev, f, tree }: { ev: Ev; f: Family; tree: string }) {
  const ps = ev.ids.map((id) => f.byId.get(id));
  return (
    <>
      <Name p={ps[0]} f={f} tree={tree} />
      {ps[1] && (
        <>
          {' & '}
          <Name p={ps[1]} f={f} tree={tree} />
        </>
      )}
    </>
  );
}

function relation(ev: Ev, f: Family, me: string | null, myAnc: Map<string, number>, t: Translator): string | undefined {
  if (!me) return undefined;
  if (ev.ids.includes(me)) return ev.kind === 'birthday' ? t('almanac.rel_birthday') : ev.kind === 'anniversary' ? t('almanac.rel_anniversary') : t('almanac.rel_you');
  const labels = ev.ids.map((id) => safeKinship(f, me, id, myAnc)).filter((x): x is Kinship => !!x).map((k) => kinshipLabel(k, t.locale));
  if (!labels.length) return undefined;
  const uniq = [...new Set(labels)];
  return t('shell.palette.yourKin', { kin: uniq.join(' & ') });
}

function EventRow({ ev, f, tree, me, myAnc }: { ev: Ev; f: Family; tree: string; me: string | null; myAnc: Map<string, number> }) {
  const t = useT();
  const today = ev.days === 0;
  const crowned = ev.milestone && ev.kind === 'birthday';
  const people = ev.ids.map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p);
  const rel = relation(ev, f, me, myAnc, t);
  const what =
    ev.kind === 'birthday'
      ? t('almanac.turns', { count: ev.n })
      : ev.kind === 'anniversary'
        ? ev.note
          ? t('almanac.anniversary_note', { ord: ordOf(ev.n, t.locale), note: t(ev.note) })
          : t('almanac.anniversary', { ord: ordOf(ev.n, t.locale) })
        : t('almanac.years_since', { count: ev.n });
  return (
    <li className="alm-row ui-card" data-kind={ev.kind} data-milestone={ev.milestone || undefined} data-today={today || undefined}>
      <div className="alm-leaf" aria-hidden>
        <i>{monthName(ev.date.getMonth() + 1, t.locale, 'short')}</i>
        <b>{ev.date.getDate()}</b>
      </div>
      <div className="alm-faces">
        {people.slice(0, 2).map((p) => (
          <Portrait key={p.id} person={p} tree={tree} size={46} />
        ))}
      <span className="alm-seal" aria-hidden>
        <GameIcon name={ICON[ev.kind]} size={18} />
      </span>
      </div>

      <div className="alm-text">
        <div className="alm-who">
          <EventNames ev={ev} f={f} tree={tree} />
        </div>
        <div className="alm-what">
          <span className="alm-what-text">{what}</span>
          {ev.milestone && ev.kind !== 'memorial' && (
            <span className="alm-star" title={t('almanac.round_number')}>
              <GameIcon name={crowned ? 'laurel-crown' : 'crown'} size={14} /> {t('almanac.milestone')}
            </span>
          )}
        </div>
      </div>
      <div className="alm-meta">
        {today ? (
          <span className="alm-ribbon">
            <GameIcon name="wax-seal" size={15} /> {t('almanac.today')}
          </span>
        ) : (
          <span className="alm-away">{awayLabel(ev.days, t)}</span>
        )}
        {rel && <span className="alm-rel">{rel}</span>}
      </div>
    </li>
  );
}

const HIST_VERB: Record<HistType, Key> = { born: 'almanac.was_born', died: 'almanac.died', married: 'almanac.married' };

function HistRow({ h, f, tree, thisYear, away, showDay }: { h: Hist; f: Family; tree: string; thisYear: number; away?: number; showDay?: boolean }) {
  const t = useT();
  const ps = h.ids.map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p);
  if (!ps.length) return null;
  const ago = thisYear - h.year;
  return (
    <li className="alm-hrow" data-type={h.type} data-day={showDay || undefined}>
      {showDay && <span className="alm-hday">{h.day ?? '·'}</span>}
      <span className="alm-hyear display">
        {h.approx ? 'c. ' : ''}
        {h.year}
      </span>
      <Portrait person={ps[0]} tree={tree} size={32} frame={false} />
      <span className="alm-htext">
        <Name p={ps[0]} f={f} tree={tree} />
        {h.type === 'married' && ps[1] ? (
          <>
            {' '}
            {t('almanac.married')} <Name p={ps[1]} f={f} tree={tree} />
          </>
        ) : (
          <> {t(HIST_VERB[h.type])}</>
        )}
        <small className="muted">
          {' '}
          {away !== undefined ? `${awayLabel(away, t).toLowerCase()} · ` : ''}
          {t('almanac.years_ago', { count: ago })}
        </small>
      </span>
    </li>
  );
}

function MonthHistory({ hist, f, tree, thisYear }: { hist: Hist[]; f: Family; tree: string; thisYear: number }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const rows = more ? hist : hist.slice(0, 8);
  return (
    <>
      <ol className="alm-hist">
        {rows.map((h) => (
          <HistRow key={h.key} h={h} f={f} tree={tree} thisYear={thisYear} showDay />
        ))}
      </ol>
      {hist.length > 8 && (
        <button className="btn ghost" onClick={() => setMore(!more)}>
          {more ? t('almanac.show_fewer') : t('almanac.show_all', { count: hist.length })}
        </button>
      )}
    </>
  );
}

// Restore after hydration, so stored preferences never change server-rendered markup.
function useRememberedState<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored) as T);

    } catch { /* Private browsing can disable storage. */ }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));

    } catch { /* Keeping filters in memory still works. */ }
  }, [key, value, ready]);
  return [value, setValue];
}
function usePageTrail(page: string, tree: string, locale: Locale) {
  useEffect(() => {
    const key = `kindred:scroll:${tree}:${page}`;
    const restore = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, number>;
        for (const selector of [':root', '.page', '.reg-scroll']) {
          const el = document.querySelector(selector);
          if (el) el.scrollTop = saved[selector] ?? 0;
        }
      } catch {}
    };
    const timer = window.setTimeout(() => { restore(); document.addEventListener('scroll', scroll, true); }, 450);
    const scroll = () => {
      try { sessionStorage.setItem(key, JSON.stringify(Object.fromEntries([':root', '.page', '.reg-scroll'].map((selector) => [selector, document.querySelector(selector)?.scrollTop ?? 0])))); } catch {}
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (!link) return;
      const url = new URL(link.href);
      const person = url.searchParams.get('focus');
      if (person && url.pathname === `/${tree}`) {
        try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree, person, name: link.textContent?.trim() || translate(locale, 'chronicle.your_family') })); } catch {}
      }
    };
    document.addEventListener('click', click, true);
    return () => { clearTimeout(timer); document.removeEventListener('scroll', scroll, true); document.removeEventListener('click', click, true); };
  }, [page, tree, locale]);
}
