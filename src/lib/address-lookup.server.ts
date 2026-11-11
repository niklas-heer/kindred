// Suggests whole addresses as someone types one, from OpenStreetMap's data through Photon (komoot's public geocoder,
// https://photon.komoot.io). Photon is built for search-as-you-type and its public instance may be used "as long as the
// number of requests stay in a reasonable limit"; "extensive usage will be throttled or completely banned"
// (https://github.com/komoot/photon#demo-server, read 2026-11-11). Nominatim's policy forbids exactly this ("Auto-complete
// search: This is not yet supported by Nominatim and you must not implement such a service on the client side using the
// API", https://operations.osmfoundation.org/policies/nominatim/), so it is not used here.
//
// The browser never talks to Photon: it asks our server function, which only a member who may edit contacts can call. Only
// the typed text is sent, with a User-Agent that says who is asking. To stay reasonable it keeps a small gap between
// requests from this server, caps how often one person can ask, and remembers answers for an hour. The cache lives in
// memory only, because what people type here is private. Plain fetch, so it runs the same on Node and on Workers (where each
// isolate keeps its own cache and limits).
//
// KINDRED_ADDRESS_LOOKUP=off switches it off: the address box then suggests towns from the offline gazetteer only.
import { photonHits, type AddressHit } from './address.ts';

const SEARCH = 'https://photon.komoot.io/api/';
const USER_AGENT = 'Kindred family tree (https://github.com/niklas-heer/kindred)';
/** Photon translates names into these; for any other language it answers with the local names. */
const LANGS = new Set(['de', 'en', 'fr']);
/** Between two requests from this server. */
const GAP_MS = 250;
/** Longer than this in the queue and the person gets no suggestions this time (the next key brings them). */
const MAX_WAIT_MS = 1200;
const TIMEOUT_MS = 4000;
const TTL_MS = 3600_000;
const CACHE_MAX = 300;
/** One person's lookups in a minute, at most. Typing with the box's pause makes a few. */
const PER_MINUTE = 40;

export type SuggestResult = { ok: true; hits: AddressHit[] } | { ok: false; reason: 'off' | 'busy' | 'failed' };

type Env = Record<string, string | undefined>;
const OFF = new Set(['0', 'false', 'no', 'off']);

/** Whether this server suggests addresses from Photon (KINDRED_ADDRESS_LOOKUP, on unless set to off). */
export const addressLookupOn = (env: Env = process.env): boolean => !OFF.has(env.KINDRED_ADDRESS_LOOKUP?.trim().toLowerCase() ?? '');

interface Deps { fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<unknown>; env: Env }
const live: Deps = { fetch: (...a) => fetch(...a), now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), env: process.env };

const cache = new Map<string, { at: number; hits: AddressHit[] }>();
const asked = new Map<string, number[]>();
let nextSlot = 0;

/** For tests: forgets the cache and the limits. */
export function resetLookup() { cache.clear(); asked.clear(); nextSlot = 0; }

/** Under the person's limit for the minute; counts this ask when it is. */
function allowed(who: string, now: number): boolean {
  const recent = (asked.get(who) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) { asked.set(who, recent); return false; }
  recent.push(now);
  asked.set(who, recent);
  // Forget people who stopped typing long ago, so the map stays small.
  if (asked.size > 500) for (const [k, v] of asked) if (!v.some((t) => now - t < 60_000)) asked.delete(k);
  return true;
}

/** Addresses for the typed text, in the reader's language where Photon has it. `who` is the asking account. */
export async function suggestAddresses(text: string, locale: string, who: string, deps: Deps = live): Promise<SuggestResult> {
  if (!addressLookupOn(deps.env)) return { ok: false, reason: 'off' };
  const q = text.trim().slice(0, 200);
  const lang = LANGS.has(locale) ? locale : '';
  const key = `${lang}\n${q.toLowerCase()}`;
  const now = deps.now();
  const had = cache.get(key);
  if (had && now - had.at < TTL_MS) return { ok: true, hits: had.hits };
  if (!allowed(who, now)) return { ok: false, reason: 'busy' };

  const slot = Math.max(now, nextSlot);
  if (slot - now > MAX_WAIT_MS) return { ok: false, reason: 'busy' };
  nextSlot = slot + GAP_MS;
  if (slot > now) await deps.sleep(slot - now);

  try {
    const params = new URLSearchParams({ q, limit: '6' });
    if (lang) params.set('lang', lang);
    // A house or a street: towns on their own come from the offline gazetteer, first.
    params.append('layer', 'house');
    params.append('layer', 'street');
    const res = await deps.fetch(`${SEARCH}?${params}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: 'failed' };
    const hits = photonHits(await res.json());
    if (!hits) return { ok: false, reason: 'failed' };
    cache.delete(key);
    cache.set(key, { at: deps.now(), hits });
    // The oldest entry is the first the Map holds.
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return { ok: true, hits };
  } catch {
    // Deliberately no log: the error can carry the address.
    return { ok: false, reason: 'failed' };
  }
}
