import { PageSkeleton, PageHeader, ErrorState, EmptyState } from '~/components/ui';
import { useRouter, createFileRoute, Link } from '@tanstack/react-router';
import { CalendarPlus, Check, Hourglass } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GameIcon, type GameIconName } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { play } from '~/lib/sfx';
import { ancestorDepths, displayName, kinship, partnersOf, type Family } from '~/lib/graph';
import type { GPerson } from '~/lib/types';
import '~/styles/almanac.css';
import { sectionHead } from '~/lib/title';

export const Route = createFileRoute('/$tree/almanac')({
  pendingComponent: PageSkeleton,
  errorComponent: function PageError() { const router = useRouter(); return <div className="page"><PageHeader title="Almanac" /><ErrorState message="This page could not be loaded." onRetry={() => { void router.invalidate(); }} /></div>; },
  head: sectionHead('Almanac'),
  component: AlmanacPage,
});

// ---------- dates ----------

const FULL = /^(\d{4})-(\d\d)-(\d\d)$/;
const PARTIAL = /^(~?)(\d{3,4})(?:-(\d\d)(?:-(\d\d))?)?$/;
const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function full(d?: string) {
  const m = d && FULL.exec(d);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
function partial(d?: string) {
  const m = d && PARTIAL.exec(d);
  return m ? { approx: !!m[1], y: +m[2], m: m[3] ? +m[3] : undefined, d: m[4] ? +m[4] : undefined } : null;
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY);
const ord = (n: number) => {
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
  note?: string;
}

const ROUND_AGES = new Set([18, 30, 40, 50, 60, 70, 80, 90, 100]);
const WEDDING: Record<number, string> = {
  1: 'paper', 5: 'wood', 10: 'tin', 15: 'crystal', 20: 'china', 25: 'silver', 30: 'pearl', 35: 'coral', 40: 'ruby',
  45: 'sapphire', 50: 'golden', 55: 'emerald', 60: 'diamond', 65: 'blue sapphire', 70: 'platinum',
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

function groupOf(e: Ev, today: Date, mode: 'soon' | 'month'): { id: string; label: string } {
  if (mode === 'month' || e.days > 60) {
    const y = e.date.getFullYear();
    return { id: `${y}-${e.date.getMonth()}`, label: MONTHS[e.date.getMonth()] + (y !== today.getFullYear() ? ` ${y}` : '') };
  }
  if (e.days === 0) return { id: 'today', label: 'Today' };
  const toSunday = 6 - ((today.getDay() + 6) % 7);
  if (e.days <= toSunday) return { id: 'week', label: 'This week' };
  if (e.days <= toSunday + 7) return { id: 'next', label: 'Next week' };
  if (e.date.getMonth() === today.getMonth() && e.date.getFullYear() === today.getFullYear()) return { id: 'later', label: 'Later this month' };
  return groupOf(e, today, 'month');
}

const awayLabel = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 60 ? `in ${n} days` : `in ${Math.round(n / 30.4)} months`);

// ---------- .ics ----------

const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
function fold(line: string) {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 72) out.push((i ? ' ' : '') + line.slice(i, i + 72));
  return out.join('\r\n');
}

