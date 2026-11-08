// The site's own origin. Plain code with no server-only imports: src/start.ts uses it in the CSRF check, and the client
// bundle contains that file too (it is only ever run on the server).

/** The site's own origin: KINDRED_ORIGIN when set (behind a proxy the request's own address is not the site's), else the request's. */
export function siteOrigin(request: Request): URL {
  const configured = process.env.KINDRED_ORIGIN?.trim();
  return new URL(configured ? new URL(configured).origin : new URL(request.url).origin);
}

/** The guest host, when this site has one (KINDRED_GUEST_ORIGIN): where a share link's relatives come in. See guest-host.ts. */
export function guestOrigin(): URL | undefined {
  const configured = process.env.KINDRED_GUEST_ORIGIN?.trim();
  return configured ? new URL(new URL(configured).origin) : undefined;
}

/** Whether a request came in on the guest host. */
export function onGuestHost(request: Request): boolean {
  const guest = guestOrigin();
  return !!guest && new URL(request.url).host === guest.host;
}

/** The public origin of the address this request came in on: the guest host's, or else the site's. */
export const publicOrigin = (request: Request): URL => (onGuestHost(request) ? guestOrigin()! : siteOrigin(request));

/** Whether a request's Origin header names the address it came in on (the CSRF check). */
export const originAllowed = (origin: string, request: Request) => origin === publicOrigin(request).origin;
