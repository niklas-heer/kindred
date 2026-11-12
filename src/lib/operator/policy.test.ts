// node --test src/lib/operator/policy.test.ts — the operator's policies (docs/hosting-many-families.md, "Policies"): the
// resolver at each step of its precedence (deployment, family status, the operator's scope, the grant, the steward, the
// member); each wired feature refused on the server when the operator has it off (the Campaign, the AI, painted portraits,
// address lookup, push); a background task skipping a family whose AI is off; operator-funded AI (the reservation under
// concurrency, the server-wide ceiling, an idempotent settlement, a model with no price refused, a call end to end on the
// fake provider); the policy impact preview; announcements (who sees which, their window, a demo, "View as"). Real server
// modules on scratch databases, with the framework around them replaced. Invented families only; no network.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';
import { decideAiSource, decideFeature, lockOf, parseAiSource, type PolicyFacts } from './policy.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-policy-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'policy-test-secret';
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_AUTH;
delete process.env.KINDRED_ADDRESS_LOOKUP;
for (const k of ['KINDRED_VAPID_PUBLIC_KEY', 'KINDRED_VAPID_PRIVATE_JWK', 'KINDRED_VAPID_SUBJECT']) delete process.env[k];
// Nothing here may reach the network: a call that is not stubbed fails instead of going out.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('a test tried to reach the network'); }) as typeof fetch;

