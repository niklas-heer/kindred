// node --test src/lib/photos.test.ts — the gallery's server changes: showing the drawn avatar keeps the photo,
// and deleting an album keeps its photographs, without an album. Runs on a private data folder. The server
// modules load through Vite (ssrLoadModule), as the app does: they use Vite-resolved imports.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-photos-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const family = openSqlite(join(dir, 'family.db'), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', 'family'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, arms) VALUES ('h1', 'House Test', '{"field":"gules","division":"plain","charge":"none","chargeTincture":"or"}');
  INSERT INTO person (id, given, house) VALUES ('ada', 'Ada', 'h1');
  INSERT INTO photo (person, mime, key, data, at) VALUES ('ada', 'image/png', 'photo/ada.png', NULL, '2026-01-01T00:00:00Z');
  INSERT INTO album (id, name, at) VALUES ('a1', 'Summer', '2026-01-01T00:00:00Z');
  INSERT INTO media (key, mime, album, uploaded_by, uploaded_at) VALUES ('gallery/one.jpg', 'image/jpeg', 'a1', 'Anna', '2026-01-01T00:00:00Z');
`);
family.close();

const db = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const photos = await load<typeof import('./photos.server.ts')>('/src/lib/photos.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('showing the drawn avatar keeps the photo, and the photo can be shown again', async () => {
  await photos.setPreferAvatar('family', 'ada', true, undefined);
  let ada = (await db.graph('family')).people.find((p) => p.id === 'ada')!;
  assert.equal(ada.preferAvatar, true);
  assert.equal(typeof ada.photo, 'string', 'the photo is still on the person');
  assert.ok(await db.photo('family', 'ada'), 'and still stored');

  await photos.setPreferAvatar('family', 'ada', false, undefined);
  ada = (await db.graph('family')).people.find((p) => p.id === 'ada')!;
  assert.equal(ada.preferAvatar, false);
});

test('a choice for someone who is not in the family is refused', async () => {
  await assert.rejects(photos.setPreferAvatar('family', 'nobody', true, undefined), /photos\.err\.person_not_found/);
});

test('a steward deletes an album; its photographs stay, without an album', async () => {
  await photos.deleteAlbum('family', 'a1', undefined);
  const d = db.db('family');
  assert.equal(await d.get('SELECT id FROM album WHERE id = ?', 'a1'), undefined);
  const m = await d.get<{ album: string | null }>('SELECT album FROM media WHERE key = ?', 'gallery/one.jpg');
  assert.ok(m, 'the photograph is kept');
  assert.equal(m.album, null);
  await assert.rejects(photos.deleteAlbum('family', 'a1', undefined), /photos\.err\.album_already_gone/);
});
