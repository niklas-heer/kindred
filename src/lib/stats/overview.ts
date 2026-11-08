// Turns the stored counters into what the Statistics page shows, including the plain "how it's being received" reading. Pure, so
// the arithmetic and the reading can be tested without a database.
import type { Key, Vars } from '../i18n/dictionary.ts';
import { dayBefore, EVENTS, ONCE_EVENTS, ROUTES, type EventName, type RangeDays, type RouteName } from './shared.ts';

export interface DailyRow { day: string; kind: 'view' | 'visit' | 'event' | 'active'; name: string; n: number }
export const CHANGE_KINDS = ['people', 'photos', 'stories', 'research'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export interface ChangeRow { day: string; kind: ChangeKind; n: number }

export interface DayPoint extends Record<ChangeKind, number> {
  day: string;
  views: number;
  visits: number;
  active: number;
}

export interface Totals { views: number; visits: number; guests: number; changes: number; activeDays: number }

export type Tone = 'good' | 'neutral' | 'watch';
export interface ReceptionPoint { tone: Tone; key: Key; vars?: Vars }
export interface Reception { verdict: 'early' | 'warm' | 'steady' | 'quiet'; points: ReceptionPoint[] }

export interface Overview {
  days: RangeDays;
  today: string;
  collecting: boolean;
  /** The first day anything was counted, or null when nothing has been. */
  since: string | null;
  series: DayPoint[];
  totals: Totals;
  previous: Totals;
  active: { d7: number; d30: number; d90: number };
  members: number;
  routes: { name: RouteName; n: number }[];
  features: { name: EventName; n: number }[];
  recent: ({ day: string } & Record<ChangeKind, number>)[];
  tour: { finished: number; skipped: number };
  feedback: number;
  reception: Reception;
}

export interface OverviewInput {
  days: RangeDays;
  today: string;
  collecting: boolean;
  since: string | null;
  /** Counters for this range and the one before it. */
  rows: DailyRow[];
  changes: ChangeRow[];
  active: { d7: number; d30: number; d90: number };
  members: number;
  /** All-time counts of the events the reading looks at. */
  lifetime: Partial<Record<EventName, number>>;
  /** Feedback reports in the family's feedback list. */
  feedback: number;
}

const RECENT_DAYS = 8;

const emptyDay = (day: string): DayPoint => ({ day, views: 0, visits: 0, active: 0, people: 0, photos: 0, stories: 0, research: 0 });

/** Sums a run of days; `guests` is counted apart from members' visits. */
function totalsOf(points: DayPoint[], guests: number): Totals {
  const t: Totals = { views: 0, visits: 0, guests, changes: 0, activeDays: 0 };
  for (const p of points) {
    t.views += p.views;
    t.visits += p.visits;
    t.activeDays += p.active;
    t.changes += p.people + p.photos + p.stories + p.research;
  }
  return t;
}

const ranked = <N extends string>(names: readonly N[], counted: Map<string, number>) =>
  names.map((name) => ({ name, n: counted.get(name) ?? 0 })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

export function buildOverview(input: OverviewInput): Overview {
  const { days, today, rows, changes } = input;
  const first = dayBefore(today, days - 1);
  const previousFirst = dayBefore(today, days * 2 - 1);
  const points = new Map<string, DayPoint>();
  for (let i = days * 2 - 1; i >= 0; i--) {
    const day = dayBefore(today, i);
    points.set(day, emptyDay(day));
  }
  const routes = new Map<string, number>();
  const features = new Map<string, number>();
  let guests = 0;
  let previousGuests = 0;
  for (const r of rows) {
    const p = points.get(r.day);
    if (!p) continue;
    const current = r.day >= first;
    if (r.kind === 'view') {
      p.views += r.n;
      if (current) routes.set(r.name, (routes.get(r.name) ?? 0) + r.n);
    } else if (r.kind === 'visit') {
      if (r.name === 'guest') {
        if (current) guests += r.n; else previousGuests += r.n;
      } else p.visits += r.n;
    } else if (r.kind === 'active') p.active += r.n;
    else if (r.kind === 'event' && current) features.set(r.name, (features.get(r.name) ?? 0) + r.n);
  }
  for (const c of changes) {
    const p = points.get(c.day);
    if (p) p[c.kind] += c.n;
  }
  const all = [...points.values()];
  const series = all.filter((p) => p.day >= first);
  const before = all.filter((p) => p.day >= previousFirst && p.day < first);
  const totals = totalsOf(series, guests);
  const previous = totalsOf(before, previousGuests);
  const tour = { finished: input.lifetime['tour.finished'] ?? 0, skipped: input.lifetime['tour.skipped'] ?? 0 };
  const { feedback } = input;
  const overview: Overview = {
    days, today, collecting: input.collecting, since: input.since, series, totals, previous,
    active: input.active, members: input.members,
    routes: ranked(ROUTES, routes),
    // The tour has its own place on the page: it is a first step, not a feature people return to.
    features: ranked(EVENTS.filter((e) => !ONCE_EVENTS.includes(e)), features),
    recent: series.filter((p) => CHANGE_KINDS.some((k) => p[k] > 0)).slice(-RECENT_DAYS).reverse()
      .map((p) => ({ day: p.day, people: p.people, photos: p.photos, stories: p.stories, research: p.research })),
    tour, feedback,
    reception: { verdict: 'early', points: [] },
  };
  overview.reception = readReception(overview);
  return overview;
}

/** How many days have been counted, up to today. */
function daysCounted(since: string | null, today: string): number {
  return since ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1 : 0;
}

/**
 * An honest reading of the numbers: what they show, and that there is not enough to say when there is not. It looks at reach (how
 * many of the family come back), momentum, whether people add as well as read, the tour, and feedback. Counts cannot say how
 * anyone feels, so the page says that next to this.
 */
export function readReception(o: Pick<Overview, 'since' | 'today' | 'totals' | 'previous' | 'active' | 'members' | 'tour' | 'feedback' | 'days'>): Reception {
  const counted = daysCounted(o.since, o.today);
  if (counted < 7 || o.totals.views < 20) {
    return { verdict: 'early', points: [{ tone: 'neutral', key: 'stats.rc.early', vars: { count: counted } }] };
  }
  const points: ReceptionPoint[] = [];

  // Turning collection off forgets who was seen, so no markers next to counted activity means "unknown", not "nobody came".
  if (o.active.d90 > 0 || o.totals.activeDays === 0) {
    const share = o.members ? o.active.d30 / o.members : 0;
    points.push({
      tone: share >= 0.6 ? 'good' : share >= 0.3 ? 'neutral' : 'watch',
      key: share >= 0.6 ? 'stats.rc.reach_good' : share >= 0.3 ? 'stats.rc.reach_some' : 'stats.rc.reach_low',
      vars: { active: o.active.d30, members: o.members },
    });
  }

  // Only compared when the earlier period was really counted: a family three weeks in has no last month to fall from.
  if (counted >= o.days * 2 && o.previous.activeDays > 0) {
    const ratio = o.totals.activeDays / o.previous.activeDays;
    if (ratio >= 1.2) points.push({ tone: 'good', key: 'stats.rc.momentum_up', vars: { percent: Math.round((ratio - 1) * 100) } });
    else if (ratio <= 0.8) points.push({ tone: 'watch', key: 'stats.rc.momentum_down', vars: { percent: Math.round((1 - ratio) * 100) } });
    else points.push({ tone: 'neutral', key: 'stats.rc.momentum_flat' });
  }

  if (o.totals.changes === 0) points.push({ tone: 'watch', key: 'stats.rc.only_reading' });
  else if (o.totals.changes / o.totals.views >= 0.05) points.push({ tone: 'good', key: 'stats.rc.adding', vars: { count: o.totals.changes } });
  else points.push({ tone: 'neutral', key: 'stats.rc.mostly_reading', vars: { count: o.totals.changes } });

  const toured = o.tour.finished + o.tour.skipped;
  if (toured >= 3) {
    const finished = o.tour.finished / toured;
    points.push({ tone: finished >= 0.5 ? 'good' : 'watch', key: finished >= 0.5 ? 'stats.rc.tour_good' : 'stats.rc.tour_skipped', vars: { finished: o.tour.finished, total: toured } });
  }

  points.push(o.feedback > 0
    ? { tone: 'neutral', key: 'stats.rc.feedback', vars: { count: o.feedback } }
    : { tone: 'neutral', key: 'stats.rc.no_feedback' });

  const good = points.filter((p) => p.tone === 'good').length;
  const watch = points.filter((p) => p.tone === 'watch').length;
  return { verdict: good > watch ? 'warm' : watch > good ? 'quiet' : 'steady', points };
}

/** The change from one period to the next, as a whole percentage; null when there is nothing to compare with. */
export function percentChange(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 100) : null;
}