const STUB_START = '\0stub-start';
const STUB_START_SERVER = '\0stub-start-server';
const STUB_SESSION = '\0stub-session';
const framework: Plugin = {
  name: 'stub-framework',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@tanstack/react-start') return STUB_START;
    if (source === '@tanstack/react-start/server') return STUB_START_SERVER;
    if (source === './session.server' && importer?.endsWith('guard.server.ts')) return STUB_SESSION;
    return undefined;
  },
  load(id) {
    if (id === STUB_START) return `export const createServerFn = () => { const b = { validator: () => b, handler: (fn) => { const f = (o) => fn(o ?? {}); f.isServerFn = true; return f; } }; return b; };`;
    if (id === STUB_START_SERVER) return `
      export const getRequest = () => { if (!globalThis.__request) throw new Error('outside a request'); return globalThis.__request; };
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => globalThis.__session ?? { user: null, via: null };`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } }, ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const policy = await load<typeof import('./policy.server.ts')>('/src/lib/operator/policy.server.ts');
const fns = await load<typeof import('./policy.functions.ts')>('/src/lib/operator/policy.functions.ts');
const ann = await load<typeof import('./announcements.server.ts')>('/src/lib/operator/announcements.server.ts');
const ops = await load<typeof import('./operator.server.ts')>('/src/lib/operator/operator.server.ts');
const funding = await load<typeof import('../ai/operator-funding.server.ts')>('/src/lib/ai/operator-funding.server.ts');
const ai = await load<typeof import('../ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const portrait = await load<typeof import('../ai/portrait.server.ts')>('/src/lib/ai/portrait.server.ts');
const bg = await load<typeof import('../ai/background.server.ts')>('/src/lib/ai/background.server.ts');
const { setUpFamilyAi } = await load<typeof import('../ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const campaign = await load<typeof import('../campaign/campaign.server.ts')>('/src/lib/campaign/campaign.server.ts');
const fieldFns = await load<typeof import('../field-suggest.functions.ts')>('/src/lib/field-suggest.functions.ts');
const postPush = await load<typeof import('../feed/post-push.server.ts')>('/src/lib/feed/post-push.server.ts');
const reminders = await load<typeof import('../reminders.server.ts')>('/src/lib/reminders.server.ts');
const viewAs = await load<typeof import('../auth/view-as.functions.ts')>('/src/lib/auth/view-as.functions.ts');
const { b64url } = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  globalThis.fetch = realFetch;
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

const A = 'alder';
const B = 'birch';
type User = ReturnType<typeof store.newUser>['user'];
type Who = { user: User | null; via: string | null; sessionHash?: string };
const g = globalThis as unknown as { __session?: Who; __request?: Request; __setCookies?: string[] };
let cookie: string | undefined;
/** A new request from `who`, with this test's preview cookie when it has one. */
const as = (who: User | null, withCookie: string | undefined = cookie) => {
  g.__session = { user: who, via: who ? 'passkey' : null, sessionHash: who ? `session-${who.id}` : undefined };
  g.__setCookies = [];
  g.__request = new Request('http://localhost/', { headers: withCookie ? { cookie: withCookie } : {} });
};

async function account(name: string, memberships: [string, 'viewer' | 'contributor' | 'editor' | 'steward'][] = [], operator = false): Promise<User> {
  const { user, insert } = store.newUser(name, `${name.split(' ')[0]!.toLowerCase()}@example.org`);
  await store.accounts().batch([insert, ...memberships.map(([t, role]) => store.upsertMembership(user.id, t, role))]);
  if (operator) await store.accounts().run('UPDATE user SET operator = 1 WHERE id = ?', user.id);
  return { ...user, operator: operator ? 1 : 0 } as User;
}

let op: User, stewardA: User, viewerA: User, stewardB: User;
before(async () => {
  await dbs.provisionFamily(A, 'The Alders');
  await dbs.provisionFamily(B, 'The Birches');
  op = await account('Orla Operator', [], true);
  stewardA = await account('Sana Steward', [[A, 'steward']]);
  viewerA = await account('Vic Viewer', [[A, 'viewer']]);
  stewardB = await account('Bo Birch', [[B, 'steward']]);
  as(op);
});

const save = (key: Parameters<typeof policy.savePolicy>[1], scope: 'off' | 'families' | 'selected', families: string[] = [], aiValue: Parameters<typeof policy.savePolicy>[2]['ai'] = null) =>
  policy.savePolicy(op, key, { scope, families, ai: aiValue });

// ---------- the resolver, step by step (pure) ----------

const facts = (over: Partial<PolicyFacts> = {}): PolicyFacts => ({ deployment: true, status: 'active', instance: null, family: null, ...over });

test('the resolver: each level decides in order, and the first that says no wins', () => {
  assert.deepEqual(decideFeature(facts()), { allowed: true, value: null, decidedBy: 'default' }, 'an install that never set a policy: today’s behaviour');
  assert.equal(decideFeature(facts({ deployment: false, steward: true })).decidedBy, 'deployment', 'the server cannot: nothing above it helps');
  assert.equal(decideFeature(facts({ status: 'suspended' })).decidedBy, 'status');
  assert.equal(decideFeature(facts({ status: 'closed', instance: { scope: 'families', value: '{}' } })).decidedBy, 'status');
  assert.deepEqual(decideFeature(facts({ instance: { scope: 'off', value: '{}' }, family: { granted: true } })), { allowed: false, value: null, decidedBy: 'operator' }, 'off beats a grant');
  assert.deepEqual(decideFeature(facts({ instance: { scope: 'selected', value: '{}' } })), { allowed: false, value: null, decidedBy: 'grant' }, 'selected, not granted');
  assert.deepEqual(decideFeature(facts({ instance: { scope: 'selected', value: '{}' }, family: { granted: true } })), { allowed: true, value: null, decidedBy: 'grant' });
  assert.equal(decideFeature(facts({ instance: { scope: 'families', value: '{}' }, family: { granted: false } })).decidedBy, 'grant', 'withheld from one family');
  assert.deepEqual(decideFeature(facts({ steward: false })), { allowed: false, value: null, decidedBy: 'steward' });
  assert.deepEqual(decideFeature(facts({ steward: true, member: false })), { allowed: false, value: null, decidedBy: 'member' });
  assert.deepEqual(decideFeature(facts({ steward: true, member: true })), { allowed: true, value: null, decidedBy: 'steward' });
  // Only the levels above the steward lock a steward's control.
  assert.deepEqual(lockOf(decideFeature(facts({ instance: { scope: 'off', value: '{}' } }))), { locked: true, reason: 'operator' });
  assert.deepEqual(lockOf(decideFeature(facts({ steward: false }))), { locked: false, reason: null });
});

test('the AI’s source: byo by default, the operator’s only when offered, opted in and set up', () => {
  const op = (source: string, over: Partial<PolicyFacts> = {}) => facts({ instance: { scope: 'families', value: JSON.stringify({ source, provider: 'anthropic', model: 'claude-haiku-5-5' }) }, operatorKey: true, ...over });
  assert.equal(decideAiSource(facts()).value.source, 'byo');
  assert.equal(decideAiSource(facts({ instance: { scope: 'off', value: '{}' } })).allowed, false);
  assert.equal(decideAiSource(op('none')).allowed, false);
  assert.equal(decideAiSource(op('operator')).allowed, false, 'never on by itself');
  assert.equal(decideAiSource(op('operator')).decidedBy, 'steward');
  assert.equal(decideAiSource(op('operator', { optedIn: true })).value.source, 'operator');
  assert.equal(decideAiSource(op('operator', { optedIn: true, operatorKey: false })).decidedBy, 'deployment', 'no key from the operator: it waits');
  assert.equal(decideAiSource(op('either')).value.source, 'byo');
  assert.equal(decideAiSource(op('either', { optedIn: true })).value.source, 'operator');
  assert.equal(decideAiSource(op('either', { optedIn: true, status: 'suspended' })).allowed, false);
  // Under `selected`, only the granted families get the server's offer; the rest keep their own key.
  const selected = (granted: boolean) => facts({ instance: { scope: 'selected', value: JSON.stringify({ source: 'operator', provider: 'anthropic', model: 'm' }) }, family: { granted }, optedIn: true, operatorKey: true });
  assert.equal(decideAiSource(selected(true)).value.source, 'operator');
  assert.equal(decideAiSource(selected(false)).value.source, 'byo');
  assert.deepEqual(parseAiSource('not json'), parseAiSource('{}'), 'a value that cannot be read is the default');
  assert.equal(parseAiSource('{"familyMicros":-5}').familyMicros, 2_000_000, 'a budget below zero is the default');
});

// ---------- the resolver on the database ----------

test('the migration is plain SQL both drivers run, and an existing install keeps today’s behaviour', async () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/accounts/0042_policies.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK|BEGIN)\b/i);
  for (const key of ['feature.campaign', 'feature.assistant', 'feature.portraits', 'feature.address_lookup'] as const) {
    assert.deepEqual(await policy.effective(A, key), { allowed: true, value: null, decidedBy: 'default' }, key);
  }
  assert.equal((await policy.effective(A, 'feature.push')).decidedBy, 'deployment', 'no VAPID keys here: no push');
  assert.equal((await policy.effective(A, 'ai.source')).value.source, 'byo');
});

