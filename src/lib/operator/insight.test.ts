// node --test src/lib/operator/insight.test.ts: the operator's statistics, the update check and "New in Kindred"
// (docs/hosting-many-families.md). The daily snapshot's aggregates and its one-time reconstruction of earlier days; a family
// with usage statistics off counted in the totals with its activity hidden; small breakdowns suppressed; the update check
// asking nothing until agreed, caching a day with its ETag, honouring KINDRED_UPDATE_CHECK=off and a fork's repository, and
// keeping a malicious answer harmless; the release highlights filtered by role; the card shown once and only to accounts
// older than the version. Invented names only, and no network: GitHub is a fake.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-insight-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_UPDATE_CHECK;
delete process.env.KINDRED_UPDATE_REPO;
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
const stats = await load<typeof import('./stats.server.ts')>('/src/lib/operator/stats.server.ts');
const shared = await load<typeof import('./stats-shared.ts')>('/src/lib/operator/stats-shared.ts');
const updates = await load<typeof import('./updates.server.ts')>('/src/lib/operator/updates.server.ts');
const fns = await load<typeof import('./insight.functions.ts')>('/src/lib/operator/insight.functions.ts');
const releases = await load<typeof import('../releases/index.ts')>('/src/lib/releases/index.ts');
const card = await load<typeof import('../releases/releases.server.ts')>('/src/lib/releases/releases.server.ts');
const { renderMarkdown } = await load<typeof import('../markdown.ts')>('/src/lib/markdown.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  updates.setUpdateFetch(undefined);
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-12T03:00:00Z');
const acc = () => store.accounts();
const g = globalThis as unknown as { __signedIn?: unknown; __request?: Request };

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const addUser = (n: number, name: string, created: number, lastSeen: number | null, operator = 0) => q(
  'INSERT INTO user (id, name, email, handle, created, last_seen, operator) VALUES (?, ?, ?, ?, ?, ?, ?)', uid(n), name, `${name.toLowerCase()}@example.org`, `h-${n}`, created, lastSeen, operator);
const member = (n: number, tree: string, role: string, created: number) => q('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', uid(n), tree, role, created);

// Three invented families: Ashgrove (busy), Brindle (statistics off), Corrow (quiet, suspended, capped).
for (const id of ['ashgrove', 'brindle', 'corrow']) await store.ensureTree(id);
await acc().batch([
  addUser(1, 'Orla', NOW - 40 * DAY, NOW - 2 * 3600_000, 1),
  addUser(2, 'Ada', NOW - 20 * DAY, NOW - 3600_000),
  addUser(3, 'Bram', NOW - 20 * DAY, NOW - 3 * DAY),
  addUser(4, 'Cleo', NOW - 10 * DAY, NOW - 20 * DAY),
  addUser(5, 'Dov', NOW - 5 * DAY, null),
  member(2, 'ashgrove', 'steward', NOW - 20 * DAY),
  member(3, 'ashgrove', 'editor', NOW - 20 * DAY),
  member(4, 'ashgrove', 'viewer', NOW - 10 * DAY),
  member(3, 'brindle', 'steward', NOW - 15 * DAY),
  member(5, 'corrow', 'steward', NOW - 5 * DAY),
  q("INSERT INTO family_admin (tree, status, closed, cap_bytes, created_at) VALUES ('corrow', 'suspended', 0, 1000, ?)", NOW - 5 * DAY),
  q("INSERT INTO media_usage (tree, key, bytes, at) VALUES ('ashgrove', 'a.jpg', 300, ?), ('corrow', 'c.jpg', 900, ?)", NOW, NOW),
  q("INSERT INTO stats_daily (tree, day, kind, cat, name, n) VALUES ('ashgrove', '2026-11-11', 'view', 'editor', 'tree', 7), ('ashgrove', '2026-11-01', 'view', 'viewer', 'tree', 4)"),
  q("INSERT INTO stats_setting (tree, collect, changed_at) VALUES ('brindle', 0, ?)", NOW),
  ...[2, 3, 4].map((n) => q('INSERT INTO family_visit (user, tree, since, last_seen) VALUES (?, ?, ?, ?)', uid(n), 'ashgrove', NOW - 30 * DAY, NOW - n * DAY)),
  q('INSERT INTO family_visit (user, tree, since, last_seen) VALUES (?, ?, ?, ?)', uid(3), 'brindle', NOW - 30 * DAY, NOW - DAY),
  q("INSERT INTO session (hash, user, created, expires, refreshed, credential) VALUES ('s1', ?, ?, ?, ?, 'cred-1')", uid(2), NOW - 20 * 3600_000, NOW + DAY, NOW),
  // The day's sign-ins by way in (accounts migration 0048): counted as they happen, as a session row is gone by the next sign-in.
  q("INSERT INTO signin_daily (day, method, count) VALUES ('2026-11-11', 'passkey', 3), ('2026-11-11', 'password', 2), ('2026-11-11', 'oidc', 1), ('2026-11-10', 'passkey', 9)"),
]);
const TREES = ['ashgrove', 'brindle', 'corrow'];

test('the first snapshot writes yesterday from live counts and reconstructs the days before it', async () => {
  const r = await stats.snapshot(TREES, NOW);
  assert.equal(r.day, '2026-11-11');
  const days = await stats.storedDays();
  const y = days.find((d) => d.day === '2026-11-11')!;
  assert.equal(y.backfilled, false);
  assert.equal(y.families, 3);
  assert.equal(y.accounts, 5);
  assert.equal(y.pageViews, 7, 'page views of that day from the families\' counters');
  assert.equal(y.activeDay, 2, 'Orla and Ada used Kindred in the last 24 hours');
  assert.equal(y.activeWeek, 3);
  assert.equal(y.activeMonth, 4, 'Dov never signed in');
  assert.equal(y.activeFamilies, 2, 'Ashgrove and Brindle had a visit in 30 days');
  assert.equal(y.storageBytes, 1200);
  assert.equal(y.membersMedian, 1);
  assert.equal(y.membersMax, 3);
  assert.equal(y.familiesSuspended, 1);
  assert.equal(y.familiesClosed, 0);
  assert.deepEqual(y.signIns, { passkey: 3, password: 2, oidc: 1 }, 'each way in on its own, and every sign-in of the day');

  // Reconstructed back to the first account (Orla, 40 days ago); who was active cannot be known for those days.
  assert.equal(r.backfilled, 39);
  assert.equal(days[0]!.day, '2026-10-03');
  const past = days.find((d) => d.day === '2026-11-01')!;
  assert.equal(past.backfilled, true);
  assert.equal(past.activeMonth, null);
  assert.equal(past.storageBytes, null);
  assert.equal(past.pageViews, 4);
  assert.equal(past.accounts, 3, 'Orla, Ada and Bram existed by then');
  assert.equal(past.families, 2, 'Ashgrove and Brindle by their first membership; Corrow came later');
  assert.equal(days.find((d) => d.day === '2026-10-23')!.accountsNew, 2);

  // The next night writes one row and reconstructs nothing again.
  const again = await stats.snapshot(TREES, NOW + DAY);
  assert.equal(again.backfilled, 0);
  assert.equal((await stats.storedDays()).length, days.length + 1);
  // Running twice on one night replaces that night's row.
  await stats.snapshot(TREES, NOW + DAY + 3600_000);
  assert.equal((await stats.storedDays()).length, days.length + 1);
});

test('a family with usage statistics off is counted in the totals, but its activity is not shown', async () => {
  const s = await stats.readStatistics(NOW);
  assert.equal(s.statsOff, 1);
  const brindle = s.families.find((f) => f.id === 'brindle')!;
  assert.equal(brindle.collecting, false);
  assert.equal(brindle.lastActivity, null);
  assert.equal(brindle.views30, null);
  assert.equal(brindle.members, 1, 'its size is administration, not activity');
  const ash = s.families.find((f) => f.id === 'ashgrove')!;
  assert.equal(ash.collecting, true);
  assert.equal(ash.lastActivity, NOW - 2 * DAY);
  assert.equal(ash.views30, 11);
  assert.equal(s.now.activeFamilies, 2, 'Brindle still counts as an active family in the total');
  assert.equal(s.families[0]!.id, 'corrow', 'sorted by storage');
  assert.deepEqual(s.storage, { usedBytes: 1200, cappedFamilies: 1, cappedUsedBytes: 900, capBytes: 1000, nearCap: 1 });
  assert.equal(s.busyFamilies, 1, 'Ashgrove has three members who visited in 30 days');
  assert.deepEqual(s.cohorts.map((c) => [c.weeks, c.families, c.visitedLastWeek]), [[1, 2, null], [4, 0, 0], [12, 0, 0]], 'two families visited: fewer than five');
  assert.equal(JSON.stringify(s).includes('Ada'), false, 'no names');
});

test('a breakdown below five never leaves the server: cohorts, retention and sign-ins, stored days too', async () => {
  const s = await stats.readStatistics(NOW);
  const small = (n: number | null) => n !== null && n > 0 && n < 5;
  for (const c of s.cohorts) assert.ok(!small(c.visitedLastWeek), `cohort ${c.weeks}: ${c.visitedLastWeek}`);
  for (const r of s.retention) {
    assert.ok(!small(r.created) && !small(r.activeLastWeek), `retention ${r.weeksAgo}: ${r.created}/${r.activeLastWeek}`);
    if (r.created === null) assert.equal(r.activeLastWeek, null, 'a hidden cohort hides its share too');
  }
  assert.ok(s.retention.some((r) => r.created === null), 'Bram and Dov’s week is hidden');
  for (const d of [...s.days, s.now]) for (const v of Object.values(d.signIns ?? {})) assert.ok(!small(v), `${d.day}: ${v}`);
  assert.deepEqual(s.signIns30, { passkey: null }, 'one sign-in in 30 days is fewer than five');
  assert.ok(s.days.some((d) => d.signIns && 'passkey' in d.signIns), 'the method is still named');
});

test('a breakdown below five is not shown, and series thin out over a long range', () => {
  assert.equal(shared.shown(0), 0);
  assert.equal(shared.shown(3), null);
  assert.equal(shared.shown(5), 5);
  const day = (d: string, accounts: number, views: number | null): import('./stats-shared.ts').InstanceDay => ({
    day: d, families: 1, familiesNew: 0, familiesSuspended: null, familiesClosed: null, accounts, accountsNew: 0, membersMedian: null, membersMax: null,
    activeDay: null, activeWeek: null, activeMonth: null, activeFamilies: null, storageBytes: null, pageViews: views, signIns: null, requestsOpen: null,
    dataRequestsOpen: null, backfilled: false,
  });
  const days = [day('2026-11-09', 1, 2), day('2026-11-10', 2, 3), day('2026-11-11', 4, null), day('2026-11-16', 5, 1)];
  assert.deepEqual(shared.series(days, (d) => d.accounts, 'level', '12m'), [{ day: '2026-11-09', value: 4 }, { day: '2026-11-16', value: 5 }]);
  assert.deepEqual(shared.series(days, (d) => d.pageViews, 'flow', '12m'), [{ day: '2026-11-09', value: 5 }, { day: '2026-11-16', value: 1 }]);
  assert.deepEqual(shared.inRange(days, '30d', '2026-12-10').map((d) => d.day), ['2026-11-11', '2026-11-16']);
});

test('only an operator reads the statistics', async () => {
  g.__signedIn = { id: uid(2), name: 'Ada', operator: 0 };
  await assert.rejects(() => fns.fetchOperatorStatistics(), /operator/i);
  g.__signedIn = { id: uid(1), name: 'Orla', operator: 1 };
  g.__request = undefined; // a new request: the session is read once per request
  assert.equal((await fns.fetchOperatorStatistics()).families.length, 3);
  g.__signedIn = undefined;
});

// ---------- the update check ----------

type Call = { url: string; headers: Record<string, string> };
function fakeGitHub(answers: (url: string, headers: Record<string, string>) => Response) {
  const calls: Call[] = [];
  updates.setUpdateFetch((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url, headers });
    return answers(url, headers);
  }) as typeof fetch);
  return calls;
}
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
const rel = (tag: string, body = '', extra: Record<string, unknown> = {}) => ({ tag_name: tag, name: `Kindred ${tag}`, body, html_url: `https://github.com/niklas-heer/kindred/releases/tag/${tag}`, published_at: '2026-11-20T10:00:00Z', draft: false, prerelease: false, ...extra });
const agree = (on: boolean) => acc().batch([updates.setAgreed(on, uid(1))]);

