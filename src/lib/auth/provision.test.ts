// node --test src/lib/auth/provision.test.ts — a brand-new server makes its first family: the default id, the name
// the steward typed, the database it lives in, and what a missing Cloudflare binding says. Runs on a scratch data
// folder and a scratch accounts database (never data/).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-provision-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEFAULT_TREE;

const { translateMessage } = await import('../i18n/dictionary.ts');
const { AuthError } = await import('./errors.ts');
const trees = await import('./trees.server.ts');
const { families } = trees;

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('the default family is `family`, or KINDRED_DEFAULT_TREE when it names one', () => {
  assert.equal(trees.defaultTreeId(undefined), 'family');
  assert.equal(trees.defaultTreeId('  lindberg-house  '), 'lindberg-house');
  assert.throws(() => trees.defaultTreeId('Not A Family'), /lower-case/);
  assert.throws(() => trees.defaultTreeId('accounts'), /lower-case/, 'the accounts database is not a family');
});

test('the family name the steward types is one line of at most 80 characters; blank is the default', () => {
  assert.equal(trees.cleanFamilyName(''), 'Our family');
  assert.equal(trees.cleanFamilyName(undefined), 'Our family');
  assert.equal(trees.cleanFamilyName('  Lindberg \n  family  '), 'Lindberg family');
  assert.throws(() => trees.cleanFamilyName('x'.repeat(81)), (e: Error) => e instanceof AuthError && /80 characters/.test(e.message));
});

test('a Cloudflare family whose binding is missing says how to add it, and Node never needs one', () => {
  assert.equal(trees.missingBinding('family', [], false), null, 'Node makes the file itself');
  assert.equal(trees.missingBinding('family', ['family'], true), null, 'a bound family can be made');
  const problem = trees.missingBinding('my-family', ['family'], true);
  assert.ok(problem instanceof AuthError);
  assert.match(problem.message, /TREE_MY_FAMILY/, 'names the binding to add');
  assert.match(problem.message, /docs\/deploy-cloudflare\.md/, 'points at the deploy guide');
  assert.notEqual(translateMessage(problem.message, 'de'), problem.message, 'the reader gets it in their language');
  assert.match(translateMessage(problem.message, 'de'), /TREE_MY_FAMILY/);
});

test('a database without tables is named as not migrated, with the step that fixes it', () => {
  const e = trees.notMigrated('family');
  assert.match(e.message, /no tables yet/);
  assert.match(e.message, /docs\/deploy-cloudflare\.md/);
});

test('with no family, a new server makes its first one, named by the steward, and a second setup changes nothing', async () => {
  assert.deepEqual(await families(), [], 'nothing yet');
  await trees.checkCanMakeFamily();
  const id = await trees.makeFirstFamily(trees.cleanFamilyName('Lindberg family'));
  assert.equal(id, 'family');
  assert.ok(existsSync(join(dir, 'family.db')), 'the family is a file in the data folder');
  const [made] = await families();
  assert.equal(made.id, 'family');
  assert.equal(made.name, 'Lindberg family');
  assert.equal(made.people, 0, 'an empty family, ready for its first person');
  assert.equal(made.focus, '', 'no starting point until the steward adds themselves');

  const again = await trees.makeFirstFamily('Someone else’s');
  assert.equal(again, 'family');
  assert.equal((await families()).length, 1);
  assert.equal((await families())[0].name, 'Lindberg family', 'the name is not overwritten');
});

test('the first family takes the id KINDRED_DEFAULT_TREE names', async () => {
  process.env.KINDRED_DEFAULT_TREE = 'house-nordvik';
  try {
    assert.equal(await trees.makeFirstFamily('Nordvik'), 'house-nordvik');
    assert.ok(existsSync(join(dir, 'house-nordvik.db')));
  } finally {
    delete process.env.KINDRED_DEFAULT_TREE;
  }
});

test('two setups that race both end with one family, named by whichever wrote first', async () => {
  process.env.KINDRED_DEFAULT_TREE = 'race-house';
  try {
    const [a, b] = await Promise.all([trees.makeFirstFamily('Race A'), trees.makeFirstFamily('Race B')]);
    assert.equal(a, 'race-house');
    assert.equal(b, 'race-house');
    const mine = (await families()).filter((f) => f.id === 'race-house');
    assert.equal(mine.length, 1);
    assert.ok(['Race A', 'Race B'].includes(mine[0].name));
  } finally {
    delete process.env.KINDRED_DEFAULT_TREE;
  }
});
