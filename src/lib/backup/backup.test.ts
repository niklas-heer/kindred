// node --test src/lib/backup/backup.test.ts — the automatic backups on Node (docs/hosting-many-families.md, "Backups"): a backup
// and a restore into a new id keep every row and BLOB; a changed file, another key and a file under another family's id do not
// open; retention keeps 7 daily, 4 weekly and 12 monthly; the drill finds a backup whose rows do not match its manifest and one
// whose database is damaged; a restore over a family backs it up first; a deleted family's backups wait out the grace period;
// the daily run keeps its budget, most stale first; and the console refuses anyone but the operator, a demo and a "View as"
// preview. Invented families only, in a scratch folder.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-backup-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'a test secret that seals nothing real';
delete process.env.KINDRED_BACKUP_KEY;
delete process.env.KINDRED_BACKUP_DIR;
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_DEFAULT_TREE;
delete process.env.KINDRED_AUTH;

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
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null, method: 'passkey' });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } }, ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const b = await load<typeof import('./backup.server.ts')>('/src/lib/backup/backup.server.ts');
const fns = await load<typeof import('./backup.functions.ts')>('/src/lib/backup/backup.functions.ts');
const kbak = await load<typeof import('./kbak.ts')>('/src/lib/backup/kbak.ts');
const { keepIndexes } = await load<typeof import('./retention.ts')>('/src/lib/backup/retention.ts');
const { store, q } = await load<typeof import('../store/index.ts')>('/src/lib/store/index.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const acc = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const fam = await load<typeof import('../families.server.ts')>('/src/lib/families.server.ts');
const health = await load<typeof import('../operator/health.server.ts')>('/src/lib/operator/health.server.ts');
const { onRequestReadOnly } = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { viewAsRefused } = await load<typeof import('../auth/view-as.server.ts')>('/src/lib/auth/view-as.server.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

const g = globalThis as unknown as { __signedIn?: unknown; __request?: Request };
const T = Date.now();
const user = (n: number, name: string, operator = 0) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name, email: `${name.toLowerCase()}@example.org`, handle: `h-${n}`, created: T + n, last_seen: null, locale: null, operator });
const OP = user(1, 'Orla', 1);
const STEWARD = user(2, 'Sten');
const asUser = (u: unknown) => { g.__signedIn = u; g.__request = undefined; };
const status = (e: unknown) => (e as { status?: number }).status;
const actor = { id: OP.id, name: OP.name };
const BLOB = Uint8Array.from({ length: 2048 }, (_, i) => (i * 31 + 7) % 256);
const backupsOf = async (scope: string) => (await store.accounts().all<{ name: string; gone_at: number | null }>('SELECT name, gone_at FROM family_backup WHERE family = ? ORDER BY created_at', scope));
const people = async (tree: string) => (await store.tree(tree).all<{ id: string; given: string }>('SELECT id, given FROM person ORDER BY id')).map((p) => `${p.id}:${p.given}`);

before(async () => {
  for (const u of [OP, STEWARD]) await store.accounts().run('INSERT INTO user (id, name, email, handle, created, operator) VALUES (?, ?, ?, ?, ?, ?)', u.id, u.name, u.email, u.handle, u.created, u.operator);
  for (const [id, name] of [['alderby', 'The Alderbys'], ['brackwell', 'The Brackwells'], ['corriston', 'The Corristons']]) await dbs.provisionFamily(id!, name!);
  await store.accounts().batch([acc.upsertMembership(STEWARD.id, 'alderby', 'steward')]);
  await store.tree('alderby').batch([
    q("INSERT INTO person (id, given) VALUES ('p1', 'Ilse')"),
    q("INSERT INTO person (id, given) VALUES ('p2', 'Joran')"),
    q('CREATE TABLE IF NOT EXISTS probe_blob (id INTEGER PRIMARY KEY, b BLOB)'),
    q('INSERT INTO probe_blob (id, b) VALUES (1, ?)', BLOB),
  ]);
});
beforeEach(() => { asUser(undefined); onRequestReadOnly(() => undefined); });

