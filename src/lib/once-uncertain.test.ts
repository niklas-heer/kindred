// node --test src/lib/once-uncertain.test.ts — a batch whose outcome is unknown (D1 can report a lost connection after
// the transaction committed) never costs a stored upload its file: `once` deletes an upload only when it knows the
// batch wrote nothing. A driver that commits and then throws stands in for D1. A private data folder; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-once-uncertain-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { store, q, guard } = await import('./store/index.ts');
const { once } = await import('./db.server.ts');
import type { Db, Query } from './store/index.ts';

const TREE = 'uncertain';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Uncertain'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** How the next batch fails: after it committed, before it was sent, or not at all. */
let failing: 'after' | 'before' | null = null;
const realTree = store.tree.bind(store);
store.tree = (id: string): Db => {
  const d = realTree(id);
  return {
    ...d,
    async batch(queries: Query[]) {
      const mode = failing;
      failing = null;
      if (mode === 'before') throw new Error('Network connection lost.');
      const r = await d.batch(queries);
      if (mode === 'after') throw new Error('Network connection lost.');
      return r;
    },
  };
};

const addPerson = (id: string) => q('INSERT INTO person (id, given) VALUES (?, ?)', id, 'Ida');
const hasPerson = async (id: string) => !!(await realTree(TREE).get('SELECT id FROM person WHERE id = ?', id));
const plan = (id: string, log: string[]) => () => ({ history: [], writes: [addPerson(id)], result: id, abandon: () => { log.push('abandoned'); } });

test('with a retry key, a batch that committed and then failed replays its result and keeps the upload', async () => {
  const log: string[] = [];
  failing = 'after';
  const got = await once(TREE, { key: 'k-after', user: 'u', payload: 1 }, 'addPerson', plan('ida1', log));
  assert.equal(got, 'ida1');
  assert.equal(await hasPerson('ida1'), true);
  assert.deepEqual(log, [], 'the stored file is still what the row points at');
});

test('without a retry key, a batch that may have committed keeps the upload and reports the failure', async () => {
  const log: string[] = [];
  failing = 'after';
  await assert.rejects(once(TREE, undefined, 'addPerson', plan('ida2', log)), /Network connection lost/);
  assert.equal(await hasPerson('ida2'), true);
  assert.deepEqual(log, []);
});

test('with a retry key, a batch that wrote nothing gives its upload back', async () => {
  const log: string[] = [];
  failing = 'before';
  await assert.rejects(once(TREE, { key: 'k-before', user: 'u', payload: 1 }, 'addPerson', plan('ida3', log)), /Network connection lost/);
  assert.equal(await hasPerson('ida3'), false);
  assert.deepEqual(log, ['abandoned'], 'no op row, so the batch did not commit');
});

test('a batch the database refused gives its upload back, with or without a retry key', async () => {
  const log: string[] = [];
  await assert.rejects(once(TREE, undefined, 'addPerson', plan('ida1', log)), /UNIQUE|PRIMARY KEY/);
  let attempts = 0;
  await assert.rejects(once(TREE, undefined, 'guarded', () => {
    attempts++;
    return { history: [], writes: [guard('1 = 0'), addPerson('ida4')], result: 1, abandon: () => { log.push('guard'); } };
  }), /changed while this was being saved/);
  assert.deepEqual(log, ['abandoned', 'guard', 'guard', 'guard', 'guard'].slice(0, 1 + attempts));
});
