// Single sign-on with OpenID Connect: what the server and the browser share (the presets the console offers, the rules for a
// provider's id and issuer, and the redirect URI). Plain code, no server imports. The work is in ./oidc.server.ts.

/** The kinds of provider the console knows; `generic` is any OpenID Connect provider. */
export const OIDC_KINDS = ['google', 'microsoft', 'entra', 'authentik', 'keycloak', 'generic'] as const;
export type OidcKind = (typeof OIDC_KINDS)[number];

export interface OidcPreset {
  kind: OidcKind;
  /** The provider's id in the redirect URI. */
  id: string;
  label: string;
  /** The issuer, or a pattern with `{tenant}`, `{host}`, `{slug}` or `{realm}` for the operator to fill. */
  issuer: string;
  scopes: string;
}

/**
 * Microsoft's personal accounts (outlook.com, hotmail, live): the consumer tenant's fixed issuer. Its discovery document is
 * the same at `/consumers/v2.0` and names this issuer; every token for a personal account carries it, so unlike `common` it
 * lets in only personal accounts, matched by `sub` as always. Its `email` claim is not guaranteed to be correct (Microsoft's
 * ID token reference), so Kindred never trusts it: no "trust verified emails", and never a verified address.
 */
export const MICROSOFT_PERSONAL_ISSUER = 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0';
export const GOOGLE_ISSUER = 'https://accounts.google.com';

export const OIDC_PRESETS: Record<OidcKind, OidcPreset> = {
  google: { kind: 'google', id: 'google', label: 'Google', issuer: GOOGLE_ISSUER, scopes: 'openid email profile' },
  microsoft: { kind: 'microsoft', id: 'microsoft', label: 'Microsoft', issuer: MICROSOFT_PERSONAL_ISSUER, scopes: 'openid email profile' },
  entra: { kind: 'entra', id: 'microsoft', label: 'Microsoft', issuer: 'https://login.microsoftonline.com/{tenant}/v2.0', scopes: 'openid email profile' },
  authentik: { kind: 'authentik', id: 'authentik', label: 'Authentik', issuer: 'https://{host}/application/o/{slug}/', scopes: 'openid email profile' },
  keycloak: { kind: 'keycloak', id: 'keycloak', label: 'Keycloak', issuer: 'https://{host}/realms/{realm}', scopes: 'openid email profile' },
  generic: { kind: 'generic', id: 'sso', label: 'Single sign-on', issuer: 'https://', scopes: 'openid email profile' },
};

/** A provider's id: 2 to 32 of a–z, 0–9 and dashes, starting with a letter or digit. It is part of the redirect URI. */
export const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** The path the provider sends the browser back to. Registered at the provider exactly, with the site's origin in front. */
export const callbackPath = (provider: string) => `/api/auth/oidc/${provider}/callback`;

/**
 * What a flow is for: signing in, taking an invitation, adding the provider to the signed-in account, a fresh proof, starting a
 * family, or the operator's test sign-in (which signs nobody in, makes no account and links nothing).
 */
export type OidcPurpose = 'signin' | 'invite' | 'link' | 'proof' | 'signup' | 'test';

/** A provider as the sign-in pages see it. */
export interface PublicProvider { id: string; label: string; kind: OidcKind }

