// Secrets: random tokens, their stored hashes, and comparisons that take the same time whatever the input.
// WebCrypto only, so the same code runs on Node and on Workers.

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** 32 random bytes as base64url: invite links, session cookies, challenge ids. */
export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** What the store keeps instead of a token: a SHA-256, so a copied database can't sign anyone in. */
export const hashToken = async (
  purpose: 'session' | 'invite' | 'share' | 'guest' | 'share-ip' | 'join' | 'visitor' | 'view-as' | 'auth-user' | 'auth-ip' | 'recovery' | 'signin-step' | 'reset',
  token: string,
) => base64url(await sha256(`kindred:${purpose}:${token}`));

/** Constant-time equality of two strings (compared as SHA-256 digests, so lengths can't leak either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0 && a.length === b.length;
}

// ---------- passwords ----------
//
// PBKDF2, the one password hash WebCrypto has on both Node and Workers. Cloudflare's runtime has capped it at 100,000
// iterations, so the count stays at that cap to work everywhere, and SHA-512 is the costlier hash to attack at that count. The share link's own
// password is generated with about 59 bits (share.server.ts), so guessing is out of reach even from a stolen database, and the
// stored form names its parameters, so a later change can move to a stronger hash without losing old links.

export const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_BITS = 512;
const PASSWORD_SCHEME = 'pbkdf2-sha512';

const fromBase64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: salt as BufferSource, iterations }, key, PBKDF2_BITS));
}

/** The stored form of a password: scheme, iterations, a random salt and the derived key. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${PASSWORD_SCHEME}$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

/** Whether `password` is the one behind `stored`, compared in constant time. A malformed stored value never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, key] = stored.split('$');
  const n = Number(iterations);
  if (scheme !== PASSWORD_SCHEME || !Number.isInteger(n) || n < 1 || n > PBKDF2_ITERATIONS || !salt || !key) return false;
  return safeEqual(base64url(await pbkdf2(password, fromBase64url(salt), n)), key);
}
