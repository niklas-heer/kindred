// node --test src/lib/backup/backup.test.ts — the automatic backups on Node (docs/hosting-many-families.md, "Backups"): a backup
// and a restore into a new id keep every row and BLOB; a changed file, another key and a file under another family's id do not
// open; retention keeps 7 daily, 4 weekly and 12 monthly; the drill finds a backup whose rows do not match its manifest and one
// whose database is damaged; a restore over a family backs it up first; a deleted family's backups wait out the grace period;
// the daily run keeps its budget, most stale first; and the console refuses anyone but the operator, a demo and a "View as"
// preview. Invented families only, in a scratch folder.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
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
const { DEFAULT_KEEP, keepIndexes } = await load<typeof import('./retention.ts')>('/src/lib/backup/retention.ts');
const nodeBackups = await load<typeof import('../store/backups.node.ts')>('/src/lib/store/backups.node.ts');
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
const OTHER = user(3, 'Odile');
const LEFT = user(4, 'Lorn');
const DAY = 86_400_000;
const THEME = 'codex';
const asUser = (u: unknown) => { g.__signedIn = u; g.__request = undefined; };
const status = (e: unknown) => (e as { status?: number }).status;
const actor = { id: OP.id, name: OP.name };
const BLOB = Uint8Array.from({ length: 2048 }, (_, i) => (i * 31 + 7) % 256);
const backupsOf = async (scope: string) => (await store.accounts().all<{ name: string; gone_at: number | null }>('SELECT name, gone_at FROM family_backup WHERE family = ? ORDER BY created_at', scope));
const people = async (tree: string) => (await store.tree(tree).all<{ id: string; given: string }>('SELECT id, given FROM person ORDER BY id')).map((p) => `${p.id}:${p.given}`);

