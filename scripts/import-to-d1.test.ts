// node --test scripts/import-to-d1.test.ts — the D1 transfer's plan, without Cloudflare: every table the schema has is
// decided (copied in foreign-key order, or left out on purpose), every gallery and portrait file is selected, and a
// populated family written with the transfer's own SQL lands in an empty migrated database with the same counts.
// Runs on scratch folders only; never data/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-d1-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('../src/lib/store/node.ts');
const T = await import('./lib/d1-transfer.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

const tablesOf = (d: DatabaseSync) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
const foreignKeysOf = (d: DatabaseSync, tables: string[]) =>
  tables.flatMap((t) => (d.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string }[]).map((r) => ({ table: t, parent: r.table })));

/** A migrated, empty family database: the schema every D1 target has after `migrations apply`. */
function migratedFamily(name: string): DatabaseSync {
  return openSqlite(join(dir, `${name}.db`), 'tree', { create: true });
}

test('every table the current schema has is decided: copied, or left out on purpose', () => {
  const d = migratedFamily('plan-schema');
  const present = tablesOf(d);
  const plan = T.planTables(present);
  assert.deepEqual(plan.copy, [...T.COPIED_TABLES], 'the copy list, in order');
  assert.deepEqual(plan.leftOut, ['ancestry_rev', 'campaign', 'campaign_log', 'campaign_member', 'campaign_push', 'campaign_season', 'd1_migrations', 'history', 'op'], 'bookkeeping, the game and the history are left out on purpose');
  for (const t of ['person_field', 'house_succession', 'album', 'media', 'media_person', 'occupation_translation']) {
    assert.ok(plan.copy.includes(t), `${t} is copied`);
  }
  assert.equal(plan.copy.includes('op'), false, 'retry keys are not copied');
  assert.equal(plan.copy.includes('contact'), false, 'the table migration 0008 dropped is not copied');
  d.close();
});

test('a table with no decision stops the transfer and is named', () => {
  const d = migratedFamily('plan-unknown');
  assert.throws(() => T.planTables([...tablesOf(d), 'future_table']), /future_table/);
  d.close();
});

test('a copied table missing from the copy stops the transfer and is named', () => {
  const d = migratedFamily('plan-missing');
  assert.throws(() => T.planTables(tablesOf(d).filter((t) => t !== 'album')), /album/);
  d.close();
});

test('the copy order satisfies every foreign key of the current schema', () => {
  const d = migratedFamily('plan-order');
  const keys = foreignKeysOf(d, [...T.COPIED_TABLES]);
  assert.ok(keys.length >= 10, 'the schema has foreign keys to check');
  assert.deepEqual(T.foreignKeyOrderErrors(T.COPIED_TABLES, keys), []);
  assert.ok(T.foreignKeyOrderErrors([...T.COPIED_TABLES].reverse(), keys).length > 0, 'a reversed order is caught');
  d.close();
});

