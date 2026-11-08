// node --test src/lib/auth/security-headers.test.ts — the headers every response carries, and the ones a route sets itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSecurityHeaders, contentSecurityPolicy, CSP_HEADER, newCspNonce } from './security-headers.ts';

test('a page without its own headers gets the three security headers', () => {
  const headers = new Headers({ 'Content-Type': 'text/html' });
  addSecurityHeaders(headers);
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Content-Type'), 'text/html');
});

test('a route’s own headers, such as the media route’s Content-Security-Policy, are kept', () => {
  const headers = new Headers({ 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  addSecurityHeaders(headers);
  assert.equal(headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(headers.get('X-Frame-Options'), 'DENY', 'the missing one is still added');
});

test('an HTML page gets a policy carrying this request’s nonce', () => {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  addSecurityHeaders(headers, { cspNonce: 'abc123' });
  const policy = headers.get(CSP_HEADER) ?? '';
  assert.match(policy, /script-src 'self' 'nonce-abc123'/);
  for (const part of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", 'report-uri /api/csp-report']) assert.ok(policy.includes(part), part);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe/, 'no script may be allowed by an unsafe keyword');
});

test('only pages get the policy, and a route’s own stricter one is left alone', () => {
  const json = new Headers({ 'Content-Type': 'application/json' });
  addSecurityHeaders(json, { cspNonce: 'n' });
  assert.equal(json.get(CSP_HEADER), null);

  const media = new Headers({ 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  addSecurityHeaders(media, { cspNonce: 'n' });
  assert.equal(media.get(CSP_HEADER), null);
  assert.equal(media.get('Content-Security-Policy'), "default-src 'none'; sandbox");
});

test('the dev server has no nonce, so its pages get no policy', () => {
  const headers = new Headers({ 'Content-Type': 'text/html' });
  addSecurityHeaders(headers);
  assert.equal(headers.get(CSP_HEADER), null);
});

test('HSTS is sent only over https to a public host', () => {
  const hsts = (requestUrl: string) => {
    const headers = new Headers();
    addSecurityHeaders(headers, { requestUrl });
    return headers.get('Strict-Transport-Security');
  };
  assert.equal(hsts('https://kindred.example.org/x'), 'max-age=31536000');
  assert.equal(hsts('http://app:4901/x'), null, 'behind Caddy the app sees http');
  assert.equal(hsts('https://localhost:8787/x'), null);
  assert.equal(hsts('https://127.0.0.1/x'), null);
  assert.equal(hsts('https://family.localhost/x'), null);
});

test('each request gets its own nonce, safe to place in a header', () => {
  const a = newCspNonce();
  assert.notEqual(a, newCspNonce());
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
  assert.ok(contentSecurityPolicy(a).includes(`'nonce-${a}'`));
});