test('nothing is asked until an operator agrees, then at most once a day, with a generic User-Agent', async () => {
  const calls = fakeGitHub((url) => url.endsWith('/latest') ? json(rel('v2.4.0')) : json([rel('v2.4.0', 'Notes'), rel('v2.3.0')], { etag: '"e1"' }));
  assert.equal(await updates.checkForUpdate(NOW), false);
  assert.equal(calls.length, 0, 'not agreed: no call');
  let s = await updates.updateStatus({ version: '2.3.0', commit: 'abc1234' });
  assert.equal(s.asked, false);
  assert.equal(s.enabled, false);
  assert.equal(s.updateAvailable, false);

  await agree(true);
  assert.equal(await updates.checkForUpdate(NOW), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, 'https://api.github.com/repos/niklas-heer/kindred/releases/latest');
  assert.match(calls[1]!.url, /\/releases\?per_page=30$/);
  for (const c of calls) {
    assert.equal(c.headers['user-agent'], 'Kindred', 'no version and nothing that tells servers apart');
    assert.equal(Object.keys(c.headers).some((h) => /authorization|cookie/i.test(h)), false);
  }
  s = await updates.updateStatus({ version: '2.3.0', commit: 'abc1234' });
  assert.equal(s.updateAvailable, true);
  assert.equal(s.latest, '2.4.0');
  assert.deepEqual(s.newer.map((r) => r.version), ['2.4.0'], 'only the releases after the running one');

  // Within the day: nothing asked. A day later: asked again, with the ETag; a 304 keeps the list.
  assert.equal(await updates.checkForUpdate(NOW + 12 * 3600_000), false);
  assert.equal(calls.length, 2);
  const later = fakeGitHub((url) => url.endsWith('/latest') ? json(rel('v2.4.0')) : new Response(null, { status: 304 }));
  assert.equal(await updates.checkForUpdate(NOW + DAY), true);
  assert.equal(later[1]!.headers['if-none-match'], '"e1"');
  assert.deepEqual((await updates.updateStatus({ version: '2.3.0' })).newer.map((r) => r.version), ['2.4.0']);
  assert.equal(await updates.updateAvailable(), false, 'the dot needs a running version, which a test build has not');
});

