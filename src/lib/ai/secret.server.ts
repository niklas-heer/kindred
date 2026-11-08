// Sealing a family's AI keys. AES-GCM with WebCrypto, under a key derived (HKDF-SHA-256) from the server secret, the family's
// id and the provider, so one sealed key cannot be moved to another family, nor opened as another provider's key.
//   The secret comes from the store driver (store.secret()): KINDRED_SECRET on Workers (a Worker secret), and
//   on Node KINDRED_SECRET from the environment, else data/secret, made on first use with mode 600.
// Changing the secret makes saved keys unreadable; the settings page then asks for the key again.
// Two forms are read. `v2.` (written now) binds the family and the provider. `v1.` (written before several providers
// existed, and moved across by migration 0010) binds the family only; it is read, and is re-sealed as v2 when it is saved again.
import { store } from '../store/index.ts';
import { AiError } from './adapters';
import type { Provider } from './types';

const enc = new TextEncoder();
const SALT = enc.encode('kindred-ai-keys/v1');

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The server secret as text, from the driver. A missing one is said plainly (see the driver). */
function secretText(): string {
  try {
    return store.secret();
  } catch (e) {
    throw new AiError('key-unreadable', e instanceof Error ? e.message : 'ai.err_secret_missing');
  }
}

async function sealingKey(info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secretText()), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** The key that seals a provider's key of a family (v2). */
const providerInfo = (tree: string, provider: Provider) => `tree:${tree}|provider:${provider}`;
/** The key that sealed a family's key before providers were separate (v1). */
const familyInfo = (tree: string) => `tree:${tree}`;

/** `v2.<iv>.<ciphertext>`, base64: the key of one provider of one family. */
export async function sealKey(tree: string, provider: Provider, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealingKey(providerInfo(tree, provider)), enc.encode(key)));
  return `v2.${b64(iv)}.${b64(ct)}`;
}

/** Opens a sealed key of the given provider. Throws key-unreadable when the secret changed or the text is not a sealed key. */
export async function openKey(tree: string, provider: Provider, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if ((v !== 'v1' && v !== 'v2') || !iv || !ct) throw new AiError('key-unreadable', 'ai.err_key_format');
  const info = v === 'v2' ? providerInfo(tree, provider) : familyInfo(tree);
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await sealingKey(info), unb64(ct)));
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError('key-unreadable', 'ai.err_key_unreadable');
  }
}

/** The last four characters, for "…abcd". */
export const keyTail = (key: string) => key.slice(-4);
