// Secrets: random tokens, their stored hashes, and comparisons that take the same time whatever the input.
// WebCrypto only, so the same code runs on Node and on Workers.

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** 32 random bytes as base64url: invite links, session cookies, challenge ids. */
export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** What the store keeps instead of a token: a SHA-256, so a copied database can't sign anyone in. */
export const hashToken = async (purpose: 'session' | 'invite', token: string) => base64url(await sha256(`kindred:${purpose}:${token}`));

/** Constant-time equality of two strings (compared as SHA-256 digests, so lengths can't leak either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0 && a.length === b.length;
}
