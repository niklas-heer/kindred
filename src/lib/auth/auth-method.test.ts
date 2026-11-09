// node --test src/lib/auth/auth-method.test.ts — exactly one sign-in method per installation (KINDRED_AUTH): each method alone,
// what happens to a forged token or header under each, the refusals, and guests. Scratch data folder and accounts database only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

const dir = mkdtempSync(join(tmpdir(), 'kindred-auth-method-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
for (const k of ['KINDRED_AUTH', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_SETUP_CODE', 'KINDRED_REQUIRE_SETUP_CODE', 'KINDRED_DEFAULT_TREE', 'KINDRED_ORIGIN', 'KINDRED_GUEST_ORIGIN']) delete process.env[k];

const { accessConfig, verifyAccessToken } = await import('./access.server.ts');
const { accessEmail, accessLogoutUrl, authMethod, authRefusal, authSetting } = await import('./method.server.ts');
const { getSession } = await import('./session.server.ts');
const { claimFirstSteward, joinWithInvite } = await import('./access-join.server.ts');
const passkeys = await import('./passkeys.server.ts');
const store = await import('./store.server.ts');
const share = await import('./share.server.ts');
const { families } = await import('./trees.server.ts');

const TEAM = 'family.cloudflareaccess.com';
const AUD = 'aud-method';
const SITE = 'http://family.example.org/';
const config = accessConfig({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD })!;
const { publicKey, privateKey } = await generateKeyPair('RS256');
const attacker = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });

const tokenFor = (email: string, key: CryptoKey = privateKey) =>
  new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setIssuer(config.team).setAudience(config.aud).setExpirationTime('5m').sign(key);

/** The real verification, against a local key set, counting how often it was asked. */
let verifications = 0;
const verified = (r: Request) => { verifications++; return verifyAccessToken(r.headers.get('cf-access-jwt-assertion'), config, keys); };
const session = (headers: Record<string, string> = {}, url = SITE) => getSession(new Request(url, { headers }), verified);
const withToken = async (email: string, headers: Record<string, string> = {}) => session({ 'cf-access-jwt-assertion': await tokenFor(email), ...headers });

const useKindred = () => { process.env.KINDRED_AUTH = 'kindred'; };
const useAccess = () => { process.env.KINDRED_AUTH = 'cloudflare-access'; process.env.CF_ACCESS_TEAM_DOMAIN = TEAM; process.env.CF_ACCESS_AUD = AUD; };
const clearAuth = () => { for (const k of ['KINDRED_AUTH', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_SETUP_CODE', 'KINDRED_GUEST_ORIGIN']) delete process.env[k]; };

async function account(name: string, email: string | null) {
  const made = store.newUser(name, email);
  await store.accounts().batch([made.insert]);
  return made.user;
}
const cookieFor = async (user: string) => ({ cookie: `kindred_session=${(await store.createSession(user)).token}` });
const wipeAccounts = () => store.accounts().batch(['membership', 'invite', 'session', 'credential', 'user'].map((t) => store.q(`DELETE FROM ${t}`)));

beforeEach(() => { verifications = 0; });
afterEach(clearAuth);
after(async () => {
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

test('the setting: one method, or a refusal, never a guess', () => {
  const access = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  assert.deepEqual(authSetting({}), { method: 'kindred' }, 'an install with no Access settings keeps what it always did');
  assert.deepEqual(authSetting({ KINDRED_AUTH: '  ' }), { method: 'kindred' }, 'empty is unset (Compose passes empty values)');
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'Kindred', ...access }), { method: 'kindred' }, 'an explicit kindred ignores leftover Access settings');
  assert.equal(authSetting({ KINDRED_AUTH: 'CLOUDFLARE-ACCESS', ...access }).method, 'cloudflare-access');

  assert.deepEqual(authSetting(access), { method: null, problem: 'ambiguous' }, 'Access settings without a choice: the two answers lock out different people');
  assert.deepEqual(authSetting({ CF_ACCESS_AUD: AUD }), { method: null, problem: 'ambiguous' });
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'passkeys' }), { method: null, problem: 'unknown-value' });
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'cloudflare-access' }), { method: null, problem: 'needs-access-settings' });
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'cloudflare-access', CF_ACCESS_TEAM_DOMAIN: TEAM }), { method: null, problem: 'needs-access-settings' });
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'cloudflare-access', CF_ACCESS_AUD: AUD }), { method: null, problem: 'needs-access-settings' });
  assert.deepEqual(authSetting({ KINDRED_AUTH: 'cloudflare-access', CF_ACCESS_TEAM_DOMAIN: 'evil.example/x?y', CF_ACCESS_AUD: AUD }), { method: null, problem: 'bad-team-domain' });
});