test('effective: the operator’s scope, the grant, and the family’s status', async () => {
  await save('feature.campaign', 'selected', [A]);
  assert.equal((await policy.effective(A, 'feature.campaign')).allowed, true);
  assert.deepEqual(await policy.effective(B, 'feature.campaign'), { allowed: false, value: null, decidedBy: 'grant' });
  await save('feature.campaign', 'families', [B]);
  assert.equal((await policy.effective(A, 'feature.campaign')).allowed, true);
  assert.equal((await policy.effective(B, 'feature.campaign')).decidedBy, 'grant', 'withheld');
  await ops.setFamilyStatus(op, A, 'suspended');
  assert.equal((await policy.effective(A, 'feature.campaign')).decidedBy, 'status');
  await ops.setFamilyStatus(op, A, 'active');
  await save('feature.campaign', 'families');
  assert.equal((await policy.effective(B, 'feature.campaign')).allowed, true);
  const log = await store.accounts().all<{ action: string }>("SELECT action FROM operator_audit WHERE action = 'policy'");
  assert.ok(log.length >= 3, 'every save is in the audit log');
  await assert.rejects(save('feature.campaign', 'selected', ['nobody-here']), /no such family|family/i);
});

test('the impact preview counts the families and accounts a change would affect, and saves nothing', async () => {
  const impact = await policy.policyImpact('feature.assistant', { scope: 'selected', families: [A], ai: null });
  assert.deepEqual({ losing: impact.losing, gaining: impact.gaining, accounts: impact.accounts, names: impact.names }, { losing: 1, gaining: 0, accounts: 1, names: ['The Birches'] });
  const off = await policy.policyImpact('feature.assistant', { scope: 'off', families: [], ai: null });
  assert.equal(off.losing, 2);
  assert.equal(off.accounts, 3, 'Sana, Vic and Bo');
  assert.equal((await policy.policyImpact('feature.assistant', { scope: 'families', families: [], ai: null })).losing, 0);
  assert.equal((await policy.effective(B, 'feature.assistant')).allowed, true, 'a preview saves nothing');
});

