// node --test src/lib/lifecycle/lifecycle.test.ts: the lifecycle of quiet families (docs/hosting-many-families.md, "Lifecycle").
// Off by default and changing nothing then; the thresholds, each stage waiting its own time; a member's visit resetting the clock
// (a former member's not); a steward turning the family back on (and nobody else, and never the operator's suspension); the race
// (a visit or a reactivation after the selection wins); confirmed and automatic deletion, with the final notice pushed through a
// fake push service; turning it off; the operator's own decision; a demo and a "View as" preview. Invented names only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-lifecycle-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_DEFAULT_TREE;
delete process.env.KINDRED_AUTH;
// The job has no request: an email's links start with KINDRED_ORIGIN (src/lib/email/origin.ts). No mailer is set but in the tests that set one.
process.env.KINDRED_ORIGIN = 'http://family.example.org';

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

const lc = await load<typeof import('./lifecycle.server.ts')>('/src/lib/lifecycle/lifecycle.server.ts');
const fns = await load<typeof import('./lifecycle.functions.ts')>('/src/lib/lifecycle/lifecycle.functions.ts');
const shared = await load<typeof import('./shared.ts')>('/src/lib/lifecycle/shared.ts');
const ops = await load<typeof import('../operator/operator.server.ts')>('/src/lib/operator/operator.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const acc = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const history = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const trees = await load<typeof import('../auth/trees.server.ts')>('/src/lib/auth/trees.server.ts');
const viewAs = await load<typeof import('../auth/view-as.functions.ts')>('/src/lib/auth/view-as.functions.ts');
const { addMonths } = await load<typeof import('../operator/shared.ts')>('/src/lib/operator/shared.ts');
const { b64url } = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');
const { q } = await load<typeof import('../store/index.ts')>('/src/lib/store/index.ts');

const QUIET = 'quietby';
const BUSY = 'busyton';
const SPARE = 'sparrow';
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 15, 12);
/** `n` months after T0, a day on: past the end of the day a period in months ends on. */
const at = (n: number) => addMonths(T0, n) + DAY;

type U = { id: string; name: string; email: string | null; handle: string; created: number; last_seen: null; locale: null; operator: number };
const user = (n: number, name: string, operator = 0): U => ({ id: `00000000-0000-4000-8000-00000000010${n}`, name, email: `${name.toLowerCase()}@example.org`, handle: `h-${n}`, created: T0, last_seen: null, locale: null, operator });
const OP = user(1, 'Orla', 1);
const STEW = user(2, 'Sten');
const MEMB = user(3, 'Mira');
const FORMER = user(4, 'Fenna');
const g = globalThis as unknown as { __session?: unknown; __request?: Request; __setCookies?: string[] };
const accounts = () => acc.accounts();
const one = async <R>(sql: string, ...p: (string | number | null)[]) => accounts().get<R>(sql, ...p);
const count = async (sql: string, ...p: (string | number | null)[]) => (await one<{ n: number }>(sql, ...p))!.n;
const outside = () => { g.__request = undefined; g.__session = undefined; };
let cookie: string | undefined;
function asUser(u: U, withCookie: string | undefined = cookie) {
  g.__session = { user: u, via: 'passkey', sessionHash: `session-${u.id}` };
  g.__setCookies = [];
  g.__request = new Request('http://localhost/', { headers: withCookie ? { cookie: withCookie } : {} });
}

const ON = { on: true, warnMonths: 12, readOnlyMonths: 18, deleteMonths: 24, autoDelete: false };
const stage = () => one<{ stage: string; claim: string | null }>('SELECT stage, claim FROM family_lifecycle WHERE tree = ?', QUIET);
const admin = () => one<{ status: string; status_by: string | null; active_at: number | null }>('SELECT status, status_by, active_at FROM family_admin WHERE tree = ?', QUIET);
const actions = async () => (await accounts().all<{ action: string }>("SELECT action FROM operator_audit WHERE action LIKE 'lifecycle.%' AND family = ? ORDER BY id", QUIET)).map((r) => r.action);
const run = (now: number, opts: Parameters<typeof lc.runLifecycle>[1] = {}) => { outside(); return lc.runLifecycle(now, { vapid: null, ...opts }); };

