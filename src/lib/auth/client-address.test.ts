// node --test src/lib/auth/client-address.test.ts — whose address a request is counted against: the proxy's view only when
// the operator said how many proxies there are, counted from the right so a visitor cannot choose it; Cloudflare's own header
// on Workers and behind Access.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientAddress, forwardedClient, trustedProxies } from './client-address.ts';

const req = (headers: Record<string, string>) => new Request('http://localhost:4901/', { headers });
const node = { workers: false, access: false };

test('KINDRED_TRUSTED_PROXIES is a small whole number; anything else is not a number of proxies', () => {
  assert.equal(trustedProxies(undefined), 0);
  assert.equal(trustedProxies(''), 0);
  assert.equal(trustedProxies(' 1 '), 1);
  assert.equal(trustedProxies('2'), 2);
  for (const bad of ['yes', 'true', '-1', '1.5', '6', '10.0.0.1']) assert.equal(trustedProxies(bad), undefined, bad);
});

test('the proxy-written entry is taken from the right; what the visitor wrote on the left is not', () => {
  assert.equal(forwardedClient('198.51.100.7', 1), '198.51.100.7');
  assert.equal(forwardedClient('10.0.0.1, 1.2.3.4, 198.51.100.7', 1), '198.51.100.7');
  assert.equal(forwardedClient('10.0.0.1, 198.51.100.7, 172.18.0.3', 2), '198.51.100.7', 'two proxies: the outer one wrote the second from the right');
  assert.equal(forwardedClient('198.51.100.7', 2), '198.51.100.7', 'a request that skipped the outer proxy: what the inner one saw');
  assert.equal(forwardedClient('2001:db8::7', 1), '2001:db8::7');
  assert.equal(forwardedClient('198.51.100.7', 0), undefined, 'no proxies declared: never believed');
  assert.equal(forwardedClient('', 1), undefined);
  assert.equal(forwardedClient('not-an-address', 1), undefined);
  assert.equal(forwardedClient(`${'1'.repeat(80)}`, 1), undefined);
});

test('without the setting, the socket address counts, whatever the request claims', () => {
  const claims = req({ 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '198.51.100.8' });
  assert.equal(clientAddress(claims, '172.18.0.3', { ...node, hops: 0 }), '172.18.0.3');
  assert.equal(clientAddress(undefined, undefined, { ...node, hops: 0 }), 'unknown');
});

test('with the setting, the address the proxy saw; without a header, the socket', () => {
  assert.equal(clientAddress(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }), '172.18.0.3', { ...node, hops: 1 }), '198.51.100.7');
  assert.equal(clientAddress(req({}), '172.18.0.3', { ...node, hops: 1 }), '172.18.0.3');
});

test("Cloudflare's header counts on Workers and behind Access, and only there; X-Forwarded-For never on Workers", () => {
  const r = req({ 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '198.51.100.10' });
  assert.equal(clientAddress(r, undefined, { workers: true, access: false, hops: 0 }), '198.51.100.9');
  assert.equal(clientAddress(r, '172.18.0.3', { workers: false, access: true, hops: 0 }), '198.51.100.9');
  assert.equal(clientAddress(r, '172.18.0.3', { workers: false, access: false, hops: 1 }), '198.51.100.10');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '198.51.100.10' }), '203.0.113.5', { workers: true, access: false, hops: 1 }), '203.0.113.5');
});