test('a backup is encrypted, and its manifest is beside it and in the accounts database', async () => {
  const m = await b.backUp('alderby', new Date('2026-11-12T03:00:00.000Z'));
  assert.equal(m.scope, 'alderby');
  assert.equal(m.format, 'sqlite');
  assert.equal(m.counts.person, 2);
  assert.equal(m.counts.probe_blob, 1);
  assert.match(m.schema ?? '', /^\d{4}_/);
  const file = join(dir, 'backups', 'alderby', `${m.name}.kbak`);
  const bytes = readFileSync(file);
  assert.ok(!bytes.includes(Buffer.from('Joran')), 'no name in the clear');
  assert.ok(!bytes.includes(Buffer.from('SQLite format')), 'not a plain database');
  assert.equal(JSON.parse(readFileSync(file.replace(/\.kbak$/, '.json'), 'utf8')).sha256, m.sha256);
  const row = await store.accounts().get<{ sha256: string; key_id: string; bytes: number }>('SELECT sha256, key_id, bytes FROM family_backup WHERE family = ? AND name = ?', 'alderby', m.name);
  assert.equal(row?.sha256, m.sha256);
  assert.equal(row?.bytes, bytes.length);
  assert.equal(row?.key_id, (await kbak.deriveBackupKey(process.env.KINDRED_SECRET!)).id);
});

test('a backup restored into a new id keeps every row and BLOB, names its own id, and the original\'s stewards steward it', async () => {
  const [{ name }] = await backupsOf('alderby');
  await store.tree('alderby').run("INSERT INTO person (id, given) VALUES ('p3', 'Later')");
  const r = await b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'alderby-restored' });
  assert.equal(r.into, 'alderby-restored');
  assert.equal(r.token, null, 'the original has a steward, so no link is needed');
  assert.deepEqual(await people('alderby-restored'), ['p1:Ilse', 'p2:Joran'], 'as it was when backed up');
  assert.deepEqual(await people('alderby'), ['p1:Ilse', 'p2:Joran', 'p3:Later'], 'the original is untouched');
  const blob = (await store.tree('alderby-restored').get<{ b: Uint8Array }>('SELECT b FROM probe_blob WHERE id = 1'))!.b;
  assert.deepEqual([...blob], [...BLOB]);
  assert.equal((await store.tree('alderby-restored').get<{ value: string }>("SELECT value FROM meta WHERE key = 'id'"))?.value, 'alderby-restored');
  assert.equal((await store.accounts().get<{ role: string }>('SELECT role FROM membership WHERE user = ? AND tree = ?', STEWARD.id, 'alderby-restored'))?.role, 'steward');
  assert.ok((await store.treeIds()).includes('alderby-restored'));
  assert.ok((await store.accounts().get("SELECT 1 FROM operator_audit WHERE action = 'backup.restore_new' AND family = 'alderby-restored'")));
  // Not into a family that exists.
  await assert.rejects(b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'brackwell' }), /backup\.err\.taken/);
});

test('a changed file, another key and a file under another family\'s id do not open', async () => {
  const [{ name }] = await backupsOf('alderby');
  const bytes = (await store.backups.read('alderby', name!))!;
  const k = await kbak.deriveBackupKey(process.env.KINDRED_SECRET!);
  assert.equal((await kbak.open(bytes, k, 'alderby', name!)).manifest.counts.person, 2);
  // One bit of the ciphertext.
  const flipped = bytes.slice();
  flipped[flipped.length - 20] ^= 1;
  await assert.rejects(kbak.open(flipped, k, 'alderby', name!), (e) => (e as { code?: string }).code === 'decrypt');
  // The header (the manifest) changed to name another family: the tag no longer matches.
  const text = Buffer.from(bytes).toString('latin1').replace('"scope":"alderby"', '"scope":"alderbz"');
  await assert.rejects(kbak.open(Uint8Array.from(Buffer.from(text, 'latin1')), k, 'alderbz', name!), (e) => (e as { code?: string }).code === 'decrypt');
  // Another key.
  await assert.rejects(kbak.open(bytes, await kbak.deriveBackupKey('another secret'), 'alderby', name!), /another key/);
  // The same file under brackwell's id: refused before decrypting, and the drill says so.
  await assert.rejects(kbak.open(bytes, k, 'brackwell', name!), (e) => (e as { code?: string }).code === 'scope');
  await store.backups.write('brackwell', name!, bytes);
  const drill = await store.backups.drill('brackwell', name!);
  assert.equal(drill.ok, false);
  assert.match(drill.problem ?? '', /another database/);
  await assert.rejects(store.backups.restore('brackwell', name!, 'brackwell-copy'), /another database/);
  await store.backups.remove('brackwell', name!);
  // A changed file's drill fails too.
  await store.backups.write('alderby', name!, flipped);
  assert.equal((await store.backups.drill('alderby', name!)).ok, false);
  await store.backups.write('alderby', name!, bytes);
  assert.deepEqual(await store.backups.drill('alderby', name!), { ok: true, problem: null, check: 'integrity_check' });
});