// ---------- each wired feature, refused on the server ----------

test('the Campaign: off for the family, nothing plays and its switch is locked; nothing is deleted', async () => {
  as(stewardA);
  await campaign.setCampaignEnabled(A, true, stewardA.id);
  const who = { account: stewardA.id, name: stewardA.name, person: null };
  assert.equal((await campaign.campaignStatus(A, who)).enabled, true);
  as(op);
  await save('feature.campaign', 'off');
  as(stewardA);
  assert.deepEqual(await campaign.campaignStatus(A, who), { enabled: false, locked: true });
  await assert.rejects(campaign.startRun(A, who, null), /campaign\.err\.off/);
  await assert.rejects(campaign.keepRun(A, who, crypto.randomUUID(), []), /campaign\.err\.off/);
  await assert.rejects(campaign.finishRun(A, who, crypto.randomUUID(), [], undefined), /campaign\.err\.off/);
  assert.equal(await campaign.quizRewardOn(A), false);
  await assert.rejects(campaign.setCampaignEnabled(B, true, stewardB.id), /operator/);
  const settings = await campaign.campaignSettings(A);
  assert.deepEqual(settings, { enabled: true, lock: { locked: true, reason: 'operator' } }, 'the stewards’ switch is kept as they set it');
  as(op);
  await save('feature.campaign', 'families');
  as(stewardA);
  assert.equal((await campaign.campaignStatus(A, who)).enabled, true, 'on again as it was');
});

