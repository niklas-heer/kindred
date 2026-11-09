// node --test src/lib/families-today.test.ts — the families list every page loads: "today" read narrowly gives exactly
// what the whole family's graph gave, and a reader's list opens only their own families. Runs on a scratch data folder.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-today-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const s = await import('./db.server.ts');
const { todayEvents } = await import('./auth/today.ts');
const { families } = await import('./auth/trees.server.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

await s.provisionFamily('marsh', 'Marsh family');
await s.provisionFamily('tolland', 'Tolland family');
await s.db('marsh').batch([
  s.q(`INSERT INTO person (id, given, surname, born, died, living) VALUES
    ('p1', 'Ilse', 'Marsh', '1961-03-14', NULL, 1),
    ('p2', 'Odo', 'Marsh', '1958-07-02', NULL, 1),
    ('p3', 'Wenna', NULL, '1931-03-14', '2010-07-02', 0),
    ('p4', 'Bram', 'Marsh', '1890-03-14', '1950-03-14', 0),
    ('p5', 'Tilde', 'Marsh', '1990-07-02', NULL, 1),
    ('p6', 'Aurel', 'Marsh', 'about 1900', '1999-12', 0),
    ('p7', 'Nell', 'Marsh', '2026-03-14', NULL, 1),
    ('p8', 'Corvin', 'Marsh', '1962-11-30', NULL, 0),
    ('p9', 'Rike', 'Marsh', '1960-11-30', '2001-11-30', 0)`),
  s.q(`INSERT INTO partnership (id, a, b, kind, start, end) VALUES
    ('u1', 'p1', 'p2', 'marriage', '1985-07-02', NULL),
    ('u2', 'p2', 'p5', 'marriage', '2015-03-14', '2020'),
    ('u3', 'p1', 'p8', 'partnership', '1990-03-14', NULL),
    ('u4', 'p8', 'p9', 'marriage', '1980-11-30', NULL),
    ('u5', 'p5', 'p1', 'marriage', '2011-03-14', NULL)`),
]);

test('today, read narrowly, is exactly what the whole family graph gives, on every day of the year', async () => {
  const graph = await s.graph('marsh');
  let days = 0;
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    assert.deepEqual(await s.todayIn('marsh', d), todayEvents(graph, d), d.toDateString());
    days++;
  }
  assert.equal(days, 365);
  // The fixture is not vacuous: those days carry birthdays, memorials and anniversaries.
  assert.deepEqual((await s.todayIn('marsh', new Date(2026, 2, 14))).map((e) => e.key), ['b:p1', 'a:u5'], 'a memorial more than 30 years back is not one');
  assert.deepEqual((await s.todayIn('marsh', new Date(2026, 6, 2))).map((e) => e.key), ['b:p2', 'm:p3', 'b:p5', 'a:u1']);
});

test("a reader's families list opens only their own families", async () => {
  assert.deepEqual((await families()).map((f) => f.id).sort(), ['marsh', 'tolland']);
  assert.deepEqual((await families(['tolland'])).map((f) => f.id), ['tolland']);
  assert.deepEqual((await families(['tolland', 'not-here'])).map((f) => f.id), ['tolland'], 'an unknown family is simply not there');
  assert.deepEqual(await families([]), []);
});
