// node --test src/lib/auth/oidc.test.ts — single sign-on with OpenID Connect (src/lib/auth/oidc.server.ts, oidc-jwt.server.ts):
// the ID token's checks (signature, `alg: none`, a wrong key, key rotation, iss, aud, azp, exp, iat, nonce), the issuer rules
// (Microsoft's shared tenants refused), and whole flows against a fake provider answering through a faked fetch (its own
// signing keys, a token endpoint that checks PKCE): state, nonce and PKCE misuse, a replayed callback, another browser's
// callback, open redirects, a link race, a disabled provider's callback, trusted emails, invitations, the fresh proof, the
// last-operator rule, the guest host, a demo and a preview. No network. Scratch accounts database; invented names.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-oidc-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'oidc-test-secret';
for (const k of ['KINDRED_AUTH', 'KINDRED_AUTH_METHODS', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_ORIGIN', 'KINDRED_GUEST_ORIGIN', 'KINDRED_DEMO']) delete process.env[k];

const store = await import('./store.server.ts');
const o = await import('./oidc.server.ts');
const jwt = await import('./oidc-jwt.server.ts');
const { issuerProblem, cleanScopes, OIDC_PRESETS, MICROSOFT_PERSONAL_ISSUER, trustEmailOffered, providerWarnings } = await import('./oidc.ts');
const { onRequestReadOnly } = await import('../read-only.ts');
type Jwk = import('./oidc-jwt.server.ts').Jwk;
const { AuthError } = await import('./errors.ts');
const { q } = await import('../store/index.ts');

const SITE = 'http://family.example.org';
const ISSUER = 'https://id.example.net';
const CLIENT = 'kindred-client';
const SECRET = 'client-secret-value';
const noAudit = () => q('SELECT 1');

// ---------- the fake provider ----------

const b64u = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');
type Key = { kid: string; alg: string; priv: CryptoKey; jwk: JsonWebKey & { kid: string } };
async function rsaKey(kid: string): Promise<Key> {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const { kty, n, e } = await crypto.subtle.exportKey('jwk', k.publicKey);
  return { kid, alg: 'RS256', priv: k.privateKey, jwk: { kty, n, e, kid, use: 'sig', alg: 'RS256' } };
}
async function ecKey(kid: string): Promise<Key> {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', k.publicKey);
  return { kid, alg: 'ES256', priv: k.privateKey, jwk: { kty, crv, x, y, kid, use: 'sig' } };
}
async function sign(key: Key, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64u(JSON.stringify({ alg: key.alg, typ: 'JWT', kid: key.kid, ...header }));
  const c = b64u(JSON.stringify(claims));
  const params = key.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  const sig = new Uint8Array(await crypto.subtle.sign(params, key.priv, new TextEncoder().encode(`${h}.${c}`)));
  return `${h}.${c}.${b64u(sig)}`;
}

const k1 = await rsaKey('k1');
const k2 = await rsaKey('k2');
const stranger = await rsaKey('k1'); // same kid, another key: a forger's
const ec = await ecKey('e1');
const nowS = () => Math.floor(Date.now() / 1000);

const idp = {
  keys: [k1.jwk] as JsonWebKey[],
  signer: k1,
  jwksFetches: 0,
  /** Codes it handed out: what the token for each says, and the PKCE challenge it was asked with. */
  codes: new Map<string, { claims: Record<string, unknown>; challenge: string; redirect: string }>(),
  tokenCalls: [] as { auth: string | null; body: URLSearchParams }[],
  discovery: { issuer: ISSUER } as Record<string, unknown>,
};
function resetIdp() {
  idp.keys = [k1.jwk];
  idp.signer = k1;
  idp.jwksFetches = 0;
  idp.codes.clear();
  idp.tokenCalls = [];
  idp.discovery = {
    issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`,
    id_token_signing_alg_values_supported: ['RS256', 'ES256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  };
}
const sha256b64u = async (s: string) => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

o.setOidcFetch(async (url, init) => {
  if (url === `${ISSUER}/.well-known/openid-configuration`) return reply(idp.discovery);
  // Microsoft's personal accounts, faked: their discovery names the consumer tenant's issuer; the endpoints are the fake's.
  if (url === `${MICROSOFT_PERSONAL_ISSUER}/.well-known/openid-configuration`) return reply({ ...idp.discovery, issuer: MICROSOFT_PERSONAL_ISSUER });
  if (url === `${ISSUER}/jwks`) {
    idp.jwksFetches++;
    return reply({ keys: idp.keys });
  }
  if (url === `${ISSUER}/token` && init?.method === 'POST') {
    const body = new URLSearchParams(String(init.body));
    const auth = (init.headers as Record<string, string>).authorization ?? null;
    idp.tokenCalls.push({ auth, body });
    if (auth !== `Basic ${btoa(`${CLIENT}:${SECRET}`)}`) return reply({ error: 'invalid_client' }, 401);
    const issued = idp.codes.get(body.get('code') ?? '');
    // A code works once, for the redirect URI and the PKCE challenge it was issued for.
    idp.codes.delete(body.get('code') ?? '');
    if (!issued || issued.redirect !== body.get('redirect_uri') || issued.challenge !== (await sha256b64u(body.get('code_verifier') ?? ''))) return reply({ error: 'invalid_grant' }, 400);
    return reply({ access_token: 'x', token_type: 'Bearer', id_token: await sign(idp.signer, issued.claims) });
  }
  return new Response('not found', { status: 404 });
});

// ---------- the browser ----------

const TABLES = ['oidc_flow', 'totp', 'session', 'oidc_identity', 'auth_provider', 'credential', 'password', 'membership', 'invite', 'join_request', 'instance_setting', 'operator_audit', 'signup', 'family_admin', 'terms_acceptance', 'user'];
beforeEach(async () => {
  resetIdp();
  await store.accounts().batch(TABLES.map((t) => store.q(`DELETE FROM ${t}`)));
  await store.accounts().run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', ?, 0)", JSON.stringify(['passkey', 'oidc']));
});
afterEach(() => {
  for (const k of ['KINDRED_GUEST_ORIGIN', 'KINDRED_DEMO']) delete process.env[k];
  onRequestReadOnly(() => undefined);
});
after(async () => {
  o.setOidcFetch(null);
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

const provider = (patch: Partial<Parameters<typeof o.saveProvider>[0]> = {}) =>
  o.saveProvider({ id: 'example', kind: 'generic', label: 'Example ID', issuer: ISSUER, clientId: CLIENT, secret: SECRET, scopes: 'openid email profile', trustEmail: false, enabled: true, ...patch }, noAudit);

async function account(name: string, o2: { operator?: boolean; email?: string; passkey?: boolean; verified?: boolean } = {}) {
  const made = store.newUser(name, o2.email ?? null, undefined, null, o2.verified);
  await store.accounts().batch([
    made.insert, store.q('UPDATE user SET operator = ? WHERE id = ?', o2.operator ? 1 : 0, made.user.id),
    ...(o2.passkey ? [store.insertCredential({ id: `pk-${made.user.id}`, user: made.user.id, publicKey: new Uint8Array([1]), counter: 0, transports: [], device: 'Mac', synced: false })] : []),
  ]);
  return (await store.userById(made.user.id))!;
}

/** A browser: its cookies, kept across requests as a browser would. */
class Browser {
  cookies = new Map<string, string>();
  origin: string;
  constructor(origin = SITE) { this.origin = origin; }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  request(path: string) { return new Request(`${this.origin}${path}`, { headers: { cookie: this.header() } }); }
  take(setCookie: string) {
    const [pair, ...attrs] = setCookie.split('; ');
    const i = pair.indexOf('=');
    if (attrs.includes('Max-Age=0')) this.cookies.delete(pair.slice(0, i));
    else this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  async signInAs(user: string, proved = true, method: 'passkey' | 'password' | 'email-code' = 'passkey') {
    const { token } = await store.createSession(user, null, proved, method);
    this.cookies.set('kindred_session', token);
  }
}

/** Starts a flow in `b`; returns the authorization request's parameters. */
async function start(b: Browser, input: Parameters<typeof o.startOidc>[1], user?: Awaited<ReturnType<typeof account>>) {
  const { url, cookie } = await o.startOidc(b.request('/api/auth/oidc-start'), { provider: 'example', ...input }, user);
  b.take(cookie);
  return new URL(url).searchParams;
}

/** The provider signs the person in and hands out a code for that authorization request. */
function authorize(params: URLSearchParams, claims: Record<string, unknown> = {}) {
  const code = `code-${crypto.randomUUID()}`;
  idp.codes.set(code, {
    challenge: params.get('code_challenge')!, redirect: params.get('redirect_uri')!,
    claims: { iss: ISSUER, aud: CLIENT, sub: 'subject-1', iat: nowS(), exp: nowS() + 300, nonce: params.get('nonce'), auth_time: nowS(), ...claims },
  });
  return code;
}

async function callback(b: Browser, state: string | null, code: string, extra = '') {
  const qs = new URLSearchParams({ ...(state ? { state } : {}), code });
  const r = await o.finishOidc(b.request(`/api/auth/oidc/example/callback?${qs}${extra}`), 'example');
  for (const c of r.cookies) b.take(c);
  return r;
}

const sessionsOf = (user: string) => store.accounts().all<{ method: string; provider: string | null; proved_via: string | null }>('SELECT method, provider, proved_via FROM session WHERE user = ?', user);
const identityOf = (sub: string) => store.accounts().get<{ user: string; email: string | null; email_verified: number }>('SELECT * FROM oidc_identity WHERE provider = ? AND subject = ?', 'example', sub);

/** Links `sub` at the example provider to `user`, through the account menu's flow. */
async function linked(user: Awaited<ReturnType<typeof account>>, sub = 'subject-1', claims: Record<string, unknown> = {}) {
  const b = new Browser();
  await b.signInAs(user.id);
  const p = await start(b, { purpose: 'link', next: '/settings' }, user);
  const r = await callback(b, p.get('state'), authorize(p, { sub, ...claims }));
  assert.equal(r.location, '/settings?oidc=linked');
  return b;
}

// ---------- the ID token ----------

test('an ID token: a good one passes; a wrong iss, aud, azp, an expired one, iat ahead, a wrong nonce are refused', async () => {
  const x = { issuer: ISSUER, clientId: CLIENT, nonce: 'n1', algorithms: ['RS256', 'ES256'] };
  const keys = async () => [k1.jwk as Jwk, ec.jwk as Jwk];
  const base = { iss: ISSUER, aud: CLIENT, sub: 's', iat: nowS(), exp: nowS() + 60, nonce: 'n1' };
  assert.equal((await jwt.verifyIdToken(await sign(k1, base), keys, x)).sub, 's');
  assert.equal((await jwt.verifyIdToken(await sign(ec, base), keys, x)).sub, 's', 'ES256 works too');
  const refused = async (claims: Record<string, unknown>, reason: RegExp) =>
    assert.rejects(jwt.verifyIdToken(await sign(k1, { ...base, ...claims }), keys, x), reason);
  await refused({ iss: `${ISSUER}/` }, /iss/);
  await refused({ aud: 'someone-else' }, /aud/);
  await refused({ aud: [CLIENT, 'other'] }, /azp/);
  await refused({ azp: 'other' }, /azp/);
  await refused({ exp: nowS() - 120 }, /exp/);
  await refused({ iat: nowS() + 600 }, /iat/);
  await refused({ nonce: 'n2' }, /nonce/);
  await refused({ nonce: undefined }, /nonce/);
  await refused({ sub: '' }, /sub/);
  assert.equal((await jwt.verifyIdToken(await sign(k1, { ...base, aud: [CLIENT, 'other'], azp: CLIENT }), keys, x)).sub, 's', 'several audiences with azp');
});

test('an ID token: unsigned (alg none), HMAC, a forged signature and an algorithm the provider does not use are refused', async () => {
  const x = { issuer: ISSUER, clientId: CLIENT, nonce: 'n1' };
  const keys = async () => [k1.jwk as Jwk];
  const claims = { iss: ISSUER, aud: CLIENT, sub: 's', iat: nowS(), exp: nowS() + 60, nonce: 'n1' };
  const unsigned = `${b64u(JSON.stringify({ alg: 'none' }))}.${b64u(JSON.stringify(claims))}.`;
  await assert.rejects(jwt.verifyIdToken(unsigned, keys, x), /alg none/);
  const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(JSON.stringify(k1.jwk)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const h = `${b64u(JSON.stringify({ alg: 'HS256', kid: 'k1' }))}.${b64u(JSON.stringify(claims))}`;
  const hs = `${h}.${b64u(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(h))))}`;
  await assert.rejects(jwt.verifyIdToken(hs, keys, x), /alg HS256/, 'a public key used as an HMAC secret');
  await assert.rejects(jwt.verifyIdToken(await sign(stranger, claims), keys, x), /signature/, 'the right kid, the wrong key');
  await assert.rejects(jwt.verifyIdToken(await sign(ec, claims), async () => [ec.jwk as Jwk], x), /alg ES256/, 'RS256 only when discovery says nothing');
  const [hd, cl, sg] = (await sign(k1, claims)).split('.');
  await assert.rejects(jwt.verifyIdToken(`${hd}.${b64u(JSON.stringify({ ...claims, sub: 'admin' }))}.${sg}`, keys, x), /signature/, 'changed claims');
  void cl;
});

test('an ID token signed with a new key: the keys are fetched again once (rotation)', async () => {
  const x = { issuer: ISSUER, clientId: CLIENT, nonce: 'n1' };
  const asked: boolean[] = [];
  const keys = async (refresh: boolean) => { asked.push(refresh); return refresh ? [k1.jwk, k2.jwk] as Jwk[] : [k1.jwk as Jwk]; };
  const claims = { iss: ISSUER, aud: CLIENT, sub: 's', iat: nowS(), exp: nowS() + 60, nonce: 'n1' };
  assert.equal((await jwt.verifyIdToken(await sign(k2, claims), keys, x)).sub, 's');
  assert.deepEqual(asked, [false, true]);
});

// ---------- the issuer ----------

test('issuers: https only (or this machine), no query; Microsoft’s shared tenants refused, a tenant id required', () => {
  assert.equal(issuerProblem('https://accounts.google.com'), null);
  assert.equal(issuerProblem('http://127.0.0.1:9000/realms/family'), null);
  assert.equal(issuerProblem('http://id.example.net'), 'oidc.err.issuer');
  assert.equal(issuerProblem('https://id.example.net/?x=1'), 'oidc.err.issuer');
  assert.equal(issuerProblem('https://{host}/application/o/{slug}/'), 'oidc.err.issuer');
  for (const t of ['common', 'organizations', 'Common']) assert.equal(issuerProblem(`https://login.microsoftonline.com/${t}/v2.0`), 'oidc.err.entra_common');
  // `consumers` is still refused, with an error that points to the personal-accounts preset.
  for (const t of ['consumers', 'Consumers']) assert.equal(issuerProblem(`https://login.microsoftonline.com/${t}/v2.0`), 'oidc.err.entra_consumers');
  assert.equal(issuerProblem('https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0'), 'oidc.err.entra_tenant');
  assert.equal(issuerProblem('https://login.microsoftonline.com/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0/v2.0'), null);
  assert.equal(cleanScopes('email openid, profile email'), 'openid email profile');
  assert.equal(cleanScopes('openid "x"'), null);
});

