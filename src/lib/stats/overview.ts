// Turns the stored counters into what the Statistics page shows, including the plain "how it's being received" reading. Pure, so
// the arithmetic and the reading can be tested without a database.
import type { Key, Vars } from '../i18n/dictionary.ts';
import { CATEGORIES, CHANGE_KINDS, dayBefore, EVENTS, LEGACY, ONCE_EVENTS, ROUTES, type Category, type ChangeKind, type EventName, type RangeDays, type RouteName, type StoredCategory } from './shared.ts';

export interface DailyRow { day: string; kind: 'view' | 'visit' | 'event' | 'active' | 'change'; cat: StoredCategory; name: string; n: number }
export { CHANGE_KINDS, type ChangeKind };
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

/** What the page can be switched to: the family without stewards (the headline), everyone, or one category. */
export const VIEWS = ['family', 'all', ...CATEGORIES] as const;
export type ViewKey = (typeof VIEWS)[number];

const MEMBERS_OF: Record<ViewKey, readonly Category[]> = {
  family: ['editor', 'contributor', 'viewer', 'guest'], all: CATEGORIES, steward: ['steward'], editor: ['editor'],
  contributor: ['contributor'], viewer: ['viewer'], guest: ['guest'],
};

/** The figures for one view. Everything in it is a count of this view's people (or visits, for guests), never of one person. */
export interface Slice {
  series: DayPoint[];
  totals: Totals;
  previous: Totals;
  active: { d7: number; d30: number; d90: number };
  /** Members with these roles now; 0 for guests, who are not members. */
  members: number;
  routes: { name: RouteName; n: number }[];
  features: { name: EventName; n: number }[];
  recent: ({ day: string } & Record<ChangeKind, number>)[];
  /** Whether changes in this view are complete for the whole range. The "everyone" view reads them from the family's records, always. */
  changesKnown: boolean;
  reception: Reception;
}

export interface Overview {
  days: RangeDays;
  today: string;
  collecting: boolean;
  /** The first day anything was counted, or null when nothing has been. */
  since: string | null;
  /** The first day counted by category, or null when none has been: older counters have no category. */
  categorized: string | null;
  /** Page views and visits in this range counted before categories began: only in the "everyone" view. */
  beforeCategories: number;
  slices: Record<ViewKey, Slice>;
  tour: { finished: number; skipped: number };
  feedback: number;
}

