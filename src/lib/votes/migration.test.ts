// node --test src/lib/votes/migration.test.ts — migration 0037: the vote tables exist, a vote takes its options, voters,
// ballots, reactions and comments with it, and the reactions and comments made again keep their rows. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-votes-migration-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { openSqlite, closeAccounts } = (await vite.ssrLoadModule('/src/lib/store/node.ts')) as typeof import('../store/node.ts');

const names = (f: ReturnType<typeof openSqlite>, type: string) => (f.prepare(`SELECT name FROM sqlite_master WHERE type = '${type}' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
const count = (f: ReturnType<typeof openSqlite>, sql: string) => (f.prepare(sql).get() as { n: number }).n;

test('the vote tables exist and the migration is plain SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/tree/0037_votes.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK)\b|^\s*BEGIN\s*;/im);
  const f = openSqlite(join(dir, 'a.db'), 'tree', { create: true });
  const tables = names(f, 'table');
  for (const t of ['vote', 'vote_option', 'vote_voter', 'ballot', 'vote_reminded']) assert.ok(tables.includes(t), t);
  assert.ok(names(f, 'index').includes('vote_closes'));
  for (const t of ['story', 'media', 'post', 'vote']) assert.ok(names(f, 'trigger').includes(`${t}_responses_go`), t);
  f.close();
});

test('deleting a vote takes its options, voters, ballots, reactions and comments; other kinds keep theirs', () => {
  const f = openSqlite(join(dir, 'b.db'), 'tree', { create: true });
  f.exec(`
    INSERT INTO post (id, account, author_name, body, created_at) VALUES ('p1', 'acc-ada', 'Ada', 'Hello', '2026-11-01T10:00:00Z');
    INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES ('post', 'p1', 'acc-bo', '❤️', '2026-11-01T10:01:00Z');
    INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('c0', 'post', 'p1', 'acc-bo', 'Bo', 'Nice', '2026-11-01T10:02:00Z');
    INSERT INTO vote (id, account, author_name, question, kind, closes_at, created_at) VALUES ('v1', 'acc-ada', 'Ada', 'Where to?', 'single', '2026-12-01T00:00:00Z', '2026-11-15T09:00:00Z');
    INSERT INTO vote_option (id, vote, ord, label, added_by_account, added_by_name, created_at) VALUES ('o1', 'v1', 0, 'Beach', 'acc-ada', 'Ada', '2026-11-15T09:00:00Z');
    INSERT INTO vote_voter (id, vote, account, name) VALUES ('vv1', 'v1', 'acc-carl', 'Carl');
    INSERT INTO ballot (vote, voter, choices) VALUES ('v1', 'vv1', '["o1"]');
    INSERT INTO vote_reminded (vote, account) VALUES ('v1', 'acc-carl');
    INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES ('vote', 'v1', 'acc-carl', '👍', '2026-11-15T09:05:00Z');
    INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('c1', 'vote', 'v1', 'acc-carl', 'Carl', 'Beach!', '2026-11-15T09:06:00Z');
  `);
  f.exec("DELETE FROM vote WHERE id = 'v1'");
  for (const t of ['vote', 'vote_option', 'vote_voter', 'ballot']) assert.equal(count(f, `SELECT count(*) AS n FROM ${t}`), 0, t);
  assert.equal(count(f, "SELECT count(*) AS n FROM reaction WHERE target_kind = 'vote'"), 0);
  assert.equal(count(f, "SELECT count(*) AS n FROM comment WHERE target_kind = 'vote'"), 0);
  assert.equal(count(f, "SELECT count(*) AS n FROM reaction WHERE target_kind = 'post'"), 1);
  assert.equal(count(f, "SELECT count(*) AS n FROM comment WHERE target_kind = 'post'"), 1);
  f.close();
});

test('reactions and comments of the older kinds survive the migration with their rows', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readdirSync } = await import('node:fs');
  const folder = join(process.cwd(), 'migrations/tree');
  const files = readdirSync(folder).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
  const last = files.findIndex((n) => n.startsWith('0037_'));
  assert.ok(last > 0, 'migration 0037 exists');
  const d = new DatabaseSync(join(dir, 'old.db'));
  for (const n of files.slice(0, last)) d.exec(readFileSync(join(folder, n), 'utf8'));
  d.exec(`
    INSERT INTO post (id, account, author_name, body, created_at) VALUES ('p1', 'acc-ada', 'Ada', 'Hello', '2026-11-01T10:00:00Z');
    INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES ('post', 'p1', 'acc-bo', '❤️', '2026-11-01T10:01:00Z'), ('event', 'b:ada:1990', 'acc-bo', '🎉', '2026-11-01T10:01:00Z');
    INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('c0', 'post', 'p1', 'acc-bo', 'Bo', 'Nice', '2026-11-01T10:02:00Z');
  `);
  d.exec(readFileSync(join(folder, files[last]!), 'utf8'));
  const n = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  assert.equal(n('SELECT count(*) AS n FROM reaction'), 2);
  assert.equal(n("SELECT count(*) AS n FROM comment WHERE id = 'c0' AND body = 'Nice'"), 1);
  const indexes = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'reaction_%' OR name LIKE 'comment_%'").all() as { name: string }[]).map((r) => r.name);
  for (const i of ['reaction_created', 'reaction_account', 'comment_target', 'comment_created']) assert.ok(indexes.includes(i), i);
  d.exec("DELETE FROM post WHERE id = 'p1'");
  assert.equal(n('SELECT count(*) AS n FROM comment'), 0);
  d.close();
});

test.after(async () => { closeAccounts(); await vite.close(); });