test('the drill finds a backup whose rows do not match its manifest, and a damaged database', async () => {
  const k = await kbak.deriveBackupKey(process.env.KINDRED_SECRET!);
  const m = await b.backUp('brackwell', new Date('2026-11-12T04:00:00.000Z'));
  const { manifest, plain } = await kbak.open((await store.backups.read('brackwell', m.name))!, k, 'brackwell', m.name);
  // Rows gone, but the manifest still counts them.
  const d = new DatabaseSync(':memory:');
  d.deserialize(plain);
  d.exec("DELETE FROM meta WHERE key = 'tagline'");
  const fewer = d.serialize();
  d.close();
  const { kindred: _k, version: _v, size: _s, sha256: _h, keyId: _i, ...base } = manifest;
  await store.backups.write('brackwell', m.name, (await kbak.seal(base, fewer, k)).bytes);
  const r1 = await b.drill('brackwell');
  assert.equal(r1?.ok, false);
  assert.match(r1?.problem ?? '', /meta: \d+ rows, expected \d+/);
  // A damaged page: valid encryption around a broken database.
  const broken = plain.slice();
  for (let i = 100; i < Math.min(broken.length, 100 + 8192); i++) broken[i] = 0xa5;
  await store.backups.write('brackwell', m.name, (await kbak.seal(base, broken, k)).bytes);
  const r2 = await b.drill('brackwell');
  assert.equal(r2?.ok, false, 'a damaged database fails the drill');
  const st = await store.accounts().get<{ drill_ok: number; drill_problem: string }>("SELECT drill_ok, drill_problem FROM backup_status WHERE family = 'brackwell'");
  assert.equal(st?.drill_ok, 0);
  assert.ok(!(st?.drill_problem ?? '').includes('brackwell'), 'no family id in what the console keeps');
  // Put a good one back, for the tests after.
  await store.backups.remove('brackwell', m.name);
  await store.accounts().run("DELETE FROM family_backup WHERE family = 'brackwell'");
});

test('retention keeps the newest of 7 days, 4 weeks and 12 months', async () => {
  const day = 86_400_000;
  const start = Date.parse('2025-01-01T03:00:00Z');
  // Two backups a day for 500 days.
  const times = Array.from({ length: 1000 }, (_, i) => start + Math.floor(i / 2) * day + (i % 2) * 3600_000);
  const kept = [...keepIndexes(times)].map((i) => times[i]!).sort((a, b) => b - a);
  const newest = times.at(-1)!;
  assert.equal(kept[0], newest, 'the newest is kept');
  const days = new Set(kept.map((t) => new Date(t).toISOString().slice(0, 10)));
  for (let i = 0; i < 7; i++) assert.ok(days.has(new Date(newest - i * day).toISOString().slice(0, 10)), `day ${i}`);
  const months = new Set(kept.map((t) => new Date(t).toISOString().slice(0, 7)));
  assert.equal(months.size, 12, [...months].join());
  assert.ok(kept.length <= 7 + 4 + 12 && kept.length >= 12, String(kept.length));
  // Of one day's two backups, only the later one.
  assert.ok(!kept.includes(newest - 3600_000));

  // On disk: 9 daily backups of corriston leave 7 days' worth (here, the 7 newest).
  for (let i = 0; i < 9; i++) await b.backUp('corriston', new Date(Date.parse('2026-10-01T03:00:00Z') + i * day));
  assert.equal(await b.prune('corriston', { daily: 7, weekly: 1, monthly: 1 }), 2);
  const left = await backupsOf('corriston');
  assert.equal(left.length, 7);
  const files = readdirSync(join(dir, 'backups', 'corriston')).filter((f) => f.endsWith('.kbak'));
  assert.equal(files.length, 7, 'the files went with their rows');
  assert.ok(!files.includes('20261001T030000000Z.kbak'));
});

