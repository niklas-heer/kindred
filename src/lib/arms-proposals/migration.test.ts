// node --test src/lib/arms-proposals/migration.test.ts — migration 0038: the arms proposal table, the columns arms votes
// add to vote and vote_option, and that votes made before it survive. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-arms-migration-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { openSqlite, closeAccounts } = (await vite.ssrLoadModule('/src/lib/store/node.ts')) as typeof import('../store/node.ts');

type Db = ReturnType<typeof openSqlite>;
const count = (f: Db, sql: string) => (f.prepare(sql).get() as { n: number }).n;
const columns = (f: Db, table: string) => (f.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const house = (f: Db, id: string) => f.exec(`INSERT INTO house (id, name, arms) VALUES ('${id}', 'House ${id}', '{}')`);

test('the proposal table, its index and the new columns exist; the migration is plain SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/tree/0038_arms_proposals.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK)\b|^\s*BEGIN\s*;/im);
  const f = openSqlite(join(dir, 'a.db'), 'tree', { create: true });
  for (const c of ['id', 'house', 'account', 'author_name', 'author_person', 'name', 'note', 'arms', 'status', 'reason', 'decided_by', 'decided_by_name', 'decided_at', 'created_at'])
    assert.ok(columns(f, 'arms_proposal').includes(c), c);
  assert.ok(columns(f, 'vote_option').includes('proposal'));
  assert.ok(columns(f, 'vote_option').includes('arms'));
  assert.ok(columns(f, 'vote').includes('settled_at'));
  const idx = (f.prepare("PRAGMA index_info(arms_proposal_house)").all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(idx, ['house', 'status']);
  assert.throws(() => f.exec("INSERT INTO arms_proposal (id, house, account, author_name, name, arms, status, created_at) VALUES ('x', 'h', 'a', 'Ada', 'N', '{}', 'bogus', 't')"), /CHECK constraint/i);
  f.close();
});

test('deleting a house deletes its proposals only', () => {
  const f = openSqlite(join(dir, 'b.db'), 'tree', { create: true });
  house(f, 'h1');
  house(f, 'h2');
  f.exec(`
    INSERT INTO arms_proposal (id, house, account, author_name, name, arms, status, created_at) VALUES
      ('p1', 'h1', 'acc-ada', 'Ada', 'Gold lion', '{}', 'waiting', '2026-11-15T09:00:00Z'),
      ('p2', 'h2', 'acc-bo', 'Bo', 'Blue star', '{}', 'voting', '2026-11-15T09:00:00Z');
  `);
  f.exec("DELETE FROM house WHERE id = 'h1'");
  assert.equal(count(f, "SELECT count(*) AS n FROM arms_proposal WHERE id = 'p1'"), 0);
  assert.equal(count(f, "SELECT count(*) AS n FROM arms_proposal WHERE id = 'p2'"), 1);
  f.close();
});

test('votes made before the migration survive it with their options', () => {
  const folder = join(process.cwd(), 'migrations/tree');
  const files = readdirSync(folder).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
  const at = files.findIndex((n) => n.startsWith('0038_'));
  assert.ok(at > 0, 'migration 0038 exists');
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const d = new DatabaseSync(join(dir, 'old.db'));
    for (const n of files.slice(0, at)) d.exec(readFileSync(join(folder, n), 'utf8'));
    d.exec(`
      INSERT INTO vote (id, account, author_name, question, kind, closes_at, created_at) VALUES ('v1', 'acc-ada', 'Ada', 'Where to?', 'single', '2026-12-01T00:00:00Z', '2026-11-15T09:00:00Z');
      INSERT INTO vote_option (id, vote, ord, label, added_by_account, added_by_name, created_at) VALUES ('o1', 'v1', 0, 'Beach', 'acc-ada', 'Ada', '2026-11-15T09:00:00Z');
    `);
    d.exec(readFileSync(join(folder, files[at]!), 'utf8'));
    const row = d.prepare("SELECT v.question, v.settled_at, o.label, o.proposal, o.arms FROM vote v JOIN vote_option o ON o.vote = v.id WHERE v.id = 'v1'").get() as Record<string, unknown>;
    assert.deepEqual({ ...row }, { question: 'Where to?', settled_at: null, label: 'Beach', proposal: null, arms: null });
    d.close();
  });
});

test.after(async () => { closeAccounts(); await vite.close(); });