/** A populated v2 family: every copied table holds rows, with the awkward values (quotes, NULLs, bytes) in some of them. */
function populatedFamily(name: string): DatabaseSync {
  const d = migratedFamily(name);
  const now = '2026-11-08T10:00:00Z';
  d.exec(`
    INSERT INTO meta (key, value) VALUES ('id', 'v2'), ('name', 'Ruff''s family'), ('tagline', 'a test'), ('theme', 'codex'), ('focus', 'ada');
    INSERT INTO house (id, name, motto, arms, founder) VALUES ('h1', 'House O''Neill', NULL, '{"field":"gules"}', 'ada');
    INSERT INTO person (id, given, further_given, surname, house, sex, born, living, look, updated_at) VALUES
      ('ada', 'Ada', '["Augusta","Byron"]', 'Lovelace', 'h1', 'f', '1815', 0, '{"hair":1}', '${now}'),
      ('ben', 'Ben', NULL, 'O''Brien', 'h1', 'm', '1840', 0, NULL, '${now}');
    INSERT INTO parent (child, parent, kind, confidence) VALUES ('ben', 'ada', 'biological', 'certain');
    INSERT INTO partnership (id, a, b, kind, start, end, end_reason, place) VALUES ('u1', 'ada', 'ben', 'marriage', '1835', NULL, NULL, 'Lindby');
    INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES ('s1', 'ada', 'memory', 'A ''quoted'' title', 'Body text', 'Ben', '${now}', NULL);
    INSERT INTO place (name, lat, lng, country) VALUES ('Lindby', 54.1, 9.8, 'de');
    INSERT INTO photo (person, mime, key, at) VALUES ('ada', 'image/jpeg', 'photo/ada-1.jpg', '${now}');
    INSERT INTO person_field (id, person, type, label, value, ord, visibility, created_by_name, created_at, updated_by, updated_at) VALUES
      ('f1', 'ada', 'phone', 'mobile', '{"number":"+49 1"}', 0, 'family', 'Ben', '${now}', 'Ben', '${now}'),
      ('f2', 'ada', 'medical', '', '{"text":"Keep private"}', 1, 'editors', 'Ben', '${now}', 'Ben', '${now}');
    INSERT INTO house_succession (house, law, head, heir, country) VALUES ('h1', 'seniority', 'ada', 'ben', 'DE');
    INSERT INTO house_meaning (house, name, family_words, meanings, web_searched, note, saved_at, saved_by) VALUES ('h1', 'O''Neill', 'The champion''s line', '[{"id":"m1","language":"Irish","root":"Niall","meaning":"champion","attestation":"well-attested","ideas":[],"chosen":true}]', 1, '', ${Date.now()}, 'ada');
    INSERT INTO house_arms_review (house, fingerprint, verdict, reason, advice, locale, checked_at, checked_by, dismissed_fingerprint) VALUES ('h1', 'f00d', 'partly', 'Some elements speak to it.', 'Add a charge for the trade.', 'en', ${Date.now()}, 'ada', '');
    INSERT INTO album (id, name, at) VALUES ('al1', 'Summer ''41', '${now}');
    INSERT INTO media (key, mime, width, height, taken, place, caption, album, uploaded_by, uploaded_at) VALUES
      ('gallery/g1.jpg', 'image/jpeg', 800, 600, '1941-06', 'Lindby', 'On the steps', 'al1', 'Ben', '${now}'),
      ('gallery/g2.jpg', 'image/png', 10, 10, NULL, NULL, NULL, NULL, 'Ben', '${now}');
    INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at) VALUES ('gallery/g1.jpg', 'ada', 0.1, 0.1, 0.2, 0.3, 1, 'Ben', '${now}');
    INSERT INTO portrait (key, person, mime, source, source_year, model, created_by, created_at, accepted) VALUES ('portrait/ada-1.png', 'ada', 'image/png', 'gallery/g1.jpg', 1941, 'openai/gpt-image-2', 'Ben', '${now}', 1);
    INSERT INTO occupation_translation (text, locale, label) VALUES ('Baker', 'de', 'Bäcker');
    INSERT INTO story_translation (story, locale, source_hash, title, body, same, translated_at) SELECT id, 'de', 'h1', NULL, 'Eine Geschichte.', 0, '${now}' FROM story LIMIT 1;
    INSERT INTO house_translation (house, kind, locale, source_hash, content, same, translated_at) VALUES ('h1', 'review', 'de', 'h1', '{}', 0, '${now}');
    INSERT INTO research_project (id, title, summary, private, created_by, created_by_name, created_at, updated_at) VALUES ('rp1', 'Where the line began', '', 0, 'u1', 'Ben', '${now}', '${now}');
    INSERT INTO research_document (id, project, key, mime, size, title, date, source, notes, private, created_by, created_by_name, created_at, updated_at) VALUES ('rd1', 'rp1', 'research/d1.pdf', 'application/pdf', 1200, 'Baptism record', '1815-12', 'Parish book', '', 0, 'u1', 'Ben', '${now}', '${now}');
    INSERT INTO research_note (id, project, title, body, date, private, created_by, created_by_name, created_at, updated_at) VALUES ('rn1', 'rp1', 'First lead', 'Body', NULL, 0, 'u1', 'Ben', '${now}', '${now}');
    INSERT INTO research_picture (project, media, created_by, created_by_name, created_at) VALUES ('rp1', 'gallery/g1.jpg', 'u1', 'Ben', '${now}');
    INSERT INTO research_person (project, person, private, created_by, created_by_name, created_at) VALUES ('rp1', 'ada', 0, 'u1', 'Ben', '${now}');
    INSERT INTO research_place (project, place, created_by, created_by_name, created_at) VALUES ('rp1', 'Lindby', 'u1', 'Ben', '${now}');
    INSERT INTO life_event (id, person, type, label, date, place, note, ord, created_by, created_by_name, created_at, updated_at) VALUES ('ev1', 'ben', 'residence', 'The mill', '1860', 'Lindby', '', 0, 'u1', 'Ben', '${now}', '${now}');
    INSERT INTO source (id, title, author, document, media, created_by, created_by_name, created_at, updated_at) VALUES ('so1', 'Parish ''book''', NULL, 'rd1', 'gallery/g1.jpg', 'u1', 'Ben', '${now}', '${now}');
    INSERT INTO citation (id, source, fact, person, parent, event, partnership, page, quality, created_by, created_by_name, created_at, updated_at) VALUES
      ('ci1', 'so1', 'birth', 'ada', NULL, NULL, NULL, 'p. 1', 'original', 'u1', 'Ben', '${now}', '${now}'),
      ('ci2', 'so1', 'parent', 'ben', 'ada', NULL, NULL, NULL, NULL, 'u1', 'Ben', '${now}', '${now}'),
      ('ci3', 'so1', 'event', NULL, NULL, 'ev1', NULL, NULL, NULL, 'u1', 'Ben', '${now}', '${now}'),
      ('ci4', 'so1', 'partnership', NULL, NULL, NULL, 'u1', NULL, 'unsure', 'u1', 'Ben', '${now}', '${now}');
  `);
  return d;
}

