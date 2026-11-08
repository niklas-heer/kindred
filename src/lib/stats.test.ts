// node --test src/lib/stats.test.ts — usage statistics on private databases (never data/). Checked: reports roll up into daily counters,
// a member counts as active once a day, names off the lists are dropped, the off switch stops counting and forgets members, Do Not
// Track and Global Privacy Control are honoured, only stewards may read, nothing personal is stored, and old data goes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-stats-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'stats-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const stats = await load<typeof import('./stats/store.server.ts')>('/src/lib/stats/store.server.ts');
const shared = await load<typeof import('./stats/shared.ts')>('/src/lib/stats/shared.ts');
const { buildOverview, percentChange, readReception } = await load<typeof import('./stats/overview.ts')>('/src/lib/stats/overview.ts');
const { can } = await load<typeof import('./roles.ts')>('/src/lib/roles.ts');
const { Route } = await load<typeof import('../routes/api/stats.ts')>('/src/routes/api/stats.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86_400_000;
const TREE = 'testing';
const db = () => store.accounts();
const daily = (tree = TREE) => db().all<{ day: string; kind: string; name: string; n: number }>('SELECT day, kind, name, n FROM stats_daily WHERE tree = ? ORDER BY day, kind, name', tree);
const counter = async (kind: string, name: string, tree = TREE) => (await daily(tree)).filter((r) => r.kind === kind && r.name === name).reduce((sum, r) => sum + r.n, 0);

function makeFamily(id: string) {
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada')`);
  return d;
}

test('reports add up in one row per day and name', async () => {
  const tree = 'rollup';
  await stats.recordMemberBatch('u1', { tree, visit: true, views: { almanac: 2, tree: 1 } }, NOW);
  await stats.recordMemberBatch('u1', { tree, views: { almanac: 3 }, events: { 'assistant.asked': 1 } }, NOW + 1000);
  await stats.recordMemberBatch('u1', { tree, views: { almanac: 1 } }, NOW + DAY);
  const rows = await daily(tree);
  assert.deepEqual(rows.filter((r) => r.kind === 'view' && r.name === 'almanac').map((r) => [r.day, r.n]), [['2026-11-08', 5], ['2026-11-09', 1]]);
  assert.equal(await counter('visit', 'member', tree), 1);
  assert.equal(await counter('event', 'assistant.asked', tree), 1);
});

test('a member counts as active once a day, however many reports arrive', async () => {
  const tree = 'active';
  await stats.recordMemberBatch('u1', { tree, views: { tree: 1 } }, NOW);
  await stats.recordMemberBatch('u1', { tree, views: { tree: 1 } }, NOW + 60_000);
  await stats.recordMemberBatch('u2', { tree, views: { tree: 1 } }, NOW + 120_000);
  await stats.recordMemberBatch('u1', { tree, views: { tree: 1 } }, NOW + DAY);
  const active = (await daily(tree)).filter((r) => r.kind === 'active').map((r) => [r.day, r.n]);
  assert.deepEqual(active, [['2026-11-08', 2], ['2026-11-09', 1]]);
  assert.equal((await db().all('SELECT actor FROM stats_member WHERE tree = ?', tree)).length, 2, 'one marker per member');
});

test('finishing the tour counts once per member, also from a second device', async () => {
  const tree = 'once';
  await stats.recordMemberBatch('u1', { tree, events: { 'tour.finished': 1 } }, NOW);
  await stats.recordMemberBatch('u1', { tree, events: { 'tour.finished': 1 } }, NOW + DAY);
  await stats.recordMemberBatch('u2', { tree, events: { 'tour.finished': 1 } }, NOW);
  assert.equal(await counter('event', 'tour.finished', tree), 2);
});

test('a report keeps only names on the lists, and bounded counts', () => {
  const batch = shared.parseBatch({
    tree: 'fam', visit: true,
    views: { almanac: 2, 'person-abc123': 5, '/fam/house/h1': 1, atlas: 9999, tree: -1 },
    events: { 'assistant.asked': 1, 'typed: dear aunt ada': 1, 'feedback.left': 1 },
    name: 'Ada', ip: '1.2.3.4',
  });
  assert.deepEqual(batch, { tree: 'fam', visit: true, views: { almanac: 2, atlas: shared.MAX_COUNT }, events: { 'assistant.asked': 1 } });
  assert.equal(shared.parseBatch({ tree: '../../etc' }), null);
  assert.equal(shared.parseBatch('nope'), null);
});

test('a path becomes its section, without ids', () => {
  assert.equal(shared.routeName('/fam', 'fam'), 'tree');
  assert.equal(shared.routeName('/fam/almanac', 'fam'), 'almanac');
  assert.equal(shared.routeName('/fam/house/h-12', 'fam'), 'house');
  assert.equal(shared.routeName('/fam/research', 'fam'), 'research');
  assert.equal(shared.routeName('/fam/research/p-99', 'fam'), 'research-project');
  assert.equal(shared.routeName('/fam/people', 'fam'), 'register');
  assert.equal(shared.routeName('/fam/settings/ai', 'fam'), 'settings');
  assert.equal(shared.routeName('/fam/statistics', 'fam'), null, 'reading the numbers does not move them');
  assert.equal(shared.routeName('/other/almanac', 'fam'), null);
});

test('the off switch stops counting and forgets members, and the totals stay', async () => {
  const tree = 'switch';
  assert.equal(await stats.isCollecting(tree), true, 'on until a steward turns it off');
  await stats.recordMemberBatch('u1', { tree, visit: true, views: { atlas: 1 }, events: { 'tour.finished': 1 } }, NOW);
  await stats.setCollecting(tree, false, NOW);
  assert.equal(await stats.isCollecting(tree), false);
  const before = await daily(tree);
  await stats.recordMemberBatch('u1', { tree, visit: true, views: { atlas: 4 } }, NOW + 1000);
  await stats.recordGuestVisit(tree, NOW + 1000);
  assert.deepEqual(await daily(tree), before, 'nothing new is written');
  assert.equal((await db().all('SELECT * FROM stats_member WHERE tree = ?', tree)).length, 0);
  assert.equal((await db().all('SELECT * FROM stats_once WHERE tree = ?', tree)).length, 0);
  assert.equal(await counter('view', 'atlas', tree), 1, 'the anonymous totals stay');
  await stats.setCollecting(tree, true, NOW + 2000);
  await stats.recordMemberBatch('u1', { tree, views: { atlas: 1 } }, NOW + 3000);
  assert.equal(await counter('view', 'atlas', tree), 2);
});

test('Do Not Track and Global Privacy Control are honoured', async () => {
  const headers = (h: Record<string, string>) => new Headers(h);
  assert.equal(shared.headersRefuseTracking(headers({ DNT: '1' })), true);
  assert.equal(shared.headersRefuseTracking(headers({ 'Sec-GPC': '1' })), true);
  assert.equal(shared.headersRefuseTracking(headers({ DNT: '0' })), false);
  assert.equal(shared.headersRefuseTracking(headers({})), false);
  assert.equal(shared.browserRefusesTracking({ doNotTrack: '1' }), true);
  assert.equal(shared.browserRefusesTracking({ globalPrivacyControl: true }), true);
  assert.equal(shared.browserRefusesTracking({}, { doNotTrack: '1' }), true);
  assert.equal(shared.browserRefusesTracking({ doNotTrack: '0', globalPrivacyControl: false }), false);

  // The endpoint refuses before it reads anything, so nothing is written for this family.
  const POST = (Route.options as unknown as { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } }).server.handlers.POST;
  const response = await POST({ request: new Request('http://x/api/stats', { method: 'POST', headers: { DNT: '1' }, body: JSON.stringify({ tree: 'dnt', visit: true }) }) });
  assert.equal(response.status, 204);
  assert.deepEqual(await daily('dnt'), []);
});

