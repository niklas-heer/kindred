// node --test src/lib/arms-proposals/functions.test.ts — the arms proposal server functions called for real, against a scratch database; only the
// framework around them (who is asking, createServerFn) is replaced, as in src/lib/auth/share.test.ts. The stub skips the zod
// validators, so what a validator would refuse is also checked by the handler where it matters (a guest's name).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-arms-fns-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'arms-fns-test-secret';
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_GUEST_ORIGIN;
delete process.env.KINDRED_ORIGIN;

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
      export const getRequest = () => globalThis.__request ?? new Request('http://localhost/');
      export const getRequestIP = () => globalThis.__ip ?? '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null, guest: globalThis.__guest });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  plugins: [framework],
  resolve: { alias: { '~': resolve('src') } },
  ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const fns = await load<typeof import('./proposals.functions.ts')>('/src/lib/arms-proposals/proposals.functions.ts');
const votes = await load<typeof import('../votes/votes.functions.ts')>('/src/lib/votes/votes.functions.ts');

const TREE = 'armsfns';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const BO = '00000000-0000-4000-8000-0000000000b2';
const CARL = '00000000-0000-4000-8000-0000000000c3';
const EVE = '00000000-0000-4000-8000-0000000000e4';
const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __request?: Request; __setCookies?: string[] };
const asMember = (id: string, name: string) => { g.__signedIn = { id, name }; g.__guest = undefined; g.__request = new Request('http://localhost/'); };
const asGuest = () => { g.__signedIn = null; g.__guest = { link: 'link-1', tree: TREE, expires: Date.now() + 3_600_000 }; g.__request = new Request('http://localhost/'); g.__setCookies = []; };
const asNobody = () => { g.__signedIn = null; g.__guest = undefined; g.__request = new Request('http://localhost/'); };
const status = (code: number) => (e: Error & { status?: number }) => e.status === code;
const ada = () => asMember(ADA, 'Ada');
const bo = () => asMember(BO, 'Bo');
const carl = () => asMember(CARL, 'Carl');
const eve = () => asMember(EVE, 'Eve');
const setRole = (id: string, role: string) => store.accounts().run('UPDATE membership SET role = ? WHERE user = ? AND tree = ?', role, id, TREE);

const LION = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' } as const;
const arms = (charge: string, field = 'gules') => ({ field, division: 'plain', charge, chargeTincture: 'or' }) as never;
const house = () => dbs.db(TREE).get<{ name: string; motto: string | null; arms: string }>("SELECT name, motto, arms FROM house WHERE id = 'h1'");
const seen = async () => { const h = (await house())!; return { name: h.name, motto: h.motto, arms: JSON.parse(h.arms) as unknown }; };
type Call = (o: { data: never }) => Promise<unknown>;
const READS = [fns.getHouseProposals, fns.getProposalCounts, fns.getArmsSettings] as Call[];
const WRITES = [fns.setArmsSettings, fns.proposeArmsFn, fns.withdrawProposalFn, fns.acceptProposalFn, fns.declineProposalFn, fns.putToVoteFn] as Call[];
const DATA = { tree: TREE, house: 'h1', id: '00000000-0000-4000-8000-000000000001', name: 'x', arms: arms('stag'), mode: 'choose', guests: true, before: { name: 'Birch', motto: null, arms: LION } } as never;

before(async () => {
  await dbs.provisionFamily(TREE, 'Arms Functions');
  for (const [id, name, role] of [[ADA, 'Ada', 'contributor'], [BO, 'Bo', 'viewer'], [CARL, 'Carl', 'contributor'], [EVE, 'Eve', 'steward']]) {
    await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, name, `handle-${name}`, Date.now());
    await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', id, TREE, role, Date.now());
  }
  await dbs.db(TREE).run("INSERT INTO house (id, name, motto, arms) VALUES ('h1', 'Birch', NULL, ?)", JSON.stringify(LION));
});
after(async () => {
  asNobody();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a signed-out request is refused on every read and write', async () => {
  asNobody();
  for (const call of [...READS, ...WRITES]) await assert.rejects(call({ data: DATA }), status(401));
});

test('a guest is refused on every read and write, whatever the family allows guests', async () => {
  asGuest();
  for (const call of [...READS, ...WRITES]) await assert.rejects(call({ data: DATA }), status(401));
});

test('any member reads, a viewer included; the query helpers key the cache by family and house', async () => {
  bo();
  assert.deepEqual(await fns.getHouseProposals({ data: { tree: TREE, house: 'h1' } }), { proposals: [], mode: 'choose' });
  assert.deepEqual(await fns.getProposalCounts({ data: { tree: TREE } }), {});
  assert.deepEqual(await fns.getArmsSettings({ data: { tree: TREE } }), { mode: 'choose', guests: true });
  assert.deepEqual(fns.houseProposalsQuery('t', 'h').queryKey, ['arms-proposals', 't', 'h']);
  assert.deepEqual(fns.proposalCountsQuery('t').queryKey, ['arms-proposals', 't', 'counts']);
  assert.deepEqual(fns.armsSettingsQuery('t').queryKey, ['arms-settings', 't']);
});