before(async () => {
  for (const u of [OP, STEW, MEMB, FORMER]) await accounts().run('INSERT INTO user (id, name, email, handle, created, operator) VALUES (?, ?, ?, ?, ?, ?)', u.id, u.name, u.email, u.handle, u.created, u.operator);
});

/** Each test starts from three families made at T0, the lifecycle off, and nobody's visits. */
beforeEach(async () => {
  outside();
  cookie = undefined;
  for (const [id, name] of [[QUIET, 'The Quietbys'], [BUSY, 'The Busytons'], [SPARE, 'The Sparrows']]) await dbs.provisionFamily(id, name);
  await accounts().batch([
    q('DELETE FROM family_lifecycle'), q('DELETE FROM steward_notice'), q('DELETE FROM steward_notice_dismissal'), q('DELETE FROM family_visit'),
    q('DELETE FROM operator_audit'), q('DELETE FROM view_as'), q("DELETE FROM instance_setting WHERE key IN ('lifecycle', 'lifecycle_report')"),
    q('DELETE FROM push_subscription'),
    ...[QUIET, BUSY, SPARE].map((t) => q(`INSERT INTO family_admin (tree, created_at) VALUES (?, ?) ON CONFLICT(tree) DO UPDATE SET status = 'active', closed = 0,
      status_reason = NULL, status_ground = NULL, status_at = NULL, status_by = NULL, active_at = NULL, created_at = excluded.created_at`, t, T0)),
    // The busy family is always in use.
    q('UPDATE family_admin SET active_at = ? WHERE tree = ?', addMonths(T0, 1200), BUSY),
    acc.upsertMembership(STEW.id, QUIET, 'steward'), acc.upsertMembership(MEMB.id, QUIET, 'viewer'), acc.upsertMembership(STEW.id, SPARE, 'steward'),
  ]);
});
after(async () => {
  outside();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Brings the quiet family to read-only under `settings`. */
async function toReadOnly(settings = ON) {
  await lc.saveLifecycleSettings(OP, settings, T0);
  await run(at(12));
  await run(at(18));
  assert.equal((await stage())?.stage, 'readonly');
}

test('off by default: the job changes nothing, the family is told nothing, and the dry run still reports', async () => {
  assert.deepEqual(await lc.lifecycleSettings(), shared.LIFECYCLE_DEFAULTS);
  assert.equal(shared.LIFECYCLE_DEFAULTS.on, false);
  assert.equal(await run(at(60)), null);
  assert.equal(await count('SELECT count(*) AS n FROM family_lifecycle'), 0);
  assert.equal(await count('SELECT count(*) AS n FROM steward_notice'), 0);
  assert.equal(await count("SELECT count(*) AS n FROM family_admin WHERE status <> 'active'"), 0);
  assert.equal(await count("SELECT count(*) AS n FROM instance_setting WHERE key LIKE 'lifecycle%'"), 0);
  assert.deepEqual(await actions(), []);
  assert.equal(await lc.familyLifecycle(QUIET, STEW.id, true, at(60)), null);
  // Report first: what turning it on would do, with nothing stored.
  const dry = await run(at(60), { dryRun: true });
  assert.deepEqual(dry?.families.map((f) => [f.id, f.step]), [[QUIET, 'warn'], [SPARE, 'warn']]);
  assert.equal(dry?.counts.warn, 2);
  assert.equal(await count('SELECT count(*) AS n FROM family_lifecycle'), 0);
  assert.equal(await lc.lastLifecycleReport(), null);
});

test('the thresholds: warned at 12 months, read-only at 18, due at 24, and a confirmed deletion waits for the operator', async () => {
  await lc.saveLifecycleSettings(OP, ON, T0);
  assert.equal((await run(addMonths(T0, 12) - DAY))?.counts.warn, 0);
  assert.equal((await run(at(12)))?.counts.warn, 2);
  assert.equal((await stage())?.stage, 'warned');
  assert.equal(await count("SELECT count(*) AS n FROM steward_notice WHERE tree = ? AND kind = 'lifecycle_warning'", QUIET), 1);
  const told = await lc.familyLifecycle(QUIET, STEW.id, true, at(12));
  assert.equal(told?.stage, 'warned');
  assert.equal(told?.readOnly, false);
  // Six months after the warning (never sooner than 18 after the last activity).
  assert.equal(told?.readOnlyAt, addMonths(at(12), 6));
  await run(at(17));
  assert.equal((await stage())?.stage, 'warned');
  await run(at(18));
  assert.equal((await stage())?.stage, 'readonly');
  assert.deepEqual({ ...(await admin()) }, { status: 'suspended', status_by: 'lifecycle', active_at: null });
  // Read-only as any suspension is (its members' requests are), and its members are told why in their language.
  assert.equal((await acc.membershipsOf(MEMB.id)).find((m) => m.tree === QUIET)?.suspended, 1);
  assert.equal((await lc.familyLifecycle(QUIET, MEMB.id, false, at(18)))?.readOnly, true);
  await run(at(23));
  assert.equal((await stage())?.stage, 'readonly');
  await run(at(24));
  assert.equal((await stage())?.stage, 'due');
  assert.equal(await count("SELECT count(*) AS n FROM steward_notice WHERE tree = ? AND kind = 'lifecycle_due'", QUIET), 1);
  // Confirmed deletion: it waits, listed in the console with its dates.
  await run(at(40));
  assert.equal((await stage())?.stage, 'due');
  assert.deepEqual((await lc.lifecycleFamilies()).map((f) => [f.id, f.stage, f.deleteAt]), [[QUIET, 'due', null], [SPARE, 'due', null]]);
  assert.deepEqual(await actions(), ['lifecycle.warn', 'lifecycle.readonly', 'lifecycle.due']);
  assert.ok((await lc.lastLifecycleReport())?.at === at(40));
});

test('turning it on for a family quiet for years still warns first, and each stage waits its own time', async () => {
  await lc.saveLifecycleSettings(OP, ON, T0);
  await run(at(60));
  assert.equal((await stage())?.stage, 'warned');
  await run(at(65));
  assert.equal((await stage())?.stage, 'warned');
  await run(at(66));
  assert.equal((await stage())?.stage, 'readonly');
  await run(at(71));
  assert.equal((await stage())?.stage, 'readonly');
  await run(at(72));
  assert.equal((await stage())?.stage, 'due');
});

test('a member’s visit resets the clock and clears the warning; a former member’s does not count', async () => {
  await lc.saveLifecycleSettings(OP, ON, T0);
  await run(at(12));
  // Someone who left the family: their old visit row is not activity.
  await accounts().run('INSERT INTO family_visit (user, tree, since, shown, last_seen, visits) VALUES (?, ?, ?, NULL, ?, 1)', FORMER.id, QUIET, at(13), at(13));
  assert.equal((await run(at(13) + DAY))?.counts.clear, 0);
  assert.equal((await stage())?.stage, 'warned');
  await history.noteVisit(MEMB.id, QUIET, at(13));
  const r = await run(at(13) + DAY);
  assert.equal(r?.counts.clear, 1);
  assert.equal(await stage(), undefined);
  assert.equal(await count('SELECT count(*) AS n FROM steward_notice WHERE tree = ?', QUIET), 0);
  // The clock starts again at the visit: no warning until 12 months after it.
  await run(at(24));
  assert.equal(await stage(), undefined);
  await run(at(25) + DAY);
  assert.equal((await stage())?.stage, 'warned');
});

test('a steward turns a read-only family back on with one click; a member cannot, nor can anyone lift the operator’s suspension', async () => {
  await toReadOnly();
  asUser(MEMB);
  await assert.rejects(fns.reactivateFamily({ data: { tree: QUIET } }), (e: Error & { status?: number }) => e.status === 403);
  // The steward's request reaches a suspended family, and still writes this one change.
  asUser(STEW);
  const seen = await fns.fetchFamilyLifecycle({ data: { tree: QUIET } });
  assert.equal(seen?.readOnly, true);
  assert.equal(seen?.steward, true);
  asUser(STEW);
  await fns.reactivateFamily({ data: { tree: QUIET } });
  const a = await admin();
  assert.equal(a?.status, 'active');
  assert.equal(a?.status_by, null);
  assert.ok(a?.active_at && a.active_at > T0, 'turning it on is activity');
  assert.equal(await stage(), undefined);
  assert.equal(await count('SELECT count(*) AS n FROM steward_notice WHERE tree = ?', QUIET), 0);
  assert.deepEqual((await actions()).slice(-1), ['lifecycle.reactivate']);
  // The operator's own suspension is not the steward's to lift.
  await ops.setFamilyStatus(OP as never, QUIET, 'suspended', { reason: 'Looking into a complaint.', ground: 'terms' });
  asUser(STEW);
  await assert.rejects(fns.reactivateFamily({ data: { tree: QUIET } }), /not read-only for inactivity/);
  assert.equal((await admin())?.status, 'suspended');
});

test('the race: a visit after the selection keeps the family as it was', async () => {
  await lc.saveLifecycleSettings(OP, ON, T0);
  await run(at(12));
  const r = await run(at(18), { afterSelect: () => history.noteVisit(MEMB.id, QUIET, at(18) - 60_000) });
  assert.equal(r?.families.find((f) => f.id === QUIET)?.outcome, 'kept');
  assert.equal(r?.counts.kept, 1);
  assert.equal((await stage())?.stage, 'warned');
  assert.equal((await admin())?.status, 'active');
  // The next run sees the visit and withdraws the warning.
  assert.equal((await run(at(18) + DAY))?.counts.clear, 1);
});

/** A steward with a confirmed address, and a mailer that keeps what it is given, for `work`. */
async function withEmail(work: (mails: import('../email/mailer.ts').MailMessage[]) => Promise<void>) {
  const send = await load<typeof import('../email/send.server.ts')>('/src/lib/email/send.server.ts');
  const mails: import('../email/mailer.ts').MailMessage[] = [];
  send.setMailerForTests({ mailer: { send: async (m) => { mails.push(m); } } });
  await accounts().run('UPDATE user SET email_verified = 1 WHERE id = ?', STEW.id);
  try {
    await work(mails);
  } finally {
    send.setMailerForTests(undefined);
    await accounts().batch([q('UPDATE user SET email_verified = 0 WHERE id = ?', STEW.id), q('DELETE FROM email_send'), q('DELETE FROM email_optout')]);
  }
}

test('the race: a steward turning the family on after the selection stops its deletion', () => withEmail(async () => {
  await toReadOnly({ ...ON, autoDelete: true });
  await run(at(24));
  const deleteAt = (await lc.lifecycleFamilies()).find((f) => f.id === QUIET)?.deleteAt;
  assert.ok(deleteAt);
  const r = await run(deleteAt + DAY, { afterSelect: async () => { await lc.reactivate(STEW, QUIET, deleteAt); } });
  assert.equal(r?.families.find((f) => f.id === QUIET)?.outcome, 'kept');
  assert.ok((await trees.families()).some((f) => f.id === QUIET));
  assert.equal((await admin())?.status, 'active');
}));

test('automatic deletion waits for the operator while the final notice reached no steward', async () => {
  await toReadOnly({ ...ON, autoDelete: true });
  await run(at(24));
  const notice = await one<{ emailed: number; pushed: number }>("SELECT emailed, pushed FROM steward_notice WHERE tree = ? AND kind = 'lifecycle_final'", QUIET);
  assert.deepEqual({ ...notice }, { emailed: 0, pushed: 0 }, 'no push keys, no email: delivered nowhere but the app');
  const listed = (await lc.lifecycleFamilies()).find((f) => f.id === QUIET)!;
  assert.equal(listed.deleteAt, null, 'no date for an automatic deletion');
  assert.equal(listed.undelivered, true, 'the console says why');
  const logs: string[] = [];
  const r = await run(at(24) + (shared.FINAL_NOTICE_DAYS + 1) * DAY, { log: (m) => logs.push(m) });
  assert.equal(r?.families.find((f) => f.id === QUIET)?.outcome, 'failed');
  assert.ok(logs.some((m) => /reached no steward/.test(m)), logs.join('; '));
  assert.ok((await trees.families()).some((f) => f.id === QUIET), 'kept');
  assert.equal((await stage())?.claim, null);
  await lc.confirmDeletion(OP, QUIET, QUIET, at(24) + (shared.FINAL_NOTICE_DAYS + 2) * DAY);
  assert.ok(!(await trees.families()).some((f) => f.id === QUIET), 'the operator may still confirm it');
});

test('a final notice by email counts as delivered, and cannot be unsubscribed', () => withEmail(async (mails) => {
  await toReadOnly({ ...ON, autoDelete: true });
  // The steward left the family notices: the warnings stop, the final notice does not.
  const send = await load<typeof import('../email/send.server.ts')>('/src/lib/email/send.server.ts');
  await accounts().run("INSERT INTO email_optout (recipient, category, at) VALUES (?, 'family', 0)", await send.recipientHash(STEW.email!));
  mails.length = 0;
  await run(at(24));
  const final = mails.filter((m) => m.text.includes('/quietby'));
  assert.equal(final.length, 1);
  assert.equal(final[0]!.headers['List-Unsubscribe'], undefined);
  assert.match(final[0]!.text, /http:\/\/family\.example\.org\/quietby/, 'a job’s links start with KINDRED_ORIGIN');
  const notice = await one<{ emailed: number; pushed: number }>("SELECT emailed, pushed FROM steward_notice WHERE tree = ? AND kind = 'lifecycle_final'", QUIET);
  assert.equal(notice?.emailed, 1);
  const deleteAt = (await lc.lifecycleFamilies()).find((f) => f.id === QUIET)?.deleteAt;
  assert.ok(deleteAt);
  assert.equal((await run(deleteAt + DAY))?.families.find((f) => f.id === QUIET)?.outcome, 'done');
  assert.ok(!(await trees.families()).some((f) => f.id === QUIET));
}));

test('confirmed deletion: the operator types the family’s address; the deletion is logged and leaves nothing behind', async () => {
  await toReadOnly();
  await assert.rejects(lc.confirmDeletion(OP, QUIET, QUIET, at(24)), /no longer due/);
  await run(at(24));
  await assert.rejects(lc.confirmDeletion(OP, QUIET, 'quiet', at(24)));
  assert.equal((await stage())?.stage, 'due');
  await lc.confirmDeletion(OP, QUIET, QUIET, at(24) + DAY);
  assert.ok(!(await trees.families()).some((f) => f.id === QUIET));
  assert.equal(await count('SELECT count(*) AS n FROM family_lifecycle WHERE tree = ?', QUIET), 0);
  assert.equal(await count('SELECT count(*) AS n FROM steward_notice WHERE tree = ?', QUIET), 0);
  assert.equal(await count('SELECT count(*) AS n FROM membership WHERE tree = ?', QUIET), 0);
  assert.deepEqual((await actions()).slice(-1), ['lifecycle.delete_confirmed']);
});

test('automatic deletion: a final notice, pushed to the stewards, then the deletion 30 days later', async () => {
  // A steward's phone, with push on, at a push service the fake fetch answers.
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  await accounts().run(`INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen)
    VALUES ('ph', ?, ?, 'https://fcm.googleapis.com/fcm/send/quiet', ?, ?, '[]', '[]', 'en', ?, ?)`, STEW.id, QUIET, p256dh, b64url(crypto.getRandomValues(new Uint8Array(16))), T0, T0);
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:ops@example.org' };
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL) => { sent.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;
  const logs: string[] = [];
  await lc.saveLifecycleSettings(OP, { ...ON, autoDelete: true }, T0);
  await run(at(12), { vapid, fetchImpl, log: (m) => logs.push(m) });
  await run(at(18), { vapid, fetchImpl, log: (m) => logs.push(m) });
  assert.deepEqual(logs, []);
  assert.equal(sent.length, 2, 'the warning and read-only were pushed');
  await run(at(24), { vapid, fetchImpl });
  assert.equal(sent.length, 3, 'the final notice was pushed');
  const notice = await one<{ kind: string; vars: string }>("SELECT kind, vars FROM steward_notice WHERE tree = ? AND kind = 'lifecycle_final'", QUIET);
  const { deleteAt } = JSON.parse(notice!.vars) as { deleteAt: number };
  assert.equal(deleteAt, at(24) + shared.FINAL_NOTICE_DAYS * DAY);
  // The push's words, in the steward's language, name the family and the date.
  const { noticeText } = await load<typeof import('../notify/stewards.server.ts')>('/src/lib/notify/stewards.server.ts');
  assert.match(noticeText('lifecycle_final', { deleteAt }, 'en', 'The Quietbys').title, /^The Quietbys will be deleted on /);
  await run(deleteAt - DAY, { vapid, fetchImpl });
  assert.ok((await trees.families()).some((f) => f.id === QUIET), 'not before the 30 days');
  const r = await run(deleteAt + DAY, { vapid, fetchImpl });
  assert.equal(r?.counts.delete, 1);
  assert.equal(r?.families.find((f) => f.id === SPARE)?.outcome, 'failed', 'the Sparrows’ final notice reached no device and no inbox: they wait for the operator');
  assert.ok(!(await trees.families()).some((f) => f.id === QUIET));
  assert.equal(await count('SELECT count(*) AS n FROM push_subscription WHERE tree = ?', QUIET), 0);
  assert.deepEqual(await actions(), ['lifecycle.warn', 'lifecycle.readonly', 'lifecycle.due', 'lifecycle.delete']);
});

test('the server’s last family is never deleted by the lifecycle: the run reports it instead', async () => {
  await toReadOnly({ ...ON, autoDelete: true });
  await run(at(24));
  // The other two go first, so the quiet family is the last one left.
  for (const t of [BUSY, SPARE]) await (await load<typeof import('../families.server.ts')>('/src/lib/families.server.ts')).deleteFamily(t, t);
  const logged: string[] = [];
  const r = await run(at(26), { log: (m) => logged.push(m) });
  assert.equal(r?.counts.failed, 1);
  assert.ok(logged.some((m) => /last/.test(m)));
  assert.equal((await stage())?.claim, null);
});

test('turning it off opens what it made read-only and withdraws its warnings; the operator’s own decision replaces it', async () => {
  await toReadOnly();
  await lc.saveLifecycleSettings(OP, { ...ON, on: false }, at(19));
  assert.equal((await admin())?.status, 'active');
  assert.equal(await stage(), undefined);
  assert.equal(await count('SELECT count(*) AS n FROM steward_notice'), 0);
  assert.deepEqual(await actions(), ['lifecycle.warn', 'lifecycle.readonly']);
  // On again: the operator lets a read-only family be used again, which is activity.
  await lc.saveLifecycleSettings(OP, ON, at(19));
  await run(at(31));
  await run(at(37));
  assert.equal((await stage())?.stage, 'readonly');
  await ops.setFamilyStatus(OP as never, QUIET, 'active', undefined, at(37) + 1000);
  assert.equal(await stage(), undefined);
  assert.equal((await admin())?.active_at, at(37) + 1000);
  assert.equal(await count('SELECT count(*) AS n FROM steward_notice WHERE tree = ?', QUIET), 0);
  await run(at(38));
  assert.equal(await stage(), undefined);
  await assert.rejects(lc.saveLifecycleSettings(OP, { ...ON, readOnlyMonths: 12 }), /in order/);
});

test('a steward hides the warning for 30 days; it returns after that', async () => {
  await lc.saveLifecycleSettings(OP, ON, T0);
  await run(at(12));
  const until = await lc.dismissWarning(STEW.id, QUIET, at(12));
  assert.equal(until, at(12) + shared.DISMISS_DAYS * DAY);
  assert.equal((await lc.familyLifecycle(QUIET, STEW.id, true, at(12) + DAY))?.dismissedUntil, until);
  assert.equal((await lc.familyLifecycle(QUIET, STEW.id, true, until + 1))?.dismissedUntil, null);
});

test('a demo runs nothing; a guest is told nothing; a "View as" preview reads as the previewed reader and changes nothing', async () => {
  await toReadOnly();
  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal(await run(at(30)), null);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal((await stage())?.stage, 'readonly');
  // Signed out (a guest has no account): nothing.
  outside();
  g.__request = new Request('http://localhost/');
  assert.equal(await fns.fetchFamilyLifecycle({ data: { tree: QUIET } }), null);
  // The steward previews the family as a viewer: the bar is a viewer's, and neither the button nor "hide" writes.
  asUser(STEW);
  await viewAs.startViewAs({ data: { tree: QUIET, choice: { kind: 'role', role: 'viewer' } } });
  cookie = g.__setCookies!.findLast((c) => /^kindred_view_as=[^;]/.test(c))!.split(';')[0];
  asUser(STEW);
  const seen = await fns.fetchFamilyLifecycle({ data: { tree: QUIET } });
  assert.equal(seen?.readOnly, true);
  assert.equal(seen?.steward, false);
  asUser(STEW);
  await assert.rejects(fns.reactivateFamily({ data: { tree: QUIET } }));
  asUser(STEW);
  await assert.rejects(fns.dismissLifecycleWarning({ data: { tree: QUIET } }));
  assert.equal((await admin())?.status, 'suspended');
  assert.equal(await count('SELECT count(*) AS n FROM steward_notice_dismissal'), 0);
});
