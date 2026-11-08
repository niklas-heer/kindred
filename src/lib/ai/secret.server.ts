// Sealing the family's AI key. AES-GCM with WebCrypto, under a key derived (HKDF-SHA-256) from
// KINDRED_SECRET and the family's id, so one family's sealed key cannot be moved to another's.
//   Workers: KINDRED_SECRET is a Worker secret (wrangler secret put KINDRED_SECRET).
//   Node:    KINDRED_SECRET from the environment, else data/secret, made on first use with mode 600.
// Changing the secret makes saved keys unreadable; the settings page then asks for the key again.
import { onWorkers } from '../store/index.ts';
import { AiError } from './adapters';

const enc = new TextEncoder();
const SALT = enc.encode('kindred-ai-keys/v1');

// Node's built-ins are reached without an import, so no node: module is bundled for Workers.
type NodeFs = typeof import('node:fs');
type NodePath = typeof import('node:path');
const nodeBuiltin = <T>(name: string): T | undefined => (globalThis as { process?: { getBuiltinModule?: (n: string) => unknown } }).process?.getBuiltinModule?.(name) as T | undefined;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The secret as text: the environment first, then (Node only) data/secret, made on first use. */
function secretText(): string {
  const fromEnv = process.env.KINDRED_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (onWorkers) throw new AiError('key-unreadable', 'KINDRED_SECRET is not set. Add it as a Worker secret.');
  const fs = nodeBuiltin<NodeFs>('node:fs');
  const path = nodeBuiltin<NodePath>('node:path');
  if (!fs || !path) throw new AiError('key-unreadable', 'KINDRED_SECRET is not set.');
  const dir = path.resolve(process.env.KINDRED_DATA_DIR || 'data');
  const file = path.join(dir, 'secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  fs.mkdirSync(dir, { recursive: true });
  const fresh = b64(crypto.getRandomValues(new Uint8Array(32)));
  try {
    fs.writeFileSync(file, `${fresh}\n`, { mode: 0o600, flag: 'wx' });
    return fresh;
  } catch (e) {
    // Another request made it first: use theirs.
    if ((e as { code?: string }).code === 'EEXIST') return fs.readFileSync(file, 'utf8').trim();
    throw e;
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