test('kindred ignores a valid Access token completely, even with the Access settings left in place', async () => {
  useKindred();
  process.env.CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.CF_ACCESS_AUD = AUD;
  const s = await withToken('anna@example.org');
  assert.equal(s.user, null);
  assert.equal(s.uninvitedEmail, undefined);
  assert.equal(verifications, 0, 'the token is not even looked at');
  assert.equal(await store.userCount(), 0, 'and no first account is made from it');
  assert.equal(await accessEmail(new Request(SITE, { headers: { 'cf-access-jwt-assertion': await tokenFor('anna@example.org') } })), undefined);
  assert.equal(accessLogoutUrl(), undefined);
});

test('kindred: a plain Access email header and a forged token open nothing', async () => {
  useKindred();
  const s = await session({ 'cf-access-authenticated-user-email': 'anna@example.org', 'cf-access-jwt-assertion': await tokenFor('anna@example.org', attacker.privateKey) });
  assert.equal(s.user, null);
  assert.equal(s.uninvitedEmail, undefined);
  assert.equal(verifications, 0);
});

test('kindred: the session cookie decides, whatever Access token comes with it', async () => {
  useKindred();
  const dora = await account('Dora', 'dora@example.org');
  const s = await withToken('someone-else@example.org', await cookieFor(dora.id));
  assert.equal(s.user?.id, dora.id);
  assert.equal(s.via, 'passkey');
  assert.equal(verifications, 0);
  await wipeAccounts();
});

test('cloudflare-access: the first verified identity is the steward of the first family; a later one is not', async () => {
  useAccess();
  const first = await withToken('anna@example.org');
  assert.equal(first.user?.email, 'anna@example.org');
  assert.equal(first.via, 'access');
  assert.deepEqual((await store.membershipsOf(first.user!.id)).map((m) => [m.tree, m.role]), [['family', 'steward']]);
  assert.deepEqual((await families()).map((f) => f.id), ['family']);
  const later = await withToken('bea@example.org');
  assert.equal(later.user, null);
  assert.equal(later.uninvitedEmail, 'bea@example.org');
  assert.equal(accessLogoutUrl(), '/cdn-cgi/access/logout');
});

test('cloudflare-access: a forged token, a plain email header or an old session cookie are not identities', async () => {
  useAccess();
  const anna = (await store.userByEmail('anna@example.org'))!;
  const attempts: Record<string, string>[] = [
    { 'cf-access-jwt-assertion': await tokenFor('anna@example.org', attacker.privateKey) },
    { 'cf-access-authenticated-user-email': 'anna@example.org' },
    await cookieFor(anna.id),
  ];
  for (const headers of attempts) {
    const s = await session(headers);
    assert.equal(s.user, null, JSON.stringify(Object.keys(headers)));
    assert.equal(s.uninvitedEmail, undefined);
  }
});

test('cloudflare-access: an invitation to an address joins by itself; a link names the verified address', async () => {
  useAccess();
  const anna = (await store.userByEmail('anna@example.org'))!;
  await store.createInvite({ tree: 'family', role: 'editor', email: 'cara@example.org', createdBy: anna.id });
  const cara = await withToken('cara@example.org');
  assert.equal(cara.user?.email, 'cara@example.org');
  assert.deepEqual((await store.membershipsOf(cara.user!.id)).map((m) => m.role), ['editor']);

  const { token } = await store.createInvite({ tree: 'family', role: 'contributor', email: null, createdBy: anna.id });
  const id = await joinWithInvite('bea@example.org', token, 'Bea', 'de');
  const bea = (await withToken('bea@example.org')).user!;
  assert.equal(bea.id, id);
  assert.equal(bea.name, 'Bea');
  assert.equal(bea.locale, 'de');
  assert.deepEqual((await store.membershipsOf(id)).map((m) => m.role), ['contributor']);
  await assert.rejects(joinWithInvite('dan@example.org', token, 'Dan', null), /already used/, 'a link works once');
});