test('a populated family written with the transfer’s own SQL lands in an empty migrated database, count for count', () => {
  const source = populatedFamily('v2-source');
  const plan = T.planTables(tablesOf(source));
  const columns = new Map<string, string[]>();
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const t of plan.copy) {
    const cols = (source.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).filter((c) => !(t === 'photo' && c === 'data'));
    columns.set(t, cols);
    rows.set(t, source.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all() as Record<string, unknown>[]);
  }
  const sent = Object.fromEntries(plan.copy.map((t) => [t, rows.get(t)!.length]));
  for (const t of plan.copy) assert.ok(sent[t] > 0, `${t} has rows to carry`);
  source.close();

  const sql = plan.copy.flatMap((t) => T.insertSql(t, columns.get(t)!, rows.get(t)!));
  const target = migratedFamily('v2-target');
  target.exec('PRAGMA foreign_keys = ON');
  target.exec(sql.join('\n'));
  const held = target.prepare(T.countSql(plan.copy)).get() as Record<string, number>;
  assert.deepEqual(T.countMismatches(sent, held), [], 'every table holds what was sent');
  // The ancestry revision is not copied: the target's own counter (seeded at 0) moved once per parent row written.
  assert.equal((target.prepare('SELECT rev FROM ancestry_rev WHERE id = 1').get() as { rev: number }).rev, sent.parent, 'the target counts its own link changes');
  assert.equal((target.prepare("SELECT value FROM meta WHERE key = 'name'").get() as { value: string }).value, "Ruff's family");
  assert.equal((target.prepare("SELECT surname FROM person WHERE id = 'ben'").get() as { surname: string }).surname, "O'Brien", 'quotes survive');
  assert.equal((target.prepare("SELECT further_given FROM person WHERE id = 'ada'").get() as { further_given: string }).further_given, '["Augusta","Byron"]', 'the further given names are copied');
  target.close();
});

test('the same family written in the wrong order is refused by the foreign keys, so the order is load-bearing', () => {
  const source = populatedFamily('v2-reversed-source');
  const copy = [...T.COPIED_TABLES];
  const sql = [...copy].reverse().flatMap((t) => {
    const cols = (source.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).filter((c) => !(t === 'photo' && c === 'data'));
    return T.insertSql(t, cols, source.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all() as Record<string, unknown>[]);
  });
  source.close();
  const target = migratedFamily('v2-reversed-target');
  target.exec('PRAGMA foreign_keys = ON');
  assert.throws(() => target.exec(sql.join('\n')), /FOREIGN KEY/i);
  target.close();
});

