// Sealing the family's AI key. AES-GCM with WebCrypto, under a key derived (HKDF-SHA-256) from the server
// secret and the family's id, so one family's sealed key cannot be moved to another's.
//   The secret comes from the store driver (store.secret()): KINDRED_SECRET on Workers (a Worker secret), and
//   on Node KINDRED_SECRET from the environment, else data/secret, made on first use with mode 600.
// Changing the secret makes saved keys unreadable; the settings page then asks for the key again.
import { store } from '../store/index.ts';
import { AiError } from './adapters';

const enc = new TextEncoder();
const SALT = enc.encode('kindred-ai-keys/v1');

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The server secret as text, from the driver. A missing one is said plainly (see the driver). */
function secretText(): string {
  try {
    return store.secret();
  } catch (e) {
    throw new AiError('key-unreadable', e instanceof Error ? e.message : 'The server secret is not available.');
  }
}

async function familyKey(tree: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secretText()), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(`tree:${tree}`) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** `v1.<iv>.<ciphertext>`, base64. */
export async function sealKey(tree: string, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await familyKey(tree), enc.encode(key)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function openKey(tree: string, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new AiError('key-unreadable', 'The saved key is in an unknown format.');
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await familyKey(tree), unb64(ct)));
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError('key-unreadable', 'The saved key can’t be read any more.');
  }
}

/** The last four characters, for "…abcd". */
export const keyTail = (key: string) => key.slice(-4);
