// node --test src/lib/hidden-fields.test.ts — nobody learns of activity on, or the number of, fields they cannot see: the
// revision a reader gets moves only with what they see, the cap on fields counts only theirs, a field's place is its place
// among theirs, and a guest gets no revision at all. A scratch family under a temporary KINDRED_DATA_DIR (never data/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-hidden-fields-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { db, person } = await import('./db.server.ts');
const { editSnapshot, savePersonEdit, addPersonField, deletePersonField } = await import('./person.server.ts');
const { MAX_FIELDS } = await import('./fields/model.ts');
import type { EditSnapshot } from './person.server.ts';
import type { Audience } from './visibility.ts';

const ALICE: Audience = { account: 'alice', role: 'editor', guest: false };
const BOB: Audience = { account: 'bob', role: 'editor', guest: false };
const VIEWER: Audience = { account: 'vera', role: 'viewer', guest: false };
const GUEST: Audience = { account: null, role: 'viewer', guest: true };
const PROTECTED_GUEST: Audience = { ...GUEST, protectLiving: true };
const TREE = 'hidden';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Hidden'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  for (const p of ['ada', 'cap', 'ord']) d.exec(`INSERT INTO person (id, given, born, living) VALUES ('${p}', 'Ada', '1950', 1)`);
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

const detailsOf = (s: EditSnapshot) => ({
  given: s.given, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname,
  sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title,
  epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});
const inputsOf = (s: EditSnapshot) => s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
const note = (text: string, visibility: 'personal' | 'editors' | 'family') => ({ type: 'notes' as const, label: '', value: { text }, visibility });

test('the person read carries no revision for anyone, and a guest’s none either', async () => {
  for (const who of [ALICE, VIEWER, GUEST, PROTECTED_GUEST]) {
    const detail = await person(TREE, 'ada', who);
    assert.equal('revision' in detail, false, `no revision for ${who.guest ? 'a guest' : who.role}`);
  }
});

test('someone’s personal field coming, changing and going moves no other reader’s revision, and a stale-looking draft still saves', async () => {
  const bob = await editSnapshot(TREE, 'ada', BOB);
  const vera = await editSnapshot(TREE, 'ada', VIEWER);
  const fid = await addPersonField(TREE, 'ada', note('Alice only', 'personal'), undefined, 'Alice', ALICE);
  assert.equal((await editSnapshot(TREE, 'ada', BOB)).revision, bob.revision, 'Bob cannot see it arrive');
  assert.equal((await editSnapshot(TREE, 'ada', VIEWER)).revision, vera.revision, 'nor can a viewer');
  const alice = await editSnapshot(TREE, 'ada', ALICE);
  await savePersonEdit(TREE, 'ada', detailsOf(alice), inputsOf(alice).map((f) => (f.id === fid ? { ...f, value: { text: 'changed' } } : f)), alice.revision, undefined, 'Alice', ALICE);
  assert.equal((await editSnapshot(TREE, 'ada', BOB)).revision, bob.revision, 'nor see it change');
  // Bob's draft from before all of this saves: nothing he can see moved.
  const saved = await savePersonEdit(TREE, 'ada', { ...detailsOf(bob), nickname: 'Addy' }, inputsOf(bob), bob.revision, undefined, 'Bob', BOB);
  assert.equal(saved.revision, (await editSnapshot(TREE, 'ada', BOB)).revision);
  assert.equal((await editSnapshot(TREE, 'ada', ALICE)).fields.find((f) => f.id === fid)?.value.text, 'changed', 'and Alice’s field is untouched');
  const after = (await editSnapshot(TREE, 'ada', BOB)).revision;
  await deletePersonField(TREE, fid, undefined, ALICE);
  assert.equal((await editSnapshot(TREE, 'ada', BOB)).revision, after, 'nor see it go');
});

test('an Editors field moves an editor’s revision and not a viewer’s', async () => {
  const bob = await editSnapshot(TREE, 'ada', BOB);
  const vera = await editSnapshot(TREE, 'ada', VIEWER);
  await addPersonField(TREE, 'ada', note('editors only', 'editors'), undefined, 'Alice', ALICE);
  assert.notEqual((await editSnapshot(TREE, 'ada', BOB)).revision, bob.revision, 'an editor sees it, so their draft is stale');
  assert.equal((await editSnapshot(TREE, 'ada', VIEWER)).revision, vera.revision, 'a viewer does not');
});

test('a field everyone sees still makes an open draft stale, so the Edit tab’s protection holds', async () => {
  const bob = await editSnapshot(TREE, 'ada', BOB);
  await addPersonField(TREE, 'ada', note('for everyone', 'family'), undefined, 'Alice', ALICE);
  await assert.rejects(savePersonEdit(TREE, 'ada', detailsOf(bob), inputsOf(bob), bob.revision, undefined, 'Bob', BOB), /changed/i);
});

test('the cap on fields counts only the ones the reader sees, so reaching it says nothing about the others', async () => {
  const d = db(TREE);
  for (let i = 0; i < MAX_FIELDS; i++) {
    await d.run("INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner, created_by, created_by_name) VALUES (?, 'cap', 'notes', '', '{\"text\":\"x\"}', ?, 'personal', 'alice', 'alice', 'Alice')", `cap-${i}`, i);
  }
  // Bob sees none of Alice's: he can add as if the person had none.
  await addPersonField(TREE, 'cap', note('Bob’s first', 'family'), undefined, 'Bob', BOB);
  // Alice sees her own at the cap, and is told so.
  await assert.rejects(addPersonField(TREE, 'cap', note('one too many', 'family'), undefined, 'Alice', ALICE), new RegExp(`up to ${MAX_FIELDS}`));
});

test('a field’s place is its place among the reader’s fields, and moving it for a hidden field leaves its editor and time', async () => {
  const d = db(TREE);
  const at = '2026-01-01T00:00:00Z';
  await d.run("INSERT INTO person_field (id, person, type, label, value, ord, visibility, created_by_name, updated_by, updated_at) VALUES ('shared', 'ord', 'notes', '', '{\"text\":\"shared\"}', 0, 'family', 'Seed', 'Seed', ?)", at);
  // Alice puts a personal note before the shared one: the shared note moves down a place in the stored order.
  const alice = await editSnapshot(TREE, 'ord', ALICE);
  await savePersonEdit(TREE, 'ord', detailsOf(alice), [note('mine first', 'personal'), ...inputsOf(alice)], alice.revision, undefined, 'Alice', ALICE);
  assert.equal((await d.get<{ ord: number }>("SELECT ord FROM person_field WHERE id = 'shared'"))!.ord, 1, 'stored one down');
  const seen = (await person(TREE, 'ord', VIEWER)).fields;
  assert.deepEqual(seen.map((f) => [f.id, f.ord]), [['shared', 0]], 'a viewer sees it first, with no gap before it');
  assert.equal(seen[0]!.updatedAt, at, 'and not as just edited');
  assert.equal(seen[0]!.updatedBy, 'Seed');
});
