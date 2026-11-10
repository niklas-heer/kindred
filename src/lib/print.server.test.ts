// node --test src/lib/print.server.test.ts — what the family book reads of each person, on a private data folder: members
// only, nothing of the living unless asked for in full, no picture a living person is in, and the batch limit.
// Server modules load through Vite (ssrLoadModule), as the app does.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-print-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const family = openSqlite(join(dir, 'family.db'), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', 'family'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname, born, born_place, living, bio) VALUES
    ('ada', 'Ada', 'Alder', '1890', 'Lindholm', 0, 'Ada kept bees.'),
    ('ben', 'Ben', 'Alder', '1920', NULL, 0, NULL),
    ('cleo', 'Cleo', 'Alder', '2010-04-02', 'Brookmere', 1, 'Cleo plays the cello.');
  INSERT INTO parent (child, parent) VALUES ('ben', 'ada'), ('cleo', 'ben');
  INSERT INTO partnership (id, a, b, kind, start) VALUES ('u1', 'ada', 'ben', 'other', '1950'), ('u2', 'ben', 'cleo', 'other', '2020');
  INSERT INTO story (id, person, kind, title, body, author, at) VALUES
    ('s1', 'ada', 'memory', 'The bees', 'She sang to them.', 'Aunt Ina', '2024-02-01T10:00:00Z'),
    ('s2', 'cleo', 'memory', NULL, 'First recital.', 'Aunt Ina', '2024-03-01T10:00:00Z');
  INSERT INTO life_event (id, person, type, label, date, place, note, ord, created_at, updated_at) VALUES
    ('e2', 'ada', 'residence', NULL, '1930', 'Lindholm', '', 0, '2026', '2026'),
    ('e1', 'ada', 'baptism', NULL, '1890', 'Lindholm', 'In the old church', 0, '2026', '2026'),
    ('e3', 'cleo', 'education', 'Village school', '2016', 'Brookmere', '', 0, '2026', '2026');
  INSERT INTO source (id, title, created_at, updated_at) VALUES ('src', 'Parish register of Lindholm', '2026', '2026');
  INSERT INTO citation (id, source, fact, person, parent, event, partnership, page, quality, created_at, updated_at) VALUES
    ('c1', 'src', 'birth', 'ada', NULL, NULL, NULL, 'p. 12', 'original', '2026-01', '2026'),
    ('c2', 'src', 'event', NULL, NULL, 'e1', NULL, NULL, NULL, '2026-02', '2026'),
    ('c3', 'src', 'partnership', NULL, NULL, NULL, 'u1', NULL, NULL, '2026-03', '2026'),
    ('c4', 'src', 'partnership', NULL, NULL, NULL, 'u2', NULL, NULL, '2026-04', '2026'),
    ('c5', 'src', 'birth', 'cleo', NULL, NULL, NULL, NULL, NULL, '2026-05', '2026'),
    ('c6', 'src', 'parent', 'ben', 'ada', NULL, NULL, NULL, NULL, '2026-06', '2026');
  INSERT INTO media (key, mime, width, height, taken, caption, uploaded_by, uploaded_at) VALUES
    ('gallery/old.jpg', 'image/jpeg', 600, 400, '1925', 'Ada at the hives', 'x', '2026'),
    ('gallery/both.jpg', 'image/jpeg', 600, 400, '2015', 'Ada''s portrait held by Cleo', 'x', '2026'),
    ('gallery/maybe.jpg', 'image/jpeg', 600, 400, '1930', 'Perhaps Ada', 'x', '2026');
  INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at) VALUES
    ('gallery/old.jpg', 'ada', 0.1, 0.1, 0.2, 0.2, 1, 'x', '2026'),
    ('gallery/both.jpg', 'ada', 0.1, 0.1, 0.2, 0.2, 1, 'x', '2026'),
    ('gallery/both.jpg', 'cleo', 0.5, 0.1, 0.2, 0.2, 1, 'x', '2026'),
    ('gallery/maybe.jpg', 'ada', 0.1, 0.1, 0.2, 0.2, 0, 'x', '2026');