export interface OverviewInput {
  days: RangeDays;
  today: string;
  collecting: boolean;
  since: string | null;
  categorized?: string | null;
  /** Counters for this range and the one before it. */
  rows: DailyRow[];
  /** Changes read from the family's own records: every author together. */
  changes: ChangeRow[];
  /** Members seen in the last 7, 30 and 90 days, by the category they were last seen in; `legacy` is seen before categories. */
  active: Partial<Record<StoredCategory, { d7: number; d30: number; d90: number }>>;
  /** Members with each role. */
  members: Partial<Record<Category, number>>;
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

const sumActive = (input: OverviewInput, cats: readonly StoredCategory[]) => {
  const out = { d7: 0, d30: 0, d90: 0 };
  for (const c of cats) for (const k of ['d7', 'd30', 'd90'] as const) out[k] += input.active[c]?.[k] ?? 0;
  return out;
};

/** The figures of one view. Counters with no category belong to `all` alone: nobody can say who they were. */
function buildSlice(input: OverviewInput, view: ViewKey, tour: Overview['tour'], categorized: string | null): Slice {
  const { days, today, rows, changes } = input;
  const cats = new Set<StoredCategory>(view === 'all' ? [...CATEGORIES, LEGACY] : MEMBERS_OF[view]);
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
    if (!cats.has(r.cat)) continue;
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
    // Counted changes are by category; "everyone" reads the family's records instead, which reach back before any counting.
    else if (r.kind === 'change' && view !== 'all' && (CHANGE_KINDS as readonly string[]).includes(r.name)) p[r.name as ChangeKind] += r.n;
  }
  if (view === 'all') for (const c of changes) { const p = points.get(c.day); if (p) p[c.kind] += c.n; }
  const all = [...points.values()];
  const series = all.filter((p) => p.day >= first);
  const slice: Slice = {
    series,
    totals: totalsOf(series, guests),
    previous: totalsOf(all.filter((p) => p.day >= previousFirst && p.day < first), previousGuests),
    active: sumActive(input, [...cats]),
    members: [...cats].reduce((n, c) => n + (c === 'guest' || c === LEGACY ? 0 : input.members[c] ?? 0), 0),
    routes: ranked(ROUTES, routes),
    // The tour has its own place on the page: it is a first step, not a feature people return to.
    features: ranked(EVENTS.filter((e) => !ONCE_EVENTS.includes(e)), features),
    recent: series.filter((p) => CHANGE_KINDS.some((k) => p[k] > 0)).slice(-RECENT_DAYS).reverse()
      .map((p) => ({ day: p.day, people: p.people, photos: p.photos, stories: p.stories, research: p.research })),
    // Changes by category are only counted since categories began, so a range that starts earlier has a hole in it.
    changesKnown: view === 'all' || (categorized !== null && categorized <= first),
    reception: { verdict: 'early', points: [] },
  };
  slice.reception = readReception({
    since: view === 'all' ? input.since : categorized, today, totals: slice.totals, previous: slice.previous, active: slice.active,
    members: slice.members, tour: view === 'family' || view === 'all' ? tour : { finished: 0, skipped: 0 }, feedback: input.feedback, days,
    changesKnown: slice.changesKnown, guestsOnly: view === 'guest',
  });
  return slice;
}

export function buildOverview(input: OverviewInput): Overview {
  const tour = { finished: input.lifetime['tour.finished'] ?? 0, skipped: input.lifetime['tour.skipped'] ?? 0 };
  const categorized = input.categorized ?? null;
  const first = dayBefore(input.today, input.days - 1);
  const beforeCategories = input.rows.filter((r) => r.cat === LEGACY && r.day >= first && (r.kind === 'view' || r.kind === 'visit')).reduce((n, r) => n + r.n, 0);
  return {
    days: input.days, today: input.today, collecting: input.collecting, since: input.since, categorized, beforeCategories,
    slices: Object.fromEntries(VIEWS.map((v) => [v, buildSlice(input, v, tour, categorized)])) as Record<ViewKey, Slice>,
    tour, feedback: input.feedback,
  };
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
export function readReception(o: Pick<Slice, 'totals' | 'previous' | 'active' | 'members'> & Pick<Overview, 'since' | 'today' | 'tour' | 'feedback' | 'days'> & { changesKnown?: boolean; guestsOnly?: boolean }): Reception {
  // Guests are anonymous visits, so there is nothing about people to read.
  if (o.guestsOnly) return { verdict: 'early', points: [{ tone: 'neutral', key: 'stats.rc.guests_only' }] };
  const counted = daysCounted(o.since, o.today);
  if (counted === 0) return { verdict: 'early', points: [{ tone: 'neutral', key: 'stats.empty_notice' }] };
  if (counted < 7 || o.totals.views < 20) {
    return { verdict: 'early', points: [{ tone: 'neutral', key: 'stats.rc.early', vars: { count: counted } }] };
  }
  const points: ReceptionPoint[] = [];

  // Turning collection off forgets who was seen, so no markers next to counted activity means "unknown", not "nobody came".
  if (o.active.d90 > 0 || o.totals.activeDays === 0) {
    const share = o.members ? o.active.d30 / o.members : 0;
    if (o.members) points.push({
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

  if (o.changesKnown === false) points.push({ tone: 'neutral', key: 'stats.rc.changes_unknown' });
  else if (o.totals.changes === 0) points.push({ tone: 'watch', key: 'stats.rc.only_reading' });
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
