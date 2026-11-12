// Sealing a short secret of an account (a two-step code's secret) with the server secret: AES-GCM under a key derived with
// HKDF-SHA-256 from KINDRED_SECRET (store.secret()) and `info`, so a sealed value cannot be moved to another account or
// purpose. The same construction as the family AI keys (src/lib/ai/secret.server.ts), with its own salt. Changing the secret
// makes sealed values unreadable: two-step codes then have to be set up again (a recovery code still signs in).
import { store } from '../store/index.ts';

const enc = new TextEncoder();
const SALT = enc.encode('kindred-sealed/v1');
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(store.secret()), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** `s1.<iv>.<ciphertext>`, base64. */
export async function seal(info: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(info), enc.encode(text)));
  return `s1.${b64(iv)}.${b64(ct)}`;
}

/** The sealed text, or undefined when it cannot be opened (another secret, another `info`, or not a sealed value). */
export async function unseal(info: string, sealed: string): Promise<string | undefined> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 's1' || !iv || !ct) return undefined;
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(info), unb64(ct)));
  } catch {
    return undefined;
  }
}

/** HMAC-SHA-256 under a key derived from the server secret for `purpose`: the password pepper. */
export async function serverHmac(purpose: string, data: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', enc.encode(store.secret()), 'HKDF', false, ['deriveKey']);
  const mac = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(`hmac:${purpose}`) }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', mac, data as BufferSource));
}
