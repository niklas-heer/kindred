// The database contract: what server code may rely on from `Db` and `once`, whichever driver is underneath. The same
// cases run on node:sqlite and, inside workerd, on the real Cloudflare driver with local D1 (./contract.test.ts). A
// behaviour that differs between the two belongs here, and gets fixed in the driver rather than at the call sites.
import assert from 'node:assert/strict';
import { added, db, once } from '../db.server.ts';
import { setHouseMembers } from '../houses.server.ts';
import { addPersonField, editSnapshot, savePersonEdit } from '../person.server.ts';
import type { Audience } from '../visibility.ts';
import { guard, isGuardError, isUniqueError, MAX_BOUND_PARAMS, q, store, type Db, type Param } from './index.ts';

export const TREE = 'modern';
const tree = (): Db => db(TREE);
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const addPerson = (id: string) => q('INSERT INTO person (id, given) VALUES (?, ?)', id, 'Contract');
const hasPerson = async (id: string) => !!(await tree().get('SELECT id FROM person WHERE id = ?', id));
const op = (user = 'u1', payload: unknown = { a: 1 }) => ({ key: uid('key'), user, payload });

/** A table of every storage class, for the cases that are about values rather than the family's schema. */
async function scratch(): Promise<Db> {
  const d = tree();
  await d.run('CREATE TABLE IF NOT EXISTS contract_value (id INTEGER PRIMARY KEY, txt TEXT, num REAL, int INTEGER, b BLOB, u TEXT UNIQUE)');
  return d;
}

