// Checking an OpenID Connect ID token (a signed JWT) with WebCrypto only, so the same code runs on Node and on Workers.
// OpenID Connect Core 1.0 §3.1.3.7: the signature with one of the provider's published keys (asymmetric algorithms only:
// never `none`, never a shared-secret HMAC), `iss` exactly the provider's issuer, `aud` holding the client id (and `azp` the
// client id whenever it is present or there are several audiences), `exp` in the future and `iat` not in it (a minute's
// skew either way), and the `nonce` this sign-in sent.

export interface Jwk { kty?: string; kid?: string; use?: string; alg?: string; crv?: string; n?: string; e?: string; x?: string; y?: string; key_ops?: string[] }

export interface IdTokenClaims {
  iss: string; sub: string; aud: string | string[]; exp: number; iat: number;
  nonce?: string; azp?: string; auth_time?: number; email?: string; email_verified?: boolean | string; name?: string; preferred_username?: string;
}

/** Why a token was refused: a short code, never shown to the reader (they see one sentence for all of them). */
export class TokenError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`id token refused: ${reason}`);
    this.reason = reason;
    this.name = 'TokenError';
  }
}

/** Clock skew allowed on `exp`, `iat` and `auth_time`, in seconds. */
export const SKEW_S = 60;

type Alg = { kty: string; import: RsaHashedImportParams | EcKeyImportParams | Algorithm; verify: AlgorithmIdentifier | RsaPssParams | EcdsaParams };
const RSA = (hash: string): Alg => ({ kty: 'RSA', import: { name: 'RSASSA-PKCS1-v1_5', hash }, verify: { name: 'RSASSA-PKCS1-v1_5' } });
const PSS = (hash: string, saltLength: number): Alg => ({ kty: 'RSA', import: { name: 'RSA-PSS', hash }, verify: { name: 'RSA-PSS', saltLength } });
const EC = (namedCurve: string, hash: string): Alg => ({ kty: 'EC', import: { name: 'ECDSA', namedCurve }, verify: { name: 'ECDSA', hash } });
/** The algorithms Kindred accepts. Anything else (`none`, HS256, …) is refused before any key is looked at. */
export const ALGORITHMS: Record<string, Alg> = {
  RS256: RSA('SHA-256'), RS384: RSA('SHA-384'), RS512: RSA('SHA-512'),
  PS256: PSS('SHA-256', 32), PS384: PSS('SHA-384', 48), PS512: PSS('SHA-512', 64),
  ES256: EC('P-256', 'SHA-256'), ES384: EC('P-384', 'SHA-384'), ES512: EC('P-521', 'SHA-512'),
};

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const decodeJson = (part: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(new TextDecoder().decode(fromB64u(part)));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  throw new TokenError('malformed');
};

/** The header and claims of a compact JWS, unchecked. */
export function decodeJwt(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; signed: Uint8Array; signature: Uint8Array } {
  if (typeof token !== 'string' || token.length > 16_384) throw new TokenError('malformed');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new TokenError('malformed');
  return { header: decodeJson(parts[0]), claims: decodeJson(parts[1]), signed: new TextEncoder().encode(`${parts[0]}.${parts[1]}`), signature: fromB64u(parts[2]) };
}

/** The keys a token may have been signed with: by `kid` when it names one, else every key of the algorithm's type. */
export function candidateKeys(keys: Jwk[], alg: string, kid: unknown): Jwk[] {
  const a = ALGORITHMS[alg];
  return keys.filter((k) =>
    k && k.kty === a.kty && (k.use === undefined || k.use === 'sig') && (k.alg === undefined || k.alg === alg)
    && (a.kty !== 'EC' || k.crv === (a.import as EcKeyImportParams).namedCurve)
    && (typeof kid === 'string' ? k.kid === kid : true));
}

async function verifiedWith(key: Jwk, alg: string, signed: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const a = ALGORITHMS[alg];
  try {
    const { kty, n, e, crv, x, y } = key;
    const k = await crypto.subtle.importKey('jwk', { kty, n, e, crv, x, y, ext: true } as JsonWebKey, a.import, false, ['verify']);
    return await crypto.subtle.verify(a.verify, k, signature as BufferSource, signed as BufferSource);
  } catch {
    return false;
  }
}

export interface Expected {
  issuer: string; clientId: string; nonce: string;
  /** The algorithms the provider says it signs with (discovery); RS256 when it does not say. */
  algorithms?: string[];
  /** Seconds since the epoch; tests pass their own. */
  now?: number;
}

/**
 * Checks an ID token and returns its claims. `keys` gives the provider's current keys; when no key matches, it is asked once
 * more with `refresh` (the provider rotated its keys), so a new key works without a restart.
 */
export async function verifyIdToken(token: string, keys: (refresh: boolean) => Promise<Jwk[]>, x: Expected): Promise<IdTokenClaims> {
  const { header, claims, signed, signature } = decodeJwt(token);
  const alg = typeof header.alg === 'string' ? header.alg : '';
  const allowed = (x.algorithms?.length ? x.algorithms : ['RS256']).filter((a) => a in ALGORITHMS);
  if (!(alg in ALGORITHMS) || !allowed.includes(alg)) throw new TokenError(`alg ${alg || 'missing'}`);
  if (header.crit !== undefined) throw new TokenError('crit');
  let ok = false;
  for (const refresh of [false, true]) {
    const found = candidateKeys(await keys(refresh), alg, header.kid);
    for (const key of found.slice(0, 5)) if ((ok = await verifiedWith(key, alg, signed, signature))) break;
    // Asked again only when no key fits at all (a new `kid`): a key that fits but does not verify is a bad token.
    if (ok || found.length) break;
  }
  if (!ok) throw new TokenError('signature');

  const c = claims as Partial<IdTokenClaims>;
  const now = x.now ?? Math.floor(Date.now() / 1000);
  if (c.iss !== x.issuer) throw new TokenError('iss');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(x.clientId)) throw new TokenError('aud');
  if ((aud.length > 1 || c.azp !== undefined) && c.azp !== x.clientId) throw new TokenError('azp');
  if (typeof c.exp !== 'number' || c.exp + SKEW_S < now) throw new TokenError('exp');
  if (typeof c.iat !== 'number' || c.iat - SKEW_S > now) throw new TokenError('iat');
  if (typeof c.nonce !== 'string' || c.nonce !== x.nonce) throw new TokenError('nonce');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) throw new TokenError('sub');
  if (c.auth_time !== undefined && typeof c.auth_time !== 'number') throw new TokenError('auth_time');
  return c as IdTokenClaims;
}

/** Whether the provider vouches for the email: `email_verified` true (some providers send the string "true"). */
export const emailVerified = (c: Pick<IdTokenClaims, 'email' | 'email_verified'>) =>
  typeof c.email === 'string' && c.email.includes('@') && (c.email_verified === true || c.email_verified === 'true');
