// node --test src/lib/votes/functions.test.ts — the vote server functions called for real, against a scratch database; only the
// framework around them (who is asking, createServerFn) is replaced, as in src/lib/auth/share.test.ts. The stub skips the zod
// validators, so what a validator would refuse is also checked by the handler where it matters (a guest's name).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-vote-fns-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'vote-fns-test-secret';
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
const fns = await load<typeof import('./votes.functions.ts')>('/src/lib/votes/votes.functions.ts');

const TREE = 'votefns';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const BO = '00000000-0000-4000-8000-0000000000b2';
const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __request?: Request; __setCookies?: string[] };
const asMember = (id: string, name: string) => { g.__signedIn = { id, name }; g.__guest = undefined; g.__request = new Request('http://localhost/'); };
const asGuest = () => { g.__signedIn = null; g.__guest = { link: 'link-1', tree: TREE, expires: Date.now() + 3_600_000 }; g.__request = new Request('http://localhost/'); g.__setCookies = []; };
const asNobody = () => { g.__signedIn = null; g.__guest = undefined; g.__request = new Request('http://localhost/'); };
const status = (code: number) => (e: Error & { status?: number }) => e.status === code;

let open = { id: '', options: [] as string[] };
before(async () => {
  await dbs.provisionFamily(TREE, 'Vote Functions');
  for (const [id, name, role] of [[ADA, 'Ada', 'contributor'], [BO, 'Bo', 'viewer']]) {
    await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, name, `handle-${name}`, Date.now());
    await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', id, TREE, role, Date.now());
  }
  asMember(ADA, 'Ada');
  const closesAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const { id } = await fns.startVote({ data: { tree: TREE, vote: { question: 'Where to meet?', kind: 'single', secret: false, addOptions: false, guests: true, closesAt, options: ['Park', 'Lake'] } } });
  const view = await fns.getVote({ data: { tree: TREE, id } });
  open = { id, options: view!.options.map((o) => o.id) };
});
after(async () => {
  asNobody();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a signed-out request is refused on every read and write', async () => {
  asNobody();
  const data = { tree: TREE, id: open.id, choices: [open.options[0]] } as never;
  for (const call of [fns.getVotes, fns.getVote, fns.startVote, fns.endVote, fns.deleteVote, fns.castVote]) {
    await assert.rejects((call as (o: { data: never }) => Promise<unknown>)({ data }), status(401));
  }
});

test('a guest may read but not start, change, close, remove, add an option or strike', async () => {
  asGuest();
  assert.equal((await fns.getVotes({ data: { tree: TREE } })).length, 1);
  for (const call of [fns.startVote, fns.changeVote, fns.endVote, fns.deleteVote, fns.addVoteOption, fns.strikeVoter]) {
    await assert.rejects((call as (o: { data: never }) => Promise<unknown>)({ data: { tree: TREE, id: open.id, vote: {}, label: 'x', voter: 'x', struck: true } as never }), status(401));
  }
});

test('a guest castVote without a name fails, and with one sets the voter cookie and records the ballot', async () => {
  asGuest();
  await assert.rejects(fns.castVote({ data: { tree: TREE, id: open.id, choices: [open.options[0]] } }), /votes\.err\.name/);
  assert.deepEqual(g.__setCookies, []);
  await fns.castVote({ data: { tree: TREE, id: open.id, choices: [open.options[0]], name: 'Carl' } });
  assert.equal(g.__setCookies?.length, 1);
  assert.match(g.__setCookies![0], /^(__Host-)?kindred_voter=/);
  // The browser sends the cookie back: the same guest changes their ballot instead of becoming a second voter.
  g.__request = new Request('http://localhost/', { headers: { cookie: (g.__setCookies as string[])[0].split(';')[0] } });
  g.__setCookies = [];
  await fns.castVote({ data: { tree: TREE, id: open.id, choices: [open.options[1]], name: 'Carl' } });
  assert.deepEqual(g.__setCookies, [], 'a guest who has the cookie is given no new one');
  const view = await fns.getVote({ data: { tree: TREE, id: open.id } });
  assert.equal(view!.voterCount, 1);
  assert.deepEqual(view!.mine, [open.options[1]]);
});

test('a guest of a suspended family reads, but a ballot is refused, writes nothing and sets no cookie', async () => {
  const run = (sql: string, ...a: (string | number)[]) => store.accounts().run(sql, ...a);
  await run("INSERT INTO family_admin (tree, created_at) VALUES (?, ?) ON CONFLICT(tree) DO UPDATE SET status = 'suspended'", TREE, new Date().toISOString());
  await run("UPDATE family_admin SET status = 'suspended' WHERE tree = ?", TREE);
  try {
    asGuest();
    assert.equal((await fns.getVotes({ data: { tree: TREE } })).length, 1, 'reads still work');
    await assert.rejects(fns.castVote({ data: { tree: TREE, id: open.id, choices: [open.options[0]], name: 'Dee' } }), (e: Error & { status?: number }) => e.status === 403 && /suspended/.test(e.message));
    assert.deepEqual(g.__setCookies, []);
    assert.equal((await fns.getVote({ data: { tree: TREE, id: open.id } }))!.voterCount, 1, 'no ballot was written');
  } finally {
    asNobody(); // a new request: the suspended guest's was read-only
    await run("UPDATE family_admin SET status = 'active' WHERE tree = ?", TREE);
  }
});

test('a member votes under their own name, and a viewer may vote but not start a vote', async () => {
  asMember(BO, 'Bo');
  await fns.castVote({ data: { tree: TREE, id: open.id, choices: [open.options[0]] } });
  const view = await fns.getVote({ data: { tree: TREE, id: open.id } });
  assert.deepEqual(view!.mine, [open.options[0]]);
  assert.ok(view!.voters?.some((v) => v.name === 'Bo'));
  await assert.rejects(fns.startVote({ data: { tree: TREE, vote: { question: 'x', kind: 'single', secret: false, addOptions: false, guests: false, closesAt: new Date(Date.now() + 86_400_000).toISOString(), options: ['a', 'b'] } } }), status(403));
});

test('the query helpers key the cache by family and vote', () => {
  assert.deepEqual(fns.votesQuery('t').queryKey, ['votes', 't']);
  assert.deepEqual(fns.voteQuery('t', 'v').queryKey, ['votes', 't', 'v']);
});
