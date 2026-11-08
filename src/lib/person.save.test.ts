// node --test src/lib/person.save.test.ts — an Edit save writes only what changed. A field whose content, label, privacy
// and position are as stored keeps its last editor and time, and the person's row moves the revision once per save.
// Each test has a person of its own in a scratch family under a temporary KINDRED_DATA_DIR (never data/); the environment
// is set before anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-save-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { db, person } = await import('./db.server.ts');
const { editSnapshot, savePersonEdit } = await import('./person.server.ts');
import type { EditSnapshot } from './person.server.ts';
import { blankValue, type FieldInput } from '../components/fields/model.ts';

const TREE = 'save';
const SEEN = '2026-01-01T00:00:00Z';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Save'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  // Each person has an address with only its street (written by an older form, so city, postcode and country are missing
  // from the JSON) and a note. Every field was last written by "Seed".
  for (const p of ['nick', 'same', 'label', 'added', 'text']) {
    d.exec(`INSERT INTO person (id, given, born, living) VALUES ('${p}', 'Ada', '1950', 1)`);
    d.exec(`INSERT INTO person_field (id, person, type, label, value, ord, private, created_by, created_at, updated_by, updated_at) VALUES
      ('${p}-street', '${p}', 'address', 'home', '{"street":"Main St"}', 0, 0, 'Seed', '${SEEN}', 'Seed', '${SEEN}'),
      ('${p}-note', '${p}', 'notes', 'General', '{"text":"Hello"}', 1, 0, 'Seed', '${SEEN}', 'Seed', '${SEEN}')`);
  }
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** The Edit tab's scalars for the person as the snapshot has them. */
const detailsOf = (s: EditSnapshot) => ({
  given: s.given, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname,
  sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title,
  epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});
/** A field as the Edit tab sends it: the blank parts of its type filled in, as `draftOf` does. */
const inputOf = (f: EditSnapshot['fields'][number]): FieldInput => ({
  id: f.id, type: f.type, label: f.label, value: { ...blankValue(f.type), ...f.value }, private: f.private,
});
const row = (id: string) => db(TREE).get<{ label: string; value: string; ord: number; updated_by: string; updated_at: string }>(
  'SELECT label, value, ord, updated_by, updated_at FROM person_field WHERE id = ?', id,
);
const revisionOf = async (p: string) => (await person(TREE, p)).revision!;

test('a save that changes one nickname writes that, and no field, even one stored with blanks missing', async () => {
  const snap = await editSnapshot(TREE, 'nick', true);
  const before = await revisionOf('nick');
  assert.equal(before, snap.revision);
  await savePersonEdit(TREE, 'nick', { ...detailsOf(snap), nickname: 'Addy' }, snap.fields.map(inputOf), snap.revision, undefined, 'Editor');
  assert.equal(await revisionOf('nick'), before + 1, 'the revision moved once, for the person’s row');
  for (const id of ['nick-street', 'nick-note']) {
    assert.equal((await row(id))!.updated_by, 'Seed', `${id} keeps its last editor`);
    assert.equal((await row(id))!.updated_at, SEEN, `${id} keeps its last time`);
  }
  assert.equal((await db(TREE).get<{ nickname: string }>('SELECT nickname FROM person WHERE id = ?', 'nick'))!.nickname, 'Addy');
});

test('a save with nothing changed writes nothing: the revision stays where it was', async () => {
  const snap = await editSnapshot(TREE, 'same', true);
  await savePersonEdit(TREE, 'same', detailsOf(snap), snap.fields.map(inputOf), snap.revision, undefined, 'Editor');
  assert.equal(await revisionOf('same'), snap.revision);
  assert.equal((await row('same-street'))!.updated_by, 'Seed');
});

test('a field whose label changed is written by its editor, and the field beside it is not', async () => {
  const snap = await editSnapshot(TREE, 'label', true);
  const fields = snap.fields.map(inputOf).map((f) => (f.id === 'label-street' ? { ...f, label: 'work' } : f));
  await savePersonEdit(TREE, 'label', detailsOf(snap), fields, snap.revision, undefined, 'Editor');
  assert.equal((await row('label-street'))!.label, 'work');
  assert.equal((await row('label-street'))!.updated_by, 'Editor');
  assert.equal((await row('label-note'))!.updated_by, 'Seed', 'the untouched field keeps its editor');
});

test('a field added at the end writes that field only: the others keep their editor and their place', async () => {
  const snap = await editSnapshot(TREE, 'added', true);
  const added: FieldInput = { type: 'notes', label: 'New', value: { text: 'Fresh' }, private: false };
  await savePersonEdit(TREE, 'added', detailsOf(snap), [...snap.fields.map(inputOf), added], snap.revision, undefined, 'Editor');
  assert.equal((await row('added-street'))!.updated_by, 'Seed');
  assert.equal((await row('added-note'))!.updated_by, 'Seed');
  const count = await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM person_field WHERE person = ?', 'added');
  assert.equal(count!.n, 3);
});

test('a field with the same text, with blank parts written out, is not rewritten; a field whose text changed is', async () => {
  const snap = await editSnapshot(TREE, 'text', true);
  // Nothing but the blanks differ: the street address gains empty city, postcode and country. Not a change.
  await savePersonEdit(TREE, 'text', detailsOf(snap), snap.fields.map(inputOf), snap.revision, undefined, 'Editor');
  assert.equal((await row('text-street'))!.updated_by, 'Seed');
  assert.equal((await revisionOf('text')), snap.revision);
  // The note's text itself changed: that field, and only that one, is written.
  const edited = snap.fields.map(inputOf).map((f) => (f.id === 'text-note' ? { ...f, value: { text: 'Hello again' } } : f));
  await savePersonEdit(TREE, 'text', detailsOf(snap), edited, snap.revision, undefined, 'Editor');
  assert.equal((await row('text-note'))!.updated_by, 'Editor');
  assert.equal((await row('text-street'))!.updated_by, 'Seed');
});
