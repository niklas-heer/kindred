// node --test src/lib/graph-patch.test.ts — after an Edit save the page patches its copy of the family from the save's answer
// instead of reading it all again. The patched family must equal a fresh read for the same reader, for every kind of change the
// Edit tab makes; where it cannot (a painted portrait's age), the patch says so and the page reads the family again.
// A scratch family under a temporary KINDRED_DATA_DIR (never data/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-graph-patch-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { db, graph } = await import('./db.server.ts');
const { editSnapshot, savePersonEdit } = await import('./person.server.ts');
const { patchPerson } = await import('./graph-patch.ts');
import type { EditSnapshot, PersonDetails } from './person.server.ts';
import type { FieldInput } from '../components/fields/model.ts';
import type { Audience } from './visibility.ts';

const EDITOR: Audience = { account: 'ed', role: 'editor', guest: false };
const TREE = 'patch';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Patch'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, surname, born, living, nickname, title) VALUES ('ada', 'Ada', 'Stone', '1950', 1, 'Addy', 'Dr')`);
  d.exec(`INSERT INTO person (id, given, born, living) VALUES ('ben', 'Ben', '1921', 0)`);
  d.exec(`INSERT INTO person (id, given, born, living) VALUES ('cal', 'Cal', '1980', 1)`);
  d.exec(`INSERT INTO portrait (key, person, mime, source, source_year, model, created_by, accepted, created_at) VALUES ('portrait/x.webp', 'cal', 'image/webp', 'photo/x.jpg', 2000, 'test/model', 'ed', 1, '2026-01-01T00:00:00Z')`);
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

const detailsOf = (s: EditSnapshot): PersonDetails => ({
  given: s.given, furtherGiven: s.furtherGiven, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname,
  nickname: s.nickname, sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living,
  title: s.title, epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});
const inputsOf = (s: EditSnapshot): FieldInput[] => s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

/** Saves a change, then checks the patched family against a fresh read for the same reader. */
async function check(id: string, change: (d: PersonDetails) => PersonDetails, fields?: (f: FieldInput[]) => FieldInput[]) {
  const before = await graph(TREE, EDITOR);
  const snap = await editSnapshot(TREE, id, EDITOR);
  const saved = await savePersonEdit(TREE, id, change(detailsOf(snap)), (fields ?? ((f) => f))(inputsOf(snap)), snap.revision, undefined, 'Ed', EDITOR);
  // The answer travels as JSON, as a server function's does.
  const patched = patchPerson(before, id, plain(saved).person);
  assert.ok(patched, 'the patch applies');
  assert.deepEqual(plain(patched), plain(await graph(TREE, EDITOR)));
}

test('names, further and current names, and their removal', async () => {
  await check('ada', (d) => ({ ...d, given: 'Adelaide', furtherGiven: ['Mary', 'Ann'], currentGiven: 'Ada', currentSurname: 'Rowe' }));
  await check('ada', (d) => ({ ...d, furtherGiven: [], currentGiven: null, currentSurname: null, nickname: null, title: '  ' }));
});

test('dates, places, living, sex, epithet and an occupation with its vocabulary code', async () => {
  await check('ben', (d) => ({ ...d, born: '1921-03-04', bornPlace: 'Lindau', died: '~1999', diedPlace: 'Brest', sex: 'm', epithet: 'the Tall' }));
  await check('ben', (d) => ({ ...d, occupation: 'Baker', occupationCode: null }));
  await check('ada', (d) => ({ ...d, living: false, died: '2020' }));
  await check('ada', (d) => ({ ...d, living: true, died: null, occupation: null }));
});

test('contacts are counted as the saving reader sees them, personal ones included', async () => {
  await check('ada', (d) => d, (f) => [...f, { type: 'phone', label: 'mobile', value: { number: '+00 1234' }, visibility: 'editors' }]);
  await check('ada', (d) => d, (f) => [...f, { type: 'email', label: 'home', value: { address: 'a@example.org' }, visibility: 'personal' }, { type: 'notes', label: '', value: { text: 'not a contact' }, visibility: 'family' }]);
  await check('ada', (d) => d, (f) => f.filter((x) => x.type !== 'phone'));
});

test('a person with a painted portrait whose birth date changed is read again, not patched', async () => {
  const before = await graph(TREE, EDITOR);
  const snap = await editSnapshot(TREE, 'cal', EDITOR);
  const saved = await savePersonEdit(TREE, 'cal', { ...detailsOf(snap), born: '1985' }, inputsOf(snap), snap.revision, undefined, 'Ed', EDITOR);
  assert.equal(patchPerson(before, 'cal', plain(saved).person), null);
  // Without a date change the portrait's age stands, so the patch applies and matches.
  await check('cal', (d) => ({ ...d, nickname: 'C' }));
});

test('no answer to patch from, or a person the page does not have, means reading again', async () => {
  const g = await graph(TREE, EDITOR);
  assert.equal(patchPerson(g, 'ada', undefined), null);
  assert.equal(patchPerson(undefined, 'ada', { given: 'x' } as never), null);
  const saved = await savePersonEdit(TREE, 'ada', detailsOf(await editSnapshot(TREE, 'ada', EDITOR)), [], (await editSnapshot(TREE, 'ada', EDITOR)).revision, undefined, 'Ed', EDITOR);
  assert.equal(patchPerson({ ...g, people: g.people.filter((p) => p.id !== 'ada') }, 'ada', saved.person), null);
  assert.ok((await db(TREE).get('SELECT id FROM person WHERE id = ?', 'ada')));
});
