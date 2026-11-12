// node --test src/lib/operator/self-update.test.ts: the console's Update button and Health tab (docs/hosting-many-families.md,
// "Updates" and "Health"). The GitHub token sealed and never returned; the button refused for a non-operator, without a fresh
// proof, over a release that needs a step by hand, in a demo and in a "View as" preview, and for an install the button does
// not update; the workflow's dispatch well-formed and followed politely; the daily jobs' runs, the families' schemas and the
// backup's age as the Health tab reads them. Invented names only, and no network: GitHub is a fake.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-self-update-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'an-invented-secret-for-the-self-update-test';
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_UPDATE_CHECK;
delete process.env.KINDRED_UPDATE_REPO;
delete process.env.KINDRED_UPDATE_VIA;
delete process.env.KINDRED_AUTH;
for (const k of Object.keys(process.env)) if (k.startsWith('KINDRED_ARCHIVE_')) delete process.env[k];
// The running version, as a build stamps it (src/lib/version.ts reads the global a build defines).
(globalThis as unknown as { __KINDRED_VERSION__: string }).__KINDRED_VERSION__ = '2.3.0';
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
      export const getRequest = () => globalThis.__request ?? (globalThis.__request = new Request('http://localhost/'));
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = () => {};
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } }, ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const { store, q } = await load<typeof import('../store/index.ts')>('/src/lib/store/index.ts');
const updates = await load<typeof import('./updates.server.ts')>('/src/lib/operator/updates.server.ts');
const work = await load<typeof import('./self-update.server.ts')>('/src/lib/operator/self-update.server.ts');
const fns = await load<typeof import('./self-update.functions.ts')>('/src/lib/operator/self-update.functions.ts');
const shared = await load<typeof import('./self-update-shared.ts')>('/src/lib/operator/self-update-shared.ts');
const health = await load<typeof import('./health.server.ts')>('/src/lib/operator/health.server.ts');
const jobs = await load<typeof import('../jobs/index.ts')>('/src/lib/jobs/index.ts');
const report = await load<typeof import('../store/schema-report.ts')>('/src/lib/store/schema-report.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  updates.setUpdateFetch(undefined);
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-12T09:00:00Z');
const acc = () => store.accounts();
const g = globalThis as unknown as { __signedIn?: unknown; __request?: Request };
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OP = { id: uid(1), name: 'Orla', operator: 1 };
const READER = { id: uid(2), name: 'Ada', operator: 0 };
const asUser = (u: unknown) => { g.__signedIn = u; g.__request = undefined; };
const status = (e: unknown) => (e as { status?: number }).status;
const TOKEN = 'github_pat_11INVENTED0123456789_abcdefghijklmnopqrstuvwxyzWXYZ';

await acc().batch([
  q('INSERT INTO user (id, name, email, handle, created, operator) VALUES (?, ?, ?, ?, ?, 1)', OP.id, OP.name, 'orla@example.org', 'orla', NOW),
  q('INSERT INTO user (id, name, email, handle, created, operator) VALUES (?, ?, ?, ?, ?, 0)', READER.id, READER.name, 'ada@example.org', 'ada', NOW),
]);

// ---------- a fake GitHub ----------

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let runs: Record<string, unknown>[] = [];
let runStatus: Record<string, unknown> = { status: 'in_progress', conclusion: null };
const json = (body: unknown, s = 200) => new Response(JSON.stringify(body), { status: s, headers: { 'content-type': 'application/json' } });
const rel = (tag: string, body = '') => ({ tag_name: tag, name: `Kindred ${tag}`, body, html_url: `https://github.com/niklas-heer/kindred/releases/tag/${tag}`, published_at: '2026-11-20T10:00:00Z', draft: false, prerelease: false });
const RELEASES = [rel('v2.5.0', 'A new setting.\n<!-- kindred:manual -->'), rel('v2.4.1', 'Fixes.\n<!-- kindred:security -->'), rel('v2.4.0', 'Highlights'), rel('v2.3.0')];
updates.setUpdateFetch((async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push({ method, url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const path = url.replace('https://api.github.com', '');
  if (path.endsWith('/releases/latest')) return json(RELEASES[0]);
  if (path.includes('/releases?')) return json(RELEASES);
  if (path === '/repos/orla-example/kindred') return json({ full_name: 'orla-example/kindred', default_branch: 'trunk' });
  if (path === '/repos/orla-example/kindred/actions/workflows/update.yml') return json({ id: 7, path: '.github/workflows/update.yml' });
  if (path === '/repos/orla-example/kindred/actions/workflows/update.yml/dispatches' && method === 'POST') return new Response(null, { status: 204 });
  if (path.startsWith('/repos/orla-example/kindred/actions/workflows/update.yml/runs?')) return json({ total_count: runs.length, workflow_runs: runs });
  if (path === '/repos/orla-example/kindred/actions/runs/4242') return json({ id: 4242, html_url: 'https://github.com/orla-example/kindred/actions/runs/4242', ...runStatus });
  if (path.startsWith('/repos/elsewhere/')) return json({ message: 'Not Found' }, 404);
  return json({ message: 'Bad credentials' }, 401);
}) as typeof fetch);

beforeEach(() => {
  asUser(undefined);
  calls = [];
  process.env.KINDRED_UPDATE_VIA = 'github-actions';
});

// The update check knows v2.4.0, v2.4.1 (security) and v2.5.0 (needs a step by hand) above the running 2.3.0.
await acc().batch([updates.setAgreed(true, OP.id)]);
await updates.checkForUpdate(NOW);

test('how an install is updated: KINDRED_UPDATE_VIA, else Node here', () => {
  assert.equal(work.installKind(), 'github-actions');
  process.env.KINDRED_UPDATE_VIA = 'docker';
  assert.equal(work.installKind(), 'docker');
  process.env.KINDRED_UPDATE_VIA = 'something-else';
  assert.equal(work.installKind(), 'node');
  delete process.env.KINDRED_UPDATE_VIA;
  assert.equal(work.installKind(), 'node');
});

test('the flags of a release: Kindred’s own word, or a marker in the notes', () => {
  assert.deepEqual(shared.releaseFlags({ version: '9.0.0', notes: 'x <!-- kindred:manual --> y' }), { manual: true, security: false });
  assert.deepEqual(shared.releaseFlags({ version: '9.0.0', notes: '<!--kindred: security-->' }), { manual: false, security: true });
  assert.deepEqual(shared.releaseFlags({ version: '9.0.0', notes: 'manual security' }), { manual: false, security: false });
  assert.equal(shared.stripFlagMarkers('Notes\n<!-- kindred:manual -->\n<!-- other -->'), 'Notes\n\n<!-- other -->');
  assert.deepEqual(shared.releasesUpTo([{ version: '2.5.0' }, { version: '2.4.0' }, { version: '2.4.1' }] as never, '2.4.1').map((r) => r.version), ['2.4.0', '2.4.1']);
});

test('only an operator reads or changes it', async () => {
  for (const u of [undefined, READER]) {
    asUser(u);
    await assert.rejects(fns.fetchSelfUpdate(), (e) => [401, 403].includes(status(e)!));
    asUser(u);
    await assert.rejects(fns.operatorSaveUpdateToken({ data: { repo: 'orla-example/kindred', token: TOKEN } }), (e) => [401, 403].includes(status(e)!));
    asUser(u);
    await assert.rejects(fns.operatorStartUpdate({ data: { tag: 'v2.4.0' } }), (e) => [401, 403].includes(status(e)!));
    asUser(u);
    await assert.rejects(fns.fetchHealth(), (e) => [401, 403].includes(status(e)!));
  }
  assert.equal(calls.length, 0);
});

test('a server the button did not make stores no token', async () => {
  process.env.KINDRED_UPDATE_VIA = 'docker';
  await assert.rejects(work.saveToken(OP, 'orla-example/kindred', TOKEN), /Deploy to Cloudflare/);
  assert.equal(calls.length, 0);
});

test('the token is checked with GitHub, sealed, and never returned', async () => {
  await assert.rejects(work.saveToken(OP, 'not a repo', TOKEN), /owner\/name/);
  await assert.rejects(work.saveToken(OP, 'orla-example/kindred', 'short'), /GitHub token/);
  await assert.rejects(work.saveToken(OP, 'elsewhere/kindred', TOKEN), /can’t reach/);
  calls = [];
  asUser(OP);
  await fns.operatorSaveUpdateToken({ data: { repo: 'orla-example/kindred', token: TOKEN } });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://api.github.com/repos/orla-example/kindred',
    'GET https://api.github.com/repos/orla-example/kindred/actions/workflows/update.yml',
  ]);
  for (const c of calls) {
    assert.equal(c.headers.authorization, `Bearer ${TOKEN}`, 'the token goes in the header');
    assert.equal(c.url.includes(TOKEN), false, 'never in the address');
  }
  const row = await acc().get<{ token: string; token_tail: string; branch: string }>('SELECT token, token_tail, branch FROM update_github');
  assert.match(row!.token, /^s1\./);
  assert.equal(row!.token.includes(TOKEN), false);
  assert.equal(row!.token_tail, 'WXYZ');
  assert.equal(row!.branch, 'trunk', 'the repository’s default branch');
  asUser(OP);
  const shown = await fns.fetchSelfUpdate();
  assert.equal(JSON.stringify(shown).includes(TOKEN.slice(0, 20)), false, 'the console never gets it back');
  assert.equal(JSON.stringify(shown).includes(row!.token), false, 'not even sealed');
  assert.equal(shown.tokenTail, 'WXYZ');
  assert.equal(shown.repo, 'orla-example/kindred');
  const logged = await acc().all<{ action: string; detail: string | null }>("SELECT action, detail FROM operator_audit WHERE action LIKE 'update.%'");
  assert.deepEqual(logged.map((l) => l.action), ['update.token']);
  assert.equal(logged.some((l) => (l.detail ?? '').includes(TOKEN.slice(-12))), false, 'the log has no token');
  // Sealed under KINDRED_SECRET: another secret cannot open it.
  const { openSecret } = await load<typeof import('../ai/secret.server.ts')>('/src/lib/ai/secret.server.ts');
  assert.equal(await openSecret('github-update', row!.token), TOKEN);
  await assert.rejects(openSecret('another-purpose', row!.token));
});

