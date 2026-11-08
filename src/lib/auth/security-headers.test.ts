// node --test src/lib/auth/security-headers.test.ts — the headers every response carries, and the ones a route sets itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSecurityHeaders } from './security-headers.ts';

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
