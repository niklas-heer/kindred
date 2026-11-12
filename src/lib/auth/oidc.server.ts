// Single sign-on with OpenID Connect, the third way into a Kindred account (./methods.server.ts turns it on). Schema in
// accounts migration 0046 (`auth_provider`, `oidc_identity`, `oidc_flow`, `session.provider`); docs/self-host.md, "Single
// sign-on", says how to register Kindred with a provider.
//
// The flow: the authorization code flow with PKCE (S256). Starting it (`startOidc`, a POST from Kindred's own pages) stores a
// short-lived row keyed by a hash of a random `state`, holding the `nonce`, the PKCE verifier, what the flow is for and a hash
// of a cookie only this browser holds; the provider sends the browser back to the exact redirect URI
// /api/auth/oidc/<provider>/callback, where `finishOidc` deletes the row first (a state works once: a replayed callback finds
// nothing), checks the browser's cookie, trades the code for an ID token (with the verifier), and checks the token
// (./oidc-jwt.server.ts) against the provider's keys, fetched from its discovery document at the issuer's fixed
// `.well-known` URL and cached in the provider's row; an unknown key id fetches the keys again (the provider rotated them).
//
// Accounts: a sign-in matches the identity (provider, `sub`) and nothing else. An email never finds an account, unless the
// operator turned on `trust_email` for that provider and the token says `email_verified`. A provider is added to an account
// only from a signed-in session with a fresh proof (`link`), or by taking an invitation with it (a new account). A fresh proof
// by single sign-on asks the provider to sign the person in again (`max_age=0`, `prompt=login`) and checks `auth_time`.
// Nothing here works on the guest host, in a demo or in a preview. After the flow, the browser goes only to a path on this site.
import { AuthError } from './errors.ts';
import { authMethod } from './method.server.ts';
import { enabledMethods, hasWayIn, methodEnabled } from './methods.server.ts';
import { callbackPath, cleanScopes, issuerProblem, OIDC_KINDS, PROVIDER_ID, secureUrl, type OidcKind, type OidcPurpose, type ProviderView, type PublicProvider } from './oidc.ts';
import { emailVerified, SKEW_S, TokenError, verifyIdToken, type IdTokenClaims, type Jwk } from './oidc-jwt.server.ts';
import { onGuestHost } from './origin.ts';
import { cleanName } from './passkeys.server.ts';
import { requireFreshProof } from './proof.server.ts';
import { seal, unseal } from './seal.server.ts';
import { guestChoice, readCookie, sessionOf, siteOrigin, startSession } from './session.server.ts';
import {
  accounts, commit, guard, inviteById, inviteUsed, isGuardError, newUser, now, openInvite, q, sessionProved, usable, useInvite, userByEmail, userById, type UserRow,
} from './store.server.ts';
import { hashToken, randomToken } from './tokens.server.ts';
import { safeNext } from './client.ts';
import { inviteAcceptance, inviteNeedsTerms, termsRefused } from '../operator/terms.server.ts';
import { refuseReadOnly } from '../read-only.ts';
import { isUniqueError, type Query } from '../store/index.ts';
import { isDemo } from '../demo.ts';

const FLOW_MS = 10 * 60_000;
const DISCOVERY_MS = 24 * 3_600_000;
const JWKS_MS = 24 * 3_600_000;
/** Keys are fetched again for an unknown key id at most this often per provider, so a stream of bad tokens cannot hammer it. */
const JWKS_REFETCH_MS = 60_000;

const invalid = (key: string) => new AuthError('invalid', key);

// ---------- talking to providers ----------

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (input, init) => fetch(input, init);
/** Tests answer for the provider here (a local JWKS and signed tokens); null puts the real fetch back. */
export function setOidcFetch(f: Fetcher | null): void {
  fetcher = f ?? ((input, init) => fetch(input, init));
}

