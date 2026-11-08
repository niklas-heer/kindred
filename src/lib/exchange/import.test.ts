// The import against a real family database: a scratch family under a temporary KINDRED_DATA_DIR (never data/).
// The store reads KINDRED_DATA_DIR when it loads, so the environment is set before anything is imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-import-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('../store/node.ts');
const { writeGedcom } = await import('./gedcom.ts');
const { fixtureTree } = await import('./fixture.ts');
const { readTree } = await import('./model.ts');
const { db } = await import('../db.server.ts');
const { applyImport, previewImport } = await import('./import.server.ts');

/** An empty family database with the tree schema, as the app creates one. */
function emptyFamily(id: string) {
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Scratch ${id}'), ('tagline', 'test'), ('theme', 'modern'), ('focus', '')`);
  d.close();
}

const text = writeGedcom(fixtureTree(), new Date('2026-11-08T12:00:00Z')).text;

test('a preview of an import into an empty family says what would be added, and writes nothing', async () => {
  emptyFamily('empty');
  const p = await previewImport('empty', text);
  assert.equal(p.addCount, 8);
  assert.equal(p.matchCount, 0);
  assert.equal(p.parents, 8);
  assert.equal(p.unions, 3);
  assert.equal((await readTree(db('empty'))).people.length, 0, 'nothing was written');
});

test('applying the import writes the family, and reading it back gives the same people and links', async () => {
  emptyFamily('target');
  const result = await applyImport('target', text, undefined, false);
  assert.deepEqual(result, { people: 8, parents: 8, unions: 3, matched: 0 });
  const back = await readTree(db('target'));
  const want = fixtureTree();
  assert.equal(back.people.length, 8);
  const anna = back.people.find((p) => p.id === 'anna')!;
  assert.equal(anna.born, '~1900');
  assert.equal(anna.bio?.split('\n')[0], 'Anna kept the bakery on the square and wrote @letters@ to every cousin she had, every Sunday, for forty years.');
  assert.equal(back.parents.length, want.parents.length);
  assert.equal(back.unions.length, want.unions.length);
  const greta = back.people.find((p) => p.id === 'greta')!;
  assert.equal(greta.currentSurname, 'Linden');
  assert.equal(greta.surname, 'Berg');
  const karlGreta = back.unions.find((u) => u.id === 'u-karl-greta')!;
  assert.equal(karlGreta.endReason, 'death');
  assert.equal(karlGreta.end, '1960');
});

test('a family that already has people refuses the import unless the steward says to add to it', async () => {
  await assert.rejects(applyImport('target', text, undefined, false), /already has 8 people/);
});

test('adding a file to a family that already has its people matches them and writes nothing new', async () => {
  const result = await applyImport('target', text, undefined, true);
  assert.deepEqual(result, { people: 0, parents: 0, unions: 0, matched: 8 });
  assert.equal((await readTree(db('target'))).people.length, 8);
});

test('a preview of a different family’s file lists the conflicts without changing anything', async () => {
  const changed = text.replace('2 DATE 14 JUN 1971', '2 DATE 14 JUN 1972');
  const p = await previewImport('target', changed);
  assert.equal(p.conflictCount, 1);
  assert.deepEqual(p.conflicts[0], { name: 'Anna Linden', field: 'died', existing: '1971-06-14', incoming: '1972-06-14' });
  assert.equal((await readTree(db('target'))).people.find((x) => x.id === 'anna')!.died, '1971-06-14');
});

test('an import with the same key and the same change is replayed, not written twice', async () => {
  emptyFamily('keyed');
  const op = { key: 'a1b2c3d4e5f60708', user: 'steward-1', payload: { text, allowExisting: false } };
  const first = await applyImport('keyed', text, op, false);
  const again = await applyImport('keyed', text, op, false);
  assert.deepEqual(again, first);
  assert.equal((await readTree(db('keyed'))).people.length, 8);
});

test('a key sent again with a different file is refused, not written', async () => {
  const op = { key: 'a1b2c3d4e5f60708', user: 'steward-1', payload: { text: 'other', allowExisting: false } };
  await assert.rejects(applyImport('keyed', text, op, false), /already sent as something else/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a file that would make someone their own ancestor previews the loop as a conflict, and is refused whole', async () => {
  emptyFamily('loops');
  const loop = [
    '0 HEAD', '0 @a@ INDI', '1 NAME Ann /Loop/', '0 @b@ INDI', '1 NAME Ben /Loop/',
    '0 @F1@ FAM', '1 HUSB @a@', '1 CHIL @b@', '0 @F2@ FAM', '1 HUSB @b@', '1 CHIL @a@', '0 TRLR',
  ].join('\n') + '\n';
  const preview = await previewImport('loops', loop);
  assert.equal(preview.conflicts.filter((c) => c.field === 'parent').length, 1, 'the loop is shown in the preview');
  assert.ok(preview.issues.some((i) => i.level === 'loss'));
  await assert.rejects(applyImport('loops', loop, undefined, false), /would make someone their own ancestor/);
  assert.equal((await db('loops').get<{ n: number }>('SELECT count(*) AS n FROM person'))!.n, 0, 'nothing was written');
  assert.equal((await db('loops').get<{ n: number }>('SELECT count(*) AS n FROM parent'))!.n, 0);
});
