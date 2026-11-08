// node --test scripts/seed.test.ts — the seed script writes a working family into KINDRED_DATA_DIR: contacts and
// favourites as person fields, the current names, and nothing in data/. Run from the repository root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const scratch = mkdtempSync(join(tmpdir(), 'kindred-seed-test-'));
const inputs = join(scratch, 'seed');
const data = join(scratch, 'data');
mkdirSync(inputs);
const tree = {
  id: 'scratch', name: 'Scratch', tagline: '', theme: 'codex', focus: 'ada', houses: [], parents: [], unions: [], stories: [], places: [],
  people: [
    { id: 'ada', given: 'Ada', surname: 'Lovelace', currentSurname: 'King', living: true, favourite: 'Cheesecake, gardening' },
    { id: 'ben', given: 'Ben', living: false },
  ],
  contacts: [
    { person: 'ada', kind: 'phone', label: 'mobile', value: '+49 170 1' },
    { person: 'ada', kind: 'messenger', value: 'ada_l' },
    { person: 'ben', kind: 'email', label: 'home', value: 'ben@example.org' },
  ],
};
const file = join(inputs, 'scratch.json');
writeFileSync(file, JSON.stringify(tree));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

test('a seed writes contacts and favourites as person fields, and the current names', () => {
  execFileSync(process.execPath, ['scripts/seed.ts', file], { env: { ...process.env, KINDRED_DATA_DIR: data }, stdio: 'pipe' });
  const db = new DatabaseSync(join(data, 'scratch.db'), { readOnly: true });
  try {
    const fields = db.prepare('SELECT person, type, label, value, ord, private, created_by FROM person_field WHERE person = ? ORDER BY ord').all('ada')
      .map((r) => ({ ...r }));
    assert.deepEqual(fields, [
      { person: 'ada', type: 'phone', label: 'mobile', value: '{"number":"+49 170 1"}', ord: 0, private: 0, created_by: 'seed' },
      { person: 'ada', type: 'social', label: 'Messenger', value: '{"handle":"ada_l"}', ord: 1, private: 0, created_by: 'seed' },
      { person: 'ada', type: 'favourites', label: '', value: '{"text":"Cheesecake, gardening"}', ord: 1000, private: 0, created_by: 'seed' },
    ]);
    const ben = db.prepare("SELECT type, value FROM person_field WHERE person = 'ben'").all().map((r) => ({ ...r }));
    assert.deepEqual(ben, [{ type: 'email', value: '{"address":"ben@example.org"}' }]);
    const ada = db.prepare('SELECT current_given, current_surname FROM person WHERE id = ?').get('ada');
    assert.deepEqual({ ...ada }, { current_given: null, current_surname: 'King' });
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    db.close();
  }
  assert.equal(existsSync('data/scratch.db'), false, 'the real data folder is untouched');
});