const OFF_FEATURES = { assistant: false, faces: false, avatar: false, arms: false };
test('the AI: the assistant and every adapter refused when the operator has it off, and hidden', async () => {
  as(stewardA);
  await setUpFamilyAi(A, stewardA.id, { provider: 'anthropic', model: '', apiKey: 'sk-ant-test-alder', features: { ...OFF_FEATURES, assistant: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {} });
  assert.ok((await ai.adapterForFeature(A, 'assistant', 'en')).adapter);
  assert.equal((await ai.statusFor(A)).features.assistant, true);
  as(op);
  await save('feature.assistant', 'selected', [B]);
  as(stewardA);
  await assert.rejects(ai.adapterForFeature(A, 'assistant', 'en'), /operator/);
  await assert.rejects(ai.routeAdapter(A, 'arms', 'en'), /operator/);
  assert.deepEqual(await ai.statusFor(A), { configured: false, provider: null, features: OFF_FEATURES });
  assert.equal((await ai.readSettings(A)).features.assistant, true, 'the family’s switch is kept');
  as(op);
  await save('feature.assistant', 'families');
  await save('ai.source', 'off');
  as(stewardA);
  await assert.rejects(ai.adapterForFeature(A, 'assistant', 'en'), /AI off/);
  as(op);
  await save('ai.source', 'families');
  as(stewardA);
  assert.ok((await ai.adapterForFeature(A, 'assistant', 'en')).adapter, 'back as it was');
});

test('a background task skips a family whose AI the operator turned off, and runs nothing', async () => {
  await dbs.db(A).run("INSERT INTO person (id, given, surname, living, occupation) VALUES ('wren', 'Wren', 'Alder', 0, 'Zylograph of the moors')");
  as(stewardA);
  await bg.setTaskEnabled(A, 'occupations', true);
  assert.equal((await bg.readiness(A, 'occupations')).state, 'ready');
  as(op);
  await save('feature.assistant', 'off');
  g.__request = undefined;
  g.__session = undefined;
  // The daily run has no request: the readiness is read from the database alone.
  assert.equal((await bg.readiness(A, 'occupations')).state, 'policy-off');
  const out = await bg.runTask(A, 'occupations', { source: 'manual' });
  assert.equal(out.status, 'skipped');
  assert.equal(out.calls, 0);
  const lines: string[] = [];
  await bg.runScheduled([A], new Date(), (m) => lines.push(m));
  assert.equal((await store.accounts().all("SELECT * FROM ai_task_run WHERE tree = ? AND status = 'done'", A)).length, 0);
  as(op);
  await save('feature.assistant', 'families');
  await bg.setTaskEnabled(A, 'occupations', false);
});

test('painted portraits: refused when the operator has them off, and never on the operator’s AI', async () => {
  as(stewardA);
  assert.equal(await portrait.paintingAllowed(A), true);
  as(op);
  await save('feature.portraits', 'off');
  as(stewardA);
  assert.equal(await portrait.paintingAllowed(A), false);
  await assert.rejects(portrait.setPortraitEnabled(A, stewardA.id, true), /policy\.err\.off/);
  assert.equal((await portrait.portraitStatus(A)).enabled, false);
  as(op);
  await save('feature.portraits', 'families');
});

test('address lookup: the server function refuses when the operator has it off, before any lookup', async () => {
  as(stewardA);
  assert.deepEqual(await fieldFns.getAddressLookup({ data: { tree: A } }), { on: true });
  as(op);
  await save('feature.address_lookup', 'selected', [B]);
  as(stewardA);
  assert.deepEqual(await fieldFns.getAddressLookup({ data: { tree: A } }), { on: false });
  // The network guard above would throw if a lookup were tried.
  assert.deepEqual(await fieldFns.suggestAddressesOnline({ data: { tree: A, text: 'Mill Lane 4', locale: 'en' } }), { ok: false, reason: 'off' });
  as(op);
  await save('feature.address_lookup', 'families');
});

async function device(user: string, tree: string, endpoint: string, at: number) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await store.accounts().run(
    `INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen, posts)
     VALUES (?, ?, ?, ?, ?, ?, '[0]', '["birthday"]', 'en', ?, ?, 1)`, crypto.randomUUID(), user, tree, endpoint, p256dh, auth, at, at);
}
async function vapidKeys() {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:alders@example.org' };
}

test('push: a family whose push is off gets none, and its devices stay registered', async () => {
  const now = new Date();
  await device(viewerA.id, A, 'https://web.push.apple.com/vic', now.getTime());
  const vapid = await vapidKeys();
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;
  as(op);
  await save('feature.push', 'off');
  as(stewardA);
  assert.equal(await postPush.notifyPost(A, { id: stewardA.id, name: stewardA.name }, { vapid, fetchImpl, now }), 0);
  // A family that is skipped is never even read.
  const loadGraph = async () => { throw new Error('a family whose push is off was read'); };
  const totals = await reminders.sendDailyReminders({ trees: [A], now, vapid, fetchImpl, log: () => {}, loadGraph });
  assert.equal(totals.sent, 0);
  assert.deepEqual(sent, []);
  await assert.rejects(reminders.saveRegistration({ user: viewerA.id, tree: A, subscription: { endpoint: 'https://web.push.apple.com/new', keys: { p256dh: 'x', auth: 'y' } }, choices: { offsets: [0], kinds: ['birthday'] }, locale: 'en' }), /operator/);
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM push_subscription WHERE tree = ?', A))!.n, 1, 'kept');
  as(op);
  await save('feature.push', 'families');
  as(stewardA);
  assert.equal(await postPush.notifyPost(A, { id: stewardA.id, name: stewardA.name }, { vapid, fetchImpl, now }), 1);
  assert.deepEqual(sent, ['https://web.push.apple.com/vic']);
});

// ---------- operator-funded AI ----------