test('a restore over a family backs it up first, then puts the backup in its place', async () => {
  const before = await backupsOf('alderby');
  const name = before[0]!.name;
  await assert.rejects(b.restoreBackup(actor, { scope: 'alderby', name, mode: 'over', confirm: 'alderbyy' }), /backup\.err\.confirm/);
  const r = await b.restoreBackup(actor, { scope: 'alderby', name, mode: 'over', confirm: 'alderby' });
  assert.ok(r.fresh);
  assert.deepEqual(await people('alderby'), ['p1:Ilse', 'p2:Joran'], 'p3 came after the backup');
  const after = await backupsOf('alderby');
  assert.equal(after.length, before.length + 1, 'the fresh backup');
  // The fresh one still holds what was replaced: restoring it brings p3 back.
  await b.restoreBackup(actor, { scope: 'alderby', name: r.fresh!, mode: 'over', confirm: 'alderby' });
  assert.deepEqual(await people('alderby'), ['p1:Ilse', 'p2:Joran', 'p3:Later']);
});

test('a deleted family\'s backups stay for the grace period, can be restored into a new id meanwhile, then go', async () => {
  await dbs.provisionFamily('dunmore', 'The Dunmores');
  await store.tree('dunmore').run("INSERT INTO person (id, given) VALUES ('d1', 'Wenna')");
  const m = await b.backUp('dunmore', new Date(T - 3 * 86_400_000));
  await fam.deleteFamily('dunmore', 'dunmore');
  const rows = await backupsOf('dunmore');
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.gone_at, 'marked when the family was deleted');
  assert.ok(existsSync(join(dir, 'backups', 'dunmore', `${m.name}.kbak`)));
  // Over the deleted family: no. Into a new id: yes, and with no steward left, a link for one.
  await assert.rejects(b.restoreBackup(actor, { scope: 'dunmore', name: m.name, mode: 'over', confirm: 'dunmore' }), /backup\.err\.gone/);
  const r = await b.restoreBackup(actor, { scope: 'dunmore', name: m.name, mode: 'new', into: 'dunmore-again' });
  assert.ok(r.token, 'a one-time link for its first steward');
  assert.deepEqual(await people('dunmore-again'), ['d1:Wenna']);
  // The daily run within the grace period keeps them; after it, they go.
  const trees = await store.treeIds();
  await b.runBackups({ trees, now: new Date(), log: () => {} });
  assert.equal((await backupsOf('dunmore')).length, 1);
  await b.runBackups({ trees, now: new Date(Date.now() + 31 * 86_400_000), log: () => {} });
  assert.equal((await backupsOf('dunmore')).length, 0);
  assert.ok(!existsSync(join(dir, 'backups', 'dunmore', `${m.name}.kbak`)));
});

