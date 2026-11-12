// node --test scripts/lib/do-transfer.test.ts — the import into a Durable Object, decided without a Worker: the tables go in
// an order their foreign keys allow, every row of a family travels as data and lands in an empty migrated database with the
// same counts through the one statement the target builds from its own schema (the seeded `ancestry_rev` replaced rather
// than clashing), and the rows are cut into requests in order. Names that are not the schema's are refused.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-do-transfer-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
const { openSqlite } = await import('../../src/lib/store/node.ts');
const T = await import('./do-transfer.ts');
const X = await import('../../src/lib/store/transfer.ts');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const tablesOf = (d: DatabaseSync) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name).filter((t) => !T.NEVER_SENT.test(t));
const keysOf = (d: DatabaseSync, tables: string[]) => tables.flatMap((t) => (d.prepare(`PRAGMA foreign_key_list("${t}")`).all() as { table: string }[]).map((r) => ({ table: t, parent: r.table })));
const columnsOf = (d: DatabaseSync, t: string) => (d.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);

test('a table goes after every table it refers to; itself and strangers do not count', () => {
  const order = T.tableOrder(['story', 'person', 'parent', 'house'], [
    { table: 'person', parent: 'house' }, { table: 'parent', parent: 'person' }, { table: 'story', parent: 'person' }, { table: 'person', parent: 'person' }, { table: 'story', parent: 'elsewhere' },
  ]);
  assert.deepEqual(order, ['house', 'person', 'parent', 'story']);
});

test('every table of a family, in that order, lands in an empty migrated database with the same rows', () => {
  const src = openSqlite(join(dir, 'source.db'), 'tree', { create: true });
  src.exec(`INSERT INTO meta (key, value) VALUES ('id', 'source'), ('name', 'Source');
    INSERT INTO house (id, name, arms) VALUES ('h1', 'Ashby', '{}');
    INSERT INTO person (id, given, house) VALUES ('a', 'Ada', 'h1'), ('b', 'Ben', 'h1');
    INSERT INTO parent (child, parent) VALUES ('b', 'a');
    INSERT INTO person_field (id, person, type, label, value, visibility, owner) VALUES ('f1', 'a', 'notes', '', '{"text":"mine; only"}', 'personal', 'acct-1');`);
  src.prepare('UPDATE ancestry_rev SET rev = 7').run();
  const tables = tablesOf(src);
  const target = openSqlite(join(dir, 'target.db'), 'tree', { create: true });
  const schema = new Map(tablesOf(target).map((t) => [t, columnsOf(target, t)]));
  const sent: Record<string, number> = {};
  for (const t of T.tableOrder(tables, keysOf(src, tables))) {
    const got = T.tableRows(src, t, columnsOf(src, t));
    sent[t] = got.count;
    for (const b of got.batches) {
      // As JSON, the way it travels.
      const back = JSON.parse(JSON.stringify(b)) as typeof b;
      const statement = target.prepare(X.importStatement(schema, back.table, back.columns));
      target.exec('BEGIN');
      for (const r of back.rows) statement.run(...r.map(X.fromCell));
      target.exec('COMMIT');
    }
  }
  for (const [t, n] of Object.entries(sent)) assert.equal((target.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n, n, t);
  // The seeded row takes the source's number instead of clashing; parent links written after it bump it on, never back.
  assert.ok((target.prepare('SELECT rev FROM ancestry_rev').get() as { rev: number }).rev >= 7, 'the seeded row takes the source value');
  assert.equal((target.prepare("SELECT visibility FROM person_field WHERE id = 'f1'").get() as { visibility: string }).visibility, 'personal', 'a personal item moves within one install');
  assert.equal(T.schemaOf(target), T.schemaOf(src));
});

test('only the schema’s own tables and columns make a statement; values come back as they went', () => {
  const schema = new Map([['person', ['id', 'given']], ['d1_migrations', ['name']]]);
  assert.equal(X.importStatement(schema, 'person', ['id', 'given']), 'INSERT INTO "person" ("id", "given") VALUES (?, ?)');
  assert.throws(() => X.importStatement(schema, 'd1_migrations', ['name']), /no table/);
  assert.throws(() => X.importStatement(schema, 'meta', ['key']), /no table/);
  assert.throws(() => X.importStatement(schema, 'person', ['id', 'given" FROM meta --']), /no column/);
  assert.throws(() => X.importStatement(schema, 'person', ['id', 'id']), /named twice/);
  assert.throws(() => X.importStatement(schema, 'person', []), /No columns/);
  const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 251);
  for (const v of ['text', '', 0, -1.5, null]) assert.deepEqual(X.fromCell(JSON.parse(JSON.stringify(X.toCell(v)))), v);
  assert.deepEqual([...(X.fromCell(JSON.parse(JSON.stringify(X.toCell(bytes)))) as Uint8Array)], [...bytes]);
  for (const bad of [{ sql: 'SELECT 1' }, { b64: 'AA', more: 1 }, true, [1], Infinity]) assert.throws(() => X.fromCell(bad), /must be text, a number/);
});

test('rows are cut into requests by count and by size, in order, never splitting one', () => {
  const rows = [['a'.repeat(10)], ['b'.repeat(10)], ['c'.repeat(10)], ['d'.repeat(25)]];
  assert.deepEqual(X.rowBatches('t', ['c'], rows, 2, 1000).map((b) => b.rows), [[rows[0], rows[1]], [rows[2], rows[3]]]);
  assert.deepEqual(X.rowBatches('t', ['c'], rows, 10, 30).map((b) => b.rows), [[rows[0], rows[1]], [rows[2]], [rows[3]]]);
  assert.deepEqual(X.rowBatches('t', ['c'], [], 10, 20), []);
});
