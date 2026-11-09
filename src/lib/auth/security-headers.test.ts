// node --test src/lib/auth/security-headers.test.ts — the headers every response carries, and the ones a route sets itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSecurityHeaders, contentSecurityPolicy, CSP_HEADER, newCspNonce } from './security-headers.ts';

const policyOf = (nonce = 'n') => {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  addSecurityHeaders(headers, { cspNonce: nonce });
  return new Map((headers.get('Content-Security-Policy') ?? '').split(';').map((d) => { const [name, ...values] = d.trim().split(/\s+/); return [name, values]; }));
};

test('a page without its own headers gets the security headers', () => {
  const headers = new Headers({ 'Content-Type': 'text/html' });
  addSecurityHeaders(headers);
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(headers.get('Content-Type'), 'text/html');
});

test('the permissions policy turns off device access, keeping only the microphone for Kindred’s own dictation', () => {
  const headers = new Headers();
  addSecurityHeaders(headers);
  const policy = headers.get('Permissions-Policy') ?? '';
  for (const off of ['camera', 'geolocation', 'payment', 'usb', 'display-capture']) assert.ok(policy.includes(`${off}=()`), off);
  assert.ok(policy.includes('microphone=(self)'));
  assert.doesNotMatch(policy, /\*/, 'no feature is open to other sites');
});

test('a page, a server function’s data and an API answer are never stored, by the browser or a shared cache', () => {
  for (const type of ['text/html; charset=utf-8', 'application/json', 'application/x-ndjson', 'text/plain']) {
    const headers = new Headers({ 'Content-Type': type });
    addSecurityHeaders(headers, { cspNonce: 'n' });
    assert.equal(headers.get('Cache-Control'), 'private, no-store', type);
  }
  const bare = new Headers();
  addSecurityHeaders(bare);
  assert.equal(bare.get('Cache-Control'), 'private, no-store', 'a response without a type, such as a redirect');
});

test('a route’s own caching is kept: a member’s photo may stay in their own browser', () => {
  for (const own of ['private, max-age=31536000, immutable', 'private, max-age=86400', 'no-store', 'private, no-store']) {
    const headers = new Headers({ 'Content-Type': 'image/jpeg', 'Cache-Control': own });
    addSecurityHeaders(headers);
    assert.equal(headers.get('Cache-Control'), own);
  }
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
  assert.equal(headers.get('Content-Security-Policy-Report-Only'), null, 'the policy is enforced, not only reported');
});

test('the enforced policy allows exactly what the app needs, and nothing from other sites but pictures in stories', () => {
  const p = policyOf('abc');
  assert.deepEqual(p.get('default-src'), ["'self'"]);
  assert.deepEqual(p.get('script-src'), ["'self'", "'nonce-abc'"]);
  assert.deepEqual(p.get('style-src'), ["'self'", "'unsafe-inline'"], 'style attributes; no nonce here, or the browser would ignore unsafe-inline');
  assert.deepEqual(p.get('img-src'), ["'self'", 'data:', 'blob:', 'https:']);
  assert.deepEqual(p.get('font-src'), ["'self'", 'data:']);
  assert.deepEqual(p.get('connect-src'), ["'self'"]);
  assert.deepEqual(p.get('worker-src'), ["'self'"]);
  assert.deepEqual(p.get('frame-src'), ["'self'"]);
  assert.deepEqual(p.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(p.get('base-uri'), ["'self'"]);
  assert.deepEqual(p.get('form-action'), ["'self'"]);
  assert.deepEqual(p.get('object-src'), ["'none'"]);
});

test('only pages get the policy, and a route’s own stricter one is left alone', () => {
  const json = new Headers({ 'Content-Type': 'application/json' });
  addSecurityHeaders(json, { cspNonce: 'n' });
  assert.equal(json.get(CSP_HEADER), null);

  const media = new Headers({ 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  addSecurityHeaders(media, { cspNonce: 'n' });
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
