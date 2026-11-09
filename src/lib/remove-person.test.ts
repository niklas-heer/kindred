// node --test src/lib/remove-person.test.ts — removing a person deletes their photo file and every painted-portrait file
// (accepted, kept or draft), and leaves other people's files. A private data folder; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-remove-person-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'remove-person-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const { removePlan } = await load<typeof import('./relations.server.ts')>('/src/lib/relations.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const TREE = 'rm';
const seed = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
seed.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Rm family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname, living) VALUES ('ada', 'Ada', 'Rm', 1), ('ben', 'Ben', 'Rm', 1);
  INSERT INTO photo (person, mime, key, at) VALUES ('ben', 'image/png', 'photo/ben.png', '2026-01-01'), ('ada', 'image/png', 'photo/ada.png', '2026-01-01');
  INSERT INTO portrait (key, person, mime, source, model, created_by, created_at, accepted) VALUES
    ('portrait/ben-accepted.png', 'ben', 'image/png', 'photo/ben.png', 'm', 'u', '2026-01-01', 1),
    ('portrait/ben-draft.png', 'ben', 'image/png', 'photo/ben.png', 'm', 'u', '2026-01-01', 0),
    ('portrait/ada-draft.png', 'ada', 'image/png', 'photo/ada.png', 'm', 'u', '2026-01-01', 0);
`);
seed.close();

test('removing a person deletes their photo and every portrait file, and only theirs', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  for (const k of ['photo/ben.png', 'photo/ada.png', 'portrait/ben-accepted.png', 'portrait/ben-draft.png', 'portrait/ada-draft.png']) await dbs.media.put(TREE, k, bytes, 'image/png');
  assert.equal(await dbs.once(TREE, undefined, 'removePerson', (d) => removePlan(d, TREE, 'ben')), 1);
  for (const k of ['photo/ben.png', 'portrait/ben-accepted.png', 'portrait/ben-draft.png']) assert.equal(await dbs.media.get(TREE, k), undefined, `${k} is gone`);
  for (const k of ['photo/ada.png', 'portrait/ada-draft.png']) assert.ok(await dbs.media.get(TREE, k), `${k} stays`);
  assert.equal((await dbs.db(TREE).all('SELECT key FROM portrait WHERE person = ?', 'ben')).length, 0, 'no row is left');
});

test('the last person still cannot be removed', async () => {
  await assert.rejects(dbs.once(TREE, undefined, 'removePerson', (d) => removePlan(d, TREE, 'ada')), /last person/);
});

test('a field that named a removed person keeps their name as text, and the person it is on can still be saved', async () => {
  const { editSnapshot, savePersonEdit } = await load<typeof import('./person.server.ts')>('/src/lib/person.server.ts');
  const who = { account: 'steward-account', role: 'steward', guest: false } as const;
  const d = dbs.db(TREE);
  await d.run("INSERT INTO person (id, given, surname, current_surname, living) VALUES ('cleo', 'Cleo', 'Rm', 'Vale', 1), ('dora', 'Dora', 'Rm', NULL, 1)");
  const detailsOf = (s: Awaited<ReturnType<typeof editSnapshot>>) => ({
    given: s.given, furtherGiven: s.furtherGiven, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname,
    nickname: s.nickname, sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living,
    title: s.title, epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
  });
  const fieldsOf = (s: Awaited<ReturnType<typeof editSnapshot>>) => s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
  let s = await editSnapshot(TREE, 'dora', who);
  await savePersonEdit(TREE, 'dora', detailsOf(s), [{ type: 'related', label: 'godparent', value: { person: 'cleo' }, visibility: 'family' }], s.revision, undefined, 'Tester', who);

  await dbs.once(TREE, undefined, 'removePerson', (d) => removePlan(d, TREE, 'cleo'));

  s = await editSnapshot(TREE, 'dora', who);
  const related = s.fields.find((f) => f.type === 'related');
  assert.equal(related?.value.person ?? '', '', 'the link to the removed person is gone');
  assert.equal(related?.value.name, 'Cleo Vale', 'the name they had is kept as text');
  // An unrelated change on the person whose field named them saves as usual.
  await savePersonEdit(TREE, 'dora', { ...detailsOf(s), nickname: 'Dodo' }, fieldsOf(s), s.revision, undefined, 'Tester', who);
  assert.equal((await editSnapshot(TREE, 'dora', who)).nickname, 'Dodo');
});

test('a related field naming someone already gone does not stop the other changes from saving', async () => {
  const { editSnapshot, savePersonEdit } = await load<typeof import('./person.server.ts')>('/src/lib/person.server.ts');
  const who = { account: 'steward-account', role: 'steward', guest: false } as const;
  const d = dbs.db(TREE);
  // A link left behind by an older version, which removed people without rewriting the fields that named them.
  await d.run("INSERT INTO person (id, given, living) VALUES ('emil', 'Emil', 1)");
  await d.run(`INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES ('stale', 'emil', 'related', 'friend', '{"person":"nobody","name":"","note":""}', 0, 'family')`);
  const s = await editSnapshot(TREE, 'emil', who);
  const fields = s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
  await savePersonEdit(TREE, 'emil', {
    given: s.given, furtherGiven: s.furtherGiven, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname,
    nickname: 'Em', sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living,
    title: s.title, epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
  }, fields, s.revision, undefined, 'Tester', who);
  // Pointing an untouched field at someone who is not there is still refused.
  const again = await editSnapshot(TREE, 'emil', who);
  await assert.rejects(savePersonEdit(TREE, 'emil', {
    given: again.given, furtherGiven: again.furtherGiven, surname: again.surname, currentGiven: again.currentGiven, currentSurname: again.currentSurname,
    nickname: again.nickname, sex: again.sex, born: again.born, bornPlace: again.bornPlace, died: again.died, diedPlace: again.diedPlace, living: again.living,
    title: again.title, epithet: again.epithet, occupation: again.occupation, occupationCode: again.occupationCode, bio: again.bio,
  }, [...fields, { type: 'related', label: 'friend', value: { person: 'nobody-else' }, visibility: 'family' }], again.revision, undefined, 'Tester', who), /not in this family/);
});
