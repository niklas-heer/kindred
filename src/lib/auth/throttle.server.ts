// In-memory rate limits for the sign-in endpoints: a sliding window per key (an IP, or one global
// key for the setup code). Enough for one server process; it resets on restart.
const g = globalThis as unknown as { __kindredThrottle?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__kindredThrottle ??= new Map());

/** Records one attempt; false when `key` has used up `limit` attempts in the last `windowMs`. */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const t = Date.now();
  const recent = (hits.get(key) ?? []).filter((at: number) => t - at < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(t);
  hits.set(key, recent);
  // Keep the map small: drop keys nobody has used for an hour.
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 3_600_000) hits.delete(k);
  return true;
}

/** Forgets a key's attempts (for tests). */
export const resetThrottle = () => hits.clear();