test('a failed check keeps what was known and says when it last checked, never "up to date"', async () => {
  fakeGitHub(() => new Response('nope', { status: 503 }));
  assert.equal(await updates.checkForUpdate(NOW + 2 * DAY), true);
  const s = await updates.updateStatus({ version: '2.4.0' });
  assert.equal(s.error, 'http 503');
  assert.equal(s.checkedAt, NOW + 2 * DAY);
  assert.equal(s.latest, '2.4.0', 'the last good answer stays');
  assert.equal(s.updateAvailable, false);
});

test('KINDRED_UPDATE_CHECK=off and turning it off ask nothing; a fork names its own repository', async () => {
  const calls = fakeGitHub(() => json([]));
  process.env.KINDRED_UPDATE_CHECK = 'off';
  assert.equal(await updates.checkForUpdate(NOW + 10 * DAY), false);
  const s = await updates.updateStatus({ version: '2.3.0' });
  assert.equal(s.envOff, true);
  assert.equal(s.enabled, false);
  assert.equal(s.updateAvailable, false);
  delete process.env.KINDRED_UPDATE_CHECK;
  await agree(false);
  assert.equal(await updates.checkForUpdate(NOW + 10 * DAY), false);
  assert.equal(calls.length, 0);
  await agree(true);

  process.env.KINDRED_UPDATE_REPO = 'cousin-co/kindred-fork';
  assert.equal(await updates.checkForUpdate(NOW + 10 * DAY - 1), true, 'another repository is asked at once');
  assert.match(calls[0]!.url, /\/repos\/cousin-co\/kindred-fork\/releases\/latest$/);
  process.env.KINDRED_UPDATE_REPO = 'https://evil.example/x?y';
  assert.equal(updates.updateRepo(), 'niklas-heer/kindred', 'anything but owner/name falls back');
  delete process.env.KINDRED_UPDATE_REPO;
});

