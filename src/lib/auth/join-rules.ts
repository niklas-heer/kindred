// "Ask to join" without storage or network: what a request may hold, the device family from a user agent, the approximate
// place from Cloudflare's request data, and how a guest browser's usage is added up. No framework imports, so the browser
// (the preview a guest sees before sending) and the tests can use it directly. The rest is in ./join.server.ts.
import { ROUTES, type RouteName } from '../stats/shared.ts';

/** How long a request waits for a steward. */
export const REQUEST_DAYS = 30;
/** The most open requests one link may hold at once. */
export const MAX_OPEN_PER_LINK = 10;
/** Requests one address may start through one link in one window (the window of the password tries). */
export const JOINS_PER_IP = 5;
/** How long a guest browser's usage is kept after its last visit. */
export const VISITOR_KEEP_DAYS = 90;
/** The longest message a guest may add. */
export const MAX_MESSAGE = 500;
/** People kept in a visitor's tally, and how many a steward is shown. */
export const PEOPLE_KEPT = 20;
export const PEOPLE_SHOWN = 5;
/** The most active time one report can add: a little over the beacon's interval, so a forged report cannot add hours. */
export const MAX_ACTIVE_PER_REPORT = 120;
/** The most people one report may name. */
export const MAX_PEOPLE_PER_REPORT = 10;

/** A short message: control characters out (line breaks stay), trimmed, at most MAX_MESSAGE characters. Empty is null. */
export function cleanMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return m ? m.slice(0, MAX_MESSAGE) : null;
}

/** An IANA time zone name as the browser reports it ("Europe/Berlin", "UTC"), else null. */
export function cleanTimeZone(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 64 && /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(raw) ? raw : null;
}

/** A BCP 47 language tag as the browser reports it ("de-DE", "af"), else null. */
export function cleanLanguage(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 35 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(raw) ? raw : null;
}

/** A person id from the tree, as a request names it. The server checks it is really in the family. */
export const PERSON_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** "iPhone, Safari", "Mac, Firefox", "Android phone, Chrome": the device family, and nothing finer. */
export function deviceFamily(ua: string | null | undefined): string {
  const s = ua ?? '';
  const device = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? (/Mobile/.test(s) ? 'Android phone' : 'Android tablet')
    : /Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows PC' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux computer' : null;
  const browser = /Edg(?:e|A|iOS)?\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser\//.test(s) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(s) ? 'Firefox' : /CriOS\/|Chrome\/|Chromium\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : null;
  return [device, browser].filter(Boolean).join(', ') || 'unknown';
}

export interface Place { city: string | null; region: string | null; country: string | null }

const placePart = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v.trim() : null);

/**
 * The approximate place of a request: the city, region and country Cloudflare puts on a Worker's request (`request.cf`), never
 * an address. On Node there is none, unless a trusted proxy sets a country header (`trustCountryHeader`), and then only the
 * country. Null when nothing is known.
 */
export function placeOf(request: Request | undefined, trustCountryHeader: boolean): Place | null {
  const cf = (request as (Request & { cf?: Record<string, unknown> }) | undefined)?.cf;
  const country = (c: unknown) => { const v = placePart(c, 2); return v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null; };
  if (cf && typeof cf === 'object') {
    const p = { city: placePart(cf.city), region: placePart(cf.region), country: country(cf.country) };
    return p.city || p.region || p.country ? p : null;
  }
  if (trustCountryHeader) {
    const c = country(request?.headers.get('cf-ipcountry'));
    return c ? { city: null, region: null, country: c } : null;
  }
  return null;
}

// ---------- a guest browser's usage ----------

export interface UsageRow { first_seen: number; last_seen: number; visits: number; active_seconds: number; sections: string; people: string }

/** What a steward reads in a request: totals, the sections and up to five people. */
export interface Usage {
  firstSeen: number;
  lastSeen: number;
  visits: number;
  activeMinutes: number;
  sections: Partial<Record<RouteName, number>>;
  people: { id: string; count: number }[];
}

const SECTIONS = new Set<string>(ROUTES);

function parseCounts(json: string, ok: (k: string) => boolean): Record<string, number> {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (ok(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
    return out;
  } catch {
    return {};
  }
}

/** The extra a guest's report carries for its own usage: active seconds and the people opened. Anything else is dropped. */
export function parseGuestExtras(raw: unknown): { active: number; people: string[] } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const active = typeof b.active === 'number' && Number.isFinite(b.active) && b.active > 0 ? Math.min(Math.floor(b.active), MAX_ACTIVE_PER_REPORT) : 0;
  const people = Array.isArray(b.people) ? [...new Set(b.people.filter((p): p is string => typeof p === 'string' && PERSON_ID.test(p)))].slice(0, MAX_PEOPLE_PER_REPORT) : [];
  return { active, people };
}

/** Adds one report to a visitor's row: the new totals, with only known sections and the PEOPLE_KEPT people opened most. */
export function addUsage(
  row: Pick<UsageRow, 'visits' | 'active_seconds' | 'sections' | 'people'> | undefined,
  report: { visit: boolean; views: Partial<Record<string, number>>; active: number; people: string[] },
): { visits: number; active_seconds: number; sections: string; people: string } {
  const sections = parseCounts(row?.sections ?? '{}', (k) => SECTIONS.has(k));
  for (const [k, n] of Object.entries(report.views)) if (SECTIONS.has(k) && n) sections[k] = (sections[k] ?? 0) + n;
  const people = parseCounts(row?.people ?? '{}', (k) => PERSON_ID.test(k));
  for (const id of report.people) people[id] = (people[id] ?? 0) + 1;
  const kept = Object.fromEntries(Object.entries(people).sort((a, b) => b[1] - a[1]).slice(0, PEOPLE_KEPT));
  return {
    visits: (row?.visits ?? 0) + (report.visit ? 1 : 0),
    active_seconds: (row?.active_seconds ?? 0) + report.active,
    sections: JSON.stringify(sections),
    people: JSON.stringify(kept),
  };
}

/** A visitor's row as a steward reads it. */
export function usageOf(row: UsageRow): Usage {
  const people = Object.entries(parseCounts(row.people, (k) => PERSON_ID.test(k))).sort((a, b) => b[1] - a[1]).slice(0, PEOPLE_SHOWN).map(([id, count]) => ({ id, count }));
  return {
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    visits: row.visits,
    activeMinutes: Math.round(row.active_seconds / 60),
    sections: parseCounts(row.sections, (k) => SECTIONS.has(k)) as Usage['sections'],
    people,
  };
}

/** A copy of a usage kept in a request, read back; null when it is not one. */
export function parseUsage(json: string | null): Usage | null {
  if (!json) return null;
  try {
    const u = JSON.parse(json) as Usage;
    if (typeof u?.firstSeen !== 'number' || typeof u.visits !== 'number') return null;
    return u;
  } catch {
    return null;
  }
}