test('only stewards may read or switch statistics, and the server checks', () => {
  assert.equal(can('steward', 'view-statistics'), true);
  for (const role of ['viewer', 'contributor', 'editor'] as const) assert.equal(can(role, 'view-statistics'), false, role);
  const source = readFileSync(new URL('./stats/functions.ts', import.meta.url), 'utf8');
  const handlers = source.split('.handler(').slice(1);
  assert.equal(handlers.length, 2);
  for (const h of handlers) assert.match(h.slice(0, 200), /requireCan\(data\.tree, 'view-statistics'\)/, 'checked before anything is read or changed');
});

test('nothing personal is stored', async () => {
  const tree = 'privacy';
  const user = 'user-ada-lindqvist-7f3a';
  await stats.recordMemberBatch(user, { tree, visit: true, views: { house: 2 }, events: { 'tour.finished': 1, 'assistant.asked': 1 } }, NOW);
  await stats.recordGuestVisit(tree, NOW);
  const tables = ['stats_daily', 'stats_member', 'stats_once'];
  const dump = JSON.stringify(await Promise.all(tables.map((t) => db().all(`SELECT * FROM ${t} WHERE tree = ?`, tree))));
  assert.ok(!dump.includes(user), 'no account id');
  assert.ok(!dump.toLowerCase().includes('ada'), 'no name');
  const actor = await stats.actorKey(tree, user);
  assert.notEqual(actor, await stats.actorKey('other-family', user), 'a member has a different pseudonym in every family');
  const columns = (await Promise.all(tables.map((t) => db().all<{ name: string }>(`SELECT name FROM pragma_table_info('${t}')`)))).flat().map((c) => c.name);
  for (const forbidden of ['user', 'email', 'ip', 'path', 'url', 'person', 'agent']) assert.ok(!columns.includes(forbidden), `no ${forbidden} column`);
});

