// node --test src/lib/auth/access.test.ts — the Cloudflare Access checks, against a local key set.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { accessConfig, verifyAccessToken } from './access.server.ts';

const config = accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'Family.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-123' })!;
const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });

const sign = (claims: Record<string, unknown>, opts: { key?: CryptoKey; alg?: string; exp?: string | number; iss?: string; aud?: string } = {}) =>
  new SignJWT({ email: 'Anna@Example.org', ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setIssuer(opts.iss ?? 'https://family.cloudflareaccess.com')
    .setAudience(opts.aud ?? 'aud-123')
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey);

test('config normalises the team domain and needs both values', () => {
  assert.equal(config.team, 'https://family.cloudflareaccess.com');
  assert.equal(accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com' }), undefined);
  assert.equal(accessConfig({}), undefined);
  assert.throws(() => accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'evil.com/path?x', CF_ACCESS_AUD: 'a' }));
});

test('a valid token gives its email, lower-cased', async () => {
  assert.equal(await verifyAccessToken(await sign({}), config, keys), 'anna@example.org');
});

test('wrong audience, issuer, expiry, key or algorithm are refused', async () => {
  assert.equal(await verifyAccessToken(await sign({}, { aud: 'other' }), config, keys), undefined);
  assert.equal(await verifyAccessToken(await sign({}, { iss: 'https://evil.cloudflareaccess.com' }), config, keys), undefined);
  assert.equal(await verifyAccessToken(await sign({}, { exp: Math.floor(Date.now() / 1000) - 120 }), config, keys), undefined);
  assert.equal(await verifyAccessToken(await sign({}, { key: other.privateKey }), config, keys), undefined);
  const hs = await new SignJWT({ email: 'a@b.c' }).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).setIssuer(config.team).setAudience('aud-123').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('secret'));
  assert.equal(await verifyAccessToken(hs, config, keys), undefined);
  const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ email: 'a@b.c', aud: 'aud-123', iss: config.team, exp: 9e9, iat: 1 })).toString('base64url')}.`;
  assert.equal(await verifyAccessToken(none, config, keys), undefined);
});

test('missing or garbage tokens, and tokens without an email, are refused', async () => {
  assert.equal(await verifyAccessToken(undefined, config, keys), undefined);
  assert.equal(await verifyAccessToken('', config, keys), undefined);
  assert.equal(await verifyAccessToken('a.b.c', config, keys), undefined);
  assert.equal(await verifyAccessToken(await sign({ email: undefined }), config, keys), undefined);
  assert.equal(await verifyAccessToken(await sign({ email: 'not an email' }), config, keys), undefined);
});
