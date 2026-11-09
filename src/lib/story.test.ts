// node --test src/lib/story.test.ts — a removed story comes back exactly as it was, and only for the person who
// removed it. A scratch family under a temporary KINDRED_DATA_DIR (never data/); the environment is set before
// anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-story-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { db } = await import('./db.server.ts');
const { removeStory, restoreStory } = await import('./story.server.ts');

const TREE = 'stories';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Stories'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, living) VALUES ('oma', 'Oma', 0), ('opa', 'Opa', 0)`);
  d.exec(`INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES
    ('s1', 'oma', 'quote', NULL, 'Eat first, talk later.', 'Greta', '2020-05-01T10:00:00.000Z', 'at every Sunday lunch'),
    ('s2', 'opa', 'recipe', 'Plum cake', 'Flour, plums, patience.', 'Jonas', '2021-06-02T10:00:00.000Z', NULL)`);
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

const story = (id: string) => db(TREE).get<Record<string, unknown>>('SELECT * FROM story WHERE id = ?', id);
const op = (key: string, user: string, id: string) => ({ key, user, payload: { tree: TREE, id } });

test('a removed story is restored with its writer, date and context', async () => {
  const before = await story('s1');
  assert.deepEqual(await removeStory(TREE, 's1', op('key-remove-1', 'greta', 's1')), { removed: true });
  assert.equal(await story('s1'), undefined);
  assert.deepEqual(await restoreStory(TREE, 'key-remove-1', 'greta'), { restored: true });
  assert.deepEqual(await story('s1'), before);
});

test('restoring twice, or resending the removal, changes nothing more', async () => {
  assert.deepEqual(await restoreStory(TREE, 'key-remove-1', 'greta'), { restored: true });
  assert.equal((await db(TREE).get<{ n: number }>("SELECT count(*) AS n FROM story WHERE id = 's1'"))?.n, 1);
  // The same removal arriving again (a retry after a lost answer) is replayed, not run again: the story stays.
  assert.deepEqual(await removeStory(TREE, 's1', op('key-remove-1', 'greta', 's1')), { removed: true });
  assert.ok(await story('s1'));
});

test('only the person who removed a story can put it back', async () => {
  await removeStory(TREE, 's2', op('key-remove-2', 'greta', 's2'));
  await assert.rejects(restoreStory(TREE, 'key-remove-2', 'jonas'), /no longer be undone/);
  await assert.rejects(restoreStory(TREE, 'key-never-used', 'greta'), /no longer be undone/);
  assert.equal(await story('s2'), undefined);
});

test('a key from another kind of change restores nothing', async () => {
  await db(TREE).run("INSERT INTO op (key, fn, result, at, user, fingerprint) VALUES ('key-other', 'addStory', ?, ?, 'greta', NULL)",
    JSON.stringify({ id: 'forged', person: 'oma', kind: 'note', title: null, body: 'x', author: 'Someone else', at: '2000-01-01', context: null }), new Date().toISOString());
  await assert.rejects(restoreStory(TREE, 'key-other', 'greta'), /no longer be undone/);
  assert.equal(await story('forged'), undefined);
});

test('a story is not restored onto someone who has left the tree', async () => {
  await db(TREE).run("DELETE FROM person WHERE id = 'opa'");
  await assert.rejects(restoreStory(TREE, 'key-remove-2', 'greta'), /Person not found/);
});

test('removing a story that is already gone says so', async () => {
  assert.deepEqual(await removeStory(TREE, 'nope', op('key-remove-3', 'greta', 'nope')), { removed: false });
  assert.deepEqual(await restoreStory(TREE, 'key-remove-3', 'greta'), { restored: false });
});
