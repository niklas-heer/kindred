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
const { store } = await import('../store/index.ts');
import type { Db } from '../store/index.ts';
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
  assert.deepEqual(result, { people: 8, parents: 8, unions: 3, matched: 0, places: { located: 0, unplaced: 2 } });
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
  // The refusal is a translation key: the app shows it in the reader's language.
  await assert.rejects(applyImport('target', text, undefined, false), { message: 'exchange.import.needAllow' });
});

test('adding a file to a family that already has its people matches them and writes nothing new', async () => {
  const result = await applyImport('target', text, undefined, true);
  assert.deepEqual(result, { people: 0, parents: 0, unions: 0, matched: 8, places: { located: 0, unplaced: 0 } });
  assert.equal((await readTree(db('target'))).people.length, 8);
});

test('a preview of a different family’s file lists the conflicts without changing anything', async () => {
  const changed = text.replace('2 DATE 14 JUN 1971', '2 DATE 14 JUN 1972');
  const p = await previewImport('target', changed);
  assert.equal(p.conflictCount, 1);
  const [c] = p.conflicts;
  assert.deepEqual(
    { name: c.name, field: c.field, code: c.code, kind: c.kind, existing: c.existing, incoming: c.incoming, vars: c.vars },
    {
      name: 'Anna Linden',
      field: 'died',
      code: 'exchange.conflict.field.died',
      kind: 'value',
      existing: '1971-06-14',
      incoming: '1972-06-14',
      vars: { name: 'Anna Linden', existing: '1971-06-14', incoming: '1972-06-14' },
    },
  );
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
  assert.ok(preview.issues.some((i) => i.level === 'loss' && i.code === 'exchange.issue.cycles' && i.vars.count === 1));
  assert.equal(preview.conflicts.find((c) => c.field === 'parent')?.kind, 'cycle');
  await assert.rejects(applyImport('loops', loop, undefined, false), { message: 'exchange.cycle_refused' });
  assert.equal((await db('loops').get<{ n: number }>('SELECT count(*) AS n FROM person'))!.n, 0, 'nothing was written');
  assert.equal((await db('loops').get<{ n: number }>('SELECT count(*) AS n FROM parent'))!.n, 0);
});

test('a parent link another editor replaces between the plan and the write is caught: the import plans again and refuses the loop', async () => {
  emptyFamily('race');
  const r = db('race');
  await r.run("INSERT INTO person (id, given, surname, living) VALUES ('ann', 'Ann', 'Race', 1), ('ben', 'Ben', 'Race', 1), ('cat', 'Cat', 'Race', 1)");
  await r.run("INSERT INTO parent (child, parent) VALUES ('ben', 'ann')");
  // The file says Ben is Cat's parent. Alone, that is fine: Ann is Ben's parent, and nothing above Cat is Ben.
  const file = ['0 HEAD', '0 @ben@ INDI', '1 NAME Ben /Race/', '0 @cat@ INDI', '1 NAME Cat /Race/', '0 @F1@ FAM', '1 HUSB @ben@', '1 CHIL @cat@', '0 TRLR'].join('\n') + '\n';
  assert.equal((await previewImport('race', file)).conflictCount, 0, 'the file alone is fine');

  // Between the plan and the batch, another editor removes Ann → Ben and makes Cat → Ben: still one parent link, so the
  // count the import used to guard does not move, and the new link closes a loop with the one the import would add.
  const realTree = store.tree;
  let raced = false;
  store.tree = (id: string): Db => {
    const inner = realTree(id);
    if (id !== 'race') return inner;
    return {
      ...inner,
      batch: async (qs) => {
        if (!raced) {
          raced = true;
          await inner.run("DELETE FROM parent WHERE child = 'ben' AND parent = 'ann'");
          await inner.run("INSERT INTO parent (child, parent) VALUES ('ben', 'cat')");
        }
        return inner.batch(qs);
      },
    } as Db;
  };
  try {
    await assert.rejects(applyImport('race', file, undefined, true), { message: 'exchange.cycle_refused' });
  } finally {
    store.tree = realTree;
  }
  assert.ok(raced, 'the race was injected before the write');
  const links = (await r.all<{ child: string; parent: string }>('SELECT child, parent FROM parent ORDER BY child, parent')).map((l) => ({ ...l }));
  assert.deepEqual(links, [{ child: 'ben', parent: 'cat' }], 'the other editor’s link is kept and the import wrote no loop');
  assert.equal((await r.get<{ n: number }>('SELECT count(*) AS n FROM person'))!.n, 3, 'and no person was added');
});

/**
 * A family with about 30,000 parent links: 2,000 people with UUID ids, each with up to 15 parents among the people
 * before them. The old guard put every link in one JSON parameter, about 2.4 MB here, over D1's 2 MB limit.
 */
function manyLinksFamily(id: string) {
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Many ${id}'), ('tagline', 'test'), ('theme', 'modern'), ('focus', '')`);
  const ids = Array.from({ length: 2000 }, () => crypto.randomUUID());
  const sql = ['BEGIN;'];
  ids.forEach((pid, i) => sql.push(`INSERT INTO person (id, given, surname, living) VALUES ('${pid}', 'P${i}', 'Many', 1);`));
  ids.forEach((pid, i) => {
    for (let k = 1; k <= 15 && k <= i; k++) sql.push(`INSERT INTO parent (child, parent) VALUES ('${pid}', '${ids[i - k]}');`);
  });
  sql.push('COMMIT;');
  d.exec(sql.join('\n'));
  d.close();
  return ids;
}

test('a small import into a family with about 30,000 parent links is written: the guard is one number, not the links', async () => {
  manyLinksFamily('many');
  const links = (await db('many').get<{ n: number }>('SELECT count(*) AS n FROM parent'))!.n;
  assert.ok(links > 29_000, `the family has ${links} links`);
  const result = await applyImport('many', text, undefined, true);
  assert.deepEqual(result, { people: 8, parents: 8, unions: 3, matched: 0, places: { located: 0, unplaced: 2 } });
  assert.equal((await db('many').get<{ n: number }>('SELECT count(*) AS n FROM parent'))!.n, links + 8);
});

test('another editor replacing one of those links, one for one, between the plan and the write makes the import plan again', async () => {
  const ids = manyLinksFamily('many-race');
  const r = db('many-race');
  // The other editor moves one link from the person 15 places back to the first person: the count stays the same.
  const realTree = store.tree;
  let raced = false;
  store.tree = (id: string): Db => {
    const inner = realTree(id);
    if (id !== 'many-race') return inner;
    return {
      ...inner,
      batch: async (qs) => {
        if (!raced) {
          raced = true;
          await inner.run('DELETE FROM parent WHERE child = ? AND parent = ?', ids[1500], ids[1485]);
          await inner.run('INSERT INTO parent (child, parent) VALUES (?, ?)', ids[1500], ids[0]);
        }
        return inner.batch(qs);
      },
    } as Db;
  };
  try {
    const result = await applyImport('many-race', text, undefined, true);
    assert.deepEqual(result, { people: 8, parents: 8, unions: 3, matched: 0, places: { located: 0, unplaced: 2 } });
  } finally {
    store.tree = realTree;
  }
  assert.ok(raced, 'the replacement was made before the first write');
  const kept = await r.get<{ n: number }>('SELECT count(*) AS n FROM parent WHERE child = ? AND parent = ?', ids[1500], ids[0]);
  assert.equal(kept!.n, 1, 'the other editor’s link is kept');
});
