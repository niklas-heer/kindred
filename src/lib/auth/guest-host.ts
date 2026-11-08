// The guest host: a second address for the same app, for sites behind Cloudflare Access (docs/deploy-cloudflare.md,
// "Guests behind Access"). Access stops anyone without a login before Kindred sees them, so guests come in on their own
// host name, which Access does not cover, and the member site keeps its Access policy unchanged.
//
// The guest host is open to the internet, so it answers only what a guest needs. Anything else is 404, and it never honours
// an account's session or an Access login (session.server.ts). Plain code, with no server-only imports.

/** A family's section names a guest must not be served. */
const NOT_GUEST_SECTIONS = new Set(['access', 'settings']);
/** First path segments that are not families and that a guest must not reach: the routes for accounts and setup. */
const NOT_GUEST_ROOTS = new Set(['signin', 'setup', 'invite', 'ui', 'ui_', 'api']);
const GUEST_MEDIA = /^\/api\/(?:photo|portrait|media|research)\/[^/]+\/[^/]+$/;

/** Whether the guest host may answer a path: an allow-list, so a route added later stays closed until it is added here. */
export function guestHostAllows(pathname: string): boolean {
  if (pathname === '/' || pathname === '/api/health' || pathname === '/api/stats') return true;
  if (pathname.startsWith('/share/') || pathname.startsWith('/_serverFn/') || pathname.startsWith('/assets/')) return true;
  if (GUEST_MEDIA.test(pathname)) return true;
  const [, root, section] = pathname.split('/');
  if (!root || NOT_GUEST_ROOTS.has(root) || root.startsWith('_')) return false;
  if (!section) return /^[a-z0-9-]+$/.test(root) || /\.[a-z0-9]+$/i.test(root); // a family, or a file at the root (favicon.svg)
  return !NOT_GUEST_SECTIONS.has(section);
}
