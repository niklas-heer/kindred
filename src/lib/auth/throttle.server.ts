// In-memory rate limits for the sign-in endpoints: a sliding window per key (an IP, or one global
// key for the setup code). Enough for one server process; it resets on restart. On Workers each
// isolate keeps its own window, so the limits are per isolate there: a brake, not a wall.
import { getRequest, getRequestIP } from '@tanstack/react-start/server';
import { onWorkers } from '../store/index.ts';
import { authMethod } from './method.server.ts';

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

/**
 * The client's address for throttling. Cloudflare sets CF-Connecting-IP and a Worker can trust it; on
 * Node it is trusted only when Cloudflare Access is the sign-in method, else the socket's address is used.
 */
export function clientIP(): string {
  let request: Request | undefined;
  try { request = getRequest(); } catch {}
  const cf = request?.headers.get('cf-connecting-ip');
  if (cf && (onWorkers || authMethod() === 'cloudflare-access')) return cf;
  try { return getRequestIP() || 'unknown'; } catch { return 'unknown'; }
}
