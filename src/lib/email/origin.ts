// The origin an email's links start with (docs/hosting-many-families.md, "Email"). Only KINDRED_ORIGIN, the server's own
// address as its operator set it: never the request's Host header, which anyone can set, so a password reset asked for with a
// forged Host cannot carry a link to someone else's server. The one exception is a local server (localhost, 127.0.0.1, [::1]:
// the tests and development), whose request names it. Without either, email is off: no email goes out at all, and the
// console's Email tab says why and refuses to turn email on.

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

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
    return LOCAL.includes(url.hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
