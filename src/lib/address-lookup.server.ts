// Looks an address up on OpenStreetMap's public search, only when someone presses "Look up this address". Only the
// typed text is sent. Follows https://operations.osmfoundation.org/policies/nominatim/: it says who is asking, sends at
// most one request a second, caches what it gets, and asks for nothing automatically. The cache lives in memory only,
// because what people type here is private. Plain fetch, so it runs the same on Node and on Workers.
import { osmHit, type OsmHit } from './address.ts';

const SEARCH = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Kindred family tree (https://github.com/niklas-heer/kindred)';
const GAP_MS = 1100;
/** Longer than this in the queue and the person is better off being told. */
const MAX_WAIT_MS = 4000;
const TIMEOUT_MS = 6000;
const TTL_MS = 24 * 3600_000;
const CACHE_MAX = 200;

export type LookupResult = { ok: true; hits: OsmHit[] } | { ok: false };

interface Deps { fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<unknown> }
const live: Deps = { fetch: (...a) => fetch(...a), now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

const cache = new Map<string, { at: number; hits: OsmHit[] }>();
let nextSlot = 0;

/** For tests: forgets the cache and the rate limit. */
export function resetLookup() { cache.clear(); nextSlot = 0; }

/** Addresses matching the typed text, in the reader's language. A failure of any kind is `{ ok: false }`. */
export async function lookupAddress(text: string, locale: string, deps: Deps = live): Promise<LookupResult> {
  const q = text.trim();
  const key = `${locale}\n${q.toLowerCase()}`;
  const now = deps.now();
  const had = cache.get(key);
  if (had && now - had.at < TTL_MS) return { ok: true, hits: had.hits };

  const slot = Math.max(now, nextSlot);
  if (slot - now > MAX_WAIT_MS) return { ok: false };
  nextSlot = slot + GAP_MS;
  if (slot > now) await deps.sleep(slot - now);

  try {
    const url = `${SEARCH}?${new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': locale })}`;
    const res = await deps.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return { ok: false };
    const hits = body.map(osmHit).filter((h): h is OsmHit => !!h);
    cache.delete(key);
    cache.set(key, { at: deps.now(), hits });
    // The oldest entry is the first the Map holds.
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return { ok: true, hits };
  } catch {
    // Deliberately no log: the error can carry the address.
    return { ok: false };
  }
}