test('cloudflare-access: no passkey ceremony runs, on either end', async () => {
  useAccess();
  const request = new Request(SITE);
  const off = (e: Error) => e.message === 'auth.passkeys_off';
  await assert.rejects(passkeys.signInOptions(request), off);
  await assert.rejects(passkeys.setupOptions(request, '', 'Anna'), off);
  await assert.rejects(passkeys.inviteOptions(request, 'x'.repeat(43), 'Anna'), off);
  await assert.rejects(passkeys.addOptions(request, (await store.userByEmail('anna@example.org'))!), off);
  await assert.rejects(passkeys.finishSignIn(request, 'c'.repeat(20), {} as never), off, 'a challenge from before the switch is no way in');
});

test('cloudflare-access with a setup code: the first account waits for the code, then keeps its name', async () => {
  useAccess();
  await wipeAccounts();
  process.env.KINDRED_SETUP_CODE = 'ABCD-EFGH-JKMN-PQRS';
  const waiting = await withToken('anna@example.org');
  assert.equal(waiting.user, null, 'a code protects the first account here too');
  assert.equal(waiting.uninvitedEmail, 'anna@example.org', 'and /setup knows who is asking');
  assert.equal(await store.userCount(), 0);
  await assert.rejects(claimFirstSteward('anna@example.org', 'wrong-wrong-wrong', 'Anna', '', null), /setup code/);
  assert.equal(await store.userCount(), 0);
  const { user } = await claimFirstSteward('anna@example.org', 'abcd efgh jkmn pqrs', 'Anna Lind', '', null);
  const signedIn = await withToken('anna@example.org');
  assert.equal(signedIn.user?.id, user);
  assert.equal(signedIn.user?.name, 'Anna Lind');
  assert.deepEqual((await store.membershipsOf(user)).map((m) => m.role), ['steward']);
  await assert.rejects(claimFirstSteward('bea@example.org', 'abcd efgh jkmn pqrs', 'Bea', '', null), /already set up/);
});

test('a refused setting signs nobody in, by cookie or token, and says why', async () => {
  const errors = mock.method(console, 'error', () => {});
  const anna = (await store.userByEmail('anna@example.org'))!;
  try {
    process.env.KINDRED_AUTH = 'cloudflare-access'; // no team domain, no audience
    assert.equal(authMethod(), null);
    const s = await withToken('anna@example.org', await cookieFor(anna.id));
    assert.equal(s.user, null);
    assert.equal(s.uninvitedEmail, undefined);
    assert.equal(verifications, 0, 'never falls through to checking a token it has no settings for');
    await assert.rejects(passkeys.signInOptions(new Request(SITE)), /passkeys_off/);

    const refused = authRefusal(new Request(SITE, { headers: { 'accept-language': 'de' } }))!;
    assert.equal(refused.status, 503);
    const page = await refused.text();
    assert.match(page, /CF_ACCESS_TEAM_DOMAIN/);
    assert.match(page, /Niemand kann sich anmelden/);
    assert.match(String(errors.mock.calls[0]?.arguments[0]), /Nobody can sign in/);

    process.env.KINDRED_GUEST_ORIGIN = 'http://guests.example.org';
    assert.equal(authRefusal(new Request('http://guests.example.org/share/x')), undefined, 'the guest host does not depend on sign-in');
    assert.ok(authRefusal(new Request(SITE)), 'the members’ site does');
  } finally {
    errors.mock.restore();
  }
  useKindred();
  assert.equal(authRefusal(new Request(SITE)), undefined);
});

test('a guest’s link works under either method, and is never an account', async () => {
  const anna = (await store.userByEmail('anna@example.org'))!;
  const made = await share.makeShareLink({ tree: 'family', password: false, days: 7, createdBy: anna.id });
  const visit = (await share.startGuestVisit((await share.shareLinkByToken(made.token))!))!;
  const cookie = `kindred_guest=${visit.token}`;

  useKindred();
  const underKindred = await session({ cookie });
  assert.equal(underKindred.guest?.tree, 'family');
  assert.equal(underKindred.user, null);

  useAccess();
  const underAccess = await session({ cookie });
  assert.equal(underAccess.guest?.tree, 'family');
  assert.equal(underAccess.user, null);

  process.env.KINDRED_GUEST_ORIGIN = 'http://guests.example.org';
  verifications = 0;
  const onGuestHost = await getSession(new Request('http://guests.example.org/family', { headers: { cookie, 'cf-access-jwt-assertion': await tokenFor('anna@example.org') } }), verified);
  assert.equal(onGuestHost.guest?.tree, 'family');
  assert.equal(onGuestHost.user, null, 'not even a valid Access token makes an account on the guest host');
  assert.equal(verifications, 0);
});