test('the console refuses Microsoft’s common tenant, an issuer whose discovery names another, and a changed issuer', async () => {
  await assert.rejects(provider({ issuer: 'https://login.microsoftonline.com/common/v2.0' }), /oidc\.err\.entra_common/);
  idp.discovery.issuer = 'https://evil.example';
  await assert.rejects(provider(), /oidc\.err\.discovery/);
  resetIdp();
  await provider();
  await assert.rejects(provider({ issuer: 'https://other.example.net' }), /oidc\.err\.issuer_fixed/);
  const sealed = (await o.providerById('example'))!.secret_sealed!;
  assert.ok(sealed.startsWith('s1.') && !sealed.includes(SECRET), 'the client secret is sealed');
});

// ---------- flows ----------

test('a sign-in: PKCE S256, state and nonce sent; an unknown subject has no account; a linked one signs in with a new session', async () => {
  await provider();
  const ada = await account('Ada Example', { passkey: true });
  const b = new Browser();
  const p = await start(b, { purpose: 'signin', next: '/families' });
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('redirect_uri'), `${SITE}/api/auth/oidc/example/callback`);
  assert.equal(p.get('scope'), 'openid email profile');
  assert.ok(p.get('state') && p.get('nonce') && p.get('state') !== p.get('nonce'));
  assert.equal(p.get('max_age'), null);
  assert.equal((await callback(b, p.get('state'), authorize(p))).location, '/signin?oidc_error=no_account');
  assert.equal(b.cookies.has('kindred_session'), false);

  await linked(ada);
  const p2 = await start(b, { purpose: 'signin', next: '/families' });
  const r = await callback(b, p2.get('state'), authorize(p2));
  assert.equal(r.location, '/families');
  assert.ok(b.cookies.get('kindred_session'));
  const s = await store.sessionByToken(b.cookies.get('kindred_session')!);
  assert.equal(s?.user, ada.id);
  assert.equal(s?.method, 'oidc');
  assert.equal(s?.provider, 'example');
  const call = idp.tokenCalls.at(-1)!;
  assert.equal(call.body.get('grant_type'), 'authorization_code');
  assert.equal(call.body.get('redirect_uri'), `${SITE}/api/auth/oidc/example/callback`);
  assert.equal(call.body.get('client_secret'), null, 'the secret goes in the Basic header, not the body');
});

