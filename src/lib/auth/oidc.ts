// Single sign-on with OpenID Connect: what the server and the browser share (the presets the console offers, the rules for a
// provider's id and issuer, and the redirect URI). Plain code, no server imports. The work is in ./oidc.server.ts.

/** The kinds of provider the console knows; `generic` is any OpenID Connect provider. */
export const OIDC_KINDS = ['google', 'entra', 'authentik', 'keycloak', 'generic'] as const;
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

export const OIDC_PRESETS: Record<OidcKind, OidcPreset> = {
  google: { kind: 'google', id: 'google', label: 'Google', issuer: 'https://accounts.google.com', scopes: 'openid email profile' },
  entra: { kind: 'entra', id: 'microsoft', label: 'Microsoft', issuer: 'https://login.microsoftonline.com/{tenant}/v2.0', scopes: 'openid email profile' },
  authentik: { kind: 'authentik', id: 'authentik', label: 'Authentik', issuer: 'https://{host}/application/o/{slug}/', scopes: 'openid email profile' },
  keycloak: { kind: 'keycloak', id: 'keycloak', label: 'Keycloak', issuer: 'https://{host}/realms/{realm}', scopes: 'openid email profile' },
  generic: { kind: 'generic', id: 'sso', label: 'Single sign-on', issuer: 'https://', scopes: 'openid email profile' },
};

/** A provider's id: 2 to 32 of a–z, 0–9 and dashes, starting with a letter or digit. It is part of the redirect URI. */
export const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** The path the provider sends the browser back to. Registered at the provider exactly, with the site's origin in front. */
export const callbackPath = (provider: string) => `/api/auth/oidc/${provider}/callback`;

/** What a flow is for: signing in, taking an invitation, adding the provider to the signed-in account, or a fresh proof. */
export type OidcPurpose = 'signin' | 'invite' | 'link' | 'proof';

/** A provider as the sign-in pages see it. */
export interface PublicProvider { id: string; label: string; kind: OidcKind }

/** A provider as the console sees it (never the secret). */
export interface ProviderView extends PublicProvider {
  issuer: string; clientId: string; scopes: string; trustEmail: boolean; enabled: boolean; hasSecret: boolean;
  /** Accounts that sign in with it. */
  identities: number;
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
 */
export function issuerProblem(issuer: string): 'oidc.err.issuer' | 'oidc.err.entra_common' | 'oidc.err.entra_tenant' | null {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    return 'oidc.err.issuer';
  }
  if (!secureUrl(u) || u.search || u.hash || u.username || u.password || issuer !== issuer.trim() || /[{}]/.test(issuer)) return 'oidc.err.issuer';
  if (MICROSOFT_HOSTS.has(u.hostname)) {
    const tenant = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
    if (['common', 'organizations', 'consumers'].includes(tenant)) return 'oidc.err.entra_common';
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
