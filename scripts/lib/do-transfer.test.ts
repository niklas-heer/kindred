// node --test scripts/lib/do-transfer.test.ts — the move into a Durable Object, decided without a Worker: the tables go in
// an order their foreign keys allow, every row of a family lands in an empty migrated database with the same counts (the
// seeded `ancestry_rev` replaced rather than clashing), and the statements are cut into requests in order.
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
  const statements: string[] = [];
  const sent: Record<string, number> = {};
  for (const t of T.tableOrder(tables, keysOf(src, tables))) {
    const rows = src.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
    statements.push(...T.upsertSql(t, columnsOf(src, t), rows));
    sent[t] = rows.length;
  }
  const target = openSqlite(join(dir, 'target.db'), 'tree', { create: true });
  for (const part of T.chunks(statements, 3)) {
    target.exec('BEGIN');
    for (const s of part) target.prepare(s).run();
    target.exec('COMMIT');
  }
  for (const [t, n] of Object.entries(sent)) assert.equal((target.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n, n, t);
  // The seeded row takes the source's number instead of clashing; parent links written after it bump it on, never back.
  assert.ok((target.prepare('SELECT rev FROM ancestry_rev').get() as { rev: number }).rev >= 7, 'the seeded row takes the source value');
  assert.equal((target.prepare("SELECT visibility FROM person_field WHERE id = 'f1'").get() as { visibility: string }).visibility, 'personal', 'a personal item moves within one install');
});

test('statements are cut into requests by count and by size, in order, never splitting one', () => {
  const s = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10), 'd'.repeat(25)];
  assert.deepEqual(T.chunks(s, 2, 1000), [[s[0], s[1]], [s[2], s[3]]]);
  assert.deepEqual(T.chunks(s, 10, 20), [[s[0], s[1]], [s[2]], [s[3]]]);
  assert.deepEqual(T.chunks([], 10, 20), []);
});
