// What families in Durable Objects must do, beyond the database contract (./contract.cases.ts): made on demand, migrated
// once and in order, listed beside the bound D1 families, dropped completely, and refused in a demo. The cases run inside
// workerd on the real Cloudflare driver (./durable.worker.ts); ./durable.test.ts runs them, phase by phase, and restarts
// the Worker in between to upgrade it, turn it into a demo or move it to another jurisdiction.
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { move, type Importer, type MoveStep } from './move.server.ts';
import { q, store } from './index.ts';
import { backupName, deriveBackupKey, open, seal } from '../backup/kbak.ts';
import { decodeDump, encodeDump } from '../backup/dump.ts';

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
    const imogen: Importer = { id: 'u-imp', operator: false, steward: false, mayCreate: async () => true };
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
    await assert.rejects(move('old', fern({ meta: 1 }), { id: 'u-op', operator: false, steward: false, mayCreate: async () => true }), /Only a steward of old/);
    const sten: Importer = { id: 'u-imp', operator: false, steward: true, mayCreate: async () => false };
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

  /** An import that makes a new family follows the rules of making one: the account's limit, and the server's terms. */
  'an import that makes a family keeps the limit and the terms': async (files) => {
    const schema = files.at(-1)!;
    const now = Date.now();
    await store.accounts().batch([q("INSERT INTO user (id, name, handle, created) VALUES ('u-lim', 'Lia', 'h-lim', ?), ('u-opr', 'Ossian', 'h-opr', ?)", now, now)]);
    const set = (key: string, value: string) => q('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value, now);
    const lia: Importer = { id: 'u-lim', operator: false, steward: false, mayCreate: async () => true };
    const begin = (extra: Partial<Extract<MoveStep, { step: 'begin' }>> = {}): MoveStep => ({ step: 'begin', schema, tables: { meta: 1 }, ...extra });

    await store.accounts().batch([set('families_per_account', '0')]);
    await assert.rejects(move('limited', begin({ acceptTerms: true }), lia), /as many as an account may make/);
    await store.accounts().batch([set('families_per_account', '5'), set('terms', 'Be kind.')]);
    await assert.rejects(move('limited', begin(), lia), (e: Error) => /terms/i.test(e.message));
    const ok = await move('limited', begin({ acceptTerms: true }), lia);
    assert.equal(ok.mode, 'new');
    assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM terms_acceptance WHERE user = 'u-lim' AND family = 'limited'"))?.n, 1);
    // The limit holds when the families are recorded, not only when the imports begin: staged imports are not yet counted,
    // so three may begin under a limit of two, and finishing all three at once publishes exactly two.
    await store.accounts().batch([set('families_per_account', '2')]);
    const staged = await Promise.all(['lim-a', 'lim-b', 'lim-c'].map(async (tree) => {
      const id = String((await move(tree, begin({ acceptTerms: true }), lia)).import);
      await move(tree, { step: 'rows', import: id, table: 'meta', columns: ['key', 'value'], rows: [['id', tree]] }, lia);
      return [tree, id] as const;
    }));
    const finished = await Promise.allSettled(staged.map(([tree, id]) => move(tree, { step: 'finish', import: id }, lia)));
    assert.equal(finished.filter((r) => r.status === 'fulfilled').length, 2, 'two families published');
    const over = finished.find((r) => r.status === 'rejected');
    assert.match(String((over as PromiseRejectedResult).reason?.message), /as many as an account may make/);
    assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM family_admin WHERE created_by = 'u-lim'"))?.n, 2);
    assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM membership WHERE user = 'u-lim'"))?.n, 2);
    assert.equal((await store.treeIds()).filter((t) => ['lim-a', 'lim-b', 'lim-c'].includes(t)).length, 2, 'the third is not published');
    // Nor may a finish that comes later, one at a time: the account has made its two.
    await store.accounts().batch([set('families_per_account', '5')]);
    const late = String((await move('lim-d', begin({ acceptTerms: true }), lia)).import);
    await move('lim-d', { step: 'rows', import: late, table: 'meta', columns: ['key', 'value'], rows: [['id', 'lim-d']] }, lia);
    await store.accounts().batch([set('families_per_account', '2')]);
    await assert.rejects(move('lim-d', { step: 'finish', import: late }, lia), /as many as an account may make/);
    // And whoever may no longer make families cannot finish one either.
    await store.accounts().batch([set('families_per_account', '5')]);
    await assert.rejects(move('lim-d', { step: 'finish', import: late }, { ...lia, mayCreate: async () => false }), /may not make families/);
    assert.ok(!(await store.treeIds()).includes('lim-d'));
    // An operator wrote the terms and is not asked, and has no limit.
    const ossian: Importer = { id: 'u-opr', operator: true, steward: false, mayCreate: async () => true };
    await store.accounts().batch([set('families_per_account', '0')]);
    assert.equal((await move('opened', begin(), ossian)).mode, 'new');
    await store.accounts().batch([q("DELETE FROM instance_setting WHERE key IN ('families_per_account', 'terms')")]);
  },

  /**
   * A family in its Durable Object is backed up by the object itself into the bucket under `_backups/`, out of every family's
   * media; the drill restores it into a scratch object; a restore into a new id and over the family keep every row and BLOB;
   * a changed file and a file under another family's id do not open. The accounts object is backed up too.
   */
  'a Durable Object family is backed up, drilled and restored': async () => {
    const b = await import('../backup/backup.server.ts');
    const op = { id: 'u-bk', name: 'Bryn' };
    const now = Date.now();
    await store.accounts().batch([
      q("INSERT INTO user (id, name, handle, created, operator) VALUES ('u-bk', 'Bryn', 'h-bk', ?, 1), ('u-fir', 'Fenna', 'h-fir', ?, 0)", now, now),
    ]);
    const d = await store.ensureTree('fir');
    const blob = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13 + 1) % 256);
    await d.batch([
      q("INSERT INTO meta (key, value) VALUES ('id', 'fir'), ('name', 'The Firs')"),
      q("INSERT INTO person (id, given) VALUES ('f1', 'Aino'), ('f2', 'Bede')"),
      q('CREATE TABLE IF NOT EXISTS probe_blob (id INTEGER PRIMARY KEY, b BLOB)'),
      q('INSERT INTO probe_blob (id, b) VALUES (1, ?)', blob),
    ]);
    await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES ('u-fir', 'fir', 'steward', ?)", now);
    await store.media.put('fir', 'photo/one.jpg', Uint8Array.from([1, 2, 3]), 'image/jpeg');

    const m = await b.backUp('fir', new Date(now - 60_000));
    assert.equal(m.format, 'dump');
    assert.equal(m.counts.person, 2);
    const media = env.MEDIA as R2Bucket;
    const object = await media.get(`_backups/fir/${m.name}.kbak`);
    assert.ok(object, 'in the bucket under _backups/');
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    assert.ok(!new TextDecoder('latin1').decode(bytes).includes('Aino'), 'encrypted');
    assert.deepEqual((await store.media.list('fir')).map((f) => f.key), ['photo/one.jpg'], 'not among the family\'s files');
    const k = await deriveBackupKey(String((env as Record<string, unknown>).KINDRED_SECRET));
    assert.equal((await open(bytes, k, 'fir', m.name)).manifest.sha256, m.sha256);

    // The drill: a scratch object, checked with quick_check, row counts and schema as the manifest says.
    const r = await b.drill('fir');
    assert.deepEqual(r, { name: m.name, ok: true, problem: null });

    // Into a new id: every row and the BLOB, its own id, the original's steward, the pictures copied.
    await d.run("INSERT INTO person (id, given) VALUES ('f3', 'After')");
    const into = await b.restoreBackup(op, { scope: 'fir', name: m.name, mode: 'new', into: 'fir-two' });
    assert.deepEqual(into.media, { copied: 1, left: 0 });
    assert.equal(into.stewards, 1, 'the steward the backup recorded');
    const restored = store.tree('fir-two');
    assert.deepEqual((await restored.all<{ id: string }>('SELECT id FROM person ORDER BY id')).map((p) => p.id), ['f1', 'f2']);
    const back = (await restored.get<{ b: Uint8Array }>('SELECT b FROM probe_blob WHERE id = 1'))!.b;
    assert.ok(back instanceof Uint8Array);
    assert.deepEqual([...back], [...blob]);
    assert.equal((await restored.get<{ value: string }>("SELECT value FROM meta WHERE key = 'id'"))?.value, 'fir-two');
    assert.ok((await store.treeIds()).includes('fir-two'), 'listed in family_store');
    assert.equal((await store.accounts().get<{ role: string }>("SELECT role FROM membership WHERE user = 'u-fir' AND tree = 'fir-two'"))?.role, 'steward');
    assert.ok(await store.media.get('fir-two', 'photo/one.jpg'));

    // Over the family: a fresh backup first, then the backup in its place.
    const over = await b.restoreBackup(op, { scope: 'fir', name: m.name, mode: 'over', confirm: 'fir' });
    assert.ok(over.fresh && over.fresh !== m.name);
    assert.deepEqual((await store.tree('fir').all<{ id: string }>('SELECT id FROM person ORDER BY id')).map((p) => p.id), ['f1', 'f2']);
    await b.restoreBackup(op, { scope: 'fir', name: over.fresh!, mode: 'over', confirm: 'fir' });
    assert.deepEqual((await store.tree('fir').all<{ id: string }>('SELECT id FROM person ORDER BY id')).map((p) => p.id), ['f1', 'f2', 'f3']);

    // The object does not take a backup over a family unless the restore is over it.
    await assert.rejects(store.backups.restore('fir', m.name, 'fir-two'), /holds a family/);
    assert.deepEqual((await store.tree('fir-two').all<{ id: string }>('SELECT id FROM person ORDER BY id')).map((p) => p.id), ['f1', 'f2']);
    // A backup whose rows do not match its manifest is refused before anything of the family is deleted.
    const { manifest, plain } = await open(bytes, k, 'fir', m.name);
    const dump = decodeDump(plain);
    const people = dump.tables.find((t) => t.name === 'person')!;
    people.rows = people.rows.slice(1);
    const { kindred: _k, version: _v, size: _s, sha256: _h, keyId: _i, ...base } = manifest;
    await store.backups.write('fir', m.name, (await seal(base, encodeDump(dump), k)).bytes);
    await assert.rejects(store.backups.restore('fir', m.name, 'fir', { over: true }), /person: 1 rows, expected 2/);
    assert.deepEqual((await store.tree('fir').all<{ id: string }>('SELECT id FROM person ORDER BY id')).map((p) => p.id), ['f1', 'f2', 'f3'], 'untouched');
    await store.backups.write('fir', m.name, bytes);

    // A changed file fails the drill; the same file under another family's id cannot be read.
    const flipped = bytes.slice();
    flipped[flipped.length - 9]! ^= 4;
    await store.backups.write('fir', m.name, flipped);
    const bad = await store.backups.drill('fir', m.name);
    assert.equal(bad.ok, false);
    assert.match(bad.problem ?? '', /changed or damaged/);
    await store.backups.write('fir', m.name, bytes);
    await store.backups.write('fir-two', m.name, bytes);
    const moved = await store.backups.drill('fir-two', m.name);
    assert.equal(moved.ok, false);
    assert.match(moved.problem ?? '', /another database/);
    await assert.rejects(store.backups.restore('fir-two', m.name, 'fir-three'), /another database/);
    await store.backups.remove('fir-two', m.name);

    // The accounts database is backed up and drilled too.
    const a = await b.backUp('_accounts');
    assert.ok(a.counts.user >= 2);
    assert.equal((await b.drill('_accounts'))?.ok, true);
    // Nothing a drill made is left: no family, no listed object.
    assert.ok(!(await store.treeIds()).some((t) => t.startsWith('drill')));
  },

  /** Before a family's object applied new migrations it recorded a recovery point; local workerd cannot restore one. */
  'a recovery point is recorded before an upgrade': async (files) => {
    const b = await import('../backup/backup.server.ts');
    // The first answer after the upgrade reports the point to the accounts database.
    await store.tree('fir').all('SELECT 1');
    const points = await store.backups.recovery!.points('fir');
    const latest = points[0];
    assert.ok(latest, 'a point');
    // The first of the two new files, and the newest the family held before them.
    assert.equal(latest.before, files.at(-2));
    assert.equal(latest.held, files.at(-3));
    assert.equal(latest.reason, 'migration');
    const row = await store.accounts().get<{ id: number; before_migration: string }>("SELECT id, before_migration FROM recovery_point WHERE tree = 'fir' ORDER BY id DESC");
    assert.equal(row?.before_migration, files.at(-2));
    const overview = await b.backupOverview();
    assert.ok(overview.pitr);
    assert.equal(overview.families.find((f) => f.scope === 'fir')?.recovery[0]?.before, files.at(-2));
    // The rollback takes a fresh backup, then asks the object; local workerd keeps no history and says so.
    const op = { id: 'u-bk', name: 'Bryn' };
    const before = (await store.accounts().all("SELECT name FROM family_backup WHERE family = 'fir'")).length;
    await assert.rejects(b.rollbackFamily(op, 'fir', row!.id, 'fir'), /backup\.err\.no_pitr/);
    assert.equal((await store.accounts().all("SELECT name FROM family_backup WHERE family = 'fir'")).length, before + 1, 'a fresh backup first');
    await assert.rejects(b.rollbackFamily(op, 'fir', row!.id, 'firs'), /backup\.err\.confirm/);
    assert.equal((await store.tree('fir').get<{ value: string }>("SELECT value FROM meta WHERE key = 'id'"))?.value, 'fir', 'the family is untouched');
  },

  /** A demo refuses every write, making and dropping a family included; reads still work. */
  'a demo refuses to make, change or drop a family': async () => {
    await assert.rejects(store.backups.take('ash', backupName(new Date())), /demo/i);
    await assert.rejects(store.backups.restore('fir', backupName(new Date()), 'fir-demo'), /demo/i);
    await assert.rejects(store.backups.drill('fir', backupName(new Date())), /demo/i);
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
