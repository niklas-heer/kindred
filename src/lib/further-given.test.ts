// node --test src/lib/further-given.test.ts — a person's further given names (migration 0021): the full name, search,
// the stored form, the Edit save and the migration. Scratch family under a temporary KINDRED_DATA_DIR (never data/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { displayName, fullName, personDisplayName } from './graph.ts';
import { allGiven, parseFurther, storeFurther } from './further-given.ts';
import { matchesName, personNames } from './search.ts';
import type { GPerson } from './types.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-further-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
const { openSqlite } = await import('./store/node.ts');
const { db, graph } = await import('./db.server.ts');
const { editSnapshot, savePersonEdit } = await import('./person.server.ts');
import type { EditSnapshot } from './person.server.ts';
test.after(() => rmSync(dir, { recursive: true, force: true }));

const EDITOR = { account: 'editor-account', role: 'editor', guest: false } as const;
const TREE = 'further';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Further'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, surname, further_given, living) VALUES
    ('mira', 'Mira', 'Lindqvist', '["Josefina","Anna"]', 1),
    ('hans', 'Hans Peter', 'Weber', NULL, 1)`);
  d.close();
}

const mira: GPerson = { id: 'mira', given: 'Mira', furtherGiven: ['Josefina', 'Anna'], surname: 'Lindqvist', nickname: 'Mimi', living: true, stories: 0, contacts: 0 };

test('the full name has every given name; the display forms stay short', () => {
  assert.equal(fullName(mira), 'Mira Josefina Anna Lindqvist');
  assert.equal(displayName(mira), 'Mira Lindqvist');
  assert.equal(personDisplayName(mira, 'full'), 'Mira Lindqvist');
  assert.equal(personDisplayName(mira, 'first'), 'Mira');
  assert.equal(fullName({ ...mira, furtherGiven: undefined }), 'Mira Lindqvist');
  // Further names belong to the birth name: with a current given name recorded, that name stands alone.
  assert.equal(fullName({ ...mira, currentGiven: 'Mirabel' }), 'Mirabel Lindqvist');
  assert.equal(fullName({ ...mira, currentSurname: 'Berg' }), 'Mira Josefina Anna Berg');
});

test('a search finds a person by any given name, alone or with the others, in any order', () => {
  assert.ok(matchesName(mira, 'josefina'));
  assert.ok(matchesName(mira, 'Anna Lindqvist'));
  assert.ok(matchesName(mira, 'mira josefina anna'));
  assert.ok(matchesName(mira, 'lindqvist josefina'));
  assert.ok(!matchesName(mira, 'Karolina'));
  assert.ok(personNames(mira).includes('mira josefina anna lindqvist'));
});

test('the stored form drops blanks, and an empty list is no list', () => {
  assert.equal(storeFurther(['Josefina', '  ', ' Anna ']), '["Josefina","Anna"]');
  assert.equal(storeFurther([]), null);
  assert.equal(storeFurther(undefined), null);
  assert.deepEqual(parseFurther('["Josefina"," ","Anna"]'), ['Josefina', 'Anna']);
  assert.deepEqual(parseFurther('not json'), []);
  assert.deepEqual(parseFurther('{"a":1}'), []);
  assert.deepEqual(parseFurther(null), []);
  assert.equal(allGiven('Mira', ['Josefina']), 'Mira Josefina');
});

test('the graph carries them, and a given name that already holds several names is left whole', async () => {
  const g = await graph(TREE);
  assert.deepEqual(g.people.find((p) => p.id === 'mira')!.furtherGiven, ['Josefina', 'Anna']);
  const hans = g.people.find((p) => p.id === 'hans')!;
  assert.equal(hans.given, 'Hans Peter');
  assert.equal(hans.furtherGiven, undefined);
});

const detailsOf = (s: EditSnapshot) => ({
  given: s.given, furtherGiven: s.furtherGiven, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname,
  sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title,
  epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});

test('the Edit tab saves them in order, moves the revision once, and a save that leaves them out keeps them', async () => {
  const snap = await editSnapshot(TREE, 'mira', EDITOR);
  assert.deepEqual(snap.furtherGiven, ['Josefina', 'Anna']);
  await savePersonEdit(TREE, 'mira', { ...detailsOf(snap), furtherGiven: ['Anna', 'Josefina', 'Karin'] }, [], snap.revision, undefined, 'Editor', EDITOR);
  const after = await editSnapshot(TREE, 'mira', EDITOR);
  assert.deepEqual(after.furtherGiven, ['Anna', 'Josefina', 'Karin']);
  assert.equal(after.revision, snap.revision + 1);

  const { furtherGiven: _left, ...without } = detailsOf(after);
  await savePersonEdit(TREE, 'mira', { ...without, nickname: 'Mimi' }, [], after.revision, undefined, 'Editor', EDITOR);
  assert.deepEqual((await editSnapshot(TREE, 'mira', EDITOR)).furtherGiven, ['Anna', 'Josefina', 'Karin']);

  const cleared = await editSnapshot(TREE, 'mira', EDITOR);
  await savePersonEdit(TREE, 'mira', { ...detailsOf(cleared), furtherGiven: [] }, [], cleared.revision, undefined, 'Editor', EDITOR);
  assert.deepEqual((await editSnapshot(TREE, 'mira', EDITOR)).furtherGiven, []);
  assert.equal((await db(TREE).get<{ f: string | null }>("SELECT further_given AS f FROM person WHERE id = 'mira'"))!.f, null);
});

test('migration 0021 adds the column empty, keeps every given name as it was, and counts the column in the revision', () => {
  const files = readdirSync('migrations/tree').filter((f) => f.endsWith('.sql')).sort();
  const file = files.find((f) => f.startsWith('0021'));
  assert.ok(file, 'there is a migration 0021');
  const d = new DatabaseSync(join(dir, 'migration.db'));
  for (const f of files.filter((x) => x < '0021')) d.exec(readFileSync(join('migrations/tree', f), 'utf8'));
  d.exec(`INSERT INTO person (id, given, surname, current_given) VALUES ('p', 'Hans Peter', 'Weber', 'Hansi')`);
  const row = (cols = 'given, current_given, further_given, revision') => d.prepare(`SELECT ${cols} FROM person WHERE id = 'p'`).get() as Record<string, unknown>;
  const before = { ...row('given, current_given, revision') };
  d.exec(readFileSync(join('migrations/tree', file!), 'utf8'));
  assert.deepEqual({ ...row() }, { ...before, further_given: null }, 'nothing is split or moved');
  d.exec(`UPDATE person SET further_given = '["Maria"]' WHERE id = 'p'`);
  assert.equal(row().revision, (before.revision as number) + 1, 'a change to the column moves the revision');
  d.exec(`UPDATE person SET nickname = 'Hans' WHERE id = 'p'`);
  assert.equal(row().revision, (before.revision as number) + 2, 'the earlier columns still do');
  d.close();
});
