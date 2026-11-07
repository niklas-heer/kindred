// Secrets: random tokens, their stored hashes, and comparisons that take the same time whatever the input.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes as base64url: invite links, session cookies, challenge ids. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** What the store keeps instead of a token: a SHA-256, so a copied database can't sign anyone in. */
export const hashToken = (purpose: 'session' | 'invite', token: string) =>
  createHash('sha256').update(`kindred:${purpose}:${token}`).digest('base64url');

/** Constant-time equality of two strings (compared as SHA-256 digests, so lengths can't leak either). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}