/** A step of the flow that failed: `code` names the sentence the reader sees (`oidc.err.<code>`). */
export class OidcFail extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ?? code);
    this.code = code;
    this.name = 'OidcFail';
  }
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
  } catch (e) {
    throw new OidcFail('provider', `${url}: ${e instanceof Error ? e.message : e}`);
  }
  const text = await res.text();
  if (res.status !== 200 || text.length > 1_000_000) throw new OidcFail('provider', `${url}: HTTP ${res.status}`);
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  throw new OidcFail('provider', `${url}: not JSON`);
}

export interface Discovery {
  issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string;
  id_token_signing_alg_values_supported?: string[]; token_endpoint_auth_methods_supported?: string[];
}

const endpoint = (v: unknown) => {
  if (typeof v !== 'string') return false;
  try {
    return secureUrl(new URL(v));
  } catch {
    return false;
  }
};
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined);

/**
 * The provider's discovery document, from the issuer's fixed `.well-known` URL. Its `issuer` must be the configured issuer
 * exactly (OpenID Connect Discovery §4.3), and every endpoint https.
 */
export async function discover(issuer: string): Promise<Discovery> {
  if (issuerProblem(issuer)) throw new OidcFail('provider', 'bad issuer');
  const doc = await fetchJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (doc.issuer !== issuer) throw new OidcFail('provider', `discovery issuer ${String(doc.issuer)} is not ${issuer}`);
  if (![doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri].every(endpoint)) throw new OidcFail('provider', 'discovery endpoints');
  return {
    issuer, authorization_endpoint: doc.authorization_endpoint as string, token_endpoint: doc.token_endpoint as string, jwks_uri: doc.jwks_uri as string,
    id_token_signing_alg_values_supported: strings(doc.id_token_signing_alg_values_supported),
    token_endpoint_auth_methods_supported: strings(doc.token_endpoint_auth_methods_supported),
  };
}

// ---------- providers ----------

export interface ProviderRow {
  id: string; kind: string; label: string; issuer: string; client_id: string; secret_sealed: string | null; scopes: string;
  trust_email: number; enabled: number; discovery: string | null; discovered_at: number | null; jwks: string | null; jwks_at: number | null;
  created: number; updated: number;
}

export const providerById = (id: string) => accounts().get<ProviderRow>('SELECT * FROM auth_provider WHERE id = ?', id);
const kindOf = (k: string): OidcKind => ((OIDC_KINDS as readonly string[]).includes(k) ? (k as OidcKind) : 'generic');
const publicOf = (p: ProviderRow): PublicProvider => ({ id: p.id, label: p.label, kind: kindOf(p.kind) });

/** The providers the sign-in pages offer: none unless single sign-on is on. */
export async function signInProviders(): Promise<PublicProvider[]> {
  if (!(await methodEnabled('oidc'))) return [];
  return (await accounts().all<ProviderRow>('SELECT * FROM auth_provider WHERE enabled = 1 ORDER BY label')).map(publicOf);
}

const secretInfo = (id: string) => `oidc-client-secret:${id}`;

async function discoveryOf(p: ProviderRow): Promise<Discovery> {
  if (p.discovery && p.discovered_at && now() - p.discovered_at < DISCOVERY_MS) {
    try {
      const d = JSON.parse(p.discovery) as Discovery;
      if (d.issuer === p.issuer) return d;
    } catch {}
  }
  const d = await discover(p.issuer);
  await accounts().run('UPDATE auth_provider SET discovery = ?, discovered_at = ? WHERE id = ? AND issuer = ?', JSON.stringify(d), now(), p.id, p.issuer);
  return d;
}

const refetched = new Map<string, number>();

/** The provider's keys: the cached ones, or fetched again when they are old or a token names a key they lack. */
async function keysOf(p: ProviderRow, d: Discovery, refresh: boolean): Promise<Jwk[]> {
  const cached = (() => {
    try {
      return p.jwks ? (JSON.parse(p.jwks) as Jwk[]) : null;
    } catch {
      return null;
    }
  })();
  const age = p.jwks_at ? now() - p.jwks_at : Infinity;
  if (cached && !refresh && age < JWKS_MS) return cached;
  if (cached && refresh) {
    // A token named a key the cache lacks: fetch again, but not more than once a minute per provider (in this process).
    if (now() - (refetched.get(p.id) ?? 0) < JWKS_REFETCH_MS) return cached;
    refetched.set(p.id, now());
  }
  const doc = await fetchJson(d.jwks_uri);
  const keys = Array.isArray(doc.keys) ? (doc.keys as Jwk[]).filter((k) => k && typeof k === 'object').slice(0, 50) : [];
  p.jwks = JSON.stringify(keys);
  p.jwks_at = now();
  await accounts().run('UPDATE auth_provider SET jwks = ?, jwks_at = ? WHERE id = ?', p.jwks, p.jwks_at, p.id);
  return keys;
}