test('a research document is a file the family names, so a missing one stops the transfer', () => {
  const offered = [{ key: 'research/d1.pdf', file: join(dir, 'x.pdf') }];
  assert.equal(T.planMedia(['research/d1.pdf'], offered).length, 1);
  assert.throws(() => T.planMedia(['research/gone.pdf'], offered), /research\/gone\.pdf/);
});

test('the pictures to upload are every file under the tree, gallery/ included, and the family’s own pictures must all exist', () => {
  const root = join(dir, 'media', 'v2');
  for (const f of ['photo/ada-1.jpg', 'gallery/g1.jpg', 'gallery/nested/g3.webp']) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), 'bytes');
  }
  const onDisk = T.listFiles(root);
  assert.deepEqual(onDisk.map((f) => f.key), ['gallery/g1.jpg', 'gallery/nested/g3.webp', 'photo/ada-1.jpg']);
  const all = T.planMedia(['photo/ada-1.jpg', 'gallery/g1.jpg'], onDisk);
  assert.equal(all.length, 3, 'a gallery picture goes up, not only portraits');

  // A picture moved out of the database is offered first and wins over the same key on disk.
  const moved = { key: 'photo/ada-1.jpg', file: join(dir, 'moved', 'photo', 'ada-1.jpg') };
  const chosen = T.planMedia(['photo/ada-1.jpg'], [moved, ...onDisk]).find((f) => f.key === 'photo/ada-1.jpg');
  assert.equal(chosen?.file, moved.file);

  assert.throws(() => T.planMedia(['gallery/gone.jpg'], onDisk), /gallery\/gone\.jpg/, 'a named picture with no file is refused, and named');
  assert.deepEqual(T.listFiles(join(dir, 'no-such-folder')), [], 'a tree with no media has nothing to upload');
});

test('values are written as SQL literals: quotes doubled, NULLs, numbers and bytes', () => {
  assert.equal(T.literal("O'Brien"), "'O''Brien'");
  assert.equal(T.literal(null), 'NULL');
  assert.equal(T.literal(undefined), 'NULL');
  assert.equal(T.literal(3), '3');
  assert.equal(T.literal(new Uint8Array([1, 255])), "X'01ff'");
  assert.deepEqual(T.insertSql('meta', ['key', 'value'], [{ key: 'name', value: 'A' }]), ["INSERT INTO meta (key, value) VALUES ('name', 'A');"]);
});

test('the counts read back are compared table by table, and a short table is named', () => {
  assert.deepEqual(T.countMismatches({ person: 3, media: 2 }, { person: 3, media: 2 }), []);
  assert.deepEqual(T.countMismatches({ person: 3, media: 2 }, { person: 3, media: 1 }), ['media: sent 2, the target holds 1']);
  assert.deepEqual(T.countMismatches({ person: 3 }, {}), ['person: sent 3, the target holds no count for it']);
});

test('emptying a target deletes the copied tables children first', () => {
  const sql = T.deleteSql(['meta', 'person', 'media_person']);
  assert.deepEqual(sql, ['DELETE FROM media_person;', 'DELETE FROM person;', 'DELETE FROM meta;']);
});

test('a D1 database that already holds the family’s details is refused up front, unless --replace is given', () => {
  const empty = { people: 0, meta: 0 };
  assert.equal(T.existingFamilyProblem(empty, 'modern', false), null, 'a new database takes the copy');
  const people = T.existingFamilyProblem({ people: 3, meta: 1 }, 'modern', false);
  assert.match(people ?? '', /already holds 3 people; pass --replace/);
  const setup = T.existingFamilyProblem({ people: 0, meta: 6 }, 'family', false);
  assert.match(setup ?? '', /setup made them.*--replace/, 'the setup case names --replace too');
  assert.equal(T.existingFamilyProblem({ people: 3, meta: 6 }, 'modern', true), null, '--replace takes the copy, and empties the copied tables first');
  assert.deepEqual(T.deleteSql(T.COPIED_TABLES).at(-1), 'DELETE FROM meta;', 'meta is one of the tables --replace empties');
});