`);
family.close();

const P = await load<typeof import('./print.server.ts')>('/src/lib/print.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const viewer = { id: 'u-viewer', name: 'Vi Viewer', role: 'viewer' as const };
const guest = { id: '', name: '', role: 'viewer' as const, guest: true, protectLiving: false };
const names = { living: false, photos: true };
const full = { living: true, photos: true };

test('a share-link guest gets nothing of the book, whatever the link protects', async () => {
  await assert.rejects(P.printPeople('family', ['ada'], names, guest), /access to this family/);
  await assert.rejects(P.printPeople('family', ['ada'], full, { ...guest, protectLiving: true }), /access to this family/);
  await assert.rejects(P.printPeople('family', ['ada'], full, { ...viewer, id: '' }), /access to this family/);
});

test('a member gets a dead person’s biography, memories, events in order, citations by fact and confirmed pictures', async () => {
  const [ada] = await P.printPeople('family', ['ada'], names, viewer);
  assert.equal(ada.bio, 'Ada kept bees.');
  assert.deepEqual(ada.stories.map((s) => [s.id, s.title, s.author]), [['s1', 'The bees', 'Aunt Ina']]);
  assert.deepEqual(ada.events.map((e) => e.id), ['e1', 'e2']);
  assert.deepEqual(ada.citations, [
    { source: 'src', fact: 'birth', page: 'p. 12', quality: 'original' },
    { source: 'src', fact: 'event', page: null, quality: null, event: 'e1' },
    { source: 'src', fact: 'partnership', page: null, quality: null, partnership: 'u1' },
  ]);
  // The picture a living person is in stays out, and so does a tag nobody confirmed.
  assert.deepEqual(ada.photos.map((p) => p.key), ['gallery/old.jpg']);
});

test('by default nothing of a living person is read: no biography, memory, event, citation or picture', async () => {
  const [cleo, ben] = await P.printPeople('family', ['cleo', 'ben'], names, viewer);
  assert.deepEqual(cleo, { id: 'cleo', stories: [], events: [], citations: [], photos: [] });
  // Ben is dead, but his partnership with the living Cleo keeps its source to itself; his parent link is his own fact.
  assert.deepEqual(ben.citations.map((c) => [c.fact, c.partnership ?? c.parent]), [['partnership', 'u1'], ['parent', 'ada']]);
});

test('asked for in full, the living are read like anyone, and their pictures come back', async () => {
  const [cleo, ada, ben] = await P.printPeople('family', ['cleo', 'ada', 'ben'], full, viewer);
  assert.equal(cleo.bio, 'Cleo plays the cello.');
  assert.deepEqual(cleo.stories.map((s) => s.id), ['s2']);
  assert.deepEqual(cleo.events.map((e) => e.id), ['e3']);
  assert.deepEqual(cleo.citations.map((c) => c.fact), ['partnership', 'birth']);
  assert.deepEqual(ada.photos.map((p) => p.key), ['gallery/old.jpg', 'gallery/both.jpg']);
  assert.deepEqual(ben.citations.map((c) => [c.fact, c.partnership ?? c.parent]), [['partnership', 'u1'], ['partnership', 'u2'], ['parent', 'ada']]);
});

test('without photos no picture is read, unknown people are left out, and a batch is capped', async () => {
  const [ada] = await P.printPeople('family', ['ada'], { living: true, photos: false }, viewer);
  assert.deepEqual(ada.photos, []);
  assert.deepEqual((await P.printPeople('family', ['nobody', 'ben', 'ben'], names, viewer)).map((p) => p.id), ['ben']);
  assert.deepEqual(await P.printPeople('family', [], names, viewer), []);
  const many = Array.from({ length: P.PRINT_BATCH + 5 }, (_, i) => (i === P.PRINT_BATCH + 4 ? 'ada' : `x${i}`));
  assert.deepEqual(await P.printPeople('family', many, names, viewer), [], 'ids past the batch limit are not read');
});
