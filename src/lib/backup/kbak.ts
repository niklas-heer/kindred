// The automatic backup's file (docs/hosting-many-families.md, "Backups"): one database, a family's or the accounts', as a
// `.kbak` file. Shared by the Node driver (./../store/backups.node.ts), the Durable Object (../store/durable.ts) and the
// console (./backup.server.ts). Web Crypto and CompressionStream only, so it runs on Node and in workerd alike.
//
// A file is:
//   "KBAK1\n"                      6 bytes, the format
//   header length                  4 bytes, big-endian
//   header                         JSON: the manifest (below) and the nonce, readable without the key
//   ciphertext                     AES-256-GCM of the gzipped database, with everything before it as additional data
// The header is authenticated, so a file whose manifest was changed, or that was copied under another family's id or name,
// does not decrypt: `open` checks the scope and name it was asked for against the header, and the header against the tag.
//
// The key: HKDF-SHA-256 over KINDRED_BACKUP_KEY when it is set, else over KINDRED_SECRET, for the purpose "backup". Lose the
// key and the backups cannot be read by anyone, Kindred included. `keyId` names the key without revealing it, so the Health
// tab can say which backups another key made.

/** The accounts database's scope; family ids are lower-case letters, digits and dashes, so no family can be called this. */
export const ACCOUNTS_SCOPE = '_accounts';
/** A scope: a family id, or the accounts. */
export const SCOPE = /^(?:[a-z0-9-]{1,64}|_accounts)$/;
/** A backup's name: the UTC time it was made, `20261112T031500123Z`. */
export const BACKUP_NAME = /^\d{8}T\d{9}Z$/;
/** Where a backup lives in a bucket or folder: under a prefix no family id or media key can start with. */
export const backupKey = (scope: string, name: string) => {
  checkBackup(scope, name);
  return `_backups/${scope}/${name}.kbak`;
};
export const checkBackup = (scope: string, name: string) => {
  if (!SCOPE.test(scope) || !BACKUP_NAME.test(name)) throw new Error(`bad backup ${String(scope).slice(0, 70)}/${String(name).slice(0, 30)}`);
};

/** A backup's name for a moment: the UTC time to the millisecond. */
export const backupName = (at: Date) => at.toISOString().replace(/[-:.]/g, '');
/** The moment a backup's name holds. */
export const nameTime = (name: string) => Date.parse(`${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T${name.slice(9, 11)}:${name.slice(11, 13)}:${name.slice(13, 15)}.${name.slice(15, 18)}Z`);

/** What a backup holds and how to check it, without the key. */
export interface Manifest {
  kindred: 'backup';
  version: 1;
  /** The family id, or `_accounts`. */
  scope: string;
  name: string;
  /** ISO time it was made. */
  created: string;
  /** `sqlite`: the database file (Node, VACUUM INTO). `dump`: its schema and rows as data (a Durable Object, ./dump.ts). */
  format: 'sqlite' | 'dump';
  /** The newest migration the database held. */
  schema: string | null;
  /** Rows per table. */
  counts: Record<string, number>;
  /** Bytes of the database before compression and encryption, and their SHA-256 (hex). */
  size: number;
  sha256: string;
  /** Which key sealed it (./kbak.ts keyId). */
  keyId: string;
}

const MAGIC = new TextEncoder().encode('KBAK1\n');
const enc = new TextEncoder();

export class BackupError extends Error {
  readonly code: 'key' | 'format' | 'scope' | 'decrypt' | 'checksum';
  constructor(code: BackupError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** The secret the backup key is made from: KINDRED_BACKUP_KEY when set, else KINDRED_SECRET (`fallback`). */
export function backupSecret(get: (name: string) => string | undefined, fallback?: () => string): { secret: string; own: boolean } {
  const own = get('KINDRED_BACKUP_KEY')?.trim();
  if (own) return { secret: own, own: true };
  const s = get('KINDRED_SECRET')?.trim() || fallback?.();
  if (!s) throw new BackupError('key', 'Neither KINDRED_BACKUP_KEY nor KINDRED_SECRET is set: backups need a key.');
  return { secret: s, own: false };
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface BackupKey { key: CryptoKey; id: string }

/** The AES key and its id, derived from the secret for the purpose "backup". */
export async function deriveBackupKey(secret: string): Promise<BackupKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = enc.encode('kindred');
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('backup') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const id = hex(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('backup key id') }, base, 64));
  return { key, id };
}