test('guests count only as anonymous visits, up to a daily limit', async () => {
  const tree = 'guests';
  await db().run(`INSERT INTO stats_daily (tree, day, kind, name, n) VALUES (?, ?, 'visit', 'guest', ?)`, tree, shared.dayOf(NOW), stats.GUEST_DAILY_CAP - 1);
  await stats.recordGuestVisit(tree, NOW);
  await stats.recordGuestVisit(tree, NOW);
  assert.equal(await counter('visit', 'guest', tree), stats.GUEST_DAILY_CAP);
  assert.equal((await db().all('SELECT * FROM stats_member WHERE tree = ?', tree)).length, 0);
});

test('old counters and markers go; recent ones stay', async () => {
  const tree = 'prune';
  const old = (days: number) => shared.dayOf(NOW - days * DAY);
  await db().batch([
    { sql: `INSERT INTO stats_daily (tree, day, kind, name, n) VALUES (?, ?, 'view', 'atlas', 1)`, params: [tree, old(stats.DAILY_KEEP_DAYS + 1)] },
    { sql: `INSERT INTO stats_daily (tree, day, kind, name, n) VALUES (?, ?, 'view', 'almanac', 1)`, params: [tree, old(400)] },
    { sql: `INSERT INTO stats_member (tree, actor, last_day) VALUES (?, 'gone', ?)`, params: [tree, old(stats.MEMBER_KEEP_DAYS + 1)] },
    { sql: `INSERT INTO stats_member (tree, actor, last_day) VALUES (?, 'here', ?)`, params: [tree, old(10)] },
    { sql: `INSERT INTO stats_once (tree, actor, name) VALUES (?, 'gone', 'tour.finished')`, params: [tree] },
    { sql: `INSERT INTO stats_once (tree, actor, name) VALUES (?, 'here', 'tour.finished')`, params: [tree] },
  ]);
  await stats.pruneStats(NOW);
  assert.deepEqual((await daily(tree)).map((r) => r.name), ['almanac']);
  assert.deepEqual((await db().all<{ actor: string }>('SELECT actor FROM stats_member WHERE tree = ?', tree)).map((r) => r.actor), ['here']);
  assert.deepEqual((await db().all<{ actor: string }>('SELECT actor FROM stats_once WHERE tree = ?', tree)).map((r) => r.actor), ['here']);
});

test('the overview fills empty days, compares periods, and ranks', () => {
  const o = buildOverview({
    days: 7, today: '2026-11-08', collecting: true, since: '2026-10-01',
    rows: [
      { day: '2026-11-08', kind: 'view', name: 'atlas', n: 4 },
      { day: '2026-11-05', kind: 'view', name: 'almanac', n: 10 },
      { day: '2026-10-30', kind: 'view', name: 'almanac', n: 7 },
      { day: '2026-11-08', kind: 'visit', name: 'member', n: 3 },
      { day: '2026-11-08', kind: 'visit', name: 'guest', n: 2 },
      { day: '2026-11-08', kind: 'event', name: 'assistant.asked', n: 5 },
      { day: '2026-11-08', kind: 'active', name: 'member', n: 2 },
      { day: '2020-01-01', kind: 'view', name: 'tree', n: 99 },
    ],
    changes: [{ day: '2026-11-07', kind: 'stories', n: 2 }, { day: '2026-11-07', kind: 'people', n: 1 }, { day: '2026-11-01', kind: 'photos', n: 1 }],
    active: { d7: 3, d30: 4, d90: 5 }, members: 6, lifetime: { 'tour.finished': 2 }, feedback: 1,
  });
  assert.equal(o.series.length, 7);
  assert.equal(o.series[0].day, '2026-11-02');
  assert.equal(o.series[6].views, 4);
  assert.equal(o.totals.views, 14);
  assert.equal(o.previous.views, 7);
  assert.equal(o.totals.visits, 3);
  assert.equal(o.totals.guests, 2, 'guests are counted apart from members');
  assert.equal(o.totals.changes, 3);
  assert.equal(o.previous.changes, 1);
  assert.deepEqual(o.routes.map((r) => r.name), ['almanac', 'atlas']);
  assert.deepEqual(o.recent.map((r) => r.day), ['2026-11-07']);
  assert.equal(o.tour.finished, 2);
  assert.equal(o.feedback, 1);
  assert.equal(percentChange(14, 7), 100);
  assert.equal(percentChange(5, 0), null);
});

