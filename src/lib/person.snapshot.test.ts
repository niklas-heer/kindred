// node --test src/lib/person.snapshot.test.ts — the Edit tab reads the person as one moment (`editSnapshot`): a change
// between its reads is read again, never mixed in. A draft rebased on such a snapshot saves without overwriting what
// someone else changed in between (the regression Sol found in round 5: the names from one read, the revision from another).
// A scratch family under a temporary KINDRED_DATA_DIR (never data/); the environment is set before anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-snapshot-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { store } = await import('./store/index.ts');
import type { Db, Param } from './store/index.ts';
const { db, person } = await import('./db.server.ts');
const { editSnapshot, savePersonEdit, CHANGED_SINCE_OPENED } = await import('./person.server.ts');
const { rebaseDraft } = await import('../components/fields/rebase.ts');
import type { EditSnapshot } from './person.server.ts';
import type { RebaseField } from '../components/fields/rebase.ts';
import type { FieldInput, FieldType } from '../components/fields/model.ts';

const EDITOR = { account: 'editor-account', role: 'editor', guest: false } as const;
const VIEWER = { account: 'viewer-account', role: 'viewer', guest: false } as const;
const TREE = 'snapshot';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Snapshot'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, born, living) VALUES ('ada', 'Ada', '1950', 1)`);
  d.exec(`INSERT INTO person_field (id, person, type, label, value, ord, visibility, created_by, created_at, updated_by, updated_at) VALUES
    ('pub', 'ada', 'notes', 'General', '{"text":"Public"}', 0, 'family', 'Seed', '2026-01-01T00:00:00Z', 'Seed', '2026-01-01T00:00:00Z'),
    ('priv', 'ada', 'medical', 'Condition', '{"note":"Private"}', 1, 'editors', 'Seed', '2026-01-01T00:00:00Z', 'Seed', '2026-01-01T00:00:00Z')`);
  d.close();
}

// Runs before the fields of a person are read: the moment between the two reads that `editSnapshot` makes.
let beforeFields: (() => Promise<void>) | null = null;
const realTree = store.tree;
store.tree = (id: string): Db => {
  const inner = realTree(id);
  return {
    ...inner,
    all: (async (sql: string, ...params: Param[]) => {
      if (beforeFields && sql.startsWith('SELECT * FROM person_field')) await beforeFields();
      return inner.all(sql, ...params);
    }) as Db['all'],
  };
};
test.after(() => {
  store.tree = realTree;
  rmSync(dir, { recursive: true, force: true });
});

/** The snapshot's list of fields, as the rebase compares them. */
const asRebase = (s: EditSnapshot): RebaseField[] =>
  s.fields.map((f) => ({ key: f.id, id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));
/** The snapshot's scalars and fields, as the Edit tab's draft holds them (only the ones these tests change). */
const asValues = (s: EditSnapshot) => ({ given: s.given, nickname: s.nickname ?? '', title: s.title ?? '', fields: asRebase(s) });

test('a change between the reads is read again: the snapshot’s names and its revision are from one moment', async () => {
  let fired = false;
  beforeFields = async () => {
    if (fired) return;
    fired = true;
    await db(TREE).run("UPDATE person SET given = 'Ada Lovelace' WHERE id = 'ada'");
  };
  try {
    const snap = await editSnapshot(TREE, 'ada', EDITOR);
    assert.equal(snap.given, 'Ada Lovelace', 'the name changed between the two reads is in the snapshot');
    assert.equal(snap.revision, (await person(TREE, 'ada')).revision, 'and the revision is the one it was read at');
  } finally {
    beforeFields = null;
  }
});

test('a person who keeps changing while being read is refused after three reads, never returned as a mix', async () => {
  let n = 0;
  beforeFields = async () => {
    n++;
    await db(TREE).run('UPDATE person SET nickname = ? WHERE id = ?', `nick ${n}`, 'ada');
  };
  try {
    await assert.rejects(editSnapshot(TREE, 'ada', EDITOR), /changed while this was loaded/);
    assert.equal(n, 3, 'it read three times, then stopped');
  } finally {
    beforeFields = null;
  }
});

test('private fields are in the snapshot for editors only, as the person read gives them', async () => {
  const editor = await editSnapshot(TREE, 'ada', EDITOR);
  const reader = await editSnapshot(TREE, 'ada', VIEWER);
  assert.deepEqual(editor.fields.map((f) => f.id).sort(), ['priv', 'pub']);
  assert.deepEqual(reader.fields.map((f) => f.id), ['pub']);
});

test('the reader’s draft, rebased on a snapshot taken across a race, saves the other editor’s name and the reader’s nickname', async () => {
  // The reader opens the draft at the current revision and changes only the nickname.
  const opened = await editSnapshot(TREE, 'ada', EDITOR);
  const draft = { ...asValues(opened), nickname: 'my nickname' };
  // Someone else saves the name, so the draft is stale: the save is refused, the names are not overwritten.
  await db(TREE).run("UPDATE person SET given = 'Ada Lovelace' WHERE id = 'ada'");
  await assert.rejects(
    savePersonEdit(TREE, 'ada', { ...detailsOf(opened), nickname: 'my nickname' }, [], opened.revision, undefined, 'Reader', EDITOR),
    (e: Error) => e.message === CHANGED_SINCE_OPENED,
  );
  // "Load the latest": a third edit lands between the two reads of the snapshot.
  let fired = false;
  beforeFields = async () => {
    if (fired) return;
    fired = true;
    await db(TREE).run("UPDATE person SET title = 'Changed elsewhere' WHERE id = 'ada'");
  };
  let latest: EditSnapshot;
  try {
    latest = await editSnapshot(TREE, 'ada', EDITOR);
  } finally {
    beforeFields = null;
  }
  assert.equal(latest.given, 'Ada Lovelace');
  assert.equal(latest.title, 'Changed elsewhere');
  const { values, conflicts } = rebaseDraft(asValues(opened), draft, asValues(latest));
  assert.deepEqual(conflicts, [], 'the reader did not change what the other editors changed');
  // The save goes at the revision the snapshot was read at, and writes the rebased values.
  const fields: FieldInput[] = values.fields.map((f) => ({ id: f.id, type: f.type as FieldType, label: f.label, value: f.value, visibility: f.visibility }));
  await savePersonEdit(TREE, 'ada', { ...detailsOf(latest), given: values.given, nickname: values.nickname, title: values.title }, fields, latest.revision, undefined, 'Reader', EDITOR);
  const after = await db(TREE).get<{ given: string; nickname: string; title: string }>('SELECT given, nickname, title FROM person WHERE id = ?', 'ada');
  assert.deepEqual({ ...after }, { given: 'Ada Lovelace', nickname: 'my nickname', title: 'Changed elsewhere' });
  assert.equal((await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM person_field WHERE person = ?', 'ada'))!.n, 2, 'the private field is kept');
});

/** The Edit tab's scalars for a person, from a snapshot (the names and the facts the snapshot holds). */
function detailsOf(s: EditSnapshot) {
  return {
    given: s.given, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname,
    sex: s.sex, born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title,
    epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
  };
}
