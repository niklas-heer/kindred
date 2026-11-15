// node --test src/lib/suggestions/migration.test.ts — migration 0039: the suggestion tables, source_file, the history
// column, their cascades, and that history rows made before it survive. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-suggest-migration-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { openSqlite, closeAccounts } = (await vite.ssrLoadModule('/src/lib/store/node.ts')) as typeof import('../store/node.ts');

type Db = ReturnType<typeof openSqlite>;
const count = (f: Db, sql: string) => (f.prepare(sql).get() as { n: number }).n;
const columns = (f: Db, table: string) => (f.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const indexColumns = (f: Db, index: string) => (f.prepare(`PRAGMA index_info(${index})`).all() as { name: string }[]).map((c) => c.name);
const person = (f: Db, id: string) => f.exec(`INSERT INTO person (id, given) VALUES ('${id}', '${id}')`);
const suggestion = (f: Db, id: string, who: string | null) =>
  f.exec(`INSERT INTO suggestion (id, kind, person, payload, status, author_name, created_at) VALUES ('${id}', 'details', ${who ? `'${who}'` : 'NULL'}, '{}', 'waiting', 'Ada', '2026-11-15T09:00:00Z')`);

test('the tables, columns and indexes exist; the migration is plain SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/tree/0039_suggestions.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK)\b|^\s*BEGIN\s*;/im);
  const f = openSqlite(join(dir, 'a.db'), 'tree', { create: true });
  for (const c of ['id', 'kind', 'person', 'payload', 'basis', 'note', 'status', 'adjusted', 'reason', 'account', 'guest_key', 'author_name', 'author_person', 'link', 'net', 'decided_by', 'decided_by_name', 'decided_at', 'applied', 'created_at'])
    assert.ok(columns(f, 'suggestion').includes(c), c);
  for (const c of ['id', 'suggestion', 'key', 'mime', 'size', 'name', 'created_at']) assert.ok(columns(f, 'suggestion_file').includes(c), c);
  for (const c of ['source', 'media_key', 'mime', 'name', 'ord', 'added_at']) assert.ok(columns(f, 'source_file').includes(c), c);
  assert.ok(columns(f, 'history').includes('suggestion'));
  assert.deepEqual(indexColumns(f, 'suggestion_status'), ['status', 'created_at']);
  assert.deepEqual(indexColumns(f, 'suggestion_person'), ['person', 'status']);
  assert.deepEqual(indexColumns(f, 'suggestion_guest'), ['guest_key']);
  assert.throws(() => f.exec("INSERT INTO suggestion (id, kind, payload, status, author_name, created_at) VALUES ('y', 'bogus', '{}', 'waiting', 'Ada', 't')"), /CHECK constraint/i);
  assert.throws(() => f.exec("INSERT INTO suggestion (id, kind, payload, status, author_name, created_at) VALUES ('z', 'details', '{}', 'bogus', 'Ada', 't')"), /CHECK constraint/i);
  f.close();
});

test('deleting a person deletes their suggestions and those files; deleting a suggestion deletes its files', () => {
  const f = openSqlite(join(dir, 'b.db'), 'tree', { create: true });
  person(f, 'ada');
  person(f, 'bo');
  suggestion(f, 's1', 'ada');
  suggestion(f, 's2', 'bo');
  suggestion(f, 's3', null);
  f.exec(`INSERT INTO suggestion_file (id, suggestion, key, mime, size, name, created_at) VALUES
    ('f1', 's1', 'suggestion/f1.jpg', 'image/jpeg', 10, 'a.jpg', 't'), ('f2', 's2', 'suggestion/f2.jpg', 'image/jpeg', 10, 'b.jpg', 't'), ('f3', 's3', 'suggestion/f3.jpg', 'image/jpeg', 10, 'c.jpg', 't')`);
  f.exec("DELETE FROM person WHERE id = 'ada'");
  assert.equal(count(f, "SELECT count(*) AS n FROM suggestion WHERE id = 's1'"), 0);
  assert.equal(count(f, "SELECT count(*) AS n FROM suggestion_file WHERE id = 'f1'"), 0);
  assert.equal(count(f, 'SELECT count(*) AS n FROM suggestion'), 2);
  f.exec("DELETE FROM suggestion WHERE id = 's2'");
  assert.equal(count(f, "SELECT count(*) AS n FROM suggestion_file WHERE id = 'f2'"), 0);
  assert.equal(count(f, "SELECT count(*) AS n FROM suggestion_file WHERE id = 'f3'"), 1);
  f.close();
});

test('deleting a source deletes its files only', () => {
  const f = openSqlite(join(dir, 'c.db'), 'tree', { create: true });
  f.exec(`INSERT INTO source (id, title, created_by, created_by_name, created_at, updated_at) VALUES ('so1', 'Parish book', 'u1', 'Ada', 't', 't'), ('so2', 'Letter', 'u1', 'Ada', 't', 't');
    INSERT INTO source_file (source, media_key, mime, name, ord, added_at) VALUES ('so1', 'source/a.jpg', 'image/jpeg', 'a.jpg', 0, 't'), ('so2', 'source/b.jpg', 'image/jpeg', 'b.jpg', 0, 't')`);
  f.exec("DELETE FROM source WHERE id = 'so1'");
  assert.equal(count(f, "SELECT count(*) AS n FROM source_file WHERE source = 'so1'"), 0);
  assert.equal(count(f, "SELECT count(*) AS n FROM source_file WHERE source = 'so2'"), 1);
  f.close();
});

test('history rows made before the migration survive it with suggestion NULL', () => {
  const folder = join(process.cwd(), 'migrations/tree');
  const files = readdirSync(folder).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
  const at = files.findIndex((n) => n.startsWith('0039_'));
  assert.ok(at > 0, 'migration 0039 exists');
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const d = new DatabaseSync(join(dir, 'old.db'));
    for (const n of files.slice(0, at)) d.exec(readFileSync(join(folder, n), 'utf8'));
    d.exec("INSERT INTO history (at, name, kind, record, action) VALUES ('2026-11-15T09:00:00Z', 'Ada', 'person', 'ada', 'added')");
    d.exec(readFileSync(join(folder, files[at]!), 'utf8'));
    const row = d.prepare("SELECT name, record, suggestion FROM history WHERE record = 'ada'").get() as Record<string, unknown>;
    assert.deepEqual({ ...row }, { name: 'Ada', record: 'ada', suggestion: null });
    d.close();
  });
});

test('the limits are the agreed values', async () => {
  const t = (await vite.ssrLoadModule('/src/lib/suggestions/types.ts')) as typeof import('./types.ts');
  assert.deepEqual(
    [t.MAX_FILES, t.MAX_FILE_BYTES, t.MAX_NOTE, t.MAX_REASON, t.GUEST_WAITING_PER_NETWORK, t.GUEST_WAITING_PER_LINK, t.MEMBER_WAITING, t.PENDING_BYTES, t.EXPIRY_DAYS],
    [5, 10485760, 1000, 300, 20, 100, 50, 209715200, 90],
  );
  assert.deepEqual([...t.FILE_TYPES], ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
});

test.after(async () => { closeAccounts(); await vite.close(); });