const base = { since: '2026-08-01', today: '2026-11-08', days: 30 as const, members: 10, tour: { finished: 0, skipped: 0 }, feedback: 0, active: { d7: 7, d30: 8, d90: 9 },
  totals: { views: 400, visits: 80, guests: 0, changes: 40, activeDays: 120 }, previous: { views: 300, visits: 60, guests: 0, changes: 10, activeDays: 90 } };
const keys = (r: ReturnType<typeof readReception>) => r.points.map((p) => p.key as string);

test('the reading says when it is too early', () => {
  assert.equal(readReception({ ...base, since: '2026-11-06' }).verdict, 'early');
  assert.equal(readReception({ ...base, totals: { ...base.totals, views: 5 } }).verdict, 'early');
  assert.equal(readReception({ ...base, since: null }).verdict, 'early');
});

test('the reading reports reach, momentum, contribution, tour and feedback', () => {
  const warm = readReception({ ...base, tour: { finished: 4, skipped: 1 }, feedback: 2 });
  assert.equal(warm.verdict, 'warm');
  assert.deepEqual(keys(warm), ['stats.rc.reach_good', 'stats.rc.momentum_up', 'stats.rc.adding', 'stats.rc.tour_good', 'stats.rc.feedback']);
  const quiet = readReception({ ...base, active: { d7: 0, d30: 1, d90: 2 }, totals: { ...base.totals, changes: 0, activeDays: 20 }, tour: { finished: 0, skipped: 5 } });
  assert.equal(quiet.verdict, 'quiet');
  assert.deepEqual(keys(quiet), ['stats.rc.reach_low', 'stats.rc.momentum_down', 'stats.rc.only_reading', 'stats.rc.tour_skipped', 'stats.rc.no_feedback']);
});

test('after collection was off, reach is not claimed from forgotten markers', () => {
  const r = readReception({ ...base, active: { d7: 0, d30: 0, d90: 0 } });
  assert.ok(!keys(r).some((k) => k.startsWith('stats.rc.reach')));
});

test('no momentum is claimed before a whole earlier period was counted', () => {
  const r = readReception({ ...base, since: '2026-10-20' });
  assert.ok(!keys(r).some((k) => k.startsWith('stats.rc.momentum')));
});

test('the page reads changes from the family’s own records', async () => {
  const d = makeFamily(TREE);
  const iso = (ms: number) => new Date(ms).toISOString();
  d.prepare(`INSERT INTO person (id, given, updated_at) VALUES ('ada', 'Ada', ?), ('old', 'Old', ?)`).run(iso(NOW), iso(NOW - 400 * DAY));
  d.prepare(`INSERT INTO story (id, person, kind, body, author, at) VALUES ('s1', 'ada', 'memory', 'x', 'y', ?)`).run(iso(NOW - DAY));
  d.prepare(`INSERT INTO media (key, mime, uploaded_by, uploaded_at) VALUES ('gallery/a.jpg', 'image/jpeg', 'y', ?)`).run(iso(NOW));
  d.close();
  await stats.recordMemberBatch('u1', { tree: TREE, views: { atlas: 1 } }, NOW);
  const o = await stats.readOverview(TREE, 7, NOW);
  assert.equal(o.series.at(-1)!.people, 1);
  assert.equal(o.series.at(-1)!.photos, 1);
  assert.equal(o.series.at(-2)!.stories, 1);
  assert.equal(o.totals.changes, 3, 'the person edited 400 days ago is outside the range');
  assert.equal(o.active.d7, 1);
  assert.equal(o.collecting, true);
});

test('turning collection off wins against a batch already under way', async () => {
  const tree = 'race';
  await stats.recordMemberBatch('u1', { tree, views: { atlas: 1 } }, NOW);
  await Promise.all([
    stats.recordMemberBatch('u2', { tree, visit: true, views: { atlas: 1 }, events: { 'tour.finished': 1 } }, NOW),
    stats.recordGuestVisit(tree, NOW),
    stats.setCollecting(tree, false, NOW),
  ]);
  assert.equal((await db().all('SELECT * FROM stats_member WHERE tree = ?', tree)).length, 0);
  assert.equal((await db().all('SELECT * FROM stats_once WHERE tree = ?', tree)).length, 0);
  assert.equal(await counter('visit', 'guest', tree), 0);
  assert.equal(await counter('view', 'atlas', tree), 1);
});
