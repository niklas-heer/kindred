// node --test src/lib/auth/setup-memo.test.ts — "does anyone have an account yet?" is asked on every request. Before the
// first account it is asked of the database once per request; after it, never again. Scratch data folder.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatementSync } from 'node:sqlite';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-setup-memo-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const store = await import('./store.server.ts');
const setup = await import('./setup.server.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

// Counts the user-count queries the accounts database answers.
let counted = 0;
const get = StatementSync.prototype.get;
StatementSync.prototype.get = function (this: StatementSync, ...args: unknown[]) {
  if (/count\(\*\) AS n FROM user/.test(this.sourceSQL)) counted++;
  return (get as (...a: unknown[]) => ReturnType<StatementSync['get']>).apply(this, args);
} as StatementSync['get'];

test('before the first account: asked once per request, however many parts of it ask', async () => {
  const request = new Request('http://localhost:4901/');
  counted = 0;
  assert.equal(await setup.needsSetup(request), true);
  assert.equal(await setup.needsSetup(request), true);
  assert.equal(counted, 1);
  assert.equal(await setup.needsSetup(new Request('http://localhost:4901/')), true);
  assert.equal(counted, 2, 'the next request asks again');
});

test('once an account exists, no request asks again', async () => {
  const { insert } = store.newUser('Ilka Varga', null);
  await store.accounts().batch([insert]);
  counted = 0;
  assert.equal(await setup.needsSetup(new Request('http://localhost:4901/')), false);
  assert.equal(counted, 1);
  for (let i = 0; i < 5; i++) assert.equal(await setup.needsSetup(new Request('http://localhost:4901/')), false);
  assert.equal(await setup.needsSetup(), false);
  assert.equal(counted, 1);
});
