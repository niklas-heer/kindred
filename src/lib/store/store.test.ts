// node --test src/lib/store/store.test.ts — the Node driver, migrations, and changes without
// interactive transactions: retry keys, guards and races. Runs on a private data folder.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-store-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

// The schema as files had it before migrations: an op table without user/fingerprint, photos as BLOBs.
const LEGACY = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE house (id TEXT PRIMARY KEY, name TEXT NOT NULL, motto TEXT, arms TEXT NOT NULL, founder TEXT);
CREATE TABLE person (id TEXT PRIMARY KEY, given TEXT NOT NULL, surname TEXT, house TEXT REFERENCES house(id), sex TEXT, born TEXT, born_place TEXT,
  died TEXT, died_place TEXT, living INTEGER NOT NULL DEFAULT 0, epithet TEXT, title TEXT, occupation TEXT, bio TEXT, traits TEXT, look TEXT,
  nickname TEXT, favourite TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE parent (child TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE, parent TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'biological', confidence TEXT NOT NULL DEFAULT 'certain', PRIMARY KEY (child, parent));
CREATE TABLE photo (person TEXT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BLOB NOT NULL, at TEXT NOT NULL);
CREATE TABLE op (key TEXT PRIMARY KEY, fn TEXT NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL);
INSERT INTO meta VALUES ('id', 'old'), ('name', 'Old'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
INSERT INTO person (id, given, born, living) VALUES ('ada', 'Ada', '1950', 1), ('ben', 'Ben', '1920', 0), ('cy', 'Cy', '1922', 0), ('dot', 'Dot', '1921', 0);
INSERT INTO photo VALUES ('ada', 'image/png', X'89504E47', '2024-01-01T00:00:00Z');
`;
{
  const d = new DatabaseSync(join(dir, 'old.db'));
  d.exec(LEGACY);
  d.close();
}

const s = await import('../db.server.ts');
const { store, q, guard } = await import('./index.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a file from before migrations is brought up to date, backed up, and its photos moved out', async () => {
  const d = s.db('old');
  const applied = (await d.all<{ name: string }>('SELECT name FROM d1_migrations ORDER BY id')).map((r) => r.name);
  assert.deepEqual(applied, readdirSync('migrations/tree').filter((f) => f.endsWith('.sql')).sort());
  const cols = (await d.all<{ name: string }>('PRAGMA table_info(op)')).map((c) => c.name);
  assert.ok(cols.includes('user') && cols.includes('fingerprint'));
  const p = (await s.photo('old', 'ada'))!;
  assert.equal(p.data, null);
  assert.match(p.key!, /^photo\/[0-9a-f-]{36}\.png$/);
  assert.deepEqual([...readFileSync(join(dir, 'media', 'old', p.key!))], [0x89, 0x50, 0x4e, 0x47]);
  const got = (await store.media.get('old', p.key!))!;
  assert.equal(got.size, 4);
  assert.ok(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('old-before-0001_initial')));
  assert.deepEqual(await store.treeIds(), ['old']);
  assert.equal((await s.listTrees())[0].people, 4);
});

test('a retry key replays its result for the same person and change, and refuses anything else', async () => {
  const op = { key: 'key-0001', user: 'u1', payload: { given: 'Eve' } };
  const add = (o: typeof op) =>
    s.once('old', o, 'addPerson', () => ({ history: [], writes: [q('INSERT INTO person (id, given) VALUES (?, ?)', `eve_${crypto.randomUUID().slice(0, 4)}`, 'Eve')], result: 'done' }));
  assert.equal(await add(op), 'done');
  assert.equal(await add(op), 'done');
  const d = s.db('old');
  assert.equal((await d.get<{ n: number }>("SELECT count(*) AS n FROM person WHERE given = 'Eve'"))!.n, 1);
  await assert.rejects(add({ ...op, user: 'u2' }), /already sent as something else/);
  await assert.rejects(add({ ...op, payload: { given: 'Eva' } }), /already sent as something else/);
});

test('two copies of one change racing write once and both get the same result', async () => {
  const op = { key: 'key-race-01', user: 'u1', payload: { kind: 'note' } };
  const run = () =>
    s.once('old', op, 'addRace', async (d) => {
      await d.get('SELECT 1'); // both copies read before either writes
      return { history: [], writes: [q("INSERT INTO person (id, given) VALUES ('race-1', 'Race')")], result: (r) => r[0].lastRowId, resultSql: 'last_insert_rowid()' };
    });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a, b);
  assert.equal(typeof a, 'number');
  assert.equal((await s.db('old').get<{ n: number }>("SELECT count(*) AS n FROM person WHERE id = 'race-1'"))!.n, 1);
  assert.equal(await run(), a);
});

test('a guard sends a change back to its checks when the family changed in between', async () => {
  // Ada has one parent (Ben). Two "add a parent" changes race: both read one parent and pass the check.
  await s.db('old').run("INSERT INTO parent (child, parent) VALUES ('ada', 'ben')");
  const addParent = (parent: string) =>
    s.once('old', undefined, 'addParent', async (d) => {
      const had = (await d.all<{ parent: string }>("SELECT parent FROM parent WHERE child = 'ada'")).map((r) => r.parent);
      if (had.length >= 2) throw new Error('They already have two parents.');
      await new Promise((r) => setTimeout(r, 5));
      return { history: [], writes: [s.sameParents('ada', had), q("INSERT INTO parent (child, parent) VALUES ('ada', ?)", parent)], result: parent };
    });
  const results = await Promise.allSettled([addParent('cy'), addParent('dot')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.match(refused.reason.message, /two parents/);
  assert.equal((await s.db('old').get<{ n: number }>("SELECT count(*) AS n FROM parent WHERE child = 'ada'"))!.n, 2);
});

test('a batch is all or nothing', async () => {
  const d = s.db('old');
  await assert.rejects(d.batch([q("UPDATE person SET nickname = 'x' WHERE id = 'ben'"), guard('0')]), /kindred:guard/);
  assert.equal((await d.get<{ nickname: string | null }>("SELECT nickname FROM person WHERE id = 'ben'"))!.nickname, null);
});

test('places: a pin that exists is kept unless moved, in order', async () => {
  const kept = await s.upsertPlaces('old', [
    { name: 'Bonn', lat: 50.7, lng: 7.1 },
    { name: 'Bonn', lat: 1, lng: 1 },
    { name: 'Köln', lat: 50.9, lng: 6.9, move: true },
  ]);
  assert.deepEqual(kept, ['Bonn']);
  assert.deepEqual(await s.upsertPlaces('old', [{ name: 'Bonn', lat: 2, lng: 2 }, { name: 'Köln', lat: 3, lng: 3, move: true }]), ['Bonn']);
  assert.equal((await s.db('old').get<{ lat: number }>("SELECT lat FROM place WHERE name = 'Köln'"))!.lat, 3);
});

test('new accounts databases get the accounts migrations', async () => {
  const a = store.accounts();
  assert.ok(existsSync(join(dir, 'accounts.db')));
  const names = (await a.all<{ name: string }>('SELECT name FROM d1_migrations')).map((r) => r.name);
  assert.deepEqual(names, readdirSync('migrations/accounts').filter((f) => f.endsWith('.sql')).sort());
  (await import('./node.ts')).closeAccounts();
});

test('closeDatabases closes the families and the accounts, folding in their logs, and the next use opens them again', async () => {
  const { closeDatabases } = await import('./node.ts');
  const count = () => store.tree('old').get<{ n: number }>('SELECT COUNT(*) AS n FROM person').then((r) => r!.n);
  const before = await count();
  await store.tree('old').run("INSERT OR REPLACE INTO meta (key, value) VALUES ('closed-test', 'written just before the close')");
  await store.accounts().get('SELECT 1 AS one');
  assert.ok(existsSync(join(dir, 'old.db-wal')));
  assert.ok(existsSync(join(dir, 'accounts.db-wal')));

  closeDatabases();
  assert.equal(existsSync(join(dir, 'old.db-wal')), false);
  assert.equal(existsSync(join(dir, 'accounts.db-wal')), false);

  assert.equal(await count(), before);
  const kept = await store.tree('old').get<{ value: string }>("SELECT value FROM meta WHERE key = 'closed-test'");
  assert.equal(kept?.value, 'written just before the close');
  (await import('./node.ts')).closeAccounts();
});

test('the place gazetteer is optional: without its file there is none, and the place search still works', () => {
  assert.equal(existsSync(join(dir, 'gazetteer.db')), false);
  assert.equal(store.gazetteer(), null);
});

test('the server secret is made once, kept in the data folder with mode 600, and read back', () => {
  const env = process.env.KINDRED_SECRET;
  delete process.env.KINDRED_SECRET;
  try {
    const first = store.secret();
    assert.match(first, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(statSync(join(dir, 'secret')).mode & 0o777, 0o600);
    assert.equal(store.secret(), first);
    process.env.KINDRED_SECRET = ' from-the-environment ';
    assert.equal(store.secret(), 'from-the-environment');
  } finally {
    if (env === undefined) delete process.env.KINDRED_SECRET;
    else process.env.KINDRED_SECRET = env;
  }
});