test('only a steward changes the setting; a viewer cannot propose, a contributor can but cannot decide', async () => {
  ada();
  await assert.rejects(fns.setArmsSettings({ data: { tree: TREE, mode: 'steward', guests: false } }), status(403));
  bo();
  await assert.rejects(fns.proposeArmsFn({ data: { tree: TREE, house: 'h1', name: 'The stag', arms: arms('stag') } }), status(403));
  ada();
  const { id } = await fns.proposeArmsFn({ data: { tree: TREE, house: 'h1', name: 'The stag', arms: arms('stag'), note: 'Forest' } });
  const before = await seen();
  for (const call of [fns.acceptProposalFn, fns.declineProposalFn, fns.putToVoteFn] as Call[]) {
    await assert.rejects(call({ data: { tree: TREE, id, before } as never }), status(403));
  }
  const read = await fns.getHouseProposals({ data: { tree: TREE, house: 'h1' } });
  assert.deepEqual(read.proposals.map((p) => [p.name, p.status, p.mine]), [['The stag', 'waiting', true]]);
  assert.deepEqual(await fns.getProposalCounts({ data: { tree: TREE } }), {}, 'only a steward is told how many wait');
  eve();
  assert.deepEqual(await fns.getProposalCounts({ data: { tree: TREE } }), { h1: 1 });
  // Someone else's proposal is not theirs to withdraw; their own is, whatever their role has become.
  carl();
  await assert.rejects(fns.withdrawProposalFn({ data: { tree: TREE, id } }), /arms\.err\.not_yours/);
  await setRole(ADA, 'viewer');
  try {
    ada();
    await fns.withdrawProposalFn({ data: { tree: TREE, id } });
  } finally {
    await setRole(ADA, 'contributor');
  }
  eve();
  assert.deepEqual(await fns.getProposalCounts({ data: { tree: TREE } }), {});
});

test('a steward accepts over the house as seen, declines with a reason, and a change since is refused', async () => {
  carl();
  const a = await fns.proposeArmsFn({ data: { tree: TREE, house: 'h1', name: 'The stag', arms: arms('stag') } });
  const b = await fns.proposeArmsFn({ data: { tree: TREE, house: 'h1', name: 'The eagle', arms: arms('eagle') } });
  assert.equal(a.vote, null, 'choose mode: a proposal waits');
  eve();
  await assert.rejects(fns.acceptProposalFn({ data: { tree: TREE, id: a.id, before: { name: 'Birch', motto: 'Other', arms: LION } } }), /changed/i);
  await fns.acceptProposalFn({ data: { tree: TREE, id: a.id, before: await seen() } });
  assert.equal(JSON.parse((await house())!.arms).charge, 'stag');
  await fns.declineProposalFn({ data: { tree: TREE, id: b.id, reason: 'Too busy' } });
  const rows = await dbs.db(TREE).all<{ name: string; status: string; reason: string | null }>("SELECT name, status, reason FROM arms_proposal WHERE name IN ('The stag', 'The eagle') AND status IN ('accepted', 'declined') ORDER BY name");
  assert.deepEqual(rows.map((r) => [r.name, r.status, r.reason]), [['The eagle', 'declined', 'Too busy'], ['The stag', 'accepted', null]]);
});

test('a proposal in vote mode returns the vote it started, and the next one joins it without starting another', async () => {
  eve();
  await fns.setArmsSettings({ data: { tree: TREE, mode: 'vote', guests: true } });
  assert.deepEqual(await fns.getArmsSettings({ data: { tree: TREE } }), { mode: 'vote', guests: true });
  ada();
  const first = await fns.proposeArmsFn({ data: { tree: TREE, house: 'h1', name: 'The rose', arms: arms('rose') } });
  assert.equal(first.started, true);
  assert.match(first.vote ?? '', /^[0-9a-f-]{36}$/);
  carl();
  const second = await fns.proposeArmsFn({ data: { tree: TREE, house: 'h1', name: 'The key', arms: arms('key') } });
  assert.equal(second.vote, first.vote);
  assert.equal(second.started, false);
  const view = await votes.getVote({ data: { tree: TREE, id: first.vote! } });
  assert.deepEqual(view!.options.map((o) => o.label).sort(), ['Keep our current arms', 'The key', 'The rose']);
  // A guest sees the vote's options as { id, label, arms } and nothing of who proposed them.
  asGuest();
  const guestView = await votes.getVote({ data: { tree: TREE, id: first.vote! } });
  for (const o of guestView!.options) assert.deepEqual(Object.keys(o).sort(), ['arms', 'id', 'label']);
  assert.doesNotMatch(JSON.stringify(guestView), /Ada|Carl/);
});

test('Put to a vote starts a vote for a waiting proposal in choose mode, and is a steward\'s', async () => {
  eve();
  const open = (await votes.getVotes({ data: { tree: TREE } })).filter((v) => !v.closed);
  for (const v of open) await votes.deleteVote({ data: { tree: TREE, id: v.id } });
  await fns.setArmsSettings({ data: { tree: TREE, mode: 'choose', guests: true } });
  ada();
  const p = await fns.proposeArmsFn({ data: { tree: TREE, house: 'h1', name: 'The tower', arms: arms('tower') } });
  assert.equal(p.vote, null);
  await assert.rejects(fns.putToVoteFn({ data: { tree: TREE, id: p.id } }), status(403));
  eve();
  const put = await fns.putToVoteFn({ data: { tree: TREE, id: p.id } });
  assert.equal(put.started, true);
  assert.match(put.vote, /^[0-9a-f-]{36}$/);
});
