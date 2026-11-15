// node --test src/lib/votes/vote-push-failure.test.ts — a family whose policy cannot be read gets no push, and neither the
// daily job's run for the other families nor the push after a new vote fails with it. The policy module is replaced by one
// that fails for one family only, as src/lib/votes/functions.test.ts replaces the framework. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-vote-push-failure-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const BROKEN = 'vbroken';
const STUB_POLICY = '\0stub-policy';
const policy: Plugin = {
  name: 'stub-policy',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '../operator/policy.server.ts' && importer?.endsWith('vote-push.server.ts')) return STUB_POLICY;
    return undefined;
  },
  load(id) {
    if (id === STUB_POLICY) return `export const familyAllows = async (tree) => { if (tree === '${BROKEN}') throw new Error('the policy read failed'); return true; };`;
    return undefined;
  },
};
const vite = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error', plugins: [policy], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('./votes.server.ts')>('/src/lib/votes/votes.server.ts');
const Push = await load<typeof import('./vote-push.server.ts')>('/src/lib/votes/vote-push.server.ts');
const { votesJob } = await load<typeof import('../jobs/votes.ts')>('/src/lib/jobs/votes.ts');
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { b64url } = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-11-15T10:00:00.000Z');
const HOUR = 3_600_000;

/** A family with Ada, who starts a vote closing in 20 hours, and Bo, whose device asked for pushes about votes. */
async function family(tree: string) {
  await db.store.ensureTree(tree);
  const member = async (name: string) => {
    const { user, insert } = store.newUser(name, null);
    await store.accounts().batch([insert, store.upsertMembership(user.id, tree, 'contributor')]);
    return { id: user.id, name, role: 'contributor' as const, person: null, personConfirmed: false };
  };
  const ada = await member('Ada Alder');
  const bo = await member('Bo Birch');
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  await store.accounts().run(
    `INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen, votes)
     VALUES (?, ?, ?, ?, ?, ?, '[0]', '["birthday"]', 'en', ?, ?, 1)`, crypto.randomUUID(), bo.id, tree, `https://web.push.apple.com/${tree}/bo`,
    b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), b64url(crypto.getRandomValues(new Uint8Array(16))), NOW.getTime(), NOW.getTime());
  const { id } = await V.createVote(tree, ada, {
    question: 'Where do we meet?', description: '', kind: 'single', secret: false, addOptions: false, guests: false,
    closesAt: new Date(NOW.getTime() + 20 * HOUR).toISOString(), options: ['Beach', 'Lake'],
  }, undefined, NOW);
  return { ada, id };
}

test('a family whose policy cannot be read gets no push, and the job still reminds the next family', async () => {
  const broken = await family(BROKEN);
  await family('vgood');
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env: Record<string, string> = {
    KINDRED_VAPID_PUBLIC_KEY: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)),
    KINDRED_VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', signing.privateKey)),
    KINDRED_VAPID_SUBJECT: 'mailto:family@example.org',
  };
  const vapid = { publicKey: env.KINDRED_VAPID_PUBLIC_KEY!, privateJwk: JSON.parse(env.KINDRED_VAPID_PRIVATE_JWK!) as JsonWebKey, subject: env.KINDRED_VAPID_SUBJECT! };
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;

  assert.equal(await Push.notifyVote(BROKEN, broken.ada, broken.id, { vapid, fetchImpl, now: NOW }), 0, 'the new vote’s push resolves, with nothing sent');
  assert.equal(await Push.remindVotes(BROKEN, new Date(NOW.getTime() + HOUR), { vapid, fetchImpl }), 0, 'the reminder resolves, with nothing sent');

  const logs: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await votesJob.run({ trees: [BROKEN, 'vgood'], now: new Date(NOW.getTime() + HOUR), env: (name) => env[name], log: (m) => logs.push(m) });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(sent, ['https://web.push.apple.com/vgood/bo']);
  assert.deepEqual(logs, ['sent 1 reminders about votes closing within a day']);
});
