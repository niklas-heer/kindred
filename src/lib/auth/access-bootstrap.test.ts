// node --test src/lib/auth/access-bootstrap.test.ts — the first Cloudflare Access sign-in on an empty server. The account
// gets the server's first family exactly as passkey setup makes it (the same makeFirstFamily), and is its steward.
// A failed provisioning makes no account. Scratch data folder and accounts database only; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

const dir = mkdtempSync(join(tmpdir(), 'kindred-access-bootstrap-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
for (const k of ['KINDRED_SETUP_CODE', 'KINDRED_REQUIRE_SETUP_CODE', 'KINDRED_DEFAULT_TREE', 'KINDRED_ORIGIN']) delete process.env[k];

const { accessConfig, verifyAccessToken } = await import('./access.server.ts');
const { getSession } = await import('./session.server.ts');
const store = await import('./store.server.ts');
const { families } = await import('./trees.server.ts');

test.after(() => {
  void import('../store/node.ts').then((m) => m.closeAccounts());
  rmSync(dir, { recursive: true, force: true });
});

// A real Access token, verified against a local key set, as the Cf-Access-Jwt-Assertion header carries it.
const config = accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'family.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-bootstrap' })!;
const { publicKey, privateKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
const tokenFor = (email: string) =>
  new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setIssuer(config.team).setAudience(config.aud).setExpirationTime('5m').sign(privateKey);
const verified = (r: Request) => verifyAccessToken(r.headers.get('cf-access-jwt-assertion'), config, keys);
const signIn = async (email: string, headers: Record<string, string> = {}) =>
  getSession(new Request('https://family.example.org/', { headers: { 'cf-access-jwt-assertion': await tokenFor(email), ...headers } }), verified);

test('a failed first family makes no account, and a setup code keeps Access from claiming stewardship', async () => {
  process.env.KINDRED_SETUP_CODE = 'required';
  const coded = await signIn('anna@example.org');
  assert.equal(coded.user, null, 'with a setup code, Access does not make the first account');
  delete process.env.KINDRED_SETUP_CODE;
  assert.equal(await store.userCount(), 0);
  assert.deepEqual(await families(), []);

  process.env.KINDRED_DEFAULT_TREE = 'Not A Family';
  const broken = await signIn('anna@example.org');
  delete process.env.KINDRED_DEFAULT_TREE;
  assert.equal(broken.user, null, 'the first account is not made when its family cannot be');
  assert.equal(await store.userCount(), 0, 'and no empty-membership account is left behind');
  assert.deepEqual(await families(), []);
});

test('the first Access sign-in on an empty server makes its family in the reader’s language, and is its steward', async () => {
  const session = await signIn('anna@example.org', { 'accept-language': 'de-DE,de;q=0.9', cookie: 'kindred_locale_guest=en' });
  assert.equal(session.user?.email, 'anna@example.org');
  assert.equal(session.via, 'access');
  assert.equal(await store.userCount(), 1);

  const made = await families();
  assert.deepEqual(made.map((f) => [f.id, f.name]), [['family', 'Our family']], 'the guest cookie outranks Accept-Language: English');
  assert.deepEqual((await store.membershipsOf(session.user!.id)).map((m) => [m.tree, m.role]), [['family', 'steward']]);
});

test('a later Access identity is not the steward and makes no second family', async () => {
  const later = await signIn('bea@example.org', { 'accept-language': 'de' });
  assert.equal(later.user, null, 'a stranger is signed out, not invited');
  assert.equal(later.uninvitedEmail, 'bea@example.org');
  assert.equal(await store.userCount(), 1);
  assert.deepEqual((await families()).map((f) => f.id), ['family']);
});
