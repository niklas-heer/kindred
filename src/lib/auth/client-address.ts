// Whose request is it, for the rate limits (./throttle.server.ts)? Behind a reverse proxy every request arrives from the
// proxy's address, so per-address limits would become one limit for the whole site, which any stranger could use up.
// KINDRED_TRUSTED_PROXIES says how many proxies stand in front of a Node server; their X-Forwarded-For entries are then
// believed, counted from the right, because each proxy appends the address it saw and only the leftmost entries can come
// from the client. Without the setting the header is never believed. No framework imports, so it can be tested directly.

/** The most proxies the setting accepts; more is surely a mistake. */
export const MAX_TRUSTED_PROXIES = 5;

/**
 * KINDRED_TRUSTED_PROXIES: how many reverse proxies stand between the internet and this server (Caddy alone is 1).
 * Empty means 0. Undefined for anything that is not a whole number from 0 to MAX_TRUSTED_PROXIES: the Node server
 * refuses to start with it (server/node.ts), and nothing is trusted meanwhile.
 */
export function trustedProxies(raw: string | undefined): number | undefined {
  const v = raw?.trim() ?? '';
  if (!v) return 0;
  return /^\d+$/.test(v) && Number(v) <= MAX_TRUSTED_PROXIES ? Number(v) : undefined;
}

/** An IPv4 or IPv6 address as a proxy writes it; anything else in the header is ignored. */
const ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:.]*)$/i;

/** The client's address in X-Forwarded-For, written by the outermost of `hops` trusted proxies, or undefined. */
export function forwardedClient(forwardedFor: string | null, hops: number): string | undefined {
  if (hops < 1 || !forwardedFor) return undefined;
  const entries = forwardedFor.split(',').map((e) => e.trim()).filter(Boolean);
  if (!entries.length) return undefined;
  // Fewer entries than proxies: the request skipped one in front, and the first proxy it reached wrote the leftmost.
  const entry = entries[Math.max(0, entries.length - hops)];
  return ADDRESS.test(entry) && entry.length <= 45 ? entry : undefined;
}

export interface AddressSettings {
  /** Running as a Cloudflare Worker, where Cloudflare itself sets CF-Connecting-IP. */
  workers: boolean;
  /** Cloudflare Access is the sign-in method: a Node server behind it is reached through Cloudflare. */
  access: boolean;
  /** KINDRED_TRUSTED_PROXIES. */
  hops: number;
}

/** The address to count a request against: Cloudflare's header where Cloudflare is in front, a trusted proxy's, or the peer's. */
export function clientAddress(request: Request | undefined, peer: string | undefined, s: AddressSettings): string {
  const cf = request?.headers.get('cf-connecting-ip');
  if (cf && (s.workers || s.access)) return cf;
  if (!s.workers) {
    const forwarded = forwardedClient(request?.headers.get('x-forwarded-for') ?? null, s.hops);
    if (forwarded) return forwarded;
  }
  return peer || 'unknown';
}