test('the operator’s budget: racing reservations never pass the family’s budget or the server’s ceiling', async () => {
  const c = (k: string) => k;
  const limits = { familyMicros: 1_000_000, ceilingMicros: 1_500_000 };
  const tries = await Promise.allSettled(Array.from({ length: 20 }, () => funding.reserveOperator('race-a', 100_000, limits, c as never)));
  assert.equal(tries.filter((r) => r.status === 'fulfilled').length, 10, 'exactly the family’s budget, no more');
  assert.ok(tries.filter((r) => r.status === 'rejected').every((r) => /operator_budget/.test(String((r as PromiseRejectedResult).reason?.message))));
  // Another family hits the server's ceiling: only 500,000 is left of it.
  const more = await Promise.allSettled(Array.from({ length: 10 }, () => funding.reserveOperator('race-b', 100_000, limits, c as never)));
  assert.equal(more.filter((r) => r.status === 'fulfilled').length, 5);
  const month = new Date().toISOString().slice(0, 7);
  assert.equal((await store.accounts().get<{ micros: number }>('SELECT micros FROM ai_operator_month WHERE month = ?', month))!.micros, 1_500_000);
  // A settlement replaces the reservation once; settling it again changes nothing.
  const booking = (tries.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof funding.reserveOperator>>>).value;
  assert.equal(await funding.settleOperator(booking, 40_000), true);
  assert.equal(await funding.settleOperator(booking, 40_000), false);
  assert.equal((await store.accounts().get<{ micros: number }>("SELECT micros FROM ai_operator_spend WHERE tree = 'race-a' AND month = ?", month))!.micros, 940_000);
  assert.equal((await store.accounts().get<{ micros: number }>('SELECT micros FROM ai_operator_month WHERE month = ?', month))!.micros, 1_440_000);
});