export const sha256 = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}
export const gzip = (bytes: Uint8Array) => through(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes: Uint8Array) => through(bytes, new DecompressionStream('gzip'));

/** Seals a database's bytes into a `.kbak` file. Returns the file and its manifest. */
export async function seal(
  m: Omit<Manifest, 'kindred' | 'version' | 'size' | 'sha256' | 'keyId'>, plain: Uint8Array, k: BackupKey,
): Promise<{ bytes: Uint8Array; manifest: Manifest }> {
  checkBackup(m.scope, m.name);
  const manifest: Manifest = { kindred: 'backup', version: 1, ...m, size: plain.length, sha256: await sha256(plain), keyId: k.id };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = enc.encode(JSON.stringify({ ...manifest, iv: b64(iv) }));
  const head = new Uint8Array(MAGIC.length + 4 + header.length);
  head.set(MAGIC, 0);
  new DataView(head.buffer).setUint32(MAGIC.length, header.length);
  head.set(header, MAGIC.length + 4);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, k.key, (await gzip(plain)) as BufferSource));
  const bytes = new Uint8Array(head.length + sealed.length);
  bytes.set(head, 0);
  bytes.set(sealed, head.length);
  return { bytes, manifest };
}

/** The manifest of a `.kbak` file, read without the key (not yet verified: `open` verifies it). */
export function readManifest(bytes: Uint8Array): { manifest: Manifest; iv: Uint8Array; headEnd: number } {
  if (bytes.length < MAGIC.length + 4 || MAGIC.some((b, i) => bytes[i] !== b)) throw new BackupError('format', 'Not a Kindred backup file.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length);
  const headEnd = MAGIC.length + 4 + length;
  if (length > 1_000_000 || headEnd > bytes.length) throw new BackupError('format', 'The backup file is cut short.');
  let parsed: Manifest & { iv?: string };
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC.length + 4, headEnd)));
  } catch {
    throw new BackupError('format', 'The backup file’s header is damaged.');
  }
  if (parsed?.kindred !== 'backup' || parsed.version !== 1 || typeof parsed.iv !== 'string') throw new BackupError('format', 'Not a Kindred backup file.');
  const { iv, ...manifest } = parsed;
  return { manifest, iv: unb64(iv), headEnd };
}

/**
 * Opens a `.kbak` file of `scope` named `name`: checks that the header says so, decrypts (which fails for a changed header or
 * ciphertext, or another key), decompresses and checks the SHA-256. Returns the manifest and the database's bytes.
 */
export async function open(bytes: Uint8Array, k: BackupKey, scope: string, name: string): Promise<{ manifest: Manifest; plain: Uint8Array }> {
  const { manifest, iv, headEnd } = readManifest(bytes);
  if (manifest.scope !== scope || manifest.name !== name) throw new BackupError('scope', 'This backup belongs to another database.');
  let packed: Uint8Array;
  try {
    packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: bytes.subarray(0, headEnd) as BufferSource }, k.key, bytes.subarray(headEnd) as BufferSource));
  } catch {
    throw new BackupError('decrypt', manifest.keyId && manifest.keyId !== k.id ? 'This backup was made with another key.' : 'The backup does not decrypt: it was changed or damaged.');
  }
  const plain = await gunzip(packed);
  if (plain.length !== manifest.size || (await sha256(plain)) !== manifest.sha256) throw new BackupError('checksum', 'The backup’s checksum does not match.');
  return { manifest, plain };
}