before(async () => {
  for (const u of [OP, STEWARD, OTHER, LEFT]) await store.accounts().run('INSERT INTO user (id, name, email, handle, created, operator) VALUES (?, ?, ?, ?, ?, ?)', u.id, u.name, u.email, u.handle, u.created, u.operator);
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
  assert.equal(r.stewards, 1, 'the steward recorded with the backup');
  assert.equal('token' in r, false, 'a restore never hands the operator a link');
  assert.deepEqual(await people('alderby-restored'), ['p1:Ilse', 'p2:Joran'], 'as it was when backed up');
  assert.deepEqual(await people('alderby'), ['p1:Ilse', 'p2:Joran', 'p3:Later'], 'the original is untouched');
  const blob = (await store.tree('alderby-restored').get<{ b: Uint8Array }>('SELECT b FROM probe_blob WHERE id = 1'))!.b;
  assert.deepEqual([...blob], [...BLOB]);
  assert.equal((await store.tree('alderby-restored').get<{ value: string }>("SELECT value FROM meta WHERE key = 'id'"))?.value, 'alderby-restored');
  assert.equal((await store.accounts().get<{ role: string }>('SELECT role FROM membership WHERE user = ? AND tree = ?', STEWARD.id, 'alderby-restored'))?.role, 'steward');
  assert.ok((await store.treeIds()).includes('alderby-restored'));
  const logged = await store.accounts().all<{ detail: string }>("SELECT detail FROM operator_audit WHERE action = 'backup.restore_new' AND family = 'alderby-restored' ORDER BY id");
  assert.equal(logged.length, 2, 'logged before and after');
  assert.deepEqual(JSON.parse(logged[0]!.detail), { from: 'alderby', name, schema: JSON.parse(logged[0]!.detail).schema, gone: false });
  assert.match(JSON.parse(logged[0]!.detail).schema, /^\d{4}_/);
  assert.deepEqual(JSON.parse(logged[1]!.detail), { from: 'alderby', name, stewards: 1, media: { copied: 0, left: 0 }, mediaWithheld: false });
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

test('scripts/backup-open.ts opens a backup on another machine with the key, and not without it', async () => {
  const { openToSqlite } = await import('../../../scripts/backup-open.ts');
  const m = await b.backUp('alderby', new Date('2026-11-12T03:30:00.000Z'));
  const bytes = (await store.backups.read('alderby', m.name))!;
  const out = join(dir, 'opened-alderby.db');
  const r = await openToSqlite(bytes, process.env.KINDRED_SECRET!, out);
  assert.equal(r.problem, null);
  const d = new DatabaseSync(out, { readOnly: true });
  assert.equal((d.prepare('SELECT count(*) AS n FROM person').get() as { n: number }).n, 3, 'p1, p2 and p3, added by the test before');
  assert.deepEqual([...(d.prepare('SELECT b FROM probe_blob WHERE id = 1').get() as { b: Uint8Array }).b], [...BLOB]);
  d.close();
  await assert.rejects(openToSqlite(bytes, 'not the key', join(dir, 'opened-wrong.db')), /another key/);
  await store.backups.remove('alderby', m.name);
  await store.accounts().run('DELETE FROM family_backup WHERE family = ? AND name = ?', 'alderby', m.name);
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
  // A restore checks the backup as the drill does before it replaces anything.
  await assert.rejects(store.backups.restore('brackwell', m.name, 'brackwell', { over: true }), /meta: \d+ rows, expected \d+/);
  assert.equal((await store.tree('brackwell').get<{ value: string }>("SELECT value FROM meta WHERE key = 'tagline'"))?.value, '', 'untouched');
  // A damaged page: valid encryption around a broken database.
  const broken = plain.slice();
  for (let i = 100; i < Math.min(broken.length, 100 + 8192); i++) broken[i] = 0xa5;
  await store.backups.write('brackwell', m.name, (await kbak.seal(base, broken, k)).bytes);
  const r2 = await b.drill('brackwell');
  assert.equal(r2?.ok, false, 'a damaged database fails the drill');
  await assert.rejects(store.backups.restore('brackwell', m.name, 'brackwell', { over: true }));
  assert.equal((await store.tree('brackwell').get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value, 'The Brackwells', 'untouched');
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
  const newest = times.at(-1)!;
  const kept = [...keepIndexes(times, DEFAULT_KEEP, newest)].map((i) => times[i]!).sort((a, b) => b - a);
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
  assert.equal(await b.prune('corriston', { daily: 7, weekly: 1, monthly: 1 }, Date.parse('2026-10-09T06:00:00Z')), 2);
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
  const pinned = await store.accounts().get<{ pinned_until: number }>('SELECT pinned_until FROM family_backup WHERE family = ? AND name = ?', 'alderby', r.fresh!);
  assert.ok(pinned!.pinned_until >= Date.now() + 7 * DAY - 60_000, 'kept for a week, whatever the retention');
  assert.ok((await store.accounts().all<{ detail: string }>("SELECT detail FROM operator_audit WHERE action = 'backup.restore_over' AND family = 'alderby'")).some((a) => JSON.parse(a.detail).fresh === r.fresh));
  // The fresh one still holds what was replaced: restoring it brings p3 back.
  await b.restoreBackup(actor, { scope: 'alderby', name: r.fresh!, mode: 'over', confirm: 'alderby' });
  assert.deepEqual(await people('alderby'), ['p1:Ilse', 'p2:Joran', 'p3:Later']);
  // The tightest retention leaves the pinned backups (and the newest) in place.
  await b.prune('alderby', { daily: 1, weekly: 1, monthly: 1 }, Date.now() + 3 * DAY);
  assert.ok((await backupsOf('alderby')).some((x) => x.name === r.fresh), 'the backup from before the restore stays for its week');
  await b.prune('alderby', { daily: 1, weekly: 1, monthly: 1 }, Date.now() + 8 * DAY);
  assert.ok(!(await backupsOf('alderby')).some((x) => x.name === r.fresh), 'and goes after it');
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
  // Over the deleted family: no. Into a new id: not while the backup records no steward who still has an account, and no
  // link for one either: the operator never holds a way into a family's records.
  await assert.rejects(b.restoreBackup(actor, { scope: 'dunmore', name: m.name, mode: 'over', confirm: 'dunmore' }), /backup\.err\.gone/);
  await assert.rejects(b.restoreBackup(actor, { scope: 'dunmore', name: m.name, mode: 'new', into: 'dunmore-again' }), /backup\.err\.no_stewards/);
  assert.ok(!(await store.treeIds()).includes('dunmore-again'), 'nothing was restored');
  assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM invite WHERE tree = 'dunmore-again'"))?.n, 0);
  assert.equal(await store.accounts().get("SELECT 1 FROM family_claim WHERE tree = 'dunmore-again'"), undefined, 'the address is free again');
  // The daily run within the grace period keeps them; after it, they go.
  const trees = await store.treeIds();
  await b.runBackups({ trees, now: new Date(), log: () => {} });
  assert.equal((await backupsOf('dunmore')).length, 1);
  // A pin (the backup made before a restore over the family) protects a living family's backup; the grace period of a deleted
  // family wins over it.
  await store.accounts().run('UPDATE family_backup SET pinned_until = ? WHERE family = ?', Date.now() + 365 * 86_400_000, 'dunmore');
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

test('a deleted family\'s id made again by someone else: its old backup gives its old stewards a family, and none of the new family\'s pictures', async () => {
  await fam.createFamily(STEWARD, { id: 'fenwick', name: 'The Fenwicks', tagline: '', theme: THEME });
  await store.tree('fenwick').run("INSERT INTO person (id, given) VALUES ('f1', 'Maelon')");
  await store.media.put('fenwick', 'photo/old.jpg', Uint8Array.from([1]), 'image/jpeg');
  const m = await b.backUp('fenwick', new Date(T - 2 * DAY));
  await fam.deleteFamily('fenwick', 'fenwick');
  // As if the deletion stopped before it marked the backups.
  await store.accounts().run('UPDATE family_backup SET gone_at = NULL WHERE family = ?', 'fenwick');
  // Someone else makes a family at the same address, with pictures of their own.
  await fam.createFamily(OTHER, { id: 'fenwick', name: 'The Other Fenwicks', tagline: '', theme: THEME });
  await store.media.put('fenwick', 'photo/new.jpg', Uint8Array.from([2]), 'image/jpeg');
  const r = await b.restoreBackup(actor, { scope: 'fenwick', name: m.name, mode: 'new', into: 'fenwick-old' });
  assert.equal(r.stewards, 1);
  assert.deepEqual(await people('fenwick-old'), ['f1:Maelon']);
  const members = (await store.accounts().all<{ user: string; role: string }>("SELECT user, role FROM membership WHERE tree = 'fenwick-old'")).map((x) => `${x.user}:${x.role}`);
  assert.deepEqual(members, [`${STEWARD.id}:steward`], 'the old steward, not the new family\'s, and not the operator');
  assert.equal(r.media, null, 'no pictures: the address belongs to another family now');
  assert.deepEqual(await store.media.list('fenwick-old'), []);
  // Copying pictures later is refused too, and between families no restore paired, always.
  await assert.rejects(b.copyMediaNow(actor, 'fenwick-old'), /backup\.err\.no_media/);
  await assert.rejects(b.copyMediaNow(actor, 'brackwell'), /backup\.err\.no_media/);
  asUser(OP);
  await assert.rejects(fns.operatorCopyMedia({ data: { into: 'corriston' } }), (e) => status(e) === 400);
  assert.deepEqual(await store.media.list('corriston'), []);
  // Nor is it restored over the family now at that address: making it marked the old backups as a deleted family's, and a backup
  // whose family is not the one there now is refused even if that mark is missing (a deletion that stopped part-way).
  assert.ok((await backupsOf('fenwick')).every((x) => x.gone_at !== null), 'made again: the old backups are a deleted family\'s');
  await assert.rejects(b.restoreBackup(actor, { scope: 'fenwick', name: m.name, mode: 'over', confirm: 'fenwick' }), /backup\.err\.gone/);
  await store.accounts().run('UPDATE family_backup SET gone_at = NULL WHERE family = ? AND name = ?', 'fenwick', m.name);
  await assert.rejects(b.restoreBackup(actor, { scope: 'fenwick', name: m.name, mode: 'over', confirm: 'fenwick' }), /backup\.err\.other_family/);
  assert.equal((await store.tree('fenwick').get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value, 'The Other Fenwicks');
  await store.accounts().run('UPDATE family_backup SET gone_at = ? WHERE family = ? AND name = ?', Date.now(), 'fenwick', m.name);
});

test('a restore copies pictures only from its own source into its own family, and only until none are left', async () => {
  await fam.createFamily(STEWARD, { id: 'galloway', name: 'The Galloways', tagline: '', theme: THEME });
  for (let i = 0; i < 3; i++) await store.media.put('galloway', `photo/${i}.jpg`, Uint8Array.from([i]), 'image/jpeg');
  const m = await b.backUp('galloway', new Date(T - DAY));
  const r = await b.restoreBackup(actor, { scope: 'galloway', name: m.name, mode: 'new', into: 'galloway-two' }, Date.now(), 2);
  assert.deepEqual(r.media, { copied: 2, left: 1 });
  const more = await b.copyMediaNow(actor, 'galloway-two');
  assert.deepEqual(more, { copied: 1, left: 0 });
  assert.equal((await store.media.list('galloway-two')).length, 3);
  // Done: nothing more is copied, even when the source gets new pictures.
  await store.media.put('galloway', 'photo/later.jpg', Uint8Array.from([9]), 'image/jpeg');
  await assert.rejects(b.copyMediaNow(actor, 'galloway-two'), /backup\.err\.no_media/);
  assert.equal((await store.media.list('galloway-two')).length, 3);
});

test('a steward removed since the backup gets none of the family\'s pictures: the records are restored without them, and the result and the log say so', async () => {
  await fam.createFamily(STEWARD, { id: 'harrowby', name: 'The Harrowbys', tagline: '', theme: THEME });
  await store.accounts().batch([acc.upsertMembership(OTHER.id, 'harrowby', 'steward')]);
  await store.media.put('harrowby', 'photo/then.jpg', Uint8Array.from([1]), 'image/jpeg');
  const m = await b.backUp('harrowby', new Date(T - DAY));
  // OTHER is removed as a steward; the family goes on and adds a picture after that.
  await store.accounts().run("DELETE FROM membership WHERE tree = 'harrowby' AND user = ?", OTHER.id);
  await store.media.put('harrowby', 'photo/after.jpg', Uint8Array.from([2]), 'image/jpeg');
  const r = await b.restoreBackup(actor, { scope: 'harrowby', name: m.name, mode: 'new', into: 'harrowby-two' });
  assert.equal(r.stewards, 2);
  assert.equal(r.media, null);
  assert.equal(r.mediaWithheld, true);
  assert.deepEqual(await store.media.list('harrowby-two'), [], 'no picture reaches a steward removed since');
  await assert.rejects(b.copyMediaNow(actor, 'harrowby-two'), /backup\.err\.no_media/);
  const logged = await store.accounts().all<{ detail: string }>("SELECT detail FROM operator_audit WHERE action = 'backup.restore_new' AND family = 'harrowby-two' ORDER BY id");
  assert.equal(JSON.parse(logged.at(-1)!.detail).mediaWithheld, true);
  // With every recorded steward still a steward, the pictures are copied, and a steward added to the restored family later
  // who does not steward the source stops further copying.
  const r2 = await b.restoreBackup(actor, { scope: 'galloway', name: (await backupsOf('galloway'))[0]!.name, mode: 'new', into: 'galloway-three' }, Date.now(), 1);
  assert.equal(r2.mediaWithheld, false);
  assert.equal(r2.media?.copied, 1);
  await store.accounts().batch([acc.upsertMembership(OTHER.id, 'galloway-three', 'steward')]);
  await assert.rejects(b.copyMediaNow(actor, 'galloway-three'), /backup\.err\.no_media/);
  assert.equal((await store.media.list('galloway-three')).length, 1);
});

test('a backup whose stewards have no account any more is not restored into a new family, and the operator gets no way in', async () => {
  await dbs.provisionFamily('glenholm', 'The Glenholms');
  await store.tree('glenholm').run("INSERT INTO person (id, given) VALUES ('g1', 'Tamsin')");
  await store.accounts().batch([acc.upsertMembership(LEFT.id, 'glenholm', 'steward')]);
  const m = await b.backUp('glenholm', new Date(T - DAY));
  assert.deepEqual(JSON.parse((await store.accounts().get<{ stewards: string }>('SELECT stewards FROM family_backup WHERE family = ? AND name = ?', 'glenholm', m.name))!.stewards), [LEFT.id]);
  await store.accounts().batch([q('DELETE FROM membership WHERE user = ?', LEFT.id), q('DELETE FROM user WHERE id = ?', LEFT.id)]);
  asUser(OP);
  await assert.rejects(fns.operatorRestoreBackup({ data: { scope: 'glenholm', name: m.name, mode: 'new', into: 'glenholm-two' } }), (e) => status(e) === 400 && /steward/i.test((e as Error).message));
  assert.ok(!(await store.treeIds()).includes('glenholm-two'));
  assert.equal((await store.accounts().get<{ n: number }>("SELECT (SELECT count(*) FROM membership WHERE tree = 'glenholm-two') + (SELECT count(*) FROM invite WHERE tree = 'glenholm-two') AS n"))?.n, 0);
  // A backup from before stewards were recorded is refused the same way.
  await store.accounts().run('UPDATE family_backup SET stewards = NULL WHERE family = ?', 'alderby');
  const [{ name }] = await backupsOf('alderby');
  await assert.rejects(b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'alderby-unknown' }), /backup\.err\.no_stewards/);
  await store.accounts().run('UPDATE family_backup SET stewards = ? WHERE family = ?', JSON.stringify([STEWARD.id]), 'alderby');
});

test('two restores into one address, or a restore and a new family there, never both write: one wins, the other is refused', async () => {
  const [{ name }] = await backupsOf('alderby');
  const ok = (rs: PromiseSettledResult<unknown>[]) => rs.filter((x) => x.status === 'fulfilled').length;
  const two = await Promise.allSettled([1, 2].map(() => b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'hollin' })));
  assert.equal(ok(two), 1, JSON.stringify(two.map((x) => x.status === 'rejected' ? String(x.reason) : 'ok')));
  assert.match(String((two.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason), /backup\.err\.taken/);
  assert.deepEqual(await people('hollin'), ['p1:Ilse', 'p2:Joran']);

  // A restore and a new family at the same address: one of them, whole.
  const both = await Promise.allSettled([
    b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'ivybridge' }),
    fam.createFamily(OTHER, { id: 'ivybridge', name: 'The Ivybridges', tagline: '', theme: THEME }),
  ]);
  assert.equal(ok(both), 1, JSON.stringify(both.map((x) => x.status === 'rejected' ? String(x.reason) : 'ok')));
  const members = (await store.accounts().all<{ user: string }>("SELECT user FROM membership WHERE tree = 'ivybridge'")).map((x) => x.user);
  const name2 = (await store.tree('ivybridge').get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value;
  if (both[0].status === 'fulfilled') {
    assert.deepEqual(members, [STEWARD.id]);
    assert.deepEqual(await people('ivybridge'), ['p1:Ilse', 'p2:Joran']);
    assert.equal(name2, 'The Alderbys');
  } else {
    assert.deepEqual(members, [OTHER.id]);
    assert.deepEqual(await people('ivybridge'), []);
    assert.equal(name2, 'The Ivybridges');
  }

  // While a restore holds an address, no family is made there; while a family is being made, no restore writes there.
  await store.accounts().run("INSERT INTO family_claim (tree, what, at, state) VALUES ('juniper', 'restore', ?, 'restoring')", Date.now());
  await assert.rejects(fam.createFamily(OTHER, { id: 'juniper', name: 'The Junipers', tagline: '', theme: THEME }));
  assert.ok(!(await store.treeIds()).includes('juniper'));
  await store.accounts().run("INSERT INTO family_claim (tree, what, at) VALUES ('kestrel', 'create', ?)", Date.now());
  await assert.rejects(b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'kestrel' }), /backup\.err\.taken/);
  assert.ok(!(await store.treeIds()).includes('kestrel'));
  // A claim left by a family that was never finished does not hold the address for ever.
  await store.accounts().run("UPDATE family_claim SET at = ? WHERE tree = 'kestrel'", Date.now() - DAY);
  assert.equal((await b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'kestrel' })).into, 'kestrel');
  // Nor does a restore that stopped: its claim lapses after a while, and the console lists it and lets the operator clear it.
  await store.accounts().run("INSERT INTO family_claim (tree, what, at, by, source, state) VALUES ('larkspur', 'restore', ?, ?, 'alderby', 'restoring')", Date.now(), OP.id);
  assert.deepEqual((await b.backupOverview()).stopped.map((x) => x.into), ['juniper', 'larkspur']);
  await assert.rejects(b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'larkspur' }), /backup\.err\.taken/);
  await b.clearRestoreClaim(actor, 'larkspur');
  assert.equal((await b.restoreBackup(actor, { scope: 'alderby', name: name!, mode: 'new', into: 'larkspur' })).into, 'larkspur');
  await assert.rejects(b.clearRestoreClaim(actor, 'larkspur'), /backup\.err\.no_claim/, 'a finished restore is not cleared');
  assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM operator_audit WHERE action = 'backup.clear_claim' AND family = 'larkspur'"))?.n, 1);
  await store.accounts().run("UPDATE family_claim SET at = ? WHERE tree = 'juniper'", Date.now() - b.RESTORE_CLAIM_MS - 1000);
  assert.equal(await fam.createFamily(OTHER, { id: 'juniper', name: 'The Junipers', tagline: '', theme: THEME }), 'juniper');

  // The driver itself does not write over a family unless asked to restore over it.
  await assert.rejects(store.backups.restore('alderby', name!, 'brackwell'), /holds a family/);
  assert.equal((await store.tree('brackwell').get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value, 'The Brackwells');
});

