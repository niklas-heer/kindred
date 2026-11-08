// Web Push with WebCrypto only, so it runs on Node and in Workers alike: payloads encrypted for the device
// (RFC 8291, aes128gcm), requests signed with VAPID (RFC 8292, ES256). The push service only relays ciphertext.
// Ported from the family site's push.js (family-archive), which has sent reminders in production with this wire format.
// Nothing is stored here; src/lib/reminders.server.ts decides who gets what.

export const PUSH_TIMEOUT_MS = 10_000;

/** A push service must accept an encrypted body of at least this many bytes (RFC 8030 §5.2). */
export const PUSH_BODY_BYTES = 4096;
/**
 * What encryption adds to a message: the header (salt 16, record size 4, key id length 1, the sender's P-256 key 65),
 * the 0x02 last-record delimiter and the AES-GCM tag (16).
 */
export const ENVELOPE_BYTES = 16 + 4 + 1 + 65 + 1 + 16;
/** The most UTF-8 bytes the JSON of one message may take, so that its encrypted body fits PUSH_BODY_BYTES. */
export const MAX_MESSAGE_BYTES = PUSH_BODY_BYTES - ENVELOPE_BYTES;

const enc = new TextEncoder();

/** The UTF-8 length of a string, in bytes (what the push service and the encryption count, not characters). */
export const utf8Bytes = (text: string): number => enc.encode(text).byteLength;

/** Whether a message, as the JSON that is encrypted, fits the budget of one push. */
export const fitsPush = (message: unknown): boolean => utf8Bytes(JSON.stringify(message)) <= MAX_MESSAGE_BYTES;

/** base64url without padding (RFC 4648 §5), as the Web Push and JWK formats use it. */
export const b64url = (bytes: ArrayBuffer | ArrayBufferView): string => {
  const view = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export interface PushKeys { p256dh: string; auth: string }
export interface PushSubscriptionLike { endpoint: string; keys: PushKeys }
export interface VapidConfig { publicKey: string; privateJwk: JsonWebKey; subject: string }

/** Only the major browsers' push services: anything else would turn the daily job into a request relay for anyone. */
export function pushServiceAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname;
  return host === 'fcm.googleapis.com' || host === 'web.push.apple.com' || host.endsWith('.push.apple.com')
    || host === 'updates.push.services.mozilla.com' || host.endsWith('.notify.windows.com');
}

/** The device's public key must be a point on P-256, or every later encryption for it would fail. */
export async function validDeviceKey(p256dh: string): Promise<boolean> {
  try {
    await crypto.subtle.importKey('raw', fromB64url(p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return true;
  } catch {
    return false;
  }
}

const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
};

/**
 * Encrypts `plaintext` for a device (RFC 8291, one record, aes128gcm). `ephemeral` and `salt` are only passed by
 * tests, which replay the RFC's own vector; production makes a fresh key pair and salt for every message.
 */
export async function encryptPayload(plaintext: string, { p256dh, auth }: PushKeys, options: { ephemeral?: CryptoKeyPair; salt?: Uint8Array<ArrayBuffer> } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const receiverPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const sender = options.ephemeral ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const receiverKey = await crypto.subtle.importKey('raw', receiverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const contentSalt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(contentSalt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(contentSalt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The payload, then the 0x02 delimiter that marks the last record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(plaintext), new Uint8Array([2]))));
  // Header: salt (16), record size 4096 (4 bytes), key id length (1), the sender's public key.
  const header = new Uint8Array(16 + 4 + 1 + senderPublic.byteLength);
  header.set(contentSalt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublic.byteLength;
  header.set(senderPublic, 21);
  return concat(header, sealed);
}

/** A VAPID token for one push service: an ES256 JWT whose audience is that service's origin. */
export async function vapidToken(endpoint: string, { privateJwk, subject }: Pick<VapidConfig, 'privateJwk' | 'subject'>, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: subject })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(signature)}`;
}

/** Sends one message to one device. The caller reads the status: 404 and 410 mean the subscription is gone. */
export async function sendPush(subscription: PushSubscriptionLike, message: unknown, vapid: VapidConfig, fetchImpl: typeof fetch = fetch): Promise<Response> {
  // Refused rather than sent: a body over the budget is rejected by the push service, or cannot be decrypted by the browser.
  if (!fitsPush(message)) throw new Error('the push message is larger than a push service accepts');
  const body = await encryptPayload(JSON.stringify(message), subscription.keys);
  return fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${await vapidToken(subscription.endpoint, vapid)}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
}
