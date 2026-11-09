// node --test src/lib/person.fill-gaps.test.ts — the Needed page fills a gap only while it is the gap the page showed:
// a value someone else entered meanwhile stays, and the page is told which of its values were not written. A scratch
// family under a temporary KINDRED_DATA_DIR (never data/); the environment is set before anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-fill-gaps-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { db } = await import('./db.server.ts');
const { fillGaps } = await import('./person.server.ts');

const TREE = 'gaps';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Gaps'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, born, living) VALUES ('ivo', 'Ivo', NULL, 0), ('jan', 'Jan', '1961', 1), ('kim', 'Kim', NULL, 0)`);
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

const row = (id: string) => db(TREE).get<{ born: string | null; born_place: string | null; occupation: string | null; occupation_code: string | null; sex: string | null }>(
  'SELECT born, born_place, occupation, occupation_code, sex FROM person WHERE id = ?', id);

test('a gap that is still empty is filled, with the occupation’s code', async () => {
  const out = await fillGaps(TREE, 'ivo', { born: '1901', occupation: 'Baker', sex: 'm' }, {}, undefined);
  assert.deepEqual(out, { kept: [] });
  const r = await row('ivo');
  assert.equal(r?.born, '1901');
  assert.equal(r?.occupation, 'Baker');
  assert.equal(r?.sex, 'm');
  assert.ok(r?.occupation_code, 'the vocabulary code is set as the editor would');
});

test('a value someone else entered meanwhile stays, and the caller learns which values were not written', async () => {
  // Another relative fills in Kim's birthplace after this page loaded.
  await db(TREE).run("UPDATE person SET born_place = 'Lindenau' WHERE id = 'kim'");
  const out = await fillGaps(TREE, 'kim', { bornPlace: 'Ostheim', died: '1980' }, {}, undefined);
  assert.deepEqual(out, { kept: ['bornPlace'] });
  const r = await row('kim');
  assert.equal(r?.born_place, 'Lindenau');
  assert.equal((await db(TREE).get<{ died: string }>("SELECT died FROM person WHERE id = 'kim'"))?.died, '1980', 'the other gap is still filled');
});

test('the same value entered by someone else is not reported as kept', async () => {
  const out = await fillGaps(TREE, 'kim', { bornPlace: 'Lindenau' }, {}, undefined);
  assert.deepEqual(out, { kept: [] });
});

test('a birth year the page showed may become a full birthday, but not one changed meanwhile', async () => {
  assert.deepEqual(await fillGaps(TREE, 'jan', { born: '1961-04-02' }, { born: '1961' }, undefined), { kept: [] });
  assert.equal((await row('jan'))?.born, '1961-04-02');
  // A second page still showing the year alone does not overwrite the birthday now stored.
  assert.deepEqual(await fillGaps(TREE, 'jan', { born: '1961-09-09' }, { born: '1961' }, undefined), { kept: ['born'] });
  assert.equal((await row('jan'))?.born, '1961-04-02');
});
