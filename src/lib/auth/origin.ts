// The site's own origin. Plain code with no server-only imports: src/start.ts uses it in the CSRF check, and the client
// bundle contains that file too (it is only ever run on the server).

/** The site's own origin: KINDRED_ORIGIN when set (behind a proxy the request's own address is not the site's), else the request's. */
export function siteOrigin(request: Request): URL {
  const configured = process.env.KINDRED_ORIGIN?.trim();
  return new URL(configured ? new URL(configured).origin : new URL(request.url).origin);
}

/** Whether a request's Origin header names this site (the CSRF check). */
export const originAllowed = (origin: string, request: Request) => origin === siteOrigin(request).origin;
