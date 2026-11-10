// node --test src/lib/person.test.ts — saving a person's Edit draft is refused when the person changed after the
// draft was opened, and a change that lands between the check and the write is caught by the batch's guard.
// A scratch family under a temporary KINDRED_DATA_DIR (never data/); the environment is set before anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-person-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { store } = await import('./store/index.ts');
import type { Db, Param } from './store/index.ts';
const { db, person } = await import('./db.server.ts');
const { editSnapshot, savePersonEdit, addPersonField, addFirstPerson, CHANGED_SINCE_OPENED } = await import('./person.server.ts');

const TREE = 'scratch';
const EDITOR = { account: 'editor-account', role: 'editor', guest: false } as const;
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Scratch'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, born, living) VALUES ('ada', 'Ada', '1950', 1)`);
  d.close();
}

test.after(() => {
  store.tree = realTree;
  rmSync(dir, { recursive: true, force: true });
});

const realTree = store.tree;

const details = (given: string) => ({
  given, surname: null, currentGiven: null, currentSurname: null, nickname: null, sex: null, born: '1950', bornPlace: null,
  died: null, diedPlace: null, living: true, title: null, epithet: null, occupation: null, bio: null,
});

const fieldCount = async () => (await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM person_field WHERE person = ?', 'ada'))!.n;

test('a draft opened at the person’s current revision saves, and the revision moves on', async () => {
  const opened = (await editSnapshot(TREE, 'ada', EDITOR)).revision;
  const saved = await savePersonEdit(TREE, 'ada', { ...details('Ada'), nickname: 'Addy' }, [], opened, undefined, 'Test', EDITOR);
  const after = (await editSnapshot(TREE, 'ada', EDITOR)).revision;
  assert.notEqual(after, opened, 'the revision moved on');
  assert.equal(saved.revision, after, 'and the save said where to');
});

test('a draft opened before someone else added a field is refused, and that field survives', async () => {
  const opened = (await editSnapshot(TREE, 'ada', EDITOR)).revision;
  // Another reader adds a private note through the Everyday tab.
  await addPersonField(TREE, 'ada', { type: 'notes', label: 'Note', value: { text: 'Kept safe' }, visibility: 'editors' }, undefined, 'Other', EDITOR);
  assert.equal(await fieldCount(), 1);
  await assert.rejects(
    savePersonEdit(TREE, 'ada', details('Ada, edited'), [], opened, undefined, 'Test', EDITOR),
    (e: Error) => e.message === CHANGED_SINCE_OPENED,
  );
  assert.equal(await fieldCount(), 1, 'the stale draft did not delete the newer field');
  assert.equal((await person(TREE, 'ada', EDITOR)).fields[0]?.label, 'Note');
  assert.equal((await db(TREE).get<{ given: string }>('SELECT given FROM person WHERE id = ?', 'ada'))!.given, 'Ada', 'nor its names');
});

test('a change that lands between the check and the write is caught by the batch, and the save is refused', async () => {
  const opened = (await editSnapshot(TREE, 'ada', EDITOR)).revision;
  let injected = false;
  let reads = 0;
  // Between the plan's reads (the person, then the fields) and its batch, another writer adds a field through the same database.
  store.tree = (id: string): Db => {
    const inner = realTree(id);
    const get = (async (sql: string, ...params: Param[]) => {
      if (sql.startsWith('SELECT revision')) reads++;
      return inner.get(sql, ...params);
    }) as Db['get'];
    const all = (async (sql: string, ...params: Param[]) => {
      const rows = await inner.all(sql, ...params);
      if (sql.startsWith('SELECT id, type, label, value') && !injected) {
        injected = true;
        await inner.run("INSERT INTO person_field (id, person, type, label, value, ord, visibility, created_by_name, created_at, updated_by, updated_at) VALUES ('race', 'ada', 'notes', 'Raced', '{\"text\":\"late\"}', 5, 'family', 'Other', '2026-11-08T00:00:00Z', 'Other', '2026-11-08T00:00:00Z')");
      }
      return rows;
    }) as Db['all'];
    return { ...inner, get, all };
  };
  try {
    await assert.rejects(savePersonEdit(TREE, 'ada', details('Ada, raced'), [], opened, undefined, 'Test', EDITOR), (e: Error) => e.message === CHANGED_SINCE_OPENED);
  } finally {
    store.tree = realTree;
  }
  assert.ok(reads >= 2, 'the plan ran again on fresh reads after the batch was refused');
  assert.equal((await db(TREE).get<{ n: number }>("SELECT count(*) AS n FROM person_field WHERE id = 'race'"))!.n, 1, 'the racing field is kept');
  assert.equal((await db(TREE).get<{ given: string }>('SELECT given FROM person WHERE id = ?', 'ada'))!.given, 'Ada', 'the racing draft wrote nothing');
});

test('a draft opened at the current revision, with the fields it shows, still saves after the race', async () => {
  const current = await editSnapshot(TREE, 'ada', EDITOR);
  const fields = current.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
  await savePersonEdit(TREE, 'ada', details('Ada, again'), fields, current.revision, undefined, 'Test', EDITOR);
  assert.equal(await fieldCount(), 2, 'both fields kept: the draft listed them');
  assert.equal((await db(TREE).get<{ given: string }>('SELECT given FROM person WHERE id = ?', 'ada'))!.given, 'Ada, again');
});

test('the first person of a new family is the steward, and sets the starting point once', async () => {
  const id = await addFirstPerson(TREE, { given: 'Niklas', surname: '' }, undefined);
  assert.match(id, /^niklas_/);
  const focus = (await db(TREE).get<{ value: string }>("SELECT value FROM meta WHERE key = 'focus'"))!.value;
  assert.equal(focus, id, 'the new family starts at its first person');
  const second = await addFirstPerson(TREE, { given: 'Someone', surname: '' }, undefined);
  const still = (await db(TREE).get<{ value: string }>("SELECT value FROM meta WHERE key = 'focus'"))!.value;
  assert.equal(still, id, 'a later person does not move the starting point');
  assert.notEqual(second, id);
});

test('the first person keeps the given name and the surname apart, as the steward gave them', async () => {
  const id = await addFirstPerson(TREE, { given: 'Paula', surname: 'Probe' }, undefined);
  const row = await db(TREE).get<{ given: string; surname: string | null }>('SELECT given, surname FROM person WHERE id = ?', id);
  assert.deepEqual({ given: row!.given, surname: row!.surname }, { given: 'Paula', surname: 'Probe' });
  const blank = await addFirstPerson(TREE, { given: 'Anna', surname: '  ' }, undefined);
  assert.equal((await db(TREE).get<{ surname: string | null }>('SELECT surname FROM person WHERE id = ?', blank))!.surname, null, 'a blank surname is none');
  await assert.rejects(addFirstPerson(TREE, { given: '  ', surname: 'Probe' }, undefined), /given name/);
});
