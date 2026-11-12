// What families in Durable Objects must do, beyond the database contract (./contract.cases.ts): made on demand, migrated
// once and in order, listed beside the bound D1 families, dropped completely, and refused in a demo. The cases run inside
// workerd on the real Cloudflare driver (./durable.worker.ts); ./durable.test.ts runs them, phase by phase, and restarts
// the Worker in between to upgrade it, turn it into a demo or move it to another jurisdiction.
import assert from 'node:assert/strict';
import { move } from './move.server.ts';
import { q, store } from './index.ts';

const migrationsOf = async (tree: string) => (await store.tree(tree).all<{ name: string }>('SELECT name FROM d1_migrations ORDER BY id')).map((r) => r.name);
const registry = async () => (await store.accounts().all<{ tree: string; driver: string }>('SELECT tree, driver FROM family_store ORDER BY tree')).map((r) => `${r.tree}:${r.driver}`);

export const durableCases: Record<string, (expect: string[]) => Promise<void>> = {
  /** A family nobody made is not there: not listed, and its queries say so. Making it makes it, once. */
  'a family is made on demand and listed': async (files) => {
    await assert.rejects(store.tree('ash').all('SELECT 1'), /no tree ash/);
    assert.ok(!(await store.treeIds()).includes('ash'));
    assert.ok(store.canMakeTree('ash') && store.canMakeTree());
    const d = await store.ensureTree('ash');
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
   * A family still served by its D1 binding is copied into its Durable Object step by step (POST /api/move): only INSERTs
   * go in, the counts come back, a second copy needs `replace`, and D1 keeps serving it until the binding is removed.
   * Deleting the family then takes the copy too.
   */
  'a family moves into its Durable Object step by step': async () => {
    assert.deepEqual(await move('old', { step: 'begin' }), { ok: true, serving: false });
    await move('old', { step: 'rows', statements: ["INSERT INTO meta (key, value) VALUES ('id', 'old');", "INSERT OR REPLACE INTO person (id, given) VALUES ('o1', 'Olga')"] });
    await assert.rejects(move('old', { step: 'rows', statements: ['DELETE FROM person'] }), /Only INSERT/);
    await assert.rejects(move('old', { step: 'rows', statements: ["INSERT INTO d1_migrations (name) VALUES ('x')"] }), /Only INSERT/);
    await assert.rejects(move('old', { step: 'rows', statements: ["INSERT INTO person (id, given) VALUES ('o2', 'x'); DELETE FROM meta"] }), /One statement/);
    assert.deepEqual(await move('old', { step: 'finish', tables: ['meta', 'person'] }), { ok: true, serving: false, counts: { meta: 1, person: 1 } });
    await assert.rejects(move('old', { step: 'begin' }), /already holds a family/);
    await move('old', { step: 'begin', replace: true });
    assert.deepEqual((await move('old', { step: 'finish', tables: ['person'] })).counts, { person: 0 });
    // D1 still serves it, and the family is listed once.
    await assert.rejects(store.tree('old').all('SELECT * FROM meta'), /no such table/);
    assert.equal((await store.treeIds()).filter((id) => id === 'old').length, 1);
    assert.ok((await registry()).includes('old:durable-object'));
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