test('a malicious answer stays harmless: bad versions dropped, foreign links replaced, notes rendered as text', async () => {
  fakeGitHub((url) => url.endsWith('/latest')
    ? json(rel('v9.9.9"><script>alert(1)</script>'))
    : json([
      rel('v3.0.0', '<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>\n\n[click](javascript:alert(3)) ![x](https://tracker.example/p.gif)', { html_url: 'javascript:alert(4)', name: 'Kindred\u0000 3' }),
      rel('v3.0.1', 'draft', { draft: true }),
      rel('not-a-version'),
      'garbage',
    ]));
  assert.equal(await updates.checkForUpdate(NOW + 20 * DAY), true);
  const s = await updates.updateStatus({ version: '2.3.0' });
  assert.equal(s.latest, null, 'a tag that is not a version is no release');
  assert.deepEqual(s.newer.map((r) => r.version), ['3.0.0']);
  const r = s.newer[0]!;
  assert.equal(r.url, 'https://github.com/niklas-heer/kindred/releases/tag/v3.0.0');
  assert.equal(r.name.includes('\u0000'), false);
  const html = renderMarkdown(r.notes, { images: 'text' });
  assert.equal(/<img|<script|href="javascript/i.test(html), false, html);
  assert.ok(html.includes('&lt;script&gt;'), 'raw HTML is shown as text');
  assert.equal(html.includes('tracker.example'), false, 'no image is loaded');
});

// ---------- New in Kindred ----------

test('the highlights are filtered by role and by the running version', () => {
  const all = releases.RELEASES;
  const count = (reader: 'everyone' | 'stewards' | 'operators') => releases.releasesFor(reader, '2.3.0').flatMap((r) => r.highlights);
  assert.ok(count('everyone').every((h) => h.audience === 'everyone'));
  assert.ok(count('stewards').some((h) => h.audience === 'stewards'));
  assert.ok(count('stewards').every((h) => h.audience !== 'operators'));
  assert.ok(count('operators').some((h) => h.audience === 'operators'));
  assert.equal(releases.releasesFor('operators', '2.3.0')[0]!.version, '2.3.0', 'the empty 2.4.0 is skipped');
  assert.deepEqual(releases.releasesFor('everyone', '2.1.5').map((r) => r.version), ['2.1.0', '2.0.0'], 'nothing newer than the server');
  for (const r of all) assert.ok(r.highlights.length === 0 || (r.highlights.length >= 3 && r.highlights.length <= 8), r.version);
  assert.equal(releases.minorOf('2.4.1'), '2.4');
});

test('the card shows once per minor version, only to accounts older than the version on this server', async () => {
  const at = NOW + 30 * DAY;
  const old = { id: uid(2), created: NOW - 20 * DAY };
  // The first time the server runs 2.3 is now: Ada's account is older, so she gets the card.
  assert.equal((await card.cardFor(old, 'stewards', '2.3.0', at))?.version, '2.3.0');
  // An account made after this server began running 2.3 has nothing new to be told.
  await acc().batch([addUser(9, 'Ivo', at + 1000, null)]);
  assert.equal(await card.cardFor({ id: uid(9), created: at + 1000 }, 'everyone', '2.3.0', at + 2000), null);
  // Dismissed: gone, for this minor version and its patches.
  await card.markSeen(old.id, '2.3.0', at);
  assert.equal(await card.cardFor(old, 'stewards', '2.3.0', at), null);
  assert.equal(await card.cardFor(old, 'stewards', '2.3.4', at), null);
  // In a demo nothing is shown, and nothing is recorded.
  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal(await card.cardFor({ id: uid(3), created: NOW - 20 * DAY }, 'everyone', '2.3.0', at), null);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal((await card.cardFor({ id: uid(3), created: NOW - 20 * DAY }, 'everyone', '2.3.0', at))?.version, '2.3.0');
});