test('the button needs a fresh proof under Kindred’s own sign-in, and asks GitHub nothing until then', async () => {
  asUser(OP);
  await assert.rejects(fns.operatorStartUpdate({ data: { tag: 'v2.4.0' } }), (e) => (e as { code?: string }).code === 'reauth');
  assert.equal(calls.length, 0);
});

test('it is refused in a demo and in a "View as" preview', async () => {
  process.env.KINDRED_DEMO = '1';
  try {
    asUser(OP);
    await assert.rejects(fns.operatorStartUpdate({ data: { tag: 'v2.4.0' } }), (e) => status(e) === 403);
    asUser(OP);
    await assert.rejects(fns.operatorSaveUpdateToken({ data: { repo: 'orla-example/kindred', token: TOKEN } }), (e) => status(e) === 403);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as a contributor. Stop the preview to change something.'));
  try {
    asUser(OP);
    await assert.rejects(fns.operatorStartUpdate({ data: { tag: 'v2.4.0' } }), /viewing as/);
    asUser(OP);
    await assert.rejects(fns.operatorForgetUpdateToken(), /viewing as/);
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.equal(calls.length, 0);
  assert.equal((await work.selfUpdate()).repo, 'orla-example/kindred', 'nothing was forgotten');
});

test('the releases on the way are listed with their flags, and one that needs a step by hand refuses the button', async () => {
  assert.deepEqual(await work.plan('v2.4.1'), [{ version: '2.4.0', manual: false, security: false }, { version: '2.4.1', manual: false, security: true }]);
  await assert.rejects(work.startUpdate(OP, 'v2.5.0', NOW), /step by hand/);
  await assert.rejects(work.startUpdate(OP, 'v2.3.0', NOW), /isn’t newer/);
  await assert.rejects(work.startUpdate(OP, 'v2.9.0', NOW), /doesn’t know that release/);
  await assert.rejects(work.startUpdate(OP, 'main', NOW), /isn’t a release/);
  assert.equal(calls.some((c) => c.method === 'POST'), false, 'nothing dispatched');
});

test('the dispatch is well-formed, logged, followed politely, and one runs at a time', async () => {
  const run = await work.startUpdate(OP, 'v2.4.1', NOW);
  assert.equal(run.status, 'requested');
  const post = calls.filter((c) => c.method === 'POST');
  assert.equal(post.length, 1);
  assert.equal(post[0]!.url, 'https://api.github.com/repos/orla-example/kindred/actions/workflows/update.yml/dispatches');
  assert.deepEqual(post[0]!.body, { ref: 'trunk', inputs: { tag: 'v2.4.1' } });
  assert.equal(post[0]!.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(post[0]!.headers['x-github-api-version'], '2022-11-28');
  assert.equal(post[0]!.headers['content-type'], 'application/json');
  const logged = await acc().get<{ detail: string }>("SELECT detail FROM operator_audit WHERE action = 'update.start'");
  assert.deepEqual(JSON.parse(logged!.detail), { tag: 'v2.4.1', repo: 'orla-example/kindred', manual: false, security: true });
  await assert.rejects(work.startUpdate(OP, 'v2.4.1', NOW + 1000), /running already/);

  // GitHub has not listed the run yet; then it has (an older one is not taken for it).
  calls = [];
  runs = [{ id: 1111, created_at: new Date(NOW - 3600_000).toISOString(), html_url: 'https://github.com/orla-example/kindred/actions/runs/1111', status: 'completed', conclusion: 'success' }];
  let polled = await work.pollRun(NOW + 5_000);
  assert.equal(polled!.id, null);
  assert.match(calls[0]!.url, /\/actions\/workflows\/update\.yml\/runs\?event=workflow_dispatch&branch=trunk&per_page=5$/);
  calls = [];
  assert.equal((await work.pollRun(NOW + 9_000))!.id, null);
  assert.equal(calls.length, 0, 'asked again only after ten seconds');
  runs = [{ id: 4242, created_at: new Date(NOW + 2_000).toISOString(), html_url: 'https://evil.example/phish', status: 'queued', conclusion: null }, ...runs];
  polled = await work.pollRun(NOW + 20_000);
  assert.equal(polled!.id, 4242);
  assert.equal(polled!.url, null, 'an address that is not the repository’s runs is not kept');
  assert.equal(polled!.status, 'queued');
  runStatus = { status: 'completed', conclusion: 'success' };
  polled = await work.pollRun(NOW + 40_000);
  assert.deepEqual([polled!.status, polled!.conclusion, polled!.url], ['completed', 'success', 'https://github.com/orla-example/kindred/actions/runs/4242']);
  calls = [];
  await work.pollRun(NOW + 100_000);
  assert.equal(calls.length, 0, 'a finished run is not asked about again');
  asUser(OP);
  const shown = await fns.fetchSelfUpdate();
  assert.equal(shown.run!.conclusion, 'success');
  assert.equal(shared.runActive(shown.run), false);
});

test('forgetting the token is logged and leaves nothing to dispatch with', async () => {
  asUser(OP);
  await fns.operatorForgetUpdateToken();
  assert.equal(await acc().get('SELECT 1 AS x FROM update_github'), undefined);
  await assert.rejects(work.startUpdate(OP, 'v2.4.0', NOW + 200_000), /Save a GitHub token/);
  assert.equal((await acc().get<{ action: string }>('SELECT action FROM operator_audit ORDER BY id DESC LIMIT 1'))!.action, 'update.token_removed');
});

// ---------- health ----------

test('the job runner records how each daily job ended', async () => {
  const seen: string[] = [];
  const ctx = { trees: [], now: new Date(NOW), env: () => undefined, log: (m: string) => seen.push(m) };
  await jobs.runDailyJobs(ctx, [
    { name: 'reminders', run: async () => {} },
    { name: 'archive', run: async () => { throw new Error('no archive for ashgrove'); } },
  ], health.recordJobRun);
  const rows = await acc().all<{ job: string; ok: number; error: string | null; last_ok_at: number | null }>('SELECT job, ok, error, last_ok_at FROM job_run ORDER BY job');
  assert.deepEqual(rows.map((r) => [r.job, r.ok, r.error]), [['archive', 0, 'no archive for ashgrove'], ['reminders', 1, null]]);
  assert.equal(rows[0]!.last_ok_at, null);
  assert.ok(rows[1]!.last_ok_at);
  assert.ok(seen.includes('archive: failed: no archive for ashgrove'), 'still logged');
});

test('a family reports its schema when opened, and the Health tab reads it without opening any', async () => {
  for (const id of ['ashgrove', 'brindle', 'corrow']) await store.ensureTree(id);
  await new Promise((r) => setTimeout(r, 50));
  const newest = readdirSync(resolve('migrations/tree')).filter((f) => /^\d{4}_/.test(f)).sort().at(-1)!;
  const rows = await acc().all<{ tree: string; migration: string }>('SELECT tree, migration FROM family_schema ORDER BY tree');
  assert.deepEqual(rows.map((r) => [r.tree, r.migration]), [['ashgrove', newest], ['brindle', newest], ['corrow', newest]]);

  // Brindle has not been opened since the newest schema; Corrow's migration failed.
  report.forgetReports();
  await report.reportSchema(() => store.accounts(), 'brindle', '0001_initial.sql', null, NOW);
  await report.reportSchema(() => store.accounts(), 'corrow', null, `migration tree/${newest} failed: no such column`, NOW);
  assert.equal(report.migrationError(new Error('migration tree/0040_x.sql failed: boom')), 'migration tree/0040_x.sql failed: boom');
  assert.equal(report.migrationError(new Error('something else')), null);

  const h = await health.readHealth({ version: '2.3.0', commit: 'abc1234', archive: false });
  assert.equal(h.version, '2.3.0');
  assert.equal(h.families.total, 3);
  assert.equal(h.families.newest, newest);
  assert.deepEqual(h.families.failed.list.map((f) => [f.tree, f.migration]), [['corrow', newest]], 'the failure keeps the last good migration');
  assert.match(h.families.failed.list[0]!.error!, /no such column/);
  assert.deepEqual(h.families.behind.list.map((f) => f.tree), ['brindle']);
  assert.equal(h.families.unreported, 0);
  assert.deepEqual(h.jobs.map((j) => [j.job, j.ok]), [['archive', false], ['reminders', true]]);
  assert.ok(h.lastDailyRun);
  assert.deepEqual(h.backup, { configured: false, lastOkAt: null, failing: false }, 'no automatic backup on this install');
  assert.equal(h.check.enabled, true);
  assert.equal(h.check.latest, '2.5.0');
  assert.equal(h.check.updateAvailable, true);

  // With the nightly archive set up, its last good run is the backup's age.
  await health.recordJobRun({ job: 'archive', startedAt: NOW + 1, finishedAt: NOW + 2, error: null });
  const b = await health.readHealth({ archive: true });
  assert.deepEqual(b.backup, { configured: true, lastOkAt: NOW + 2, failing: false });
  assert.equal(health.archiveConfigured({ KINDRED_ARCHIVE_ASHGROVE_REPO: 'orla-example/archive' }), true);
  assert.equal(health.archiveConfigured({ KINDRED_ARCHIVE_ASHGROVE_TOKEN: 'x' }), false);

  // A deleted family's report goes with it (its `tree` column).
  const { forgetInAccounts } = await load<typeof import('../families.server.ts')>('/src/lib/families.server.ts');
  await acc().batch(await forgetInAccounts('corrow'));
  assert.equal(await acc().get("SELECT 1 AS x FROM family_schema WHERE tree = 'corrow'"), undefined);

  asUser(OP);
  assert.equal((await fns.fetchHealth()).families.total, 3);
});