/** A provider as the console sees it (never the secret). */
export interface ProviderView extends PublicProvider {
  issuer: string; clientId: string; scopes: string; trustEmail: boolean; enabled: boolean; hasSecret: boolean;
  /** Accounts that sign in with it. */
  identities: number;
  /** The day the client secret stops working (YYYY-MM-DD), as the operator typed it; null when not known. */
  secretExpires: string | null;
  /** When a sign-in with it last got a good ID token (the operator's test included), and when it was added. */
  lastSuccess: number | null; created: number;
  /** What went wrong the last time Kindred talked to it, and when; shown while newer than the last success. */
  lastError: string | null; lastErrorAt: number | null;
  /** When the operator's test sign-in last worked with the current client ID and secret. */
  testedAt: number | null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Whether a URL is one Kindred will talk to: https, or plain http to this machine only (a provider on the same host, a test). */
export function secureUrl(u: URL): boolean {
  return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
}

const MICROSOFT_HOSTS = new Set(['login.microsoftonline.com', 'login.microsoft.com', 'sts.windows.net', 'login.windows.net']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Why an issuer cannot be used, as a message key, or null when it can. An issuer is an absolute https URL without a query or
 * fragment. Microsoft's shared tenants (`common`, `organizations`, `consumers`) are refused: their tokens come from whichever
 * tenant the person belongs to, so anyone with any Microsoft account could sign in; a tenant's own id (a GUID) is required.
 * Personal accounts have one: MICROSOFT_PERSONAL_ISSUER, which the error for `consumers` points to.
 */
export function issuerProblem(issuer: string): 'oidc.err.issuer' | 'oidc.err.entra_common' | 'oidc.err.entra_consumers' | 'oidc.err.entra_tenant' | null {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    return 'oidc.err.issuer';
  }
  if (!secureUrl(u) || u.search || u.hash || u.username || u.password || issuer !== issuer.trim() || /[{}]/.test(issuer)) return 'oidc.err.issuer';
  if (MICROSOFT_HOSTS.has(u.hostname)) {
    const tenant = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
    // `consumers` is what someone who wants personal accounts types: the preset has the fixed issuer that does it safely.
    if (tenant === 'consumers') return 'oidc.err.entra_consumers';
    if (['common', 'organizations'].includes(tenant)) return 'oidc.err.entra_common';
    if (!GUID.test(tenant)) return 'oidc.err.entra_tenant';
  }
  return null;
}

/** Scopes as stored: space-separated, `openid` first and always there, each once. */
export function cleanScopes(text: string): string | null {
  const items = text.split(/[\s,]+/).filter(Boolean);
  if (items.some((s) => !/^[\x21\x23-\x5b\x5d-\x7e]{1,100}$/.test(s)) || items.length > 20) return null;
  return ['openid', ...new Set(items.filter((s) => s !== 'openid'))].join(' ');
}

/**
 * Whether a provider's emails may ever be trusted (*Trust this provider's verified emails*): never for Microsoft's personal
 * accounts, whose `email` claim Microsoft does not guarantee. The console does not offer it and the server refuses it.
 */
export const trustEmailOffered = (kind: OidcKind, issuer: string) => kind !== 'microsoft' && issuer !== MICROSOFT_PERSONAL_ISSUER;

/** The kinds whose client secret expires and whose wizard asks for the day it does. */
export const SECRET_EXPIRES_KINDS: readonly OidcKind[] = ['microsoft', 'entra'];

/** A day as YYYY-MM-DD that exists in the calendar, or null. */
export function cleanDay(text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : null;
}

const DAY_MS = 86_400_000;
/** How long before a stored secret's expiry the console warns. */
export const SECRET_WARN_DAYS = 30;
/** Google deletes sign-in clients unused for six months; the console warns after this many. */
export const GOOGLE_IDLE_MONTHS = 5;

export type ProviderWarning =
  | { kind: 'google_idle'; since: number }
  | { kind: 'secret_expiring'; day: string; days: number }
  | { kind: 'secret_expired'; day: string }
  | { kind: 'failing'; at: number; error: string };

/**
 * What the console warns about for a provider at time `now`: a Google client five months without a sign-in (counted from
 * when it was added if it never had one) while it is on, a stored secret's expiry within 30 days or past, and the last
 * call to the provider failing since its last good sign-in.
 */
export function providerWarnings(p: Pick<ProviderView, 'kind' | 'issuer' | 'enabled' | 'secretExpires' | 'lastSuccess' | 'created' | 'lastError' | 'lastErrorAt'>, now: number): ProviderWarning[] {
  const out: ProviderWarning[] = [];
  if (p.enabled && (p.kind === 'google' || p.issuer === GOOGLE_ISSUER)) {
    const since = p.lastSuccess ?? p.created;
    const at = new Date(since);
    at.setUTCMonth(at.getUTCMonth() + GOOGLE_IDLE_MONTHS);
    if (at.getTime() <= now) out.push({ kind: 'google_idle', since });
  }
  const day = p.secretExpires && cleanDay(p.secretExpires);
  if (day) {
    const days = Math.ceil((Date.parse(`${day}T00:00:00Z`) - now) / DAY_MS);
    if (days <= 0) out.push({ kind: 'secret_expired', day });
    else if (days <= SECRET_WARN_DAYS) out.push({ kind: 'secret_expiring', day, days });
  }
  if (p.lastError && p.lastErrorAt && (!p.lastSuccess || p.lastErrorAt > p.lastSuccess)) out.push({ kind: 'failing', at: p.lastErrorAt, error: p.lastError });
  return out;
}
