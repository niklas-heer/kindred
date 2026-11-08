// Runs the mapping script the way a steward would, against a throwaway data folder, and reads the result back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openSqlite, wrap } from '../src/lib/store/node.ts';

const script = resolve(import.meta.dirname, 'map-occupations.ts');

test('the mapping sets codes for exact or case-insensitive matches, never changes the text, and is safe to run twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kindred-occ-'));
  try {
    const d = openSqlite(join(dir, 'fam.db'), 'tree', { create: true });
    const store = wrap(d);
    const rows: [string, string][] = [
      ['p1', 'Baker'],
      ['p2', 'lehrerin'],
      ['p3', 'Ex-circus clown'],
      ['p4', 'Bakker'],
      ['p5', '   '],
    ];
    for (const [id, occupation] of rows) {
      await store.run(
        "INSERT INTO person (id, given, living, occupation, updated_at) VALUES (?, ?, 1, ?, '2020-01-01T00:00:00Z')",
        id, id, occupation.trim() === '' ? null : occupation,
      );
    }
    d.close();

    const run = () =>
      execFileSync(process.execPath, [script, 'fam'], { env: { ...process.env, KINDRED_DATA_DIR: dir }, encoding: 'utf8' });
    const first = run();
    assert.match(first, /fam: 3 mapped, 1 left as free text/);

    const after = openSqlite(join(dir, 'fam.db'), 'tree');
    const read = wrap(after);
    const people = await read.all<{ id: string; occupation: string | null; occupation_code: string | null; updated_at: string }>(
      'SELECT id, occupation, occupation_code, updated_at FROM person ORDER BY id',
    );
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    assert.equal(byId.p1.occupation_code, 'baker');
    assert.equal(byId.p2.occupation_code, 'teacher');
    assert.equal(byId.p3.occupation_code, null, 'a text that names no entry stays free text');
    assert.equal(byId.p4.occupation_code, 'baker');
    assert.equal(byId.p5.occupation_code, null);
    for (const p of people) {
      assert.equal(p.updated_at, '2020-01-01T00:00:00Z', `${p.id}: the timestamp is untouched`);
    }
    assert.equal(byId.p1.occupation, 'Baker', 'the text is never changed');
    assert.equal(byId.p2.occupation, 'lehrerin', 'the text keeps its own spelling');
    assert.equal(byId.p3.occupation, 'Ex-circus clown');

    const second = run();
    assert.match(second, /fam: 0 mapped, 1 left as free text/, 'a second run finds nothing new to map');
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
