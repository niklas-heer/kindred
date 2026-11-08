// node --test src/lib/webpush.test.ts — Web Push encryption, VAPID and the send, against RFC 8291's own worked
// example (Appendix A) and against a stubbed push service. No network: nothing here reaches a real push endpoint.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64url, encryptPayload, fromB64url, pushServiceAllowed, sendPush, validDeviceKey, vapidToken } from './webpush.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const strip = (text: string) => text.replace(/\s+/g, '');

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, keys: { p256dh: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64url(auth) } };
}

/** What a browser does with an aes128gcm message (RFC 8291 §4, receiver side). */
async function decrypt(body: Uint8Array<ArrayBuffer>, { pair, keys }: Awaited<ReturnType<typeof device>>) {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const senderPublic = body.slice(21, 21 + idLength);
  const sender = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, pair.privateKey, 256));
  const receiverPublic = fromB64url(keys.p256dh);
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...receiverPublic, ...senderPublic]);
  const ikm = await hkdf(fromB64url(keys.auth), shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idLength)));
  assert.equal(plain.at(-1), 2, 'the single record ends with the last-record delimiter');
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
  return dec.decode(plain.slice(0, -1));
}

// RFC 8291, Appendix A: the application server's ephemeral key pair, the device keys, the salt and the expected output.
// The RFC wraps its base64url text across lines; strip() removes the whitespace it inserted.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: strip('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: strip('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  header: strip('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
  ciphertext: strip('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ'),
};

async function senderPair(publicKey: string, privateKey: string): Promise<CryptoKeyPair> {
  const raw = fromB64url(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(raw.slice(1, 33)), y: b64url(raw.slice(33, 65)), d: privateKey, ext: true };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
}

test('the encryption matches RFC 8291 Appendix A byte for byte', async () => {
  const body = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.authSecret }, {
    ephemeral: await senderPair(RFC.asPublic, RFC.asPrivate),
    salt: fromB64url(RFC.salt),
  });
  const expected = new Uint8Array([...fromB64url(RFC.header), ...fromB64url(RFC.ciphertext)]);
  assert.equal(b64url(body), b64url(expected));
  assert.equal(body.byteLength, expected.byteLength);
});

test('encrypted payloads decrypt on the device, and differ on every send', async () => {
  const phone = await device();
  const first = await encryptPayload('{"title":"Hallo"}', phone.keys);
  const second = await encryptPayload('{"title":"Hallo"}', phone.keys);
  assert.equal(await decrypt(first, phone), '{"title":"Hallo"}');
  assert.notDeepEqual(first, second, 'a fresh key and salt each time');
});

test('VAPID tokens are ES256 JWTs for the push service origin, signed by the private key', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const token = await vapidToken('https://fcm.googleapis.com/fcm/send/abc', { privateJwk, subject: 'mailto:family@example.org' }, 1_800_000_000);
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43_200, sub: 'mailto:family@example.org' });
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, fromB64url(signature), enc.encode(`${header}.${claims}`)));
});

test('only the major browsers’ push services are allowed as endpoints', () => {
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?x=1']) {
    assert.equal(pushServiceAllowed(endpoint), true, endpoint);
  }
  for (const endpoint of [
    'http://fcm.googleapis.com/x', // not https
    'https://evil.example/push', // not a push service
    'https://fcm.googleapis.com.evil.example/x', // a suffix trick
    'https://fcm.googleapis.com:8443/x', // a port
    'https://user@web.push.apple.com/x', // credentials
    'https://127.0.0.1/x', // the server itself
    'not a url',
  ]) {
    assert.equal(pushServiceAllowed(endpoint), false, endpoint);
  }
});

test('a device key must be a point on P-256', async () => {
  const phone = await device();
  assert.equal(await validDeviceKey(phone.keys.p256dh), true);
  assert.equal(await validDeviceKey('B' + 'a'.repeat(86)), false, 'a made-up point is refused');
  assert.equal(await validDeviceKey('short'), false);
});

test('sendPush posts an encrypted, signed message to the endpoint and nothing else', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), subject: 'mailto:family@example.org' };
  const phone = await device();
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const response = await sendPush({ endpoint: 'https://web.push.apple.com/one', keys: phone.keys }, { title: 'Test', body: 'Hallo' }, vapid, stub);
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(calls[0].url, 'https://web.push.apple.com/one');
  assert.equal(headers['Content-Encoding'], 'aes128gcm');
  assert.equal(headers.TTL, '86400');
  assert.match(headers.Authorization, new RegExp(`^vapid t=[^ ]+, k=${vapid.publicKey}$`));
  const body = new Uint8Array(calls[0].init.body as Uint8Array);
  assert.deepEqual(JSON.parse(await decrypt(body, phone)), { title: 'Test', body: 'Hallo' });
});
