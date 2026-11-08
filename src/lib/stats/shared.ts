// What usage statistics may contain, for the browser and the server alike. Only names on these two lists are ever stored, so a
// person's id, a house, a search or anything a reader typed cannot reach the counters, whatever a browser sends.

import type { Action } from '../roles.ts';

/** The sections counted as page views. A page about one person or house counts as its section, without the id. */
export const ROUTES = [
  'tree', 'almanac', 'atlas', 'contacts', 'register', 'houses', 'house', 'needed', 'chronicle', 'gallery',
  'research', 'research-project', 'access', 'settings',
] as const;
export type RouteName = (typeof ROUTES)[number];

/** Things people do that are counted. */
export const EVENTS = [
  'assistant.asked', 'arms.designed', 'research.added', 'tour.finished', 'tour.skipped',
] as const;
export type EventName = (typeof EVENTS)[number];

/** Events that count once per member however often they happen, such as a tour reopened on another device. */
export const ONCE_EVENTS: readonly EventName[] = ['tour.finished', 'tour.skipped'];

/** Who did something, as the server saw it at that moment. Guests are anonymous visits from a share link. */
export const CATEGORIES = ['steward', 'editor', 'contributor', 'viewer', 'guest'] as const;
export type Category = (typeof CATEGORIES)[number];
/** What is stored for a counter written before categories existed. */
export const LEGACY = 'legacy';
export type StoredCategory = Category | typeof LEGACY;

/** The kinds of change that are counted when a member saves one. */
export const CHANGE_KINDS = ['people', 'photos', 'stories', 'research'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** The change a permission check stands for, so a save is counted where the role is already known. */
export const CHANGE_OF_ACTION: Partial<Record<Action, ChangeKind>> = {
  'add-person': 'people', 'edit-person': 'people', 'remove-person': 'people',
  'upload-photo': 'photos', 'add-story': 'stories', 'add-research': 'research', 'edit-research': 'research',
};

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

const ROUTE_SET = new Set<string>(ROUTES);
const EVENT_SET = new Set<string>(EVENTS);

/** One browser's batch: what it counted since it last reported. */
export interface StatsBatch {
  tree: string;
  /** The first report of this browser session. */
  visit?: boolean;
  views?: Partial<Record<RouteName, number>>;
  events?: Partial<Record<EventName, number>>;
}

export const MAX_BATCH_BYTES = 4096;
/** The most one report can add to one counter. */
export const MAX_COUNT = 50;

const TREE = /^[a-z0-9-]{1,64}$/;
const clampCount = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_COUNT) : 0);

function counts<K extends string>(raw: unknown, allowed: Set<string>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, value] of Object.entries(raw)) {
    const n = clampCount(value);
    if (n && allowed.has(name)) out[name as K] = n;
  }
  return out;
}

/** The part of a report that may be stored, or null when it is not a report at all. Unknown names are dropped, not stored. */
export function parseBatch(raw: unknown): StatsBatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.tree !== 'string' || !TREE.test(b.tree)) return null;
  return { tree: b.tree, visit: b.visit === true, views: counts<RouteName>(b.views, ROUTE_SET), events: counts<EventName>(b.events, EVENT_SET) };
}

/**
 * The section a path belongs to, or null when it is not counted. The first segment is the family; anything after a section's
 * name (a person, a house, a project) is left behind here, in the browser, and never sent. The Statistics page is not counted,
 * so a steward reading the numbers does not move them.
 */
export function routeName(pathname: string, tree: string): RouteName | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== tree) return null;
  const [section, detail] = parts.slice(1);
  switch (section) {
    case undefined: return 'tree';
    case 'almanac': case 'atlas': case 'contacts': case 'houses': case 'needed': case 'chronicle': case 'gallery': case 'access': case 'settings':
      return section;
    case 'people': return 'register';
    case 'house': return 'house';
    case 'research': return detail ? 'research-project' : 'research';
    default: return null;
  }
}

/** Do Not Track or Global Privacy Control, as the request says it. */
export function headersRefuseTracking(headers: Pick<Headers, 'get'>): boolean {
  return headers.get('dnt') === '1' || headers.get('sec-gpc') === '1';
}

/** Do Not Track or Global Privacy Control, as the browser says it. */
export function browserRefusesTracking(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean }, win?: { doNotTrack?: string | null }): boolean {
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || win?.doNotTrack === '1';
}

/** The UTC day of a moment: the day a counter belongs to. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The day `days` before `day`. */
export function dayBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}
