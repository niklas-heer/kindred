// node --test src/lib/remove-person.test.ts — removing a person deletes their photo file and every painted-portrait file
// (accepted, kept or draft), and leaves other people's files. A private data folder; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-remove-person-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'remove-person-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const { removePlan } = await load<typeof import('./relations.server.ts')>('/src/lib/relations.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const TREE = 'rm';
const seed = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
seed.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Rm family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname, living) VALUES ('ada', 'Ada', 'Rm', 1), ('ben', 'Ben', 'Rm', 1);
  INSERT INTO photo (person, mime, key, at) VALUES ('ben', 'image/png', 'photo/ben.png', '2026-01-01'), ('ada', 'image/png', 'photo/ada.png', '2026-01-01');
  INSERT INTO portrait (key, person, mime, source, model, created_by, created_at, accepted) VALUES
    ('portrait/ben-accepted.png', 'ben', 'image/png', 'photo/ben.png', 'm', 'u', '2026-01-01', 1),
    ('portrait/ben-draft.png', 'ben', 'image/png', 'photo/ben.png', 'm', 'u', '2026-01-01', 0),
    ('portrait/ada-draft.png', 'ada', 'image/png', 'photo/ada.png', 'm', 'u', '2026-01-01', 0);
`);
seed.close();

test('removing a person deletes their photo and every portrait file, and only theirs', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  for (const k of ['photo/ben.png', 'photo/ada.png', 'portrait/ben-accepted.png', 'portrait/ben-draft.png', 'portrait/ada-draft.png']) await dbs.media.put(TREE, k, bytes, 'image/png');
  assert.equal(await dbs.once(TREE, undefined, 'removePerson', (d) => removePlan(d, TREE, 'ben')), 1);
  for (const k of ['photo/ben.png', 'portrait/ben-accepted.png', 'portrait/ben-draft.png']) assert.equal(await dbs.media.get(TREE, k), undefined, `${k} is gone`);
  for (const k of ['photo/ada.png', 'portrait/ada-draft.png']) assert.ok(await dbs.media.get(TREE, k), `${k} stays`);
  assert.equal((await dbs.db(TREE).all('SELECT key FROM portrait WHERE person = ?', 'ben')).length, 0, 'no row is left');
});

test('the last person still cannot be removed', async () => {
  await assert.rejects(dbs.once(TREE, undefined, 'removePerson', (d) => removePlan(d, TREE, 'ada')), /last person/);
});