// ---------- where single sign-on may be used ----------

/** Every flow starts and ends here: Kindred's own sign-in, single sign-on on, the site's own host, a request that may write. */
async function oidcAllowed(request: Request): Promise<void> {
  if (isDemo() || authMethod() !== 'kindred' || onGuestHost(request)) throw invalid('oidc.err.off');
  refuseReadOnly();
  if (!(await methodEnabled('oidc'))) throw invalid('oidc.err.off');
}

async function enabledProvider(id: unknown): Promise<ProviderRow> {
  const p = typeof id === 'string' && PROVIDER_ID.test(id) ? await providerById(id) : undefined;
  if (!p || !p.enabled) throw invalid('oidc.err.provider_off');
  return p;
}

// ---------- the browser's flow cookie ----------

const FLOW_COOKIE = /^[A-Za-z0-9_-]{43}$/;
const secure = (request: Request) => siteOrigin(request).protocol === 'https:';
const flowCookieName = (request: Request) => (secure(request) ? '__Host-kindred_oidc' : 'kindred_oidc');

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkceChallenge = async (verifier: string) => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

// ---------- starting a flow ----------

export interface StartInput { provider?: unknown; purpose?: unknown; next?: unknown; token?: unknown; name?: unknown; acceptTerms?: unknown }

const PURPOSES: readonly OidcPurpose[] = ['signin', 'invite', 'link', 'proof'];

/**
 * Starts a flow: returns the provider's authorization URL to send the browser to, and the flow cookie to set. `user` is the
 * signed-in reader, needed for `link` (with a fresh proof) and `proof`.
 */