test('a replayed callback, an unknown state, a missing state and another browser’s callback are refused', async () => {
  await provider();
  const ada = await account('Ada Example');
  await linked(ada);
  const b = new Browser();
  const p = await start(b, { purpose: 'signin' });
  const code = authorize(p);
  assert.equal((await callback(b, p.get('state'), code)).location, '/');
  b.cookies.delete('kindred_session');
  assert.equal((await callback(b, p.get('state'), code)).location, '/signin?oidc_error=expired', 'the state works once');
  assert.equal(b.cookies.has('kindred_session'), false);
  assert.equal((await callback(b, 'A'.repeat(43), code)).location, '/signin?oidc_error=expired');
  assert.equal((await callback(b, null, code)).location, '/signin?oidc_error=expired');

  // An attacker starts a flow in their own browser and sends the callback link to someone else's: it does nothing there.
  const attacker = new Browser();
  const pa = await start(attacker, { purpose: 'signin' });
  const victim = new Browser();
  assert.equal((await callback(victim, pa.get('state'), authorize(pa))).location, '/signin?oidc_error=expired');
  assert.equal(victim.cookies.has('kindred_session'), false);
});

test('PKCE and nonce misuse: a code from another flow fails at the token endpoint; a token with another nonce is refused', async () => {
  await provider();
  const ada = await account('Ada Example');
  await linked(ada);
  const b = new Browser();
  const first = await start(b, { purpose: 'signin' });
  const second = await start(b, { purpose: 'signin' });
  // The first flow's code with the second flow's state: the second's verifier does not match the first's challenge.
  assert.equal((await callback(b, second.get('state'), authorize(first))).location, '/signin?oidc_error=provider');
  const third = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, third.get('state'), authorize(third, { nonce: first.get('nonce') }))).location, '/signin?oidc_error=token');
  const fourth = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, fourth.get('state'), authorize(fourth, { iss: 'https://evil.example' }))).location, '/signin?oidc_error=token');
  const fifth = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, fifth.get('state'), authorize(fifth, { aud: 'another-client' }))).location, '/signin?oidc_error=token');
  const sixth = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, sixth.get('state'), authorize(sixth, { exp: nowS() - 600 }))).location, '/signin?oidc_error=token');
  idp.signer = stranger;
  const seventh = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, seventh.get('state'), authorize(seventh))).location, '/signin?oidc_error=token', 'signed with a key the provider never published');
  assert.equal(b.cookies.has('kindred_session'), false);
  // The provider said no.
  idp.signer = k1;
  const eighth = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, eighth.get('state'), authorize(eighth), '&error=access_denied')).location, '/signin?oidc_error=denied');
});