/** node:sqlite rows have no prototype, which strict equality would count against them. */
const plain = (v: unknown): unknown => (Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' && !(v instanceof Uint8Array) ? { ...v } : v);
const same = (actual: unknown, expected: unknown) => assert.deepEqual(plain(actual), expected);

async function failure(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (e) {
    return e;
  }
  return assert.fail('expected this to fail');
}

export const contractCases: Record<string, () => Promise<void>> = {
  // ---------- who created a field (migration 0022) ----------

  'a field keeps the account that created it through every save, and only that account can make it personal': async () => {
    const person = uid('p');
    await tree().batch([addPerson(person)]);
    const anna: Audience = { account: 'acct-anna', role: 'editor', guest: false };
    const ben: Audience = { account: 'acct-ben', role: 'editor', guest: false };
    const fid = await addPersonField(TREE, person, { type: 'notes', label: '', value: { text: 'x' }, visibility: 'family' }, undefined, 'Anna', anna);
    const save = async (who: Audience, by: string, visibility: 'personal' | 'family', text: string) => {
      const s = await editSnapshot(TREE, person, who);
      await savePersonEdit(TREE, person, s, [{ id: fid, type: 'notes', label: '', value: { text }, visibility }], s.revision, undefined, by, who);
    };
    const row = () => tree().get('SELECT created_by, created_by_name, updated_by, visibility, owner FROM person_field WHERE id = ?', fid);
    await save(ben, 'Ben', 'family', 'y');
    same(await row(), { created_by: 'acct-anna', created_by_name: 'Anna', updated_by: 'Ben', visibility: 'family', owner: null });
    await assert.rejects(save(ben, 'Ben', 'personal', 'z'), /Only the person who added/);
    await save(anna, 'Anna', 'personal', 'z');
    same(await row(), { created_by: 'acct-anna', created_by_name: 'Anna', updated_by: 'Anna', visibility: 'personal', owner: 'acct-anna' });
  },

  'a field from before authors were recorded has none, and cannot be made personal': async () => {
    const person = uid('p');
    const fid = uid('f');
    await tree().batch([addPerson(person), q("INSERT INTO person_field (id, person, type, label, value, created_by_name) VALUES (?, ?, 'notes', '', '{\"text\":\"x\"}', 'Someone')", fid, person)]);
    same(await tree().get('SELECT created_by FROM person_field WHERE id = ?', fid), { created_by: null });
    const who: Audience = { account: 'acct-anna', role: 'editor', guest: false };
    const s = await editSnapshot(TREE, person, who);
    await assert.rejects(savePersonEdit(TREE, person, s, [{ id: fid, type: 'notes', label: '', value: { text: 'x' }, visibility: 'personal' }], s.revision, undefined, 'Anna', who), /Only the person who added/);
  },

  // ---------- batches and guards ----------

  'a batch whose guards hold runs in order and returns one result per statement': async () => {
    const a = uid('p');
    const results = await tree().batch([guard('1 = ?', 1), addPerson(a), q('UPDATE person SET epithet = ? WHERE id = ?', 'first', a), q('SELECT epithet FROM person WHERE id = ?', a)]);
    assert.equal(results.length, 4);
    same(results[3].rows, [{ epithet: 'first' }]);
  },

  'a failed guard undoes the writes before it and stops the ones after it': async () => {
    const before = uid('p');
    const after = uid('p');
    const e = await failure(() => tree().batch([addPerson(before), guard('1 = ?', 2), addPerson(after)]));
    assert.ok(isGuardError(e), `not read as a guard failure: ${String(e)}`);
    assert.ok(!isUniqueError(e), `read as a unique failure: ${String(e)}`);
    assert.equal(await hasPerson(before), false);
    assert.equal(await hasPerson(after), false);
  },

  'a guard stops a batch on the accounts database too': async () => {
    const e = await failure(() => store.accounts().batch([guard('1 = ?', 2)]));
    assert.ok(isGuardError(e), `not read as a guard failure: ${String(e)}`);
  },

  'a broken primary key undoes the batch and reads as a unique failure': async () => {
    const a = uid('p');
    const b = uid('p');
    const e = await failure(() => tree().batch([addPerson(a), addPerson(b), addPerson(a)]));
    assert.ok(isUniqueError(e), `not read as a unique failure: ${String(e)}`);
    assert.ok(!isGuardError(e), `read as a guard failure: ${String(e)}`);
    assert.equal(await hasPerson(a), false);
    assert.equal(await hasPerson(b), false);
  },

  'a broken UNIQUE column reads as a unique failure in a batch and alone': async () => {
    const d = await scratch();
    const u = uid('u');
    await d.run('INSERT INTO contract_value (u) VALUES (?)', u);
    assert.ok(isUniqueError(await failure(() => d.run('INSERT INTO contract_value (u) VALUES (?)', u))));
    assert.ok(isUniqueError(await failure(() => d.batch([q('INSERT INTO contract_value (u) VALUES (?)', u)]))));
  },

  'foreign keys are enforced and cascade': async () => {
    const child = uid('p');
    const parent = uid('p');
    const e = await failure(() => tree().run("INSERT INTO parent (child, parent) VALUES (?, ?)", child, parent));
    assert.match(String(e) + String((e as { cause?: unknown }).cause ?? ''), /FOREIGN KEY/);
    assert.ok(!isUniqueError(e) && !isGuardError(e));
    await tree().batch([addPerson(child), addPerson(parent), q('INSERT INTO parent (child, parent) VALUES (?, ?)', child, parent), q('DELETE FROM person WHERE id = ?', parent)]);
    same(await tree().all('SELECT child FROM parent WHERE child = ?', child), []);
  },

  'a chat row goes with its user, and a guard on it stops a batch for a chat that is gone': async () => {
    const d = store.accounts();
    const user = uid('u');
    const conv = uid('c');
    await d.run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', user, 'Contract', uid('h'), 1);
    await d.run('INSERT INTO ai_thread (tree, user, conv, created, updated) VALUES (?, ?, ?, ?, ?)', TREE, user, conv, 1, 2);
    const inThread = guard('EXISTS (SELECT 1 FROM ai_thread WHERE tree = ? AND user = ? AND conv = ?)', TREE, user, conv);
    const add = (id: string) => q('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, TREE, user, conv, 'user', '{"text":"hi","tier":"member","images":{"count":2}}', 3);
    const first = uid('m');
    await d.batch([inThread, add(first), q('UPDATE ai_thread SET updated = ? WHERE tree = ? AND user = ? AND conv = ?', 9, TREE, user, conv)]);
    same(await d.all('SELECT updated, title, title_tier, provider FROM ai_thread WHERE conv = ?', conv), [{ updated: 9, title: '', title_tier: 'member', provider: null }]);
    same(await d.all("SELECT json_extract(body, '$.tier') AS tier, json_extract(body, '$.images.count') AS pictures, substr(json_extract(body, '$.text'), 1, 400) AS text FROM ai_chat WHERE id = ?", first), [{ tier: 'member', pictures: 2, text: 'hi' }]);
    await d.batch([q('DELETE FROM ai_chat WHERE conv = ?', conv), q('DELETE FROM ai_thread WHERE conv = ?', conv)]);
    const e = await failure(() => d.batch([inThread, add(uid('m'))]));
    assert.ok(isGuardError(e), `not read as a guard failure: ${String(e)}`);
    same(await d.all('SELECT id FROM ai_chat WHERE conv = ?', conv), []);
    await d.run('INSERT INTO ai_thread (tree, user, conv, created, updated) VALUES (?, ?, ?, ?, ?)', TREE, user, conv, 1, 2);
    await d.run('DELETE FROM user WHERE id = ?', user);
    same(await d.all('SELECT conv FROM ai_thread WHERE conv = ?', conv), []);
  },

  'a second statement in one query never runs, alone or in a batch': async () => {
    const d = await scratch();
    const [a, b, c] = [uid('a'), uid('b'), uid('c')];
    await d.run(`INSERT INTO contract_value (txt) VALUES ('${a}'); INSERT INTO contract_value (txt) VALUES ('${b}')`).catch(() => {});
    await d.batch([q(`INSERT INTO contract_value (txt) VALUES ('${c}'); DELETE FROM contract_value`)]).catch(() => {});
    same(await d.all('SELECT txt FROM contract_value WHERE txt = ?', b), []);
    // A semicolon inside a string and a trailing one are not a second statement.
    await d.run("INSERT INTO contract_value (txt) VALUES ('x;y');");
    assert.ok(await d.get("SELECT 1 FROM contract_value WHERE txt = 'x;y'"));
  },

  'an empty batch does nothing and returns nothing': async () => {
    same(await tree().batch([]), []);
  },

  // ---------- results ----------

  'changes, RETURNING and lastRowId report the same numbers': async () => {
    const d = await scratch();
    const tag = uid('t');
    const inserted = await d.run('INSERT INTO contract_value (txt) VALUES (?)', tag);
    assert.equal(inserted.changes, 1);
    assert.ok(inserted.lastRowId > 0);
    same(await d.get('SELECT id FROM contract_value WHERE txt = ?', tag), { id: inserted.lastRowId });
    const second = await d.run('INSERT INTO contract_value (txt) VALUES (?)', tag);
    assert.equal(second.lastRowId, inserted.lastRowId + 1);

    assert.equal((await d.run('UPDATE contract_value SET num = 1 WHERE txt = ?', tag)).changes, 2);
    assert.equal((await d.run('UPDATE contract_value SET num = 1 WHERE txt = ?', uid('nobody'))).changes, 0);
    assert.equal((await d.run('SELECT * FROM contract_value WHERE txt = ?', tag)).changes, 0);

    const returned = await d.run('UPDATE contract_value SET num = 2 WHERE txt = ? RETURNING id', tag);
    assert.equal(returned.changes, 2);
    assert.deepEqual(returned.rows.map((r) => r.id), [inserted.lastRowId, second.lastRowId]);

    const [one, read] = await d.batch([q('DELETE FROM contract_value WHERE id = ?', second.lastRowId), q('SELECT count(*) AS n FROM contract_value WHERE txt = ?', tag)]);
    assert.equal(one.changes, 1);
    assert.equal(read.changes, 0);
    same(read.rows, [{ n: 1 }]);
  },

  // ---------- reads together (readBatch) ----------

  'readBatch returns each read’s rows in order, as all() would, and nothing for no reads': async () => {
    const d = await scratch();
    const tag = uid('t');
    await d.batch([q('INSERT INTO contract_value (txt, int) VALUES (?, 1)', tag), q('INSERT INTO contract_value (txt, int) VALUES (?, 2)', tag)]);
    const reads = [
      q('SELECT int FROM contract_value WHERE txt = ? ORDER BY int', tag),
      q('SELECT count(*) AS n FROM contract_value WHERE txt = ?', tag),
      q('SELECT int FROM contract_value WHERE txt = ?', uid('nobody')),
      q('WITH x AS (SELECT 7 AS v) SELECT v FROM x'),
    ];
    const got = await d.readBatch(reads);
    same(got, [[{ int: 1 }, { int: 2 }], [{ n: 2 }], [], [{ v: 7 }]]);
    same(got, plain(await Promise.all(reads.map((r) => d.all(r.sql, ...r.params)))));
    same(await d.readBatch([]), []);
    same(await store.accounts().readBatch([q('SELECT 1 AS one')]), [[{ one: 1 }]]);
  },

  'readBatch gives a blob back as the same bytes': async () => {
    const d = await scratch();
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => 255 - i);
    const { lastRowId } = await d.run('INSERT INTO contract_value (b) VALUES (?)', bytes as Param);
    const [[row]] = await d.readBatch([q('SELECT b FROM contract_value WHERE id = ?', lastRowId)]);
    assert.ok(row!.b instanceof Uint8Array, `a blob came back as ${Object.prototype.toString.call(row!.b)}`);
    assert.deepEqual([...(row!.b as Uint8Array)], [...bytes]);
  },

  'readBatch refuses a write before running anything, and a failing read fails the whole call': async () => {
    const d = await scratch();
    const tag = uid('t');
    await assert.rejects(d.readBatch([q('SELECT 1'), q('INSERT INTO contract_value (txt) VALUES (?)', tag)]), /reads only/);
    await assert.rejects(d.readBatch([q('UPDATE contract_value SET txt = ? WHERE id = -1', tag)]), /reads only/);
    same(await d.all('SELECT id FROM contract_value WHERE txt = ?', tag), []);
    await assert.rejects(d.readBatch([q('SELECT 1'), q('SELECT * FROM no_such_table')]));
    // The same limits as any statement.
    const marks = Array.from({ length: 101 }, () => '?').join(', ');
    await assert.rejects(d.readBatch([q(`SELECT 1 WHERE 1 IN (${marks})`, ...Array.from({ length: 101 }, (_, i) => i))]), /101 bound parameters/);
  },

  'a missing row is undefined and an empty read is an empty list': async () => {
    assert.equal(await tree().get('SELECT id FROM person WHERE id = ?', uid('nobody')), undefined);
    same(await tree().all('SELECT id FROM person WHERE id = ?', uid('nobody')), []);
  },

  // ---------- limits ----------

  'a statement may have 100 bound parameters and no more, on either driver': async () => {
    const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
    const values = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    const rows = await tree().all(`SELECT id FROM person WHERE id IN (${marks(MAX_BOUND_PARAMS)})`, ...values(MAX_BOUND_PARAMS));
    assert.deepEqual(rows, []);
    const tooMany = MAX_BOUND_PARAMS + 1;
    assert.match(String(await failure(() => tree().all(`SELECT id FROM person WHERE id IN (${marks(tooMany)})`, ...values(tooMany)))), /bound parameters/);
    assert.match(String(await failure(() => tree().batch([q(`SELECT id FROM person WHERE id IN (${marks(tooMany)})`, ...values(tooMany))]))), /bound parameters/);
  },

  'a list of any length goes through json_each as one parameter': async () => {
    const ids = Array.from({ length: 1500 }, () => uid('p')).concat('known');
    await tree().run('INSERT OR IGNORE INTO person (id, given) VALUES (?, ?)', 'known', 'Known');
    const rows = await tree().all<{ id: string }>('SELECT id FROM person WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids));
    assert.deepEqual(rows.map((r) => r.id), ['known']);
  },

  'a house change for several hundred people stays inside the statement limits': async () => {
    const house = uid('h');
    const ids = Array.from({ length: 250 }, () => uid('p'));
    await tree().run('INSERT INTO house (id, name, arms) VALUES (?, ?, ?)', house, house, '{}');
    await tree().batch(ids.map(addPerson));
    same(await setHouseMembers(TREE, house, { add: ids, remove: [] }, op()), { added: 250, removed: 0 });
    same(await tree().get('SELECT count(*) AS n FROM person WHERE house = ?', house), { n: 250 });
    same(await setHouseMembers(TREE, house, { add: [], remove: ids }, op()), { added: 0, removed: 250 });
    same(await tree().get('SELECT count(*) AS n FROM person WHERE house = ?', house), { n: 0 });
  },

  // ---------- values ----------

  'text and numbers come back as they went in': async () => {
    const d = await scratch();
    const texts = ['', 'plain', 'Müller-Lüdenscheidt', '家族 👩‍👩‍👧', `quote ' and " and \\ and %`, 'line\nbreak\ttab', 'x'.repeat(100_000)];
    for (const txt of texts) {
      const { lastRowId } = await d.run('INSERT INTO contract_value (txt) VALUES (?)', txt);
      same(await d.get('SELECT txt FROM contract_value WHERE id = ?', lastRowId), { txt });
    }
    const numbers: [number | null, number | null][] = [[0.5, 0], [-1.25, -1], [1e21, Number.MAX_SAFE_INTEGER], [null, null]];
    for (const [num, int] of numbers) {
      const { lastRowId } = await d.run('INSERT INTO contract_value (num, int) VALUES (?, ?)', num, int);
      same(await d.get('SELECT num, int FROM contract_value WHERE id = ?', lastRowId), { num, int });
    }
    const { lastRowId } = await d.run('INSERT INTO contract_value (txt) VALUES (?)', null);
    assert.equal((await d.get<{ empty: number }>('SELECT txt IS NULL AS empty FROM contract_value WHERE id = ?', lastRowId))?.empty, 1);
  },

  'a bound number works as an integer in columns, comparisons and LIMIT': async () => {
    const d = await scratch();
    const tag = uid('t');
    for (const int of [1, 2, 3]) await d.run('INSERT INTO contract_value (txt, int) VALUES (?, ?)', tag, int);
    same(await d.all('SELECT int, typeof(int) AS t FROM contract_value WHERE txt = ? AND int >= ? ORDER BY int LIMIT ? OFFSET ?', tag, 2, 1, 1), [{ int: 3, t: 'integer' }]);
    same(await d.get('SELECT substr(?, ?, ?) AS s', 'abcdef', 2, 3), { s: 'bcd' });
  },

  // D1 binds every JavaScript number as REAL, so json_quote(7) there is 7.0 and a number bound to a TEXT or untyped
  // column can be stored as '7.0'. The family and accounts schemas have no untyped column, and every date, day, month
  // and year is TEXT, so those are always bound as strings (the three cases below keep that true on both drivers).

  'a date, day or year is bound as a string and stays the same text': async () => {
    const d = await scratch();
    const tag = uid('d');
    for (const text of ['1985', '1985-06', '1985-06-14', '2026-11', String(7), `${2026}`]) await d.run('INSERT INTO contract_value (txt, u) VALUES (?, ?)', text, `${tag}${text}`);
    const rows = await d.all<{ txt: string; t: string }>('SELECT txt, typeof(txt) AS t FROM contract_value WHERE u LIKE ? ORDER BY u', `${tag}%`);
    same(rows.map((r) => r.txt), ['1985', '1985-06', '1985-06-14', '2026', '2026-11', '7']);
    assert.ok(rows.every((r) => r.t === 'text'));
    same(await d.get('SELECT count(*) AS n FROM contract_value WHERE u LIKE ? AND substr(txt, 1, 4) = ?', `${tag}%`, '1985'), { n: 3 });
    same(await d.get('SELECT json_quote(?) AS a', '1985'), { a: '"1985"' });
  },

  'a whole number bound to an INTEGER column is stored and counted as an integer, also after arithmetic': async () => {
    const d = await scratch();
    const tag = uid('i');
    const at = Date.now();
    await d.run('INSERT INTO contract_value (txt, int) VALUES (?, ?)', tag, at);
    await d.run('UPDATE contract_value SET int = int + ? WHERE txt = ?', 5, tag);
    await d.run('UPDATE contract_value SET int = MAX(0, int - ? + ?) WHERE txt = ?', 2, Math.round(3.4), tag);
    same(await d.get('SELECT int, typeof(int) AS t FROM contract_value WHERE txt = ?', tag), { int: at + 6, t: 'integer' });
    same(await d.get('SELECT count(*) AS n FROM contract_value WHERE txt = ? AND int > ?', tag, at), { n: 1 });
    same(await d.get('SELECT sum(int >= ?) AS n FROM contract_value WHERE txt = ?', at, tag), { n: 1 });
  },

  'a number inside a JSON document is written by JSON.stringify and stays an integer': async () => {
    const d = await scratch();
    const { lastRowId } = await d.run('INSERT INTO contract_value (txt) VALUES (?)', JSON.stringify({ n: 7, list: [1, 2], year: '1985' }));
    same(await d.get("SELECT json_type(txt, '$.n') AS n, json_type(txt, '$.list[1]') AS l, json_type(txt, '$.year') AS y, json_extract(txt, '$.n') AS v FROM contract_value WHERE id = ?", lastRowId), { n: 'integer', l: 'integer', y: 'text', v: 7 });
  },

  'JSON is stored as text and SQL can read inside it': async () => {
    const d = await scratch();
    const value = { name: 'Müller 👑', arms: { field: 'gules' }, list: [1, 'two', null], ok: true };
    const { lastRowId } = await d.run('INSERT INTO contract_value (txt) VALUES (?)', JSON.stringify(value));
    const row = await d.get<{ txt: string; field: string; second: string; n: number }>(
      "SELECT txt, json_extract(txt, '$.arms.field') AS field, json_extract(txt, '$.list[1]') AS second, json_array_length(txt, '$.list') AS n FROM contract_value WHERE id = ?",
      lastRowId,
    );
    assert.deepEqual(JSON.parse(row!.txt), value);
    assert.deepEqual([row!.field, row!.second, row!.n], ['gules', 'two', 3]);
    same(await d.get("SELECT json_quote(?) AS a, json_group_array(value) AS c FROM json_each('[1,2]')", 'x"y'), { a: '"x\\"y"', c: '[1,2]' });
  },

  'a blob comes back as the same bytes, as a Uint8Array, from every kind of read': async () => {
    const d = await scratch();
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const check = (got: unknown) => {
      assert.ok(got instanceof Uint8Array, `a blob came back as ${Object.prototype.toString.call(got)}`);
      assert.deepEqual([...got], [...bytes]);
    };
    const inserted = await d.run('INSERT INTO contract_value (b) VALUES (?) RETURNING id, b', bytes as Param);
    check(inserted.rows[0].b);
    const id = inserted.rows[0].id as number;
    check((await d.get<{ b: unknown }>('SELECT b FROM contract_value WHERE id = ?', id))!.b);
    check((await d.all<{ b: unknown }>('SELECT b FROM contract_value WHERE id = ?', id))[0].b);
    check((await d.batch([q('SELECT b FROM contract_value WHERE id = ?', id)]))[0].rows[0].b);
    same(await d.get('SELECT length(b) AS n, typeof(b) AS t FROM contract_value WHERE id = ?', id), { n: 256, t: 'blob' });
    same(await d.get('SELECT id FROM contract_value WHERE b = ?', bytes), { id });
  },

  'an empty blob stays an empty blob': async () => {
    const d = await scratch();
    const { lastRowId } = await d.run('INSERT INTO contract_value (b) VALUES (?)', new Uint8Array(0));
    same(await d.get('SELECT length(b) AS n, typeof(b) AS t FROM contract_value WHERE id = ?', lastRowId), { n: 0, t: 'blob' });
    const b = (await d.get<{ b: unknown }>('SELECT b FROM contract_value WHERE id = ?', lastRowId))!.b;
    assert.ok(b instanceof Uint8Array && b.length === 0, `an empty blob came back as ${String(b)}`);
  },

  'media goes in and comes back as the same bytes': async () => {
    const key = `photo/${crypto.randomUUID()}.png`;
    const bytes = Uint8Array.from({ length: 2048 }, (_, i) => i % 256);
    await store.media.put(TREE, key, bytes, 'image/png');
    const got = (await store.media.get(TREE, key))!;
    assert.equal(got.size, bytes.length);
    assert.deepEqual([...new Uint8Array(await new Response(got.body as BodyInit).arrayBuffer())], [...bytes]);
    await store.media.delete(TREE, key);
    assert.equal(await store.media.get(TREE, key), undefined);
  },

  // ---------- once ----------

  'once stores the result and replays it without writing or running after() again': async () => {
    const key = op();
    let afters = 0;
    const add = (id: string) => once(TREE, key, 'contract', () => ({ history: [], writes: [addPerson(id)], result: { id, nested: ['ü', 1, null] }, after: () => { afters++; } }));
    const first = uid('p');
    const second = uid('p');
    same(await add(first), { id: first, nested: ['ü', 1, null] });
    same(await add(second), { id: first, nested: ['ü', 1, null] });
    assert.equal(afters, 1);
    assert.equal(await hasPerson(second), false);
  },

  'once refuses a retry key used by someone else or for something else': async () => {
    const key = op();
    await once(TREE, key, 'contract', () => ({ history: [], writes: [addPerson(uid('p'))], result: 1 }));
    const refused = /already sent as something else/;
    assert.match(String(await failure(() => once(TREE, { ...key, user: 'u2' }, 'contract', () => ({ history: [], writes: [], result: 2 })))), refused);
    assert.match(String(await failure(() => once(TREE, { ...key, payload: { a: 2 } }, 'contract', () => ({ history: [], writes: [], result: 2 })))), refused);
    assert.match(String(await failure(() => once(TREE, key, 'other', () => ({ history: [], writes: [], result: 2 })))), refused);
  },

  'once decides again on fresh reads when a guard fails': async () => {
    const id = uid('p');
    let attempts = 0;
    let abandoned = 0;
    const result = await once(TREE, op(), 'contract', () => {
      attempts++;
      return { history: [], writes: [guard('1 = ?', attempts >= 3 ? 1 : 0), addPerson(id)], result: attempts, abandon: () => { abandoned++; } };
    });
    assert.equal(result, 3);
    assert.equal(abandoned, 2);
    assert.equal(await hasPerson(id), true);
  },

  'once gives up after four attempts and leaves nothing behind': async () => {
    const id = uid('p');
    const key = op();
    let attempts = 0;
    const e = await failure(() => once(TREE, key, 'contract', () => {
      attempts++;
      return { history: [], writes: [addPerson(id), guard('1 = ?', 0)], result: 1 };
    }));
    assert.equal(attempts, 4);
    assert.match(String(e), /changed while this was being saved/);
    assert.equal(await hasPerson(id), false);
    assert.equal(await tree().get('SELECT key FROM op WHERE key = ?', key.key), undefined);
  },

  'once passes other failures straight through and does not retry them': async () => {
    const id = uid('p');
    await tree().batch([addPerson(id)]);
    let attempts = 0;
    let abandoned = 0;
    const e = await failure(() => once(TREE, op(), 'contract', () => {
      attempts++;
      return { history: [], writes: [addPerson(id)], result: 1, abandon: () => { abandoned++; } };
    }));
    assert.ok(isUniqueError(e), String(e));
    assert.deepEqual([attempts, abandoned], [1, 1]);
  },

  'two racing copies of one change write once and agree on the result': async () => {
    const key = op();
    const made: string[] = [];
    const copy = () => once(TREE, key, 'contract', () => {
      const id = uid('race');
      made.push(id);
      return { history: [], writes: [addPerson(id)], result: id };
    });
    const [a, b] = await Promise.all([copy(), copy()]);
    assert.equal(a, b);
    const present = await tree().all<{ id: string }>('SELECT id FROM person WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(made));
    assert.deepEqual(present.map((r) => r.id), [a]);
  },

  'a result only the batch knows is stored by resultSql and replayed': async () => {
    const d = await scratch();
    const key = op();
    const write = () => once<number>(TREE, key, 'contract', () => ({
      history: [], writes: [q('INSERT INTO contract_value (txt) VALUES (?)', 'from once')],
      resultSql: 'last_insert_rowid()',
      result: (results) => results[0].lastRowId,
    }));
    const id = await write();
    same(await d.get('SELECT txt FROM contract_value WHERE id = ?', id), { txt: 'from once' });
    assert.equal(await write(), id);
    assert.equal((await d.get<{ n: number }>("SELECT count(*) AS n FROM contract_value WHERE id = ?", id))?.n, 1);
  },

  'resultSql sees the plan’s own insert, not the history row written with it': async () => {
    const d = await scratch();
    const key = op();
    const person = uid('hist');
    const txt = uid('txt');
    const write = () => once<number>(TREE, key, 'contract', () => ({
      history: [added('person', person)],
      writes: [addPerson(person), q('INSERT INTO contract_value (txt) VALUES (?)', txt)],
      resultSql: 'last_insert_rowid()',
      result: (results) => results[1].lastRowId,
    }));
    const id = await write();
    same(await d.get('SELECT txt FROM contract_value WHERE id = ?', id), { txt });
    const replayed = await write();
    assert.equal(replayed, id, 'the stored result is the contract row’s id');
    same(await d.get('SELECT txt FROM contract_value WHERE id = ?', replayed), { txt });
  },

  'a retried key writes its history row once': async () => {
    const key = op();
    const person = uid('hist');
    const write = () => once(TREE, key, 'contract', () => ({ history: [added('person', person)], writes: [addPerson(person)], result: person }));
    assert.equal(await write(), person);
    assert.equal(await write(), person);
    const [a, b] = await Promise.all([write(), write()]);
    assert.deepEqual([a, b], [person, person]);
    assert.equal((await tree().get<{ n: number }>('SELECT count(*) AS n FROM history WHERE record = ?', person))?.n, 1);
  },
};

/** The schema a database ended up with, in a form two drivers can be compared on. */
export async function schemaOf(d: Db) {
  const rows = await d.all<{ type: string; name: string; sql: string | null }>("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'contract_%' AND name <> 'd1_migrations' ORDER BY type, name");
  const applied = await d.all<{ name: string }>('SELECT name FROM d1_migrations ORDER BY id');
  return {
    objects: rows.map((r) => ({ type: r.type, name: r.name, sql: (r.sql ?? '').replace(/\s+/g, ' ').trim() })),
    applied: applied.map((r) => r.name),
  };
}

export const schemas = async () => ({ tree: await schemaOf(tree()), accounts: await schemaOf(store.accounts()) });
