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

/** Sets each security header `headers` does not already have. */
export function addSecurityHeaders(headers: Headers): void {
  for (const [name, value] of SECURITY_HEADERS) if (!headers.has(name)) headers.set(name, value);
}
