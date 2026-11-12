// What families in Durable Objects must do, beyond the database contract (./contract.cases.ts): made on demand, migrated
// once and in order, listed beside the bound D1 families, dropped completely, and refused in a demo. The cases run inside
// workerd on the real Cloudflare driver (./durable.worker.ts); ./durable.test.ts runs them, phase by phase, and restarts
// the Worker in between to upgrade it, turn it into a demo or move it to another jurisdiction.
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { move, type Importer, type MoveStep } from './move.server.ts';
import { q, store } from './index.ts';

const migrationsOf = async (tree: string) => (await store.tree(tree).all<{ name: string }>('SELECT name FROM d1_migrations ORDER BY id')).map((r) => r.name);
const registry = async () => (await store.accounts().all<{ tree: string; driver: string }>('SELECT tree, driver FROM family_store ORDER BY tree')).map((r) => `${r.tree}:${r.driver}`);

export const durableCases: Record<string, (expect: string[]) => Promise<void>> = {
  /** A family nobody made is not there: not listed, and its queries say so. Making it makes it, once. */
  'a family is made on demand and listed': async (files) => {
    await assert.rejects(store.tree('ash').all('SELECT 1'), /no tree ash/);
    assert.ok(!(await store.treeIds()).includes('ash'));
    assert.ok(store.canMakeTree('ash') && store.canMakeTree());
    // Visits record nothing about where the objects are kept: only making something worth keeping does (a family, setup).
    const media = env.MEDIA as R2Bucket;
    assert.equal(await media.get('.kindred/store.json'), null, 'a visit writes no jurisdiction marker');
    const d = await store.ensureTree('ash');
    assert.ok(await media.get('.kindred/store.json'), 'making a family records where it is kept');
    await d.run("INSERT INTO meta (key, value) VALUES ('id', 'ash')");
    assert.deepEqual(await migrationsOf('ash'), files, 'every tree migration, in order');
    // Again: nothing is applied twice, and the family keeps what it holds.
    await store.ensureTree('ash');
    assert.deepEqual(await migrationsOf('ash'), files);
    assert.equal((await store.tree('ash').get<{ value: string }>("SELECT value FROM meta WHERE key = 'id'"))?.value, 'ash');
    assert.ok((await store.treeIds()).includes('ash'));
    assert.deepEqual(await registry(), ['ash:durable-object']);
  },

  /** Bound D1 families are listed and served from D1; Durable Object families beside them. Neither shadows the other. */
  'bound D1 families and Durable Object families are listed together': async () => {
    await store.ensureTree('birch');
    const ids = await store.treeIds();
    assert.ok(ids.includes('old') && ids.includes('ash') && ids.includes('birch'), ids.join());
    // `old` is a bound D1 database without the schema: its query reaches D1 (no such table), not a Durable Object (no tree).
    await assert.rejects(store.tree('old').all('SELECT * FROM meta'), /no such table/);
    await store.ensureTree('old').catch(() => {});
    assert.ok(!(await registry()).some((r) => r.startsWith('old:')), 'a D1 family is never recorded as a Durable Object');
  },

  /** A batch is one transaction in the object: a failing statement leaves nothing of the batch. A blob comes back as bytes. */
  'a failing batch writes nothing, and a blob comes back as the same bytes': async () => {
    const d = store.tree('ash');
    await assert.rejects(d.batch([q("INSERT INTO person (id, given) VALUES ('p1', 'One')"), q("INSERT INTO person (id, given) VALUES ('p1', 'Twice')")]), /UNIQUE|PRIMARY KEY/);
    assert.equal((await d.get<{ n: number }>('SELECT count(*) AS n FROM person'))?.n, 0);
    await d.run('CREATE TABLE IF NOT EXISTS probe_blob (b BLOB)');
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256);
    await d.run('INSERT INTO probe_blob (b) VALUES (?)', bytes);
    const got = (await d.get<{ b: unknown }>('SELECT b FROM probe_blob'))!.b;
    assert.ok(got instanceof Uint8Array, Object.prototype.toString.call(got));
    assert.deepEqual([...got], [...bytes]);
    await d.run('DROP TABLE probe_blob');
  },

  /** After an upgrade the object applies only the new file, after the old ones, before it answers. */
  'an upgrade applies only the new migration': async (files) => {
    assert.deepEqual(await migrationsOf('ash'), files);
    assert.equal((await store.tree('ash').get<{ value: string }>("SELECT value FROM meta WHERE key = 'id'"))?.value, 'ash', 'the family is still there');
    assert.deepEqual(await store.tree('ash').all("SELECT name FROM sqlite_master WHERE name = 'upgrade_probe'"), [{ name: 'upgrade_probe' }]);
    // A family made after the upgrade gets every file at once.
    await store.ensureTree('cedar');
    assert.deepEqual(await migrationsOf('cedar'), files);
  },

  /** Dropping deletes everything the object stores and its registry row; the id can be made again, empty. */
  'a dropped family is gone and can be made again empty': async (files) => {
    await store.tree('birch').run("INSERT INTO person (id, given) VALUES ('b1', 'Birch')");
    await store.dropTree('birch');
    await assert.rejects(store.tree('birch').all('SELECT 1'), /no tree birch/);
    assert.ok(!(await store.treeIds()).includes('birch'));
    assert.ok(!(await registry()).some((r) => r.startsWith('birch:')));
    const again = await store.ensureTree('birch');
    assert.equal((await again.get<{ n: number }>('SELECT count(*) AS n FROM person'))?.n, 0);
    assert.deepEqual(await migrationsOf('birch'), files);
  },

  /**
   * An import (POST /api/move) writes values only, into a staged object that serves nothing, bound to the account that began
   * it, and publishes the family only when every announced count matches. A copy of a family D1 serves is its stewards'; a
   * new family is free only when the server has no family, no member and no open invitation under that id.
   */
  'a family is imported step by step, staged until it is complete': async (files) => {
    const schema = files.at(-1)!;
    const now = Date.now();
    await store.accounts().batch([
      q("INSERT INTO user (id, name, handle, created) VALUES ('u-imp', 'Imogen', 'h-imp', ?), ('u-op', 'Orla', 'h-op', ?), ('u-other', 'Otto', 'h-other', ?)", now, now, now),
    ]);
    const imogen: Importer = { id: 'u-imp', steward: false, mayCreate: async () => true };
    const fern = (tables: Record<string, number>) => ({ step: 'begin' as const, schema, tables });

    // A new family: staged, so neither listed nor served, until it is finished.
    const begun = await move('fern', fern({ meta: 2, person: 2 }), imogen);
    assert.equal(begun.mode, 'new');
    const imp = String(begun.import);
    await move('fern', { step: 'rows', import: imp, table: 'meta', columns: ['key', 'value'], rows: [['id', 'fern'], ['name', 'The Ferns']] }, imogen);
    await move('fern', { step: 'rows', import: imp, table: 'person', columns: ['id', 'given'], rows: [['f1', 'Flora']] }, imogen);
    await assert.rejects(store.tree('fern').all('SELECT * FROM person'), /no tree fern/, 'a staged family is not served');
    assert.ok(!(await store.treeIds()).includes('fern'), 'a staged family is not listed');
    // Only values: no table, column or value can carry SQL, and nothing outside the family's tables can be written.
    const refused = (step: object, re: RegExp) => assert.rejects(move('fern', { step: 'rows', import: imp, ...step } as MoveStep, imogen), re);
    await refused({ table: 'd1_migrations', columns: ['name'], rows: [['x']] }, /not announced/);
    await refused({ table: 'person', columns: ['id', 'given) SELECT 1 --'], rows: [['x', 'y']] }, /no column/);
    await refused({ table: 'person', columns: ['id', 'secret'], rows: [['x', 'y']] }, /no column/);
    await refused({ table: 'person', columns: ['id', 'given'], rows: [['f2', { sql: "(SELECT value FROM meta WHERE key = 'name')" }]] }, /must be text, a number/);
    // A step without the import's id, or from someone else, is refused.
    await assert.rejects(move('fern', { step: 'rows', import: crypto.randomUUID(), table: 'person', columns: ['id'], rows: [['f9']] }, imogen), /No import of fern by you/);
    await assert.rejects(move('fern', { step: 'rows', import: imp, table: 'person', columns: ['id'], rows: [['f9']] }, { ...imogen, id: 'u-other' }), /No import of fern by you/);
    await assert.rejects(move('fern', { step: 'begin', schema, tables: { meta: 1 } }, { ...imogen, id: 'u-other' }), /Someone else is importing/);
    // Incomplete: nothing is published.
    await assert.rejects(move('fern', { step: 'finish', import: imp }, imogen), /incomplete \(person: announced 2, holds 1\)/);
    assert.ok(!(await store.treeIds()).includes('fern'));
    await move('fern', { step: 'rows', import: imp, table: 'person', columns: ['id', 'given'], rows: [['f2', 'Fenna']] }, imogen);
    const done = await move('fern', { step: 'finish', import: imp }, imogen);
    assert.deepEqual(done, { ok: true, mode: 'new', serving: true, counts: { meta: 2, person: 2 } });
    assert.equal((await store.tree('fern').get<{ n: number }>('SELECT count(*) AS n FROM person'))?.n, 2, 'published: served');
    assert.ok((await store.treeIds()).includes('fern'));
    assert.deepEqual(await store.accounts().all('SELECT user, role FROM membership WHERE tree = ?', 'fern'), [{ user: 'u-imp', role: 'steward' }]);
    await assert.rejects(move('fern', { step: 'rows', import: imp, table: 'person', columns: ['id'], rows: [['f3']] }, imogen), /finished/);

    // A family served from its object is never imported into, by anyone; nor one that waits for its invited steward.
    await assert.rejects(move('fern', { step: 'begin', schema, tables: { meta: 1 }, replace: true }, { ...imogen, steward: true }), /a family on this server already/);
    await assert.rejects(move('ash', { step: 'begin', schema, tables: { meta: 1 }, replace: true }, imogen), /a family on this server already/);
    await store.accounts().run("INSERT INTO invite (id, hash, tree, role, expires, created, created_by) VALUES ('inv-g', 'hash-g', 'gorse', 'steward', ?, ?, 'u-op')", now + 86_400_000, now);
    await assert.rejects(move('gorse', fern({ meta: 1 }), imogen), /waits for the steward it invited/);
    // Nobody may make families: refused. A schema that is not this Worker's: refused.
    await assert.rejects(move('heath', fern({ meta: 1 }), { ...imogen, mayCreate: async () => false }), /may not make families/);
    await assert.rejects(move('heath', { step: 'begin', schema: '0001_initial.sql', tables: { meta: 1 } }, imogen), /schema/);
    // A family made while an import of its id was staged starts empty, and the import cannot go on.
    const heath = String((await move('heath', fern({ meta: 1 }), imogen)).import);
    await move('heath', { step: 'rows', import: heath, table: 'meta', columns: ['key', 'value'], rows: [['id', 'heath']] }, imogen);
    const made = await store.ensureTree('heath');
    assert.equal((await made.get<{ n: number }>('SELECT count(*) AS n FROM meta'))?.n, 0);
    await assert.rejects(move('heath', { step: 'rows', import: heath, table: 'meta', columns: ['key', 'value'], rows: [['name', 'x']] }, imogen), /a family on this server already/);

    // A family D1 still serves: copied by a steward only (an operator is not one), and D1 keeps serving it.
    await assert.rejects(move('old', fern({ meta: 1 }), { id: 'u-op', steward: false, mayCreate: async () => true }), /Only a steward of old/);
    const sten: Importer = { id: 'u-imp', steward: true, mayCreate: async () => false };
    const copy = await move('old', fern({ meta: 1 }), sten);
    assert.deepEqual([copy.mode, copy.serving], ['copy', false]);
    await move('old', { step: 'rows', import: String(copy.import), table: 'meta', columns: ['key', 'value'], rows: [['id', 'old']] }, sten);
    await move('old', { step: 'finish', import: String(copy.import) }, sten);
    await assert.rejects(store.tree('old').all('SELECT * FROM meta'), /no such table/, 'D1 still serves it');
    assert.equal((await store.treeIds()).filter((id) => id === 'old').length, 1);
    assert.ok((await registry()).includes('old:durable-object'));
    assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM membership WHERE tree = 'old'"))?.n, 0, 'a copy grants nobody anything');
    await assert.rejects(move('old', fern({ meta: 1 }), sten), /already holds a copy/);
    await store.dropTree('old');
    assert.ok(!(await registry()).some((r) => r.startsWith('old:')), 'deleting the family takes the copy too');
  },

  /** A demo refuses every write, making and dropping a family included; reads still work. */
  'a demo refuses to make, change or drop a family': async () => {
    await assert.rejects(store.ensureTree('newcomer'), /demo/i);
    await assert.rejects(store.dropTree('ash'), /demo/i);
    await assert.rejects(store.tree('ash').run("INSERT INTO person (id, given) VALUES ('x', 'X')"), /demo/i);
    await assert.rejects(store.tree('ash').batch([q('DELETE FROM person')]), /demo/i);
    assert.equal((await store.tree('ash').get<{ value: string }>("SELECT value FROM meta WHERE key = 'id'"))?.value, 'ash');
    assert.ok(!(await store.treeIds()).includes('newcomer'));
  },

  /** A changed KINDRED_JURISDICTION would reach other, empty objects: refused before any is reached. */
  'a changed jurisdiction is refused': async () => {
    await assert.rejects(store.tree('ash').all('SELECT 1'), /cannot be changed/);
    await assert.rejects(store.accounts().all('SELECT 1'), /cannot be changed/);
  },
};
