// node --test src/lib/auth/proof.test.ts — adding a passkey needs a fresh passkey proof on this very session (accounts
// migration 0025): an assertion with the reader verified, a few minutes old at most, by one of the reader's own passkeys. A
// sign-in that verified the reader counts. A software authenticator (P-256) answers the ceremonies; scratch accounts only.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-proof-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
for (const k of ['KINDRED_AUTH', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'KINDRED_ORIGIN', 'KINDRED_GUEST_ORIGIN']) delete process.env[k];

const store = await import('./store.server.ts');
const { finishProof, proofOptions, requireFreshProof, PROOF_MS } = await import('./proof.server.ts');
const { addOptions } = await import('./passkeys.server.ts');

const SITE = 'http://family.example.org';
const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

/** A passkey on a software device: its id, its private key, and its public key in COSE form for the credential row. */
function device(id: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url'), y = Buffer.from(jwk.y!, 'base64url');
  // CBOR map {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}.
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y]);
  return { id: b64u(Buffer.from(id)), privateKey, cose: new Uint8Array(cose), count: 0 };
}
type Device = ReturnType<typeof device>;

/** The device's answer to a challenge: user present, and verified unless `verified` is false. */
function assertion(d: Device & { privateKey: KeyObject }, challenge: string, { verified = true, origin = SITE } = {}) {
  d.count += 1;
  const flags = 0x01 | (verified ? 0x04 : 0);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(d.count);
  const authData = Buffer.concat([sha256(new URL(origin).hostname), Buffer.from([flags]), counter]);
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
  const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), d.privateKey);
  return {
    id: d.id, rawId: d.id, type: 'public-key' as const, clientExtensionResults: {},
    response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientData), signature: b64u(signature) },
  };
}

const wipe = () => store.accounts().batch(['session', 'credential', 'challenge', 'user'].map((t) => store.q(`DELETE FROM ${t}`)));
beforeEach(wipe);
after(async () => {
  (await import('../store/node.ts')).closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

async function account(name: string, ...devices: Device[]) {
  const made = store.newUser(name, null);
  await store.accounts().batch([
    made.insert,
    ...devices.map((d) => store.insertCredential({ id: d.id, user: made.user.id, publicKey: d.cose, counter: 0, transports: ['internal'], device: 'Mac', synced: false })),
  ]);
  return (await store.userById(made.user.id))!;
}
const browser = (token: string) => new Request(`${SITE}/api/auth/x`, { headers: { cookie: `kindred_session=${token}` } });
const reauth = (e: unknown) => (e as { code?: string }).code === 'reauth';

async function prove(req: Request, user: Awaited<ReturnType<typeof account>>, d: Device, opts?: { verified?: boolean }) {
  const { options, challengeId } = await proofOptions(req, user);
  assert.equal(options.userVerification, 'required');
  return finishProof(req, user, challengeId, assertion(d, options.challenge, opts) as never);
}

test('a session that has proved nothing cannot start adding a passkey', async () => {
  const phone = device('phone');
  const mira = await account('Mira Testfield', phone);
  const { token } = await store.createSession(mira.id, phone.id);
  await assert.rejects(addOptions(browser(token), mira), reauth);
});

test('a sign-in that verified the reader counts for a few minutes; one that did not, does not', async () => {
  const phone = device('phone');
  const mira = await account('Mira Testfield', phone);
  const verified = (await store.createSession(mira.id, phone.id, true)).token;
  const plain = (await store.createSession(mira.id, phone.id, false)).token;
  await addOptions(browser(verified), mira);
  await assert.rejects(addOptions(browser(plain), mira), reauth);
  await store.accounts().run('UPDATE session SET proved = ?', Date.now() - PROOF_MS - 1000);
  await assert.rejects(addOptions(browser(verified), mira), reauth, 'and not for longer');
});

test('confirming with the reader’s own passkey, verified, lets this session add one, and no other session', async () => {
  const phone = device('phone');
  const mira = await account('Mira Testfield', phone);
  const here = (await store.createSession(mira.id, phone.id)).token;
  const elsewhere = (await store.createSession(mira.id, phone.id)).token;
  await prove(browser(here), mira, phone);
  await addOptions(browser(here), mira);
  await requireFreshProof(browser(here), mira);
  await assert.rejects(requireFreshProof(browser(elsewhere), mira), reauth, 'the proof is this session’s alone');
});

test('a passkey that only shows presence, without verifying the reader, is not a proof', async () => {
  const phone = device('phone');
  const mira = await account('Mira Testfield', phone);
  const { token } = await store.createSession(mira.id, phone.id);
  await assert.rejects(prove(browser(token), mira, phone, { verified: false }), /couldn’t be checked/);
  await assert.rejects(addOptions(browser(token), mira), reauth);
});

test('someone else’s passkey proves nothing for this account', async () => {
  const phone = device('phone'), theirs = device('theirs');
  const mira = await account('Mira Testfield', phone);
  await account('Oskar Vellum', theirs);
  const { token } = await store.createSession(mira.id, phone.id);
  await assert.rejects(prove(browser(token), mira, theirs), /couldn’t be checked/);
  await assert.rejects(addOptions(browser(token), mira), reauth);
});

test('a confirmation started on one session cannot be finished on another', async () => {
  const phone = device('phone');
  const mira = await account('Mira Testfield', phone);
  const a = (await store.createSession(mira.id, phone.id)).token;
  const b = (await store.createSession(mira.id, phone.id)).token;
  const { options, challengeId } = await proofOptions(browser(a), mira);
  await assert.rejects(finishProof(browser(b), mira, challengeId, assertion(phone, options.challenge) as never), /took too long/);
  await assert.rejects(addOptions(browser(b), mira), reauth);
  await assert.rejects(addOptions(browser(a), mira), reauth, 'and the challenge is spent');
});

test('without a session of its own a request cannot confirm at all', async () => {
  const phone = device('phone');
  const mira = await account('Mira Testfield', phone);
  await assert.rejects(proofOptions(new Request(SITE), mira), reauth);
});