test('the daily run backs up the most stale first and stops when its budget is spent; the drill runs weekly', async () => {
  await store.accounts().run('DELETE FROM backup_status');
  const trees = await store.treeIds();
  let t = 0;
  const logs: string[] = [];
  // Every backup "takes" a minute; the budget is three.
  const r = await b.runBackups({ trees, now: new Date(Date.parse('2027-01-01T03:00:00Z')), log: (m) => logs.push(m), budgetMs: 3 * 60_000, clock: () => (t += 60_000) });
  assert.ok(r.made >= 1 && r.made <= 3, JSON.stringify(r));
  assert.ok(r.left > 0, 'some are left for tomorrow');
  const done = (await store.accounts().all<{ family: string }>('SELECT family FROM backup_status WHERE ok_at IS NOT NULL')).map((x) => x.family);
  // The next run starts with those not reached.
  const r2 = await b.runBackups({ trees, now: new Date(Date.parse('2027-01-01T04:00:00Z')), log: () => {} });
  const all = (await store.accounts().all<{ family: string }>('SELECT family FROM backup_status WHERE ok_at IS NOT NULL')).map((x) => x.family);
  assert.equal(r2.made, all.length - done.length, 'only those not done an hour ago');
  assert.ok(all.includes('_accounts'));

  const d1 = await b.runDrill({ trees, now: new Date(Date.parse('2027-01-01T05:00:00Z')), log: () => {} });
  assert.ok(d1.drilled.includes('_accounts') && d1.drilled.length === 2, d1.drilled.join());
  assert.equal(d1.failed, 0);
  const d2 = await b.runDrill({ trees, now: new Date(Date.parse('2027-01-03T05:00:00Z')), log: () => {} });
  assert.deepEqual(d2.drilled, [], 'not again within the week');
  const d3 = await b.runDrill({ trees, now: new Date(Date.parse('2027-01-08T05:00:00Z')), log: () => {} });
  assert.equal(d3.drilled.length, 2);
  assert.notEqual(d3.drilled[1], d1.drilled[1], 'another family');
});

test('the Health tab shows each family\'s last good backup, the key, the drills, and no "no automatic backup" message', async () => {
  const h = await health.readHealth({ archive: false });
  assert.equal(h.backups.where, 'files');
  assert.equal(h.backups.key.source, 'secret');
  assert.equal(h.backups.key.besideBackups, false, 'KINDRED_SECRET comes from the environment here');
  assert.ok(h.backups.total.count > 0);
  assert.ok(h.backups.drills.length > 0);
  assert.ok(h.backups.families.some((f) => f.scope === '_accounts'));
  // A family never backed up is stale.
  await dbs.provisionFamily('elmstead', 'The Elmsteads');
  const h2 = await health.readHealth({ archive: false });
  assert.ok(h2.backups.families.find((f) => f.scope === 'elmstead')?.stale);
  assert.ok(h2.backups.stale >= 1);
});

test('only the operator reaches the backups; a demo and a "View as" preview change nothing', async () => {
  const [{ name }] = await backupsOf('alderby');
  await assert.rejects(fns.fetchBackups(), (e) => status(e) === 401);
  asUser(STEWARD);
  await assert.rejects(fns.fetchBackups(), (e) => status(e) === 403);
  asUser(STEWARD);
  await assert.rejects(fns.operatorBackUpNow({ data: { scope: 'alderby' } }), (e) => status(e) === 403);
  asUser(STEWARD);
  await assert.rejects(fns.operatorRestoreBackup({ data: { scope: 'alderby', name: name!, mode: 'new', into: 'alderby-steward' } }), (e) => status(e) === 403);
  asUser(OP);
  const overview = await fns.fetchBackups();
  assert.ok(overview.families.find((f) => f.scope === 'alderby')!.backups.length > 0);
  assert.equal(JSON.stringify(overview).includes('Joran'), false, 'no record of the family in what the operator reads');

  // A "View as" preview of this request.
  const count = (await backupsOf('alderby')).length;
  onRequestReadOnly(() => viewAsRefused({ kind: 'role', role: 'viewer' } as never));
  asUser(OP);
  await assert.rejects(fns.operatorBackUpNow({ data: { scope: 'alderby' } }), (e) => status(e) === 403);
  await assert.rejects(store.backups.take('alderby', kbak.backupName(new Date())), (e) => status(e) === 403);
  onRequestReadOnly(() => undefined);

  process.env.KINDRED_DEMO = '1';
  try {
    asUser(OP);
    await assert.rejects(fns.operatorBackUpNow({ data: { scope: 'alderby' } }), (e) => status(e) === 403);
    await assert.rejects(store.backups.restore('alderby', name!, 'alderby-demo'), (e) => status(e) === 403);
    await assert.rejects(store.backups.remove('alderby', name!), (e) => status(e) === 403);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal((await backupsOf('alderby')).length, count, 'nothing was made');
  asUser(OP);
  const now = await fns.operatorBackUpNow({ data: { scope: 'alderby' } });
  assert.match(now.name, /^\d{8}T\d{9}Z$/);
});
