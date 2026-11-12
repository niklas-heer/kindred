// Headers every response of the app carries, on Node and on Workers: the request middleware in src/start.ts adds them
// to whatever Start returns, pages, server routes and server functions alike. Each is added only when the response
// does not set its own, so the media route's Content-Security-Policy (and any other header a route sets) is kept.
// Built files (the hashed bundles, the favicon, the service worker) never pass through Start: server/static.ts on Node
// and the Workers asset layer serve them, with their own long caching.
//   X-Frame-Options DENY                      nobody can frame Kindred (clickjacking); the pages never need a frame.
//   Referrer-Policy strict-origin-when-cross-origin   other sites learn the origin, never a family's page address.
//   X-Content-Type-Options nosniff            a file is served as its declared type, never sniffed into a script.
//   Cross-Origin-Opener-Policy same-origin    a page another site opens cannot keep a handle on Kindred's window.
//   Permissions-Policy                        no camera, location, payment or device access, for Kindred or anything in
//                                             it; the microphone only for Kindred itself (dictation to the assistant).
export const SECURITY_HEADERS: readonly [string, string][] = [
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Permissions-Policy', 'accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(self), midi=(), payment=(), serial=(), usb=()'],
];

/**
 * Every response Start makes is someone's: a page with the family's graph in it, a server function's data, a guest's
 * view. Unless a route says otherwise (the media routes let the reader's own browser keep a picture, `private`), it is
 * neither kept by the browser after sign-out nor by any shared cache an operator puts in front.
 */
export const DEFAULT_CACHE_CONTROL = 'private, no-store';

// Enforced: a violation is blocked, and still reported to /api/csp-report so the server log names it.
export const CSP_HEADER = 'Content-Security-Policy';

/** A fresh value for script-src, one per request. */
export function newCspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The policy for HTML pages. A second layer behind the Markdown renderer: readers' text reaches the page as HTML, and only
 * scripts of our own origin or carrying this request's nonce may run. The server-rendered inline scripts (hydration data,
 * the theme and Zod settings in src/routes/__root.tsx) carry the nonce; there is no 'unsafe-inline' and no 'unsafe-eval'.
 *   style-src 'unsafe-inline'   style attributes are used throughout the app for layout (positions on the tree, sizes),
 *                               and React sets them; a nonce cannot cover an attribute. So injected CSS is not stopped
 *                               here: that is left to the Markdown renderer, which never lets raw HTML through.
 *   img-src https:              stories and biographies may show pictures from other sites, by design. The assistant's
 *                               replies never load images (src/lib/markdown.ts), so a model cannot use one as a beacon.
 *   data:, blob:                image and upload previews, and the feedback screen capture's drawing of the page
 *   connect-src 'self'          a page can talk only to its own server, so injected markup could not send data elsewhere;
 *                               the AI providers are called by the server, never by the page
 *   frame-src 'self'            the research viewer shows a stored PDF in a frame
 *   challenges.cloudflare.com   script and frame, only with KINDRED_TURNSTILE_SITE_KEY and _SECRET: Turnstile's check on the
 *                               public request forms
 *   worker-src 'self'           the service worker (public/sw.js) for reminders
 */
export function contentSecurityPolicy(nonce: string, turnstile = !!(process.env.KINDRED_TURNSTILE_SITE_KEY?.trim() && process.env.KINDRED_TURNSTILE_SECRET?.trim())): string {
  // Cloudflare Turnstile on the public request forms (src/components/operator/Turnstile.tsx), only when the server has its keys:
  // its script, and the frame it draws the check in.
  const cf = turnstile ? ' https://challenges.cloudflare.com' : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${cf}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    `frame-src 'self'${cf}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
  ].join('; ');
}

const isLocal = (hostname: string) => /^(localhost|127\.|\[::1\]$)/.test(hostname) || hostname.endsWith('.localhost');

export interface SecurityHeaderOptions {
  /** This request's nonce. Without one (the dev server) a page gets no policy. */
  cspNonce?: string;
  /** Workers answer directly, with no proxy in front to add HSTS; behind Caddy the app sees http and Caddy adds it. */
  requestUrl?: string;
}

/** Sets each security header `headers` does not already have, the default caching, and the page-only ones for an HTML response. */
export function addSecurityHeaders(headers: Headers, { cspNonce, requestUrl }: SecurityHeaderOptions = {}): void {
  for (const [name, value] of SECURITY_HEADERS) if (!headers.has(name)) headers.set(name, value);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', DEFAULT_CACHE_CONTROL);
  const html = headers.get('Content-Type')?.includes('text/html');
  if (cspNonce && html && !headers.has('Content-Security-Policy')) headers.set(CSP_HEADER, contentSecurityPolicy(cspNonce));
  if (requestUrl && !headers.has('Strict-Transport-Security')) {
    const { protocol, hostname } = new URL(requestUrl);
    if (protocol === 'https:' && !isLocal(hostname)) headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
}
