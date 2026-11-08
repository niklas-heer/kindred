// The guest host: a second address for the same app, for sites behind Cloudflare Access (docs/deploy-cloudflare.md,
// "Guests behind Access"). Access stops anyone without a login before Kindred sees them, so guests come in on their own
// host name, which Access does not cover, and the member site keeps its Access policy unchanged.
//
// The guest host is open to the internet, so it answers only what a guest needs. Anything else is 404, and it never honours
// an account's session or an Access login (session.server.ts). Plain code, with no server-only imports.

/** The sections under a family that a guest may open. Anything not listed (a new route, access, settings) stays closed. */
const GUEST_SECTIONS = new Set(['almanac', 'atlas', 'chronicle', 'gallery', 'house', 'houses', 'needed', 'people', 'person', 'research']);
/** First path segments that are not families and that a guest must not reach: the routes for accounts and setup. */
const NOT_GUEST_ROOTS = new Set(['signin', 'setup', 'invite', 'ui', 'ui_', 'api']);
const GUEST_MEDIA = /^\/api\/(?:photo|portrait|media|research)\/[^/]+\/[^/]+$/;

/** Whether the guest host may answer a path: an allow-list, so a route added later stays closed until it is added here. */
export function guestHostAllows(rawPath: string): boolean {
  // The router matches case-insensitively and decodes the path, so compare the way it does; anything odd is refused.
  let pathname: string;
  try { pathname = decodeURIComponent(rawPath).toLowerCase(); } catch { return false; }
  if (pathname === '/' || pathname === '/api/health' || pathname === '/api/stats') return true;
  if (pathname.startsWith('/share/') || pathname.startsWith('/_serverfn/') || pathname.startsWith('/assets/')) return true;
  if (GUEST_MEDIA.test(pathname)) return true;
  const [, root, section] = pathname.split('/');
  if (!root || NOT_GUEST_ROOTS.has(root) || root.startsWith('_')) return false;
  if (!section) return /^[a-z0-9-]+$/.test(root) || /\.[a-z0-9]+$/.test(root); // a family, or a file at the root (favicon.svg)
  return GUEST_SECTIONS.has(section);
}

/** The server's default family id, for the session payload: only someone with access (a member, or a guest on a valid visit) gets it, so an anonymous visitor never sees a family id in the page data. */
export function defaultTreeFor(hasAccess: boolean, env: string | undefined = process.env.KINDRED_DEFAULT_TREE): string | undefined {
  return hasAccess ? env?.trim() || undefined : undefined;
}