test('the provider rotates its keys: a token with a new key id signs in after one more fetch of the keys', async () => {
  await provider();
  const ada = await account('Ada Example');
  await linked(ada);
  const fetched = idp.jwksFetches;
  idp.keys = [k1.jwk, k2.jwk];
  idp.signer = k2;
  const b = new Browser();
  const p = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, p.get('state'), authorize(p))).location, '/');
  assert.equal(idp.jwksFetches, fetched + 1);
});

test('no open redirects: `next` is only ever a path on this site', async () => {
  await provider();
  const ada = await account('Ada Example');
  await linked(ada);
  for (const next of ['//evil.example/x', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/ok?x=1']) {
    const b = new Browser();
    const p = await start(b, { purpose: 'signin', next });
    const { location } = await callback(b, p.get('state'), authorize(p));
    assert.equal(location, next === '/ok?x=1' ? '/ok?x=1' : '/', next);
  }
});

test('a link race: two accounts linking the same identity at once; one wins, the other is told it belongs elsewhere', async () => {
  await provider();
  const [ada, bo] = [await account('Ada Example'), await account('Bo Example')];
  const [ba, bb] = [new Browser(), new Browser()];
  await ba.signInAs(ada.id);
  await bb.signInAs(bo.id);
  const [pa, pb] = [await start(ba, { purpose: 'link' }, ada), await start(bb, { purpose: 'link' }, bo)];
  const results = await Promise.all([callback(ba, pa.get('state'), authorize(pa, { sub: 'shared' })), callback(bb, pb.get('state'), authorize(pb, { sub: 'shared' }))]);
  assert.deepEqual(results.map((r) => r.location.includes('oidc=linked')).sort(), [false, true]);
  assert.ok(results.some((r) => r.location.endsWith('oidc_error=linked_elsewhere')));
  assert.equal((await store.accounts().all('SELECT * FROM oidc_identity')).length, 1);
});

test('linking needs a signed-in session with a fresh proof, and one identity per provider per account', async () => {
  await provider();
  const ada = await account('Ada Example');
  const b = new Browser();
  await b.signInAs(ada.id, false);
  await assert.rejects(start(b, { purpose: 'link' }, ada), (e: Error) => e instanceof AuthError && e.code === 'reauth');
  await assert.rejects(start(new Browser(), { purpose: 'link' }, ada), /oidc\.err\.session/);
  await linked(ada, 'first');
  const b2 = new Browser();
  await b2.signInAs(ada.id);
  await assert.rejects(start(b2, { purpose: 'link' }, ada), /oidc\.err\.already_linked/);
});

test('an email finds an account only with trust_email on and email_verified true', async () => {
  await provider();
  const ada = await account('Ada Example', { email: 'ada@example.org' });
  const tryIt = async (claims: Record<string, unknown>) => {
    const b = new Browser();
    const p = await start(b, { purpose: 'signin' });
    return (await callback(b, p.get('state'), authorize(p, { sub: `s-${crypto.randomUUID()}`, ...claims }))).location;
  };
  assert.equal(await tryIt({ email: 'ada@example.org', email_verified: true }), '/signin?oidc_error=no_account', 'trust_email is off by default');
  await provider({ trustEmail: true, secret: undefined });
  assert.equal(await tryIt({ email: 'ada@example.org', email_verified: false }), '/signin?oidc_error=no_account');
  assert.equal(await tryIt({ email: 'ada@example.org' }), '/signin?oidc_error=no_account');
  // Pre-hijacking: Ada's address came from an invitation a steward typed, which nobody verified. Someone who controls that
  // address at the provider must not take over her account through it.
  assert.equal(await tryIt({ email: 'ada@example.org', email_verified: true }), '/signin?oidc_error=no_account', 'an unverified address on the account finds nothing');
  assert.equal(await store.accounts().get('SELECT 1 FROM oidc_identity'), undefined);
  await store.accounts().run('UPDATE user SET email_verified = 1 WHERE id = ?', ada.id);
  assert.equal(await tryIt({ email: 'ada@example.org', email_verified: true }), '/');
  assert.equal((await store.accounts().get<{ user: string }>('SELECT user FROM oidc_identity'))?.user, ada.id);
  assert.equal(await o.verifiedEmailOf(ada.id), 'ada@example.org', 'the signup lane’s verified email');
});

test('an invitation taken with single sign-on: a new account in the family; the same identity again is refused', async () => {
  await provider();
  const steward = await account('Steward Example');
  const { token } = await store.createInvite({ tree: 'family-one', role: 'editor', email: null, createdBy: steward.id });
  const b = new Browser();
  await assert.rejects(start(b, { purpose: 'invite', token, name: '' }), /name/);
  const p = await start(b, { purpose: 'invite', token, name: 'Cleo Example' });
  const r = await callback(b, p.get('state'), authorize(p, { sub: 'cleo', email: 'cleo@example.org', email_verified: true }));
  assert.equal(r.location, '/family-one');
  const id = await identityOf('cleo');
  const cleo = await store.userById(id!.user);
  assert.equal(cleo?.name, 'Cleo Example');
  assert.equal(cleo?.email, 'cleo@example.org');
  assert.equal(cleo?.email_verified, 1, 'the provider vouched for the address the account got');
  assert.equal((await store.accounts().get<{ role: string }>('SELECT role FROM membership WHERE user = ? AND tree = ?', cleo!.id, 'family-one'))?.role, 'editor');
  assert.deepEqual((await sessionsOf(cleo!.id)).map((s) => s.method), ['oidc']);

  const again = await store.createInvite({ tree: 'family-one', role: 'viewer', email: null, createdBy: steward.id });
  const b2 = new Browser();
  const p2 = await start(b2, { purpose: 'invite', token: again.token, name: 'Cleo Again' });
  assert.equal((await callback(b2, p2.get('state'), authorize(p2, { sub: 'cleo' }))).location, '/signin?oidc_error=account_exists');
  await assert.rejects(start(new Browser(), { purpose: 'invite', token, name: 'Late Example' }), /oidc\.err\.invite_gone/, 'the first invitation is used');
});

test('an invitation’s typed address is not verified until a provider vouches for that very address', async () => {
  await provider();
  const steward = await account('Steward Example');
  const { token } = await store.createInvite({ tree: 'family-one', role: 'viewer', email: 'dora@example.org', createdBy: steward.id });
  const b = new Browser();
  const p = await start(b, { purpose: 'invite', token, name: 'Dora Example' });
  await callback(b, p.get('state'), authorize(p, { sub: 'dora', email: 'someone.else@example.org', email_verified: true }));
  const dora = await store.userById((await identityOf('dora'))!.user);
  assert.equal(dora?.email, 'dora@example.org');
  assert.equal(dora?.email_verified, 0, 'the steward typed it; the provider vouched for another');
  // A sign-in where her provider vouches for her own address verifies it.
  const b2 = new Browser();
  const p2 = await start(b2, { purpose: 'signin' });
  assert.equal((await callback(b2, p2.get('state'), authorize(p2, { sub: 'dora', email: 'dora@example.org', email_verified: false }))).location, '/');
  assert.equal((await store.userById(dora!.id))?.email_verified, 0, 'not while the provider does not vouch for it');
  const p3 = await start(b2, { purpose: 'signin' });
  await callback(b2, p3.get('state'), authorize(p3, { sub: 'dora', email: 'dora@example.org', email_verified: true }));
  assert.equal((await store.userById(dora!.id))?.email_verified, 1);
});

test('a fresh proof by single sign-on: max_age=0 and prompt=login; an old auth_time does not count', async () => {
  await provider();
  const ada = await account('Ada Example');
  const b = await linked(ada);
  await store.accounts().run('UPDATE session SET proved = NULL, proved_via = NULL');
  const p = await start(b, { purpose: 'proof', next: '/operator' }, ada);
  assert.equal(p.get('max_age'), '0');
  assert.equal(p.get('prompt'), 'login');
  assert.equal((await callback(b, p.get('state'), authorize(p, { auth_time: nowS() - 3600 }))).location, '/operator?oidc_error=proof');
  const p2 = await start(b, { purpose: 'proof', next: '/operator' }, ada);
  assert.equal((await callback(b, p2.get('state'), authorize(p2, { auth_time: undefined }))).location, '/operator?oidc_error=proof');
  const p3 = await start(b, { purpose: 'proof', next: '/operator' }, ada);
  assert.equal((await callback(b, p3.get('state'), authorize(p3, { sub: 'someone-else' }))).location, '/operator?oidc_error=not_linked');
  const p4 = await start(b, { purpose: 'proof', next: '/operator' }, ada);
  assert.equal((await callback(b, p4.get('state'), authorize(p4))).location, '/operator?oidc=proved');
  assert.equal((await sessionsOf(ada.id))[0].proved_via, 'oidc');
});

test('a disabled provider: its sessions end, a callback in flight is refused, and an operator keeps a way in', async () => {
  await provider();
  const ada = await account('Ada Example', { passkey: true });
  await linked(ada);
  const b = new Browser();
  const p = await start(b, { purpose: 'signin' });
  const code = authorize(p);
  const signedIn = new Browser();
  const ps = await start(signedIn, { purpose: 'signin' });
  await callback(signedIn, ps.get('state'), authorize(ps));
  assert.equal((await sessionsOf(ada.id)).filter((s) => s.method === 'oidc').length, 1);
  await provider({ enabled: false, secret: undefined });
  assert.equal((await sessionsOf(ada.id)).filter((s) => s.method === 'oidc').length, 0, 'its sessions ended');
  assert.match((await callback(b, p.get('state'), code)).location, /oidc_error=(provider_off|expired)/);
  assert.equal(b.cookies.has('kindred_session'), false);
  await assert.rejects(start(new Browser(), { purpose: 'signin' }), /oidc\.err\.provider_off/);

  // An operator whose only way in is this provider: turning it off, or removing it, is refused.
  await provider({ enabled: true, secret: undefined });
  const op = await account('Operator Example', { operator: true });
  await linked(op, 'op-subject');
  await assert.rejects(provider({ enabled: false, secret: undefined }), /pw\.err\.operator_locked_out/);
  await assert.rejects(o.deleteProvider('example', noAudit), /pw\.err\.operator_locked_out/);
  assert.equal((await o.providerById('example'))?.enabled, 1);
});

test('removing single sign-on from an account: never the last way in', async () => {
  await provider();
  const ada = await account('Ada Example');
  const b = await linked(ada);
  const req = b.request('/x');
  await assert.rejects(o.unlinkMine(req, ada, 'example'), /pw\.err\.last_way_in/);
  await store.accounts().batch([store.insertCredential({ id: 'pk-ada', user: ada.id, publicKey: new Uint8Array([1]), counter: 0, transports: [], device: 'Mac', synced: false })]);
  await o.unlinkMine(req, ada, 'example');
  assert.equal(await identityOf('subject-1'), undefined);
});

test('nothing on the guest host, in a demo, in a preview, or with single sign-on off', async () => {
  await provider();
  const ada = await account('Ada Example');
  await linked(ada);
  process.env.KINDRED_GUEST_ORIGIN = 'http://guests.example.org';
  const guest = new Browser('http://guests.example.org');
  await assert.rejects(start(guest, { purpose: 'signin' }), /oidc\.err\.off/);
  const b = new Browser();
  const p = await start(b, { purpose: 'signin' });
  const onGuestHost = new Browser('http://guests.example.org');
  onGuestHost.cookies = b.cookies;
  const r = await o.finishOidc(onGuestHost.request(`/api/auth/oidc/example/callback?state=${p.get('state')}&code=${authorize(p)}`), 'example');
  assert.equal(r.location, '/signin?oidc_error=off');
  assert.deepEqual(r.cookies, []);
  delete process.env.KINDRED_GUEST_ORIGIN;

  process.env.KINDRED_DEMO = '1';
  await assert.rejects(start(new Browser(), { purpose: 'signin' }), /oidc\.err\.off/);
  delete process.env.KINDRED_DEMO;

  const viewer = new Browser();
  await viewer.signInAs(ada.id);
  onRequestReadOnly(() => new AuthError('forbidden', 'A preview changes nothing.'));
  await assert.rejects(start(viewer, { purpose: 'link' }, ada), /preview/);
  onRequestReadOnly(() => undefined);

  await store.accounts().run("UPDATE instance_setting SET value = ? WHERE key = 'auth_methods'", JSON.stringify(['passkey']));
  await assert.rejects(start(new Browser(), { purpose: 'signin' }), /oidc\.err\.off/);
  assert.deepEqual(await o.signInProviders(), []);
});

// ---------- council round 7: starting a family by signing in at a provider ----------

test('sign-up with single sign-on: a verified email makes the sign-up verified (past the waiting list); unverified waits; an identity signs up once', async () => {
  const [opSettings, hosting, turnstile] = await Promise.all([import('../operator/settings.server.ts'), import('../signup/settings.server.ts'), import('../operator/turnstile.server.ts')]);
  process.env.KINDRED_TURNSTILE_SITE_KEY = 'site-key';
  process.env.KINDRED_TURNSTILE_SECRET = 'secret';
  turnstile.setTurnstileVerifier(async (token) => token === 'good');
  try {
    const op = await account('Orla Operator', { operator: true, passkey: true });
    const s = await opSettings.instanceSettings();
    await store.accounts().batch([
      ...hosting.saveHosting({ ...(await hosting.hostingSettings()), mode: 'hosting', unverified: 'waitlist' }, op.id),
      ...opSettings.saveSettings({ ...s, impressum: 'Orla, 1 Example Street', privacy: 'We keep what you write.', terms: 'Be kind.', defaultCapBytes: 500_000_000, familyCreation: 'signup' }, op.id),
    ]);
    await provider();
    assert.deepEqual((await hosting.signupState()).methods, ['passkey', 'oidc']);
    const form = (familyId: string, email: string) => ({ purpose: 'signup', name: 'Wren Example', familyName: `The ${familyId}`, familyId, email, accept: true, age16: true, turnstile: 'good' });

    // Turnstile is checked before the browser leaves for the provider.
    await assert.rejects(start(new Browser(), { ...form('wrens', 'wren@example.org'), turnstile: 'bad' }), /turnstile|Turnstile/i);
    const b = new Browser();
    const p = await start(b, form('wrens', 'wren@example.org'));
    const r = await callback(b, p.get('state'), authorize(p, { sub: 'wren', email: 'Wren@Example.org', email_verified: true }));
    assert.equal(r.location, '/wrens');
    const wren = (await identityOf('wren'))!.user;
    assert.equal((await store.userById(wren))?.email, 'wren@example.org', 'the provider verified it: it becomes the account’s');
    assert.equal((await store.accounts().get<{ verified: number }>('SELECT verified FROM signup WHERE user = ?', wren))?.verified, 1);
    assert.equal((await store.accounts().get<{ role: string }>("SELECT role FROM membership WHERE user = ? AND tree = 'wrens'", wren))?.role, 'steward');
    assert.deepEqual((await sessionsOf(wren)).map((x) => x.method), ['oidc']);

    // The provider does not vouch for the email: on the waiting list, no account is made.
    const b2 = new Browser();
    const p2 = await start(b2, form('finches', 'finch@example.org'));
    assert.equal((await callback(b2, p2.get('state'), authorize(p2, { sub: 'finch', email: 'finch@example.org', email_verified: false }))).location, '/signup?oidc_error=signup_unverified');
    assert.equal(await identityOf('finch'), undefined);

    // The same identity again: it has an account already.
    const b3 = new Browser();
    const p3 = await start(b3, form('robins', 'robin@example.org'));
    assert.equal((await callback(b3, p3.get('state'), authorize(p3, { sub: 'wren', email: 'wren@example.org', email_verified: true }))).location, '/signup?oidc_error=account_exists');

    // Someone signed in starts a family with their own account, never a second one made here.
    const signedIn = new Browser();
    await signedIn.signInAs(op.id);
    await assert.rejects(start(signedIn, form('larks', 'lark@example.org')), /signed in/);
  } finally {
    turnstile.setTurnstileVerifier(undefined);
    delete process.env.KINDRED_TURNSTILE_SITE_KEY;
    delete process.env.KINDRED_TURNSTILE_SECRET;
  }
});

// ---------- the guided setup (accounts migration 0059) ----------

test('presets: Google’s issuer, Microsoft personal accounts by the consumer tenant’s fixed issuer, Entra still per tenant', () => {
  assert.equal(OIDC_PRESETS.google.issuer, 'https://accounts.google.com');
  assert.equal(OIDC_PRESETS.microsoft.issuer, 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0');
  assert.equal(issuerProblem(OIDC_PRESETS.microsoft.issuer), null, 'the fixed issuer passes the issuer rules');
  assert.equal(issuerProblem(OIDC_PRESETS.google.issuer), null);
  assert.match(OIDC_PRESETS.entra.issuer, /\{tenant\}/);
  for (const k of ['authentik', 'keycloak', 'entra'] as const) assert.ok(OIDC_PRESETS[k], k);
});

test('Microsoft personal accounts: trusting emails is never offered nor accepted, and the preset keeps its issuer', async () => {
  assert.equal(trustEmailOffered('microsoft', MICROSOFT_PERSONAL_ISSUER), false);
  assert.equal(trustEmailOffered('generic', MICROSOFT_PERSONAL_ISSUER), false, 'the issuer decides, whatever the preset');
  assert.equal(trustEmailOffered('google', 'https://accounts.google.com'), true);
  await assert.rejects(provider({ kind: 'microsoft', issuer: MICROSOFT_PERSONAL_ISSUER, trustEmail: true }), /oidc\.err\.trust_email_microsoft/);
  await assert.rejects(provider({ kind: 'generic', issuer: MICROSOFT_PERSONAL_ISSUER, trustEmail: true }), /oidc\.err\.trust_email_microsoft/);
  await assert.rejects(provider({ kind: 'microsoft', issuer: ISSUER }), /oidc\.err\.microsoft_issuer/);
  await provider({ kind: 'microsoft', issuer: MICROSOFT_PERSONAL_ISSUER });
  assert.equal((await o.listProviders())[0].issuer, MICROSOFT_PERSONAL_ISSUER, 'the faked discovery document names the fixed issuer');
});

test('Microsoft personal accounts: a sign-in works by sub, and its email never counts as verified', async () => {
  await provider({ kind: 'microsoft', issuer: MICROSOFT_PERSONAL_ISSUER });
  const ada = await account('Ada Example', { email: 'ada@example.org' });
  const b = await linked(ada, 'msa-1', { iss: MICROSOFT_PERSONAL_ISSUER, email: 'ada@example.org', email_verified: true });
  assert.equal((await identityOf('msa-1'))?.email_verified, 0, 'Microsoft does not guarantee the email claim');
  assert.equal((await store.userById(ada.id))?.email_verified, 0, 'nor does it verify the account’s address');
  const p = await start(b, { purpose: 'signin' });
  assert.equal((await callback(b, p.get('state'), authorize(p, { sub: 'msa-1', iss: MICROSOFT_PERSONAL_ISSUER }))).location, '/');
});

/** An operator, signed in in a browser of their own, with a provider saved but still off and single sign-on not on. */
async function testSetup() {
  await store.accounts().run("UPDATE instance_setting SET value = ? WHERE key = 'auth_methods'", JSON.stringify(['passkey']));
  const op = await account('Olive Operator', { operator: true, passkey: true });
  await provider({ enabled: false });
  const b = new Browser();
  await b.signInAs(op.id, false);
  return { op, b };
}
const NEXT = '/operator/sso-test?provider=example';
const row = async () => (await store.accounts().get<{ tested_at: number | null; last_success: number | null; last_error: string | null; last_error_at: number | null }>('SELECT * FROM auth_provider WHERE id = ?', 'example'))!;
const counts = async () => Promise.all(['user', 'session', 'oidc_identity'].map(async (t) => (await store.accounts().get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))!.n));

test('the operator’s test sign-in: the real flow on a provider still off; it signs nobody in, makes no account, links nothing', async () => {
  const { op, b } = await testSetup();
  const before = await counts();
  const sessionCookie = b.cookies.get('kindred_session');
  const p = await start(b, { purpose: 'test', next: NEXT }, op);
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.ok(p.get('state') && p.get('nonce') && p.get('code_challenge'));
  assert.equal(p.get('redirect_uri'), `${SITE}/api/auth/oidc/example/callback`);
  const r = await callback(b, p.get('state'), authorize(p, { sub: 'someone-new', email: 'new@example.org', email_verified: true }));
  assert.equal(r.location, `${NEXT}&oidc_test=ok`);
  assert.deepEqual(r.cookies, [], 'no session cookie');
  assert.equal(b.cookies.get('kindred_session'), sessionCookie);
  assert.deepEqual(await counts(), before, 'no account, no session, no identity');
  const after = await row();
  assert.ok(after.tested_at && after.last_success, 'tested, and a good sign-in for the health');
  assert.equal(idp.tokenCalls.length, 1);
  // The state works once.
  assert.equal((await callback(b, p.get('state'), authorize(p))).location, '/signin?oidc_error=expired');
});

test('the test sign-in belongs to the operator’s own session in their own browser', async () => {
  const { op, b } = await testSetup();
  const relative = await account('Rowan Relative', { passkey: true });
  const rb = new Browser();
  await rb.signInAs(relative.id);
  await assert.rejects(start(rb, { purpose: 'test', next: NEXT }, relative), /oidc\.err\.test_operator/);
  await assert.rejects(start(new Browser(), { purpose: 'test', next: NEXT }, op), /oidc\.err\.session/, 'signed in elsewhere');

  // The callback link in another browser does nothing there.
  const p = await start(b, { purpose: 'test', next: NEXT }, op);
  const other = new Browser();
  await other.signInAs(op.id);
  assert.match((await callback(other, p.get('state'), authorize(p))).location, /oidc_test=expired/);
  assert.equal((await row()).tested_at, null);

  // Signed out in the meantime: the session is gone, nothing is tested and the provider is never asked for a token.
  const p2 = await start(b, { purpose: 'test', next: NEXT }, op);
  await store.accounts().run('DELETE FROM session WHERE user = ?', op.id);
  assert.equal((await callback(b, p2.get('state'), authorize(p2))).location, `${NEXT}&oidc_test=session`);
  assert.equal(idp.tokenCalls.length, 0);
  assert.equal((await row()).tested_at, null);

  // A relative's sign-in flow cannot use a provider that is off; only the test can.
  await assert.rejects(start(new Browser(), { purpose: 'signin' }), /oidc\.err\.off/);
});

test('the test follows the console’s rule: an operator signed in by password or emailed code needs two-step codes, at the start and at the callback', async () => {
  const { op } = await testSetup();
  const { beginTotp } = await import('./totp.server.ts');
  for (const [method, refusal] of [['password', /pw\.err\.operator_needs_totp/], ['email-code', /email\.err\.operator_code_totp/]] as const) {
    const b = new Browser();
    await b.signInAs(op.id, false, method);
    await assert.rejects(start(b, { purpose: 'test', next: NEXT }, op), refusal, method);
  }
  // With two-step codes on, a password session may test; turned off while the provider has the browser, the callback refuses.
  assert.ok(await beginTotp(op.id));
  await store.accounts().run('UPDATE totp SET confirmed_at = ? WHERE user = ?', Date.now(), op.id);
  const b = new Browser();
  await b.signInAs(op.id, false, 'password');
  const p = await start(b, { purpose: 'test', next: NEXT }, op);
  await store.accounts().run('DELETE FROM totp WHERE user = ?', op.id);
  assert.equal((await callback(b, p.get('state'), authorize(p))).location, `${NEXT}&oidc_test=test_operator`);
  assert.equal(idp.tokenCalls.length, 0, 'the provider is never asked for a token');
  assert.equal((await row()).tested_at, null);
  // No longer an operator by the callback: the same refusal.
  const pk = new Browser();
  await pk.signInAs(op.id, false);
  const p2 = await start(pk, { purpose: 'test', next: NEXT }, op);
  await store.accounts().run('UPDATE user SET operator = 0 WHERE id = ?', op.id);
  assert.equal((await callback(pk, p2.get('state'), authorize(p2))).location, `${NEXT}&oidc_test=test_operator`);
  assert.equal((await row()).tested_at, null);
});

test('the test reports the provider’s error, and the health keeps it until a sign-in works again', async () => {
  const { op, b } = await testSetup();
  // Cancelled or refused at the provider: its words are kept.
  const p = await start(b, { purpose: 'test', next: NEXT }, op);
  assert.equal((await callback(b, p.get('state'), authorize(p), '&error=unauthorized_client&error_description=The+client+is+not+registered')).location, `${NEXT}&oidc_test=denied`);
  assert.match((await row()).last_error ?? '', /unauthorized_client: The client is not registered/);
  // A wrong client secret: the token endpoint's own error.
  await provider({ enabled: false, secret: 'not-the-secret' });
  const p2 = await start(b, { purpose: 'test', next: NEXT }, op);
  assert.equal((await callback(b, p2.get('state'), authorize(p2))).location, `${NEXT}&oidc_test=provider`);
  assert.match((await row()).last_error ?? '', /invalid_client/);
  assert.equal((await row()).tested_at, null);
  const view = (await o.listProviders())[0];
  assert.deepEqual(providerWarnings(view, Date.now()).map((w) => w.kind), ['failing']);
  // Fixed: the test works, and the error is no longer shown.
  await provider({ enabled: false, secret: SECRET });
  const p3 = await start(b, { purpose: 'test', next: NEXT }, op);
  assert.equal((await callback(b, p3.get('state'), authorize(p3))).location, `${NEXT}&oidc_test=ok`);
  assert.deepEqual(providerWarnings((await o.listProviders())[0], Date.now() + 1), []);
  // A changed secret needs a new test.
  assert.ok((await row()).tested_at);
  await provider({ enabled: false, secret: 'another-secret' });
  assert.equal((await row()).tested_at, null);
});

test('a discovery that fails stops the test before the provider and is shown; a made-up code at a sign-in is not', async () => {
  const { op, b } = await testSetup();
  idp.discovery.issuer = 'https://evil.example';
  await assert.rejects(start(b, { purpose: 'test', next: NEXT }, op), /oidc\.err\.discovery/);
  assert.match((await row()).last_error ?? '', /discovery issuer/);
  resetIdp();
  // Anyone can start a sign-in and come back with a code of their own making: that says nothing about the provider.
  await provider();
  await store.accounts().run("UPDATE instance_setting SET value = ? WHERE key = 'auth_methods'", JSON.stringify(['passkey', 'oidc']));
  await store.accounts().run('UPDATE auth_provider SET last_error = NULL, last_error_at = NULL');
  const sb = new Browser();
  const p = await start(sb, { purpose: 'signin' });
  assert.equal((await callback(sb, p.get('state'), 'made-up-code')).location, '/signin?oidc_error=provider');
  assert.equal((await row()).last_error, null);
});

test('the secret’s expiry: stored, shown, refused when not a day, and warned about 30 days before', async () => {
  await assert.rejects(provider({ secretExpires: '2027-02-30' }), /oidc\.err\.secret_expires/);
  await provider({ kind: 'microsoft', issuer: MICROSOFT_PERSONAL_ISSUER, secretExpires: '2027-05-31' });
  const view = (await o.listProviders())[0];
  assert.equal(view.secretExpires, '2027-05-31');
  const at = (day: string) => Date.parse(`${day}T12:00:00Z`);
  const kinds = (now: number) => providerWarnings(view, now).map((w) => w.kind);
  assert.deepEqual(kinds(at('2027-04-30')), [], '31 days before');
  assert.deepEqual(providerWarnings(view, at('2027-05-02')), [{ kind: 'secret_expiring', day: '2027-05-31', days: 29 }]);
  assert.deepEqual(kinds(at('2027-05-31')), ['secret_expired']);
  await provider({ kind: 'microsoft', issuer: MICROSOFT_PERSONAL_ISSUER, secretExpires: '' });
  assert.equal((await o.listProviders())[0].secretExpires, null, 'cleared');
});

test('Google’s six-month deletion: a warning at five months without a sign-in, only while it is on', () => {
  const base = { kind: 'google' as const, issuer: 'https://accounts.google.com', enabled: true, secretExpires: null, lastError: null, lastErrorAt: null };
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const google = { ...base, created: day('2026-01-10'), lastSuccess: day('2026-03-15') };
  assert.deepEqual(providerWarnings(google, day('2026-08-14')), [], 'just under five months');
  assert.deepEqual(providerWarnings(google, day('2026-08-15')), [{ kind: 'google_idle', since: day('2026-03-15') }]);
  assert.deepEqual(providerWarnings({ ...google, lastSuccess: null }, day('2026-06-10')), [{ kind: 'google_idle', since: day('2026-01-10') }], 'never used: counted from when it was added');
  assert.deepEqual(providerWarnings({ ...google, enabled: false }, day('2027-01-01')), []);
  assert.deepEqual(providerWarnings({ ...google, kind: 'keycloak', issuer: 'https://id.example.net/realms/x' }, day('2027-01-01')), [], 'other providers keep their clients');
});

test('saving a provider records in the operator’s audit whether it was tested, and when; a new secret is untested again', async () => {
  const details: Record<string, unknown>[] = [];
  const audit = (d: Record<string, unknown>) => { details.push(d); return q('SELECT 1'); };
  const save = (patch: Partial<Parameters<typeof o.saveProvider>[0]> = {}) =>
    o.saveProvider({ id: 'example', kind: 'generic', label: 'Example ID', issuer: ISSUER, clientId: CLIENT, scopes: 'openid email profile', trustEmail: false, enabled: false, ...patch }, audit);
  await save({ secret: SECRET });
  assert.deepEqual([details.at(-1)!.tested, details.at(-1)!.testedAt], [false, null], 'a new provider is untested');
  const at = Date.now() - 1000;
  await store.accounts().run('UPDATE auth_provider SET tested_at = ? WHERE id = ?', at, 'example');
  // Enabling it is never refused for want of a test: the test proves the provider answers, not that it is safe.
  await save({ enabled: true });
  assert.deepEqual([details.at(-1)!.enabled, details.at(-1)!.tested, details.at(-1)!.testedAt], [true, true, at]);
  await save({ enabled: true, secret: 'another-secret' });
  assert.deepEqual([details.at(-1)!.tested, details.at(-1)!.testedAt], [false, null], 'a new secret has not been tested');
});