export async function startOidc(request: Request, input: StartInput, user?: UserRow): Promise<{ url: string; cookie: string }> {
  await oidcAllowed(request);
  const purpose = PURPOSES.find((p) => p === input.purpose);
  if (!purpose) throw invalid('oidc.err.expired');
  const p = await enabledProvider(input.provider);
  let subject: string | null = null;
  let data: string | null = null;
  if (purpose === 'invite') {
    const invite = typeof input.token === 'string' ? await openInvite(input.token) : undefined;
    if (!invite) throw invalid('oidc.err.invite_gone');
    if (input.acceptTerms !== true && (await inviteNeedsTerms(invite))) throw termsRefused();
    data = JSON.stringify({ invite: invite.id, name: cleanName(input.name), acceptTerms: input.acceptTerms === true });
  } else if (purpose === 'link' || purpose === 'proof') {
    if (!user) throw invalid('oidc.err.session');
    const s = await sessionOf(request);
    if (!s || s.user !== user.id) throw invalid('oidc.err.session');
    const mine = await accounts().get<{ subject: string }>('SELECT subject FROM oidc_identity WHERE user = ? AND provider = ?', user.id, p.id);
    if (purpose === 'link') {
      // Adding a way in needs a fresh proof on this session, as adding a passkey or a password does.
      await requireFreshProof(request, user);
      if (mine) throw invalid('oidc.err.already_linked');
    } else if (!mine) throw invalid('oidc.err.not_linked');
    subject = `${user.id} ${s.hash}`;
  }
  const d = await discoveryOf(p).catch((e) => {
    console.error('[oidc] discovery failed for', p.id, e instanceof Error ? e.message : e);
    throw invalid('oidc.err.provider');
  });
  const state = randomToken(32);
  const nonce = randomToken(32);
  const verifier = randomToken(48);
  const existing = readCookie(request, flowCookieName(request));
  const browser = existing && FLOW_COOKIE.test(existing) ? existing : randomToken(32);
  const t = now();
  await accounts().batch([
    q('DELETE FROM oidc_flow WHERE expires < ?', t),
    q('INSERT INTO oidc_flow (hash, provider, purpose, browser, nonce, verifier, subject, next, data, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      await hashToken('oidc-state', state), p.id, purpose, await hashToken('oidc-browser', browser), nonce, verifier, subject,
      typeof input.next === 'string' ? safeNext(input.next.slice(0, 2000)) : null, data, t, t + FLOW_MS),
  ]);
  const url = new URL(d.authorization_endpoint);
  const params: Record<string, string> = {
    response_type: 'code', client_id: p.client_id, redirect_uri: `${siteOrigin(request).origin}${callbackPath(p.id)}`, scope: p.scopes,
    state, nonce, code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256',
    // A fresh proof: the provider must sign the person in again now, not reuse a session it has.
    ...(purpose === 'proof' ? { max_age: '0', prompt: 'login' } : {}),
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cookie = [`${flowCookieName(request)}=${browser}`, 'Path=/', `Max-Age=${FLOW_MS / 1000}`, 'HttpOnly', 'SameSite=Lax', ...(secure(request) ? ['Secure'] : [])].join('; ');
  return { url: url.toString(), cookie };
}

// ---------- the callback ----------

interface FlowRow { hash: string; provider: string; purpose: OidcPurpose; browser: string; nonce: string; verifier: string; subject: string | null; next: string | null; data: string | null; created: number; expires: number }
interface IdentityRow { provider: string; subject: string; user: string; email: string | null; email_verified: number }

/** Where the browser goes after a callback, and the cookies to set on the way. */
export interface CallbackResult { location: string; cookies: string[] }

/** A same-site path with one query parameter added. */
function withParam(path: string, key: string, value: string): string {
  const u = new URL(safeNext(path), 'http://x');
  u.searchParams.set(key, value);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** Trades the code for the ID token at the provider's token endpoint, with the PKCE verifier and the exact redirect URI. */
async function exchange(p: ProviderRow, d: Discovery, code: string, verifier: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  const secret = p.secret_sealed ? await unseal(secretInfo(p.id), p.secret_sealed) : '';
  if (secret === undefined) throw new OidcFail('provider', 'the client secret cannot be unsealed (KINDRED_SECRET changed?)');
  const methods = d.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
  if (!secret) body.set('client_id', p.client_id);
  else if (methods.includes('client_secret_basic')) headers.authorization = `Basic ${btoa(`${encodeURIComponent(p.client_id)}:${encodeURIComponent(secret)}`)}`;
  else {
    body.set('client_id', p.client_id);
    body.set('client_secret', secret);
  }
  const res = await fetchJson(d.token_endpoint, { method: 'POST', headers, body: body.toString() });
  if (typeof res.id_token !== 'string') throw new OidcFail('token', 'no id_token');
  return res.id_token;
}

/** The identity's email as this sign-in reports it, kept for the `signup` lane's "verified email" (verifiedEmailOf). */
const identityFacts = (c: IdTokenClaims) => ({ email: typeof c.email === 'string' ? c.email.slice(0, 254) : null, verified: emailVerified(c) ? 1 : 0 });

/** Handles the provider's redirect back. Never throws: a failure goes to a page that says what happened. */
export async function finishOidc(request: Request, providerId: string): Promise<CallbackResult> {
  let flow: FlowRow | undefined;
  try {
    return await callback(request, providerId, (f) => (flow = f));
  } catch (e) {
    const code = e instanceof OidcFail ? e.code : e instanceof AuthError && e.message.startsWith('oidc.err.') ? e.message.slice('oidc.err.'.length) : 'failed';
    if (!(e instanceof OidcFail) || ['provider', 'token', 'failed'].includes(code)) console.error('[oidc]', providerId, e instanceof Error ? e.message : e);
    const back = flow && (flow.purpose === 'link' || flow.purpose === 'proof') ? flow.next ?? '/' : '/signin';
    return { location: withParam(back, 'oidc_error', code), cookies: [] };
  }
}

async function callback(request: Request, providerId: string, seen: (f: FlowRow) => void): Promise<CallbackResult> {
  await oidcAllowed(request).catch(() => { throw new OidcFail('off'); });
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new OidcFail('expired');
  const hash = await hashToken('oidc-state', state);
  const flow = await accounts().get<FlowRow>('SELECT * FROM oidc_flow WHERE hash = ?', hash);
  if (!flow) throw new OidcFail('expired');
  // Deleting the row is the check: a state works once, so a replayed callback (or a second tab racing) finds nothing.
  if ((await accounts().run('DELETE FROM oidc_flow WHERE hash = ?', hash)).changes !== 1) throw new OidcFail('expired');
  seen(flow);
  const browser = readCookie(request, flowCookieName(request));
  // The flow belongs to the browser that started it: a callback link sent to someone else's browser does nothing there.
  if (!browser || !FLOW_COOKIE.test(browser) || (await hashToken('oidc-browser', browser)) !== flow.browser) throw new OidcFail('expired', 'browser');
  if (flow.expires < now() || flow.provider !== providerId) throw new OidcFail('expired');
  if (url.searchParams.get('error')) throw new OidcFail('denied', `provider said ${url.searchParams.get('error')}`);
  const p = await providerById(flow.provider);
  if (!p || !p.enabled) throw new OidcFail('provider_off');
  const code = url.searchParams.get('code') ?? '';
  if (!code || code.length > 4096) throw new OidcFail('expired');
  const d = await discoveryOf(p);
  const idToken = await exchange(p, d, code, flow.verifier, `${siteOrigin(request).origin}${callbackPath(p.id)}`);
  let claims: IdTokenClaims;
  try {
    claims = await verifyIdToken(idToken, (refresh) => keysOf(p, d, refresh), { issuer: p.issuer, clientId: p.client_id, nonce: flow.nonce, algorithms: d.id_token_signing_alg_values_supported });
  } catch (e) {
    throw e instanceof TokenError ? new OidcFail('token', e.message) : e;
  }
  // Whether the person signed in at the provider during this flow (not a provider session from earlier).
  const reauthenticated = typeof claims.auth_time === 'number' && claims.auth_time + SKEW_S >= Math.floor(flow.created / 1000);
  const facts = identityFacts(claims);
  const identity = await accounts().get<IdentityRow>('SELECT * FROM oidc_identity WHERE provider = ? AND subject = ?', p.id, claims.sub);
  if (identity) {
    await accounts().run('UPDATE oidc_identity SET email = ?, email_verified = ?, last_used = ? WHERE provider = ? AND subject = ?', facts.email, facts.verified, now(), p.id, claims.sub);
  }
  switch (flow.purpose) {
    case 'signin': return signIn(request, p, claims, identity, reauthenticated, flow);
    case 'invite': return takeInvite(request, p, claims, identity, reauthenticated, flow);
    case 'link': return link(request, p, claims, identity, flow);
    case 'proof': return prove(request, identity, reauthenticated, flow);
  }
}

/** A brand-new session for `user`, started by this provider; refused for a guest's account a steward has not let in yet. */
async function sessionFor(request: Request, user: string, p: ProviderRow, proved: boolean): Promise<string> {
  const allowed = await (await import('./join.server.ts')).signInAllowed(user);
  if (allowed !== 'ok') throw new OidcFail(allowed === 'pending' ? 'pending' : 'expired');
  return startSession(request, user, null, proved, 'oidc', p.id);
}

const insertIdentity = (p: ProviderRow, sub: string, user: string, facts: { email: string | null; verified: number }) =>
  q('INSERT INTO oidc_identity (provider, subject, user, email, email_verified, created, last_used) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, sub, user, facts.email, facts.verified, now(), now());

async function signIn(request: Request, p: ProviderRow, c: IdTokenClaims, identity: IdentityRow | undefined, proved: boolean, flow: FlowRow): Promise<CallbackResult> {
  let user = identity?.user;
  // The one way an email finds an account: the operator trusts this provider's emails, and it says this one is verified.
  if (!user && p.trust_email && emailVerified(c)) {
    const byEmail = await userByEmail(c.email!);
    if (byEmail) {
      try {
        await accounts().batch([insertIdentity(p, c.sub, byEmail.id, identityFacts(c))]);
      } catch (e) {
        if (!isUniqueError(e)) throw e;
        throw new OidcFail('linked_elsewhere');
      }
      user = byEmail.id;
    }
  }
  if (!user) throw new OidcFail('no_account');
  return { location: safeNext(flow.next ?? '/'), cookies: [await sessionFor(request, user, p, proved)] };
}

/** An invitation taken with this provider: a new account, joined to the family, as a passkey or a password would. */
async function takeInvite(request: Request, p: ProviderRow, c: IdTokenClaims, identity: IdentityRow | undefined, proved: boolean, flow: FlowRow): Promise<CallbackResult> {
  if (identity) throw new OidcFail('account_exists');
  const data = JSON.parse(flow.data ?? '{}') as { invite?: string; name?: string; acceptTerms?: boolean };
  const facts = identityFacts(c);
  let made: { user: string; tree: string };
  try {
    made = await commit(async () => {
      if (await accounts().get('SELECT 1 FROM oidc_identity WHERE provider = ? AND subject = ?', p.id, c.sub)) throw new OidcFail('account_exists');
      const fresh = data.invite ? await inviteById(data.invite) : undefined;
      if (!fresh || !usable(fresh)) throw new OidcFail('invite_gone');
      // The invitation's email becomes the account's address, as with a passkey; else the provider's, when it is verified.
      // Neither is proof of anything: the account is found by (provider, sub) from now on.
      const email = [fresh.email, facts.verified ? facts.email : null].find((e): e is string => !!e);
      const free = email && !(await userByEmail(email)) ? email : null;
      const { user, insert } = newUser(cleanName(data.name), free, undefined, guestChoice(request));
      const terms = await inviteAcceptance(fresh, user, data.acceptTerms === true);
      return { writes: [insert, insertIdentity(p, c.sub, user.id, facts), ...useInvite(fresh, user.id), ...terms], result: { user: user.id, tree: fresh.tree }, refused: inviteUsed };
    });
  } catch (e) {
    if (e instanceof OidcFail) throw e;
    if (e instanceof Error && e.message === inviteUsed().message) throw new OidcFail('invite_gone');
    throw e;
  }
  return { location: `/${made.tree}`, cookies: [await sessionFor(request, made.user, p, proved)] };
}

/** The session the flow was started from, still open in this browser, and its account. */
async function flowSession(request: Request, flow: FlowRow): Promise<{ user: UserRow; hash: string }> {
  const [userId, hash] = (flow.subject ?? '').split(' ');
  const s = await sessionOf(request);
  const user = userId && (await userById(userId));
  if (!s || !user || s.user !== userId || s.hash !== hash) throw new OidcFail('session');
  return { user, hash };
}

/** Adds this provider's identity to the signed-in account. One identity belongs to one account, one per provider. */
async function link(request: Request, p: ProviderRow, c: IdTokenClaims, identity: IdentityRow | undefined, flow: FlowRow): Promise<CallbackResult> {
  const { user } = await flowSession(request, flow);
  if (identity && identity.user !== user.id) throw new OidcFail('linked_elsewhere');
  if (!identity) {
    try {
      await accounts().batch([insertIdentity(p, c.sub, user.id, identityFacts(c))]);
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      // Another request linked first: this identity to another account, or another identity of this provider to this one.
      const winner = await accounts().get<IdentityRow>('SELECT * FROM oidc_identity WHERE provider = ? AND subject = ?', p.id, c.sub);
      throw new OidcFail(winner && winner.user !== user.id ? 'linked_elsewhere' : 'already_linked');
    }
  }
  return { location: withParam(flow.next ?? '/', 'oidc', 'linked'), cookies: [] };
}

/** A fresh proof: the provider signed the person in again during this flow, as the identity linked to this account. */
async function prove(request: Request, identity: IdentityRow | undefined, reauthenticated: boolean, flow: FlowRow): Promise<CallbackResult> {
  const { user, hash } = await flowSession(request, flow);
  if (!identity || identity.user !== user.id) throw new OidcFail('not_linked');
  if (!reauthenticated) throw new OidcFail('proof');
  await sessionProved(hash, user.id, 'oidc');
  return { location: withParam(flow.next ?? '/', 'oidc', 'proved'), cookies: [] };
}

// ---------- the reader's own ----------

export interface MyProvider extends PublicProvider { linked: boolean; email: string | null }

/** The providers this server offers, and which of them the reader's account uses. */
export async function myProviders(user: UserRow): Promise<MyProvider[]> {
  if (!(await methodEnabled('oidc'))) return [];
  const rows = await accounts().all<ProviderRow & { subject: string | null; email: string | null }>(
    'SELECT p.*, o.subject, o.email AS email FROM auth_provider p LEFT JOIN oidc_identity o ON o.provider = p.id AND o.user = ? WHERE p.enabled = 1 ORDER BY p.label', user.id);
  return rows.map((r) => ({ ...publicOf(r), linked: !!r.subject, email: r.subject ? r.email : null }));
}

/** The providers the reader can give a fresh proof with: single sign-on on, the provider on, their identity there. */
export async function proofProviders(user: UserRow): Promise<PublicProvider[]> {
  return (await myProviders(user)).filter((p) => p.linked).map(({ id, label, kind }) => ({ id, label, kind }));
}

/**
 * Removes a provider from the reader's account, with a fresh proof, and ends the sessions it started for them. Refused when the
 * account would have no way in left that the server accepts.
 */
export async function unlinkMine(request: Request, user: UserRow, provider: string): Promise<void> {
  if (authMethod() !== 'kindred' || onGuestHost(request)) throw invalid('oidc.err.off');
  refuseReadOnly();
  await requireFreshProof(request, user);
  const methods = await enabledMethods();
  try {
    await accounts().batch([
      q('DELETE FROM oidc_identity WHERE user = ? AND provider = ?', user.id, provider),
      guard(`EXISTS (SELECT 1 FROM user u WHERE u.id = ? AND ${hasWayIn(methods)})`, user.id),
      q("DELETE FROM session WHERE user = ? AND method = 'oidc' AND provider = ?", user.id, provider),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw invalid('pw.err.last_way_in');
    throw e;
  }
}

/**
 * The account's verified email, for the `signup` lane: an address one of its single sign-on providers said was verified at the
 * last sign-in (`email_verified`), or null. Passkeys and passwords never verify an email.
 */
export async function verifiedEmailOf(user: string): Promise<string | null> {
  const row = await accounts().get<{ email: string }>(
    'SELECT o.email FROM oidc_identity o JOIN auth_provider p ON p.id = o.provider WHERE o.user = ? AND o.email_verified = 1 AND o.email IS NOT NULL AND p.enabled = 1 ORDER BY o.last_used DESC LIMIT 1', user);
  return row?.email ?? null;
}

// ---------- the operator ----------

/** The console's list: every provider, with how many accounts use it. Never the secret. */
export async function listProviders(): Promise<ProviderView[]> {
  const rows = await accounts().all<ProviderRow & { n: number }>(
    'SELECT p.*, (SELECT count(*) FROM oidc_identity o WHERE o.provider = p.id) AS n FROM auth_provider p ORDER BY p.label');
  return rows.map((r) => ({
    ...publicOf(r), issuer: r.issuer, clientId: r.client_id, scopes: r.scopes, trustEmail: r.trust_email === 1, enabled: r.enabled === 1, hasSecret: !!r.secret_sealed, identities: r.n,
  }));
}

export interface ProviderInput {
  id: string; kind: OidcKind; label: string; issuer: string; clientId: string;
  /** undefined keeps the stored secret; '' removes it (a public client). */
  secret?: string;
  scopes: string; trustEmail: boolean; enabled: boolean;
}

/** Statements that keep every operator a way in, after the batch's other changes. */
async function operatorsKeepAWayIn(): Promise<Query> {
  return guard(`NOT EXISTS (SELECT 1 FROM user u WHERE u.operator = 1 AND NOT ${hasWayIn(await enabledMethods())})`);
}

/**
 * Adds or changes a provider. The issuer is fixed once the provider exists (identities belong to it: a new issuer is a new
 * provider). Saving an enabled provider reads its discovery document first, so a typo is caught here and not at a sign-in.
 * Turning one off ends its sessions, and is refused when an operator would be left with no way in.
 */
export async function saveProvider(input: ProviderInput, audit: (detail: Record<string, unknown>) => Query): Promise<void> {
  if (authMethod() !== 'kindred') throw invalid('pw.err.access_mode');
  if (!PROVIDER_ID.test(input.id)) throw invalid('oidc.err.id');
  const label = input.label.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!label || label.length > 60) throw invalid('oidc.err.label');
  const problem = issuerProblem(input.issuer);
  if (problem) throw invalid(problem);
  const clientId = input.clientId.trim();
  if (!clientId || clientId.length > 255) throw invalid('oidc.err.client_id');
  const scopes = cleanScopes(input.scopes);
  if (!scopes) throw invalid('oidc.err.scopes');
  if (input.secret !== undefined && input.secret.length > 1000) throw invalid('oidc.err.secret');
  const before = await providerById(input.id);
  if (before && before.issuer !== input.issuer) throw invalid('oidc.err.issuer_fixed');
  let discovery: Discovery | null = null;
  if (input.enabled) {
    try {
      discovery = await discover(input.issuer);
    } catch (e) {
      console.error('[oidc] discovery failed for', input.issuer, e instanceof Error ? e.message : e);
      throw invalid('oidc.err.discovery');
    }
  }
  const secret = input.secret === undefined ? before?.secret_sealed ?? null : input.secret ? await seal(secretInfo(input.id), input.secret) : null;
  const t = now();
  const disc = discovery ? JSON.stringify(discovery) : before?.discovery ?? null;
  const discAt = discovery ? t : before?.discovered_at ?? null;
  const turnedOff = !!before?.enabled && !input.enabled;
  try {
    await accounts().batch([
      before
        ? q('UPDATE auth_provider SET kind = ?, label = ?, client_id = ?, secret_sealed = ?, scopes = ?, trust_email = ?, enabled = ?, discovery = ?, discovered_at = ?, updated = ? WHERE id = ?',
          input.kind, label, clientId, secret, scopes, input.trustEmail ? 1 : 0, input.enabled ? 1 : 0, disc, discAt, t, input.id)
        : q('INSERT INTO auth_provider (id, kind, label, issuer, client_id, secret_sealed, scopes, trust_email, enabled, discovery, discovered_at, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          input.id, input.kind, label, input.issuer, clientId, secret, scopes, input.trustEmail ? 1 : 0, input.enabled ? 1 : 0, disc, discAt, t, t),
      await operatorsKeepAWayIn(),
      ...(turnedOff ? [q("DELETE FROM session WHERE method = 'oidc' AND provider = ?", input.id), q('DELETE FROM oidc_flow WHERE provider = ?', input.id)] : []),
      audit({ provider: input.id, label, issuer: input.issuer, enabled: input.enabled, trustEmail: input.trustEmail, created: !before, secretChanged: input.secret !== undefined }),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw invalid('pw.err.operator_locked_out');
    if (isUniqueError(e)) throw invalid('oidc.err.id_taken');
    throw e;
  }
}

/** Removes a provider, every identity at it and the sessions it started. Refused when an operator would have no way in. */
export async function deleteProvider(id: string, audit: (detail: Record<string, unknown>) => Query): Promise<void> {
  const p = await providerById(id);
  if (!p) return;
  try {
    await accounts().batch([
      q("DELETE FROM session WHERE method = 'oidc' AND provider = ?", id),
      q('DELETE FROM oidc_flow WHERE provider = ?', id),
      q('DELETE FROM oidc_identity WHERE provider = ?', id),
      q('DELETE FROM auth_provider WHERE id = ?', id),
      await operatorsKeepAWayIn(),
      audit({ provider: id, label: p.label, issuer: p.issuer, deleted: true }),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw invalid('pw.err.operator_locked_out');
    throw e;
  }
}
