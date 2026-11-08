// Headers every response of the app carries, on Node and on Workers: the request middleware in src/start.ts adds them
// to whatever Start returns, pages, server routes and server functions alike. Each is added only when the response
// does not set its own, so the media route's Content-Security-Policy (and any other header a route sets) is kept.
//   X-Frame-Options DENY                      nobody can frame Kindred (clickjacking); the pages never need a frame.
//   Referrer-Policy strict-origin-when-cross-origin   other sites learn the origin, never a family's page address.
//   X-Content-Type-Options nosniff            a file is served as its declared type, never sniffed into a script.
export const SECURITY_HEADERS: readonly [string, string][] = [
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Content-Type-Options', 'nosniff'],
];

// Report-only for now: a violation is logged (/api/csp-report) and nothing is blocked. Once a release shows no reports,
// rename this to Content-Security-Policy to enforce it.
export const CSP_HEADER = 'Content-Security-Policy-Report-Only';

/** A fresh value for script-src, one per request. */
export function newCspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The policy for HTML pages. A second layer behind the Markdown renderer: readers' text reaches the page as HTML, and only
 * scripts of our own origin or carrying this request's nonce may run.
 *   style-src 'unsafe-inline'   style attributes are used throughout the app
 *   img-src https:              stories may show pictures from other sites
 *   data:, blob:                image and upload previews, and the feedback screen capture's drawing of the page
 *   connect-src 'self'          a page can talk only to its own server, so injected markup could not send data elsewhere
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "frame-src 'self'",
    "worker-src 'self'",
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

/** Sets each security header `headers` does not already have, and the page-only ones for an HTML response. */
export function addSecurityHeaders(headers: Headers, { cspNonce, requestUrl }: SecurityHeaderOptions = {}): void {
  for (const [name, value] of SECURITY_HEADERS) if (!headers.has(name)) headers.set(name, value);
  const html = headers.get('Content-Type')?.includes('text/html');
  if (cspNonce && html && !headers.has('Content-Security-Policy')) headers.set(CSP_HEADER, contentSecurityPolicy(cspNonce));
  if (requestUrl && !headers.has('Strict-Transport-Security')) {
    const { protocol, hostname } = new URL(requestUrl);
    if (protocol === 'https:' && !isLocal(hostname)) headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
}
