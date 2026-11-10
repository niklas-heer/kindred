// node --test scripts/seed.test.ts — the seed script writes a working family into KINDRED_DATA_DIR: contacts and
// favourites as person fields, the current names, and nothing in data/. Run from the repository root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
    const fields = db.prepare('SELECT person, type, label, value, ord, visibility, created_by_name FROM person_field WHERE person = ? ORDER BY ord').all('ada')
      .map((r) => ({ ...r }));
    assert.deepEqual(fields, [
      { person: 'ada', type: 'phone', label: 'mobile', value: '{"number":"+49 170 1"}', ord: 0, visibility: 'family', created_by_name: 'seed' },
      { person: 'ada', type: 'social', label: 'Messenger', value: '{"handle":"ada_l"}', ord: 1, visibility: 'family', created_by_name: 'seed' },
      { person: 'ada', type: 'favourites', label: '', value: '{"text":"Cheesecake, gardening"}', ord: 1000, visibility: 'family', created_by_name: 'seed' },
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

test('a seed writes the family’s feed: posts by its people, their comments and reactions, and painted pictures in the gallery', () => {
  const feedFile = join(inputs, 'feedfam.json');
  writeFileSync(feedFile, JSON.stringify({
    ...tree, id: 'feedfam', contacts: [],
    posts: [
      {
        by: 'ada', daysAgo: 2, time: '19:05', body: 'Photos from Sunday.', people: ['ben'],
        pictures: [{ scene: 'lake', seed: 1 }, { scene: 'door', seed: 2, tall: true }],
        comments: [{ by: 'ada', body: 'More to come.', hoursLater: 2 }],
        reactions: [{ by: 'ada', kind: 'heart' }],
      },
      // Later today than the clock says: never dated in the future.
      { by: 'ada', daysAgo: 0, time: '23:59', body: 'Good night.' },
    ],
    uploads: [{ by: 'ada', daysAgo: 5, time: '10:00', album: 'Summer', pictures: [{ scene: 'boat', seed: 3, caption: 'The boat' }] }],
  }));
  const now = '2026-11-07T12:00:00.000Z';
  execFileSync(process.execPath, ['scripts/seed.ts', feedFile], { env: { ...process.env, KINDRED_DATA_DIR: data, KINDRED_SEED_NOW: now }, stdio: 'pipe' });
  const db = new DatabaseSync(join(data, 'feedfam.db'), { readOnly: true });
  try {
    const all = (sql: string) => db.prepare(sql).all().map((r) => ({ ...r }));
    const posts = all('SELECT id, account, author_name, author_person, body, created_at FROM post ORDER BY created_at');
    // A seed has no accounts: each speaks as a person of the family, under the name they go by now.
    assert.deepEqual(posts.map((p) => [p.account, p.author_name, p.author_person, p.body, p.created_at]), [
      ['seed:ada', 'Ada King', 'ada', 'Photos from Sunday.', '2026-11-05T19:05:00.000Z'],
      ['seed:ada', 'Ada King', 'ada', 'Good night.', '2026-11-07T11:59:00.000Z'],
    ]);
    assert.match(String(posts[0]!.id), /^[0-9a-f-]{36}$/);
    assert.deepEqual(all('SELECT person FROM post_person'), [{ person: 'ben' }]);
    assert.deepEqual(all("SELECT account, author_name, body, created_at FROM comment WHERE target_kind = 'post'"), [{ account: 'seed:ada', author_name: 'Ada King', body: 'More to come.', created_at: '2026-11-05T21:05:00.000Z' }]);
    assert.deepEqual(all("SELECT account, kind FROM reaction WHERE target_kind = 'post'"), [{ account: 'seed:ada', kind: 'heart' }]);
    // Three pictures: two with the post, in their order and marked as uploaded for it, one in an album. Each is a PNG with its
    // small copy, in the media folder.
    const media = all('SELECT m.key, m.mime, m.width, m.height, m.caption, m.thumb, m.uploaded_by, m.for_post, a.name AS album, pm.ord FROM media m LEFT JOIN album a ON a.id = m.album LEFT JOIN post_media pm ON pm.media = m.key ORDER BY m.uploaded_at, pm.ord');
    assert.deepEqual(media.map((m) => [m.mime, m.width, m.height, m.caption, m.uploaded_by, m.album, m.ord, m.for_post]), [
      ['image/png', 1280, 960, 'The boat', 'seed:ada', 'Summer', null, 0],
      ['image/png', 1280, 960, null, 'seed:ada', null, 0, 1],
      ['image/png', 960, 1280, null, 'seed:ada', null, 1, 1],
    ]);
    for (const m of media) {
      for (const key of [m.key, m.thumb]) {
        const bytes = readFileSync(join(data, 'media', 'feedfam', String(key)));
        assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${key} is a PNG`);
      }
      assert.ok(statSync(join(data, 'media', 'feedfam', String(m.thumb))).size < statSync(join(data, 'media', 'feedfam', String(m.key))).size);
    }
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    db.close();
  }
});