test('a backup\'s unencrypted copy is made in the data folder, never beside the backups, and one left by a crash is removed', async () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'kindred-backup-dir-'));
  process.env.KINDRED_BACKUP_DIR = elsewhere;
  const seen: string[] = [];
  const w = watch(elsewhere, { recursive: true }, (_e, f) => { if (f) seen.push(String(f)); });
  let made: string;
  try {
    made = (await b.backUp('corriston', new Date(T - 5 * DAY))).name;
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    w.close();
    delete process.env.KINDRED_BACKUP_DIR;
  }
  assert.ok(seen.length > 0, 'the watcher saw the backup');
  // (macOS also reports the watched folder itself.)
  assert.deepEqual(seen.filter((f) => f !== basename(elsewhere) && !/(^|\/)(corriston|\d{8}T\d{9}Z\.(kbak|json)(\.tmp-[0-9a-f-]+)?)$/.test(f)), [], 'only sealed files');
  const tmp = join(dir, '.backup-tmp');
  assert.equal(statSync(tmp).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(tmp), [], 'nothing left behind');
  await store.accounts().run('DELETE FROM family_backup WHERE family = ? AND name = ?', 'corriston', made);
  rmSync(elsewhere, { recursive: true, force: true });
  // What a crash left is removed when the store starts.
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'left.db'), 'plain');
  mkdirSync(join(dir, 'backups', 'corriston'), { recursive: true });
  writeFileSync(join(dir, 'backups', 'corriston', '.20261101T030000000Z-1.db'), 'plain');
  nodeBackups.clearBackupTemps(dir);
  assert.ok(!existsSync(join(tmp, 'left.db')));
  assert.ok(!existsSync(join(dir, 'backups', 'corriston', '.20261101T030000000Z-1.db')));
});

test('retention counts back from today: backups that stopped long ago leave only the newest, and none older than 12 months', () => {
  const now = Date.parse('2026-11-12T06:00:00Z');
  // Daily backups for 200 days that stopped 400 days ago: only the newest stays.
  const old = Array.from({ length: 200 }, (_, i) => now - 400 * DAY - i * DAY);
  assert.deepEqual([...keepIndexes(old, DEFAULT_KEEP, now)], [0]);
  // Stopped 20 days ago: no daily one but the newest, a weekly one within 4 weeks, monthly ones within 12 months.
  const recent = Array.from({ length: 400 }, (_, i) => now - 20 * DAY - i * DAY);
  const kept = [...keepIndexes(recent, DEFAULT_KEEP, now)].map((i) => recent[i]!);
  assert.ok(kept.includes(recent[0]!), 'the newest');
  assert.ok(kept.every((t) => t === recent[0] || t > Date.parse('2025-11-12T06:00:00Z')), 'nothing older than 12 months');
  assert.ok(kept.filter((t) => t > now - 28 * DAY).length <= 2, 'the weekly ones are within 4 weeks');
  assert.ok(kept.length <= 1 + 2 + 12, String(kept.length));
});
