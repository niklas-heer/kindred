// node --test src/lib/person.revision.test.ts — the person's revision moves on the columns the Edit tab saves, and
// on nothing else: a reader's own look or preferred picture never refuses their own Edit save (migration 0010).
// A scratch family under a temporary KINDRED_DATA_DIR (never data/); the environment is set before anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-revision-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { db, person } = await import('./db.server.ts');
const { savePersonEdit, setPersonLook, CHANGED_SINCE_OPENED } = await import('./person.server.ts');
import type { Look } from './types.ts';

const EDITOR = { account: 'editor-account', role: 'editor', guest: false } as const;
const TREE = 'revision';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Revision'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, born, living) VALUES ('ada', 'Ada', '1950', 1)`);
  d.close();
}

test.after(() => rmSync(dir, { recursive: true, force: true }));

const details = (given: string) => ({
  given, surname: null, currentGiven: null, currentSurname: null, nickname: null, sex: null, born: '1950', bornPlace: null,
  died: null, diedPlace: null, living: true, title: null, epithet: null, occupation: null, bio: null,
});

const revisionOf = async () => (await person(TREE, 'ada')).revision!;
const look: Look = { skin: 1, hair: 2, eyes: 3 } as Look;

test('the trigger counts the Edit tab’s columns and not the portrait, the picture or the house', async () => {
  const row = await db(TREE).get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'person_revision_on_row_update'");
  assert.ok(row, 'the row trigger exists');
  const scope = /AFTER UPDATE OF\s+([\s\S]+?)\s+ON person/.exec(row.sql)?.[1] ?? '';
  const columns = scope.split(',').map((c) => c.trim());
  for (const c of ['given', 'surname', 'current_given', 'current_surname', 'nickname', 'sex', 'born', 'born_place', 'died', 'died_place', 'living', 'title', 'epithet', 'occupation', 'occupation_code', 'bio']) {
    assert.ok(columns.includes(c), `${c} is in the scope`);
  }
  for (const c of ['look', 'prefer_avatar', 'house', 'traits', 'updated_at']) assert.ok(!columns.includes(c), `${c} is not`);
});

test('changing your own look does not move the revision, so the draft you opened still saves', async () => {
  const opened = await revisionOf();
  await setPersonLook(TREE, 'ada', look, undefined);
  assert.equal(await revisionOf(), opened, 'the look did not bump the revision');
  await savePersonEdit(TREE, 'ada', details('Ada Lovelace'), [], opened, undefined, 'Test', EDITOR);
  assert.equal(await revisionOf(), opened + 1, 'the Edit save itself moves it once');
});

test('keeping a picture or preferring the drawn avatar does not move the revision', async () => {
  const before = await revisionOf();
  await db(TREE).run('UPDATE person SET prefer_avatar = 1 WHERE id = ?', 'ada');
  assert.equal(await revisionOf(), before);
  await db(TREE).run('UPDATE person SET prefer_avatar = 0 WHERE id = ?', 'ada');
  assert.equal(await revisionOf(), before);
});

test('a change to a column the Edit tab saves moves the revision, so a stale draft is still refused', async () => {
  const opened = await revisionOf();
  await db(TREE).run('UPDATE person SET nickname = ? WHERE id = ?', 'Addy', 'ada');
  assert.equal(await revisionOf(), opened + 1, 'a nickname change from another route counts');
  await assert.rejects(savePersonEdit(TREE, 'ada', details('Ada'), [], opened, undefined, 'Test', EDITOR), (e: Error) => e.message === CHANGED_SINCE_OPENED);
});

test('a look change between opening and saving does not stop the save of a name change', async () => {
  const opened = await revisionOf();
  await setPersonLook(TREE, 'ada', { skin: 4, hair: 4, eyes: 4 } as Look, undefined);
  await savePersonEdit(TREE, 'ada', details('Ada Lovelace'), [], opened, undefined, 'Test', EDITOR);
  assert.equal((await db(TREE).get<{ given: string }>('SELECT given FROM person WHERE id = ?', 'ada'))!.given, 'Ada Lovelace');
});