test('operator-funded AI: refused for a model with no price, opt-in only, and booked on the operator’s money', async () => {
  as(op);
  await assert.rejects(save('ai.source', 'families', [], { source: 'either', provider: 'anthropic', model: 'claude-unknown-9', familyMicros: 2_000_000, ceilingMicros: 3_000_000 }), /price/);
  await assert.rejects(save('ai.source', 'families', [], { source: 'operator', provider: null, model: '', familyMicros: 2_000_000, ceilingMicros: 3_000_000 }), /provider and the model/);
  await save('ai.source', 'selected', [B], { source: 'either', provider: 'anthropic', model: 'claude-haiku-5-5', familyMicros: 2_000_000, ceilingMicros: 3_000_000 });
  await funding.saveOperatorKey(op, 'anthropic', 'sk-ant-operator-test');
  const keys = await funding.operatorKeyStates();
  assert.deepEqual(keys.find((k) => k.provider === 'anthropic'), { provider: 'anthropic', saved: true, keyTail: 'test', readable: true });
  // Birch has no key of its own: until its steward opts in, it has no AI.
  as(stewardB);
  assert.equal((await policy.effective(B, 'ai.source')).value.source, 'byo');
  await assert.rejects(funding.setFunding(A, stewardA.id, 'operator'), /not_offered/, 'Alder was not offered it');
  await funding.setFunding(B, stewardB.id, 'operator');
  assert.equal((await policy.effective(B, 'ai.source')).value.source, 'operator');
  await ai.saveSettings(B, stewardB.id, { features: { ...OFF_FEATURES, assistant: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: { 'claude-haiku-5-5': { inPerM: 0, outPerM: 0 } } });
  assert.equal((await ai.statusFor(B)).configured, true);
  const { adapter } = await ai.adapterForFeature(B, 'assistant', 'en');
  await adapter.complete({ system: 'You are a test.', messages: [{ role: 'user', text: 'Hello' }], maxTokens: 200 });
  const month = new Date().toISOString().slice(0, 7);
  const spent = (await store.accounts().get<{ micros: number }>('SELECT micros FROM ai_operator_spend WHERE tree = ? AND month = ?', B, month))?.micros ?? 0;
  assert.ok(spent > 0, 'booked at the table’s price: the family’s own price of 0 does not count');
  assert.equal((await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM ai_operator_booking WHERE tree = ? AND settled_at IS NULL', B))!.n, 0, 'settled');
  const view = await policy.familyPolicies(B);
  assert.deepEqual({ source: view.ai.source, spent: view.ai.spentMicros, budget: view.ai.budgetMicros }, { source: 'operator', spent, budget: 2_000_000 });
  // Painting is never on the operator's money.
  assert.equal(await portrait.paintingAllowed(B), false);
  // The steward opts out: back to the family's own keys (none), and nothing of theirs was changed.
  await funding.setFunding(B, stewardB.id, 'own');
  await assert.rejects(ai.adapterForFeature(B, 'assistant', 'en'));
  as(op);
  await save('ai.source', 'families');
});

// ---------- announcements ----------

test('announcements: stewards’ notes to stewards and operators, others to everyone, within their window, plain text', async () => {
  as(op);
  const now = Date.now();
  const stewardsOnly = await ann.createAnnouncement(op, { title: '  Maintenance <b>tonight</b> ', body: 'The server restarts at 22:00.\u0007', audience: 'stewards', startsAt: now - 1000, endsAt: null });
  assert.equal(stewardsOnly.title, 'Maintenance <b>tonight</b>', 'kept as typed: the page shows it as text, never as HTML');
  assert.equal(stewardsOnly.body, 'The server restarts at 22:00.', 'control characters out');
  const everyone = await ann.createAnnouncement(op, { title: 'New provider', body: '', audience: 'everyone', startsAt: now - 1000, endsAt: now + 3_600_000 });
  await ann.createAnnouncement(op, { title: 'Later', body: '', audience: 'everyone', startsAt: now + 3_600_000, endsAt: null });
  await assert.rejects(ann.createAnnouncement(op, { title: 'Backwards', body: '', audience: 'everyone', startsAt: now, endsAt: now - 1 }), /end after/);
  await assert.rejects(ann.createAnnouncement(op, { title: '   ', body: '', audience: 'everyone', startsAt: now, endsAt: null }), /title/);
  const titles = (list: { title: string }[]) => list.map((a) => a.title).sort();
  as(viewerA);
  assert.deepEqual(titles(await fns.fetchMyAnnouncements({})), ['New provider']);
  as(stewardA);
  assert.deepEqual(titles(await fns.fetchMyAnnouncements({})), ['Maintenance <b>tonight</b>', 'New provider']);
  as(op);
  assert.deepEqual(titles(await fns.fetchMyAnnouncements({})), ['Maintenance <b>tonight</b>', 'New provider'], 'an operator is told what stewards are');
  as(null);
  assert.deepEqual(await fns.fetchMyAnnouncements({}), [], 'nobody signed in');
  await ann.endAnnouncement(op, everyone.id, now + 1);
  as(viewerA);
  assert.deepEqual(await fns.fetchMyAnnouncements({}), []);
  // Only an operator makes or ends one; a steward is refused.
  as(stewardA);
  await assert.rejects(fns.createAnnouncement({ data: { title: 'Mine', body: '', audience: 'everyone', startsAt: now, endsAt: null } }), /operator/);
});

test('a demo shows no announcement and writes no policy', async () => {
  process.env.KINDRED_DEMO = '1';
  try {
    as(stewardA);
    assert.deepEqual(await fns.fetchMyAnnouncements({}), []);
    as(op);
    await assert.rejects(fns.savePolicy({ data: { key: 'feature.campaign', scope: 'off', ai: null, families: [] } }));
    await assert.rejects(ai.routeAdapter(A, 'assistant', 'en'));
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal((await policy.effective(A, 'feature.campaign')).allowed, true);
});

test('“View as”: a steward previewing a viewer sees only what that viewer would, and can change no policy or funding', async () => {
  as(stewardA, undefined);
  await viewAs.startViewAs({ data: { tree: A, choice: { kind: 'role', role: 'viewer' } } });
  const set = g.__setCookies!.findLast((c) => /^kindred_view_as=[^;]/.test(c));
  assert.ok(set, 'the preview started');
  cookie = set.split(';')[0];
  as(stewardA);
  assert.deepEqual((await fns.fetchMyAnnouncements({})).map((a) => a.title), [], 'the stewards’ note is not the viewer’s');
  await assert.rejects(fns.setAiFunding({ data: { tree: A, operator: true } }));
  await assert.rejects(ai.routeAdapter(A, 'assistant', 'en'), 'a preview sends nothing to a provider');
  as(stewardA);
  await viewAs.stopViewAs({});
  cookie = undefined;
});
