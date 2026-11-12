// The origin an email's links start with (docs/hosting-many-families.md, "Email"). Only KINDRED_ORIGIN, the server's own
// address as its operator set it: never the request's Host header, which anyone can set, so a password reset asked for with a
// forged Host cannot carry a link to someone else's server. The one exception is a local server (localhost, 127.0.0.1, [::1]:
// the tests and development), whose request names it, and only where that Host can be believed: outside production
// (NODE_ENV), or on Node when the request really came from this machine (the socket's peer is a loopback address) and no proxy
// forwarded it (a reverse proxy on the same machine is a loopback peer too). Never on Workers. Without either, email is off:
// no email goes out at all, and the console's Email tab says why and refuses to turn email on.

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const FORWARDED = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip'];

const onWorkers = () => typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

/** Whether the request came from this machine itself: its socket's peer (srvx on Node) is a loopback address, unforwarded. */
function fromLoopback(request: Request): boolean {
  if (onWorkers()) return false;
  const peer = (request as Request & { runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } } }).runtime?.node?.req?.socket?.remoteAddress;
  if (!peer || FORWARDED.some((h) => request.headers.has(h))) return false;
  const v4 = peer.replace(/^::ffff:/i, '');
  return peer === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** Whether a request's Host of localhost is believed: never on Workers; outside production, or from a loopback peer. */
const localTrusted = (request: Request) => !onWorkers() && (process.env.NODE_ENV !== 'production' || fromLoopback(request));

/** The origin for links in emails, or undefined while there is none Kindred trusts. */
export function mailOrigin(request?: Request): string | undefined {
  const configured = process.env.KINDRED_ORIGIN?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return undefined;
    }
  }
  if (!request) return undefined;
  try {
    const url = new URL(request.url);
    return LOCAL.includes(url.hostname) && localTrusted(request) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