function buildIcs(f: Family, treeName: string): { text: string; count: number } {
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
    if (p.living && b) add(`birthday-${p.id}`, b, `${displayName(p, f)}'s birthday`, `Born ${b.y}. From the ${treeName} family tree.`);
  }
  for (const u of f.graph.unions) {
    const s = full(u.start);
    const a = f.byId.get(u.a);
    const b = f.byId.get(u.b);
    if (u.kind !== 'marriage' || !s || u.end || !a?.living || !b?.living) continue;
    add(`anniversary-${u.id}`, s, `${a.given} & ${b.given}: wedding anniversary`, `Married ${s.y}. From the ${treeName} family tree.`);
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

function AlmanacPage() {
  const f = useFamily();
  // Kinship ("your aunt's birthday") only once the reader has said who they are.
  const me = useMeChosen();
  const tree = useTreeId();
  usePageTrail('almanac', tree);
  // Frozen for the life of the page, so rows don't shuffle at midnight under your hands.
  const [today] = useState(() => startOfDay(new Date()));
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
      const g = groupOf(e, today, mode);
      const cur = m.get(g.id) ?? { label: g.label, events: [] };
      cur.events.push(e);
      m.set(g.id, cur);
    }
    return [...m.entries()];
  }, [shown, today, mode]);

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
    const { text, count } = buildIcs(f, f.graph.tree.name);
    if (!count) return;
    download(`${tree}-family-calendar.ics`, 'text/calendar', text);
    play('chime');
    setSaved(true);
    setTimeout(() => setSaved(false), 2400);
  };
  const recurring = hasLiving && (all.length > 0 || f.graph.unions.some((u) => full(u.start)));

  const dateLine = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const historyPanel = (
    <section className="alm-today ui-card" aria-labelledby="otd">
      <header>
        <span className="alm-today-date">
          <b>{today.getDate()}</b>
          <i>{MONTHS[todayM - 1].slice(0, 3)}</i>
        </span>
        <div>
          <h2 id="otd" className="display">On this day</h2>
          <p className="muted">
            {onThisDay.length
              ? `${onThisDay.length} ${onThisDay.length === 1 ? 'thing' : 'things'} happened on ${today.getDate()} ${MONTHS[todayM - 1]} in family history`
              : `Nothing is recorded for ${today.getDate()} ${MONTHS[todayM - 1]}. A quiet day in the family.`}
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
        {month === null ? 'This month in history' : `${MONTHS[month - 1]} in history`}
        <span className="chip">{monthHist.length}</span>
      </h2>
      {monthHist.length ? (
        <MonthHistory key={histMonth} hist={monthHist} f={f} tree={tree} thisYear={today.getFullYear()} />
      ) : (
        <p className="muted alm-quiet">Nothing is recorded for {MONTHS[histMonth - 1]} yet.</p>
      )}
    </section>
  );

  return (
    <div className="page">
      <div className="page-inner alm">
        <PageHeader title="Almanac" subtitle={<>{dateLine}</>} actions={<>{hasLiving && (
            <button className="btn" onClick={exportIcs} disabled={!recurring} title="Download every birthday and wedding anniversary as a yearly calendar (.ics)">
              {saved ? <Check size={16} /> : <CalendarPlus size={16} />}
              {saved ? 'Calendar file saved' : 'Add to calendar'}
            </button>
          )}</>} />

        <div className="alm-strip-wrap">
          <MonthStrip counts={strip} current={todayM} selected={month} onSelect={(m) => setMonth(month === m ? null : m)} noun={hasLiving ? 'birthday' : 'event'} />
          <p className="muted alm-strip-cap">
            {hasLiving ? 'Birthdays through the year' : 'Births, deaths and weddings through the year'}
            {month !== null && (
              <button className="btn ghost" onClick={() => setMonth(null)}>
                Back to today
              </button>
            )}
          </p>
        </div>

        {f.graph.people.length === 0 ? <EmptyState title="No family events yet" text="Add people and dates from the family tree to start your calendar." /> : !hasLiving ? (
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
                  <h2 className="display">{month === null ? 'A quiet stretch' : `Nothing in ${MONTHS[month - 1]}`}</h2>
                  <p className="muted">
                    {month === null
                      ? 'No birthdays, anniversaries or remembrances in the next 60 days.'
                      : `No birthdays or anniversaries fall in ${MONTHS[month - 1]}.`}
                  </p>
                  {month === null && nextBeyond && (
                    <p>
                      Next up: <EventNames ev={nextBeyond} f={f} tree={tree} /> {awayLabel(nextBeyond.days)},{' '}
                      {nextBeyond.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.
                    </p>
                  )}
                </div>
              ) : (
                groups.map(([id, g]) => (
                  <section key={id} className="alm-group" data-group={id}>
                    <h2 className="rule">
                      {g.label}
                      <span className="chip">{g.events.length}</span>
                    </h2>
                    <ul className="alm-list">
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
function safeKinship(f: Family, me: string, id: string, myAnc: Map<string, number>): string | undefined {
  const tied =
    relatedTo(f, myAnc, id) ||
    partnersOf(f, me).some((s) => relatedTo(f, ancestorDepths(f, s), id)) ||
    partnersOf(f, id).some((s) => relatedTo(f, myAnc, s));
  if (!tied) return undefined;
  try {
    return kinship(f, me, id, myAnc)?.label;
  } catch {
    return undefined;
  }
}


function MonthStrip({ counts, current, selected, onSelect, noun }: { counts: number[]; current: number; selected: number | null; onSelect: (m: number) => void; noun: string }) {
  const max = Math.max(1, ...counts);
  // Starts at this month so the strip reads as "the year ahead".
  const order = Array.from({ length: 12 }, (_, i) => ((current - 1 + i) % 12) + 1);
  return (
    <div className="alm-strip" role="group" aria-label="Jump to a month">
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
            title={`${MONTHS[m - 1]}: ${c} ${noun}${c === 1 ? '' : 's'}`}
            onClick={() => onSelect(m)}
          >
            <span className="alm-tile-m">{MONTHS[m - 1].slice(0, 3)}</span>
            <span className="alm-tile-n">{c} <small>{noun}{c === 1 ? '' : 's'}</small></span>
            <span className="alm-tile-gauge" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

const ICON: Record<Kind, GameIconName> = { birthday: 'cake-slice', anniversary: 'linked-rings', memorial: 'candle-light' };

function Name({ p, f, tree }: { p?: GPerson; f: Family; tree: string }) {
  if (!p) return <>someone</>;
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

function relation(ev: Ev, f: Family, me: string | null, myAnc: Map<string, number>): string | undefined {
  if (!me) return undefined;
  if (ev.ids.includes(me)) return ev.kind === 'birthday' ? 'your birthday' : ev.kind === 'anniversary' ? 'your anniversary' : 'you';
  const labels = ev.ids.map((id) => safeKinship(f, me, id, myAnc)).filter((x): x is string => !!x);
  if (!labels.length) return undefined;
  const uniq = [...new Set(labels)];
  return `your ${uniq.join(' & ')}`;
}

function EventRow({ ev, f, tree, me, myAnc }: { ev: Ev; f: Family; tree: string; me: string | null; myAnc: Map<string, number> }) {
  const today = ev.days === 0;
  const crowned = ev.milestone && ev.kind === 'birthday';
  const people = ev.ids.map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p);
  const rel = relation(ev, f, me, myAnc);
  const what =
    ev.kind === 'birthday'
      ? `turns ${ev.n}`
      : ev.kind === 'anniversary'
        ? `${ord(ev.n)} anniversary${ev.note ? ` · ${ev.note} wedding` : ''}`
        : `${ev.n} ${ev.n === 1 ? 'year' : 'years'} since they passed`;
  return (
    <li className="alm-row ui-card" data-kind={ev.kind} data-milestone={ev.milestone || undefined} data-today={today || undefined}>
      <div className="alm-leaf" aria-hidden>
        <i>{ev.date.toLocaleDateString('en-GB', { month: 'short' })}</i>
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
            <span className="alm-star" title="A round number">
              <GameIcon name={crowned ? 'laurel-crown' : 'crown'} size={14} /> milestone
            </span>
          )}
        </div>
      </div>
      <div className="alm-meta">
        {today ? (
          <span className="alm-ribbon">
            <GameIcon name="wax-seal" size={15} /> Today
          </span>
        ) : (
          <span className="alm-away">{awayLabel(ev.days)}</span>
        )}
        {rel && <span className="alm-rel">{rel}</span>}
      </div>
    </li>
  );
}

const HIST_VERB: Record<HistType, string> = { born: 'was born', died: 'died', married: 'married' };

function HistRow({ h, f, tree, thisYear, away, showDay }: { h: Hist; f: Family; tree: string; thisYear: number; away?: number; showDay?: boolean }) {
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
            married <Name p={ps[1]} f={f} tree={tree} />
          </>
        ) : (
          <> {HIST_VERB[h.type]}</>
        )}
        <small className="muted">
          {' '}
          {away !== undefined ? `${awayLabel(away).toLowerCase()} · ` : ''}
          {ago.toLocaleString('en-GB')} years ago
        </small>
      </span>
    </li>
  );
}

function MonthHistory({ hist, f, tree, thisYear }: { hist: Hist[]; f: Family; tree: string; thisYear: number }) {
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
          {more ? 'Show fewer' : `Show all ${hist.length}`}
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
function usePageTrail(page: string, tree: string) {
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
        try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree, person, name: link.textContent?.trim() || 'your family' })); } catch {}
      }
    };
    document.addEventListener('click', click, true);
    return () => { clearTimeout(timer); document.removeEventListener('scroll', scroll, true); document.removeEventListener('click', click, true); };
  }, [page, tree]);
}
