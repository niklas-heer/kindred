// node --test src/lib/feed/posts.server.test.ts — posts on a private data folder: who may write, change and remove one;
// that a guest gets nothing, not even a post's pictures in the Gallery; the limits; pictures that are the writer's own
// gallery uploads; reactions and comments on a post through the one implementation; what stays when a member leaves; the
// push about a new post (gentle, and never from a demo or a preview); "What's new" and the weekly push; the migration.
// Server modules load through Vite (ssrLoadModule), as the app does. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-posts-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const family = openSqlite(join(dir, 'family.db'), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', 'family'), ('name', 'The Alders'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1890', 0), ('ben', 'Ben', 'Alder', '1960-02-03', 1), ('cleo', 'Cleo', 'Alder', '2010-04-02', 1);
`);
family.close();

const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const P = await load<typeof import('./posts.server.ts')>('/src/lib/feed/posts.server.ts');
const F = await load<typeof import('./feed.server.ts')>('/src/lib/feed/feed.server.ts');
const Rs = await load<typeof import('../research.server.ts')>('/src/lib/research.server.ts');
const Sources = await load<typeof import('../sources.server.ts')>('/src/lib/sources.server.ts');
const Push = await load<typeof import('./post-push.server.ts')>('/src/lib/feed/post-push.server.ts');
const R = await load<typeof import('../responses.server.ts')>('/src/lib/responses.server.ts');
const H = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const WeekPush = await load<typeof import('../history-push.server.ts')>('/src/lib/history-push.server.ts');
const Photos = await load<typeof import('../photos.server.ts')>('/src/lib/photos.server.ts');
const M = await load<typeof import('../auth/members.server.ts')>('/src/lib/auth/members.server.ts');
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { b64url } = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');
const { readTree } = await load<typeof import('../exchange/model.ts')>('/src/lib/exchange/model.ts');
const { markdownArchive } = await load<typeof import('../exchange/markdown.ts')>('/src/lib/exchange/markdown.ts');
const { writeGedcom } = await load<typeof import('../exchange/gedcom.ts')>('/src/lib/exchange/gedcom.ts');
const { MAX_POST, MAX_POSTS_AN_HOUR, MAX_POST_MEDIA } = await load<typeof import('./types.ts')>('/src/lib/feed/types.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
/** A member with an account in the family, standing for `person` when given. */
async function member(name: string, role: Role, person: string | null = null) {
  const { user, insert } = store.newUser(name, null);
  await store.accounts().batch([insert, store.upsertMembership(user.id, 'family', role)]);
  if (person) await store.accounts().run('UPDATE membership SET person = ? WHERE user = ? AND tree = ?', person, user.id, 'family');
  return { id: user.id, name, role, person };
}
const guest = { id: '', name: '', role: 'viewer' as const, guest: true };
const forbidden = /permission/;
const noAccess = /access/i;
const d = () => db.db('family');
const count = async (table: string, where = '1 = 1') => (await d().get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
// The smallest PNG there is: the gallery's own upload stores it.
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
/** A gallery picture uploaded by `who`, as the composer uploads one before the post is made: marked as meant for a post. */
const upload = async (who: { id: string }, caption: string | null = null) => (await Photos.addPhoto('family', who.id, PNG, { mime: 'image/png', width: 1, height: 1, taken: null, place: null, caption, album: null, forPost: true }, undefined, { bytes: PNG, mime: 'image/png' })).key;
/** An ordinary gallery picture uploaded by `who` in the Gallery. */
const galleryUpload = async (who: { id: string }, album: string | null = null, caption: string | null = null) => (await Photos.addPhoto('family', who.id, PNG, { mime: 'image/png', width: 1, height: 1, taken: '1990', place: null, caption, album }, undefined, { bytes: PNG, mime: 'image/png' })).key;

const steward = await member('Stella Steward', 'steward');
const editor = await member('Eda Editor', 'editor');
const contributor = await member('Cal Contributor', 'contributor', 'ben');
const other = await member('Ona Other', 'contributor');
const viewer = await member('Vi Viewer', 'viewer');

test('the migration is plain SQL both drivers run; reactions and comments keep their rows and take a post', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/tree/0029_posts.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK)\b|^\s*BEGIN\s*;/im);
  const account = readFileSync(join(process.cwd(), 'migrations/accounts/0029_post_push.sql'), 'utf8');
  assert.doesNotMatch(account.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK|BEGIN)\b/i);
  const f = openSqlite(join(dir, 'family.db'), 'tree');
  const cols = (t: string) => (f.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((r) => r.name);
  const triggers = (f.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%responses_go' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  const [post, reaction, comment] = [cols('post'), cols('reaction'), cols('comment')];
  f.close();
  assert.deepEqual(post, ['id', 'account', 'author_name', 'author_person', 'body', 'created_at', 'edited_at']);
  // The same columns as before the tables were made again: "what's new" and the exports read them by name.
  assert.deepEqual(reaction, ['target_kind', 'target', 'account', 'kind', 'created_at']);
  assert.deepEqual(comment, ['id', 'target_kind', 'target', 'account', 'author_name', 'body', 'created_at', 'edited_at']);
  assert.deepEqual(triggers, ['media_responses_go', 'post_responses_go', 'story_responses_go']);
});

test('a guest gets nothing: no post, no person’s posts, no change', async () => {
  const { id } = await P.createPost('family', contributor, { body: 'We moved to Aldersbrook.' });
  await assert.rejects(P.postView('family', guest, id), noAccess);
  await assert.rejects(P.personPosts('family', guest, 'ben'), noAccess);
  await assert.rejects(P.createPost('family', guest, { body: 'Hello' }), noAccess);
  await assert.rejects(P.editPost('family', guest, id, { body: 'Hello' }), noAccess);
  await assert.rejects(P.removePost('family', guest, id), noAccess);
  // And none of the reactions or comments on it.
  await assert.rejects(R.react('family', guest, 'post', id, 'heart', true), noAccess);
  await assert.rejects(R.thread('family', guest, 'post', id), noAccess);
});

test('contributors and above write; a viewer reads; the post is signed with the writer’s name and the person they stand for', async () => {
  await assert.rejects(P.createPost('family', viewer, { body: 'May I?' }), forbidden);
  const { id } = await P.createPost('family', contributor, { body: '  She passed her exam!\r\n\r\n\r\n\r\n\r\nWe are so proud.  ', people: ['cleo', 'cleo'] });
  const seen = (await P.postView('family', viewer, id))!;
  assert.equal(seen.body, 'She passed her exam!\n\n\nWe are so proud.', 'trimmed, plain line endings, at most two blank lines');
  assert.deepEqual(seen.author, { name: 'Cal Contributor', person: 'ben' });
  assert.deepEqual(seen.people, ['cleo']);
  assert.equal(seen.mine, false);
  assert.equal(seen.removable, false);
  assert.equal(seen.editedAt, null);
  for (const who of [editor, steward]) assert.ok((await P.createPost('family', who, { body: 'Hello all' })).id);
  // It also shows on the page of the person it is about, and only there.
  assert.deepEqual((await P.personPosts('family', viewer, 'cleo')).map((p) => p.id), [id]);
  assert.deepEqual(await P.personPosts('family', viewer, 'ada'), []);
});

test('a post is not in the change history, and counts as no record', async () => {
  const before = await count('history');
  const { id } = await P.createPost('family', contributor, { body: 'Nothing for the records.' });
  await P.editPost('family', contributor, id, { body: 'Nothing for the records, really.' });
  await P.removePost('family', contributor, id);
  assert.equal(await count('history'), before);
});

test('the limits: something to say, at most 4,000 characters, people who are in the tree, not too many in an hour', async () => {
  await assert.rejects(P.createPost('family', contributor, { body: '  \n ' }), /feed\.err\.empty/);
  await assert.rejects(P.createPost('family', contributor, { body: 'x'.repeat(MAX_POST + 1) }), /feed\.err\.long/);
  assert.ok((await P.createPost('family', contributor, { body: 'x'.repeat(MAX_POST) })).id);
  await assert.rejects(P.createPost('family', contributor, { body: 'Hi', people: ['nobody'] }), /feed\.err\.person_gone/);
  await assert.rejects(P.createPost('family', contributor, { body: 'Hi', media: Array.from({ length: MAX_POST_MEDIA + 1 }, (_, i) => `gallery/x${i}.png`) }), /feed\.err\.pictures/);
  const busy = await member('Bea Busy', 'contributor');
  const now = new Date('2026-11-10T12:00:00Z');
  for (let i = 0; i < MAX_POSTS_AN_HOUR; i++) await P.createPost('family', busy, { body: `Note ${i}` }, undefined, new Date(now.getTime() + i * 1000));
  await assert.rejects(P.createPost('family', busy, { body: 'One more' }, undefined, new Date(now.getTime() + 60_000)), /feed\.err\.too_many/);
  assert.ok((await P.createPost('family', busy, { body: 'An hour later' }, undefined, new Date(now.getTime() + 3_700_000))).id);
});

test('a retry with the same key writes the post once', async () => {
  const before = await count('post');
  const op = { key: 'retry-key-0001', user: contributor.id, payload: { body: 'Once only' } };
  const first = await P.createPost('family', contributor, { body: 'Once only' }, op);
  const again = await P.createPost('family', contributor, { body: 'Once only' }, op);
  assert.equal(again.id, first.id);
  assert.equal(await count('post'), before + 1);
});

test('pictures are the writer’s own uploads for a post, in order, in one post only; a post may be pictures alone', async () => {
  const [a, b] = [await upload(contributor), await upload(contributor)];
  const theirs = await upload(other);
  await assert.rejects(P.createPost('family', contributor, { body: 'Not mine', media: [theirs] }), /feed\.err\.picture_gone/);
  // An ordinary gallery picture, the writer's own, is not a post's to take: an old album picture with a face in it.
  const album = await Photos.saveAlbum('family', { name: 'Wedding 1990' }, undefined);
  const old = await galleryUpload(contributor, album.id, 'The wedding');
  await d().run("UPDATE media SET uploaded_at = '2020-01-01T00:00:00.000Z' WHERE key = ?", old);
  await Photos.addTag('family', contributor.id, old, 'ada', { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, undefined);
  await assert.rejects(P.createPost('family', contributor, { body: 'An old one', media: [old] }), /feed\.err\.picture_gone/);
  await assert.rejects(P.createPost('family', contributor, { body: 'With a new one', media: [a, old] }), /feed\.err\.picture_gone/);
  assert.ok((await Photos.gallery('family', true, true)).media.some((m) => m.key === old), 'it stays a guest’s to see');
  await assert.rejects(P.createPost('family', contributor, { body: 'Not there', media: ['gallery/none.png'] }), /feed\.err\.picture_gone/);
  const { id } = await P.createPost('family', contributor, { body: '', media: [b, a] });
  const seen = (await P.postView('family', viewer, id))!;
  assert.deepEqual(seen.pictures.map((p) => p.key), [b, a]);
  assert.equal(seen.body, '');
  await assert.rejects(P.createPost('family', contributor, { body: 'Again', media: [a] }), /feed\.err\.picture_gone/, 'a picture belongs to one post');
  // In the Gallery they are ordinary pictures that say which post they came with.
  const gallery = await Photos.gallery('family');
  assert.equal(gallery.media.find((m) => m.key === a)?.post, id);
  assert.equal(gallery.media.find((m) => m.key === theirs)?.post, undefined);
});

test('a guest’s Gallery has no picture that came with a post, and the picture is not served to them', async () => {
  const plainBefore = await galleryUpload(contributor);
  const key = await upload(contributor);
  const plain = plainBefore;
  await P.createPost('family', contributor, { body: 'Sunday at the lake', media: [key] });
  const asGuest = await Photos.gallery('family', true, true);
  assert.ok(!asGuest.media.some((m) => m.key === key));
  assert.ok(asGuest.media.some((m) => m.key === plain), 'an ordinary gallery picture is still a guest’s to see');
  assert.ok(!asGuest.media.some((m) => m.post), 'and nothing tells a guest of a post');
  assert.equal(await Photos.pictureFor('family', key, false, true), undefined);
  assert.equal(await Photos.pictureFor('family', key, true, true), undefined);
  assert.ok(await Photos.pictureFor('family', key, false, false));
  assert.ok(await Photos.pictureFor('family', plain, false, true));
  // A person's photos, for a guest: tagged in both, shown the plain one only.
  for (const k of [key, plain]) await Photos.addTag('family', contributor.id, k, 'ada', { x: 0, y: 0, w: 1, h: 1 }, undefined);
  const forGuest = (await Photos.personMedia('family', 'ada', false, true)).map((m) => m.key);
  assert.ok(forGuest.includes(plain) && !forGuest.includes(key));
  assert.ok((await Photos.personMedia('family', 'ada')).filter((m) => m.key === key || m.key === plain).length === 2);
});

test('a picture uploaded for a post that is never made is nobody’s to see: not a guest’s, not in the feed or the news', async () => {
  await new Promise((done) => setTimeout(done, 5));
  const since = Date.now();
  await new Promise((done) => setTimeout(done, 5));
  const key = await upload(contributor, 'LEFTOVER-CAPTION');
  await Photos.addTag('family', contributor.id, key, 'ada', { x: 0, y: 0, w: 1, h: 1 }, undefined);
  const stored = (await d().get<{ for_post: number; album: string | null }>('SELECT for_post, album FROM media WHERE key = ?', key))!;
  assert.deepEqual({ ...stored }, { for_post: 1, album: null }, 'marked from the moment it is stored, in no album');
  // A guest: not in the Gallery, not on a person's page, not served, nor its small copy.
  assert.ok(!(await Photos.gallery('family', false, true)).media.some((m) => m.key === key));
  assert.ok(!(await Photos.gallery('family', true, true)).media.some((m) => m.key === key));
  assert.ok(!(await Photos.personMedia('family', 'ada', false, true)).some((m) => m.key === key));
  assert.equal(await Photos.pictureFor('family', key, false, true), undefined);
  assert.equal(await Photos.pictureFor('family', key, true, true), undefined);
  // A member: no post holds it, so it is a leftover, in no list either.
  assert.ok(!(await Photos.gallery('family')).media.some((m) => m.key === key), 'not in the members’ Gallery');
  assert.ok(!(await Photos.personMedia('family', 'ada')).some((m) => m.key === key), 'nor on the person’s page');
  const feed = await F.feedPage('family', viewer);
  assert.ok(!JSON.stringify(feed).includes(key), 'the feed does not list it as an added photo');
  const news = await H.whatsNew(d(), { account: viewer.id, role: 'viewer', guest: false }, since);
  assert.ok(!news.groups.some((g) => g.lines.some((l) => l.kind === 'photo')), '“What’s new” does not say a photo was added');
  // Research, which a guest reads, cannot take it, and would not show it.
  const project = await Rs.saveProject('family', contributor, { title: 'Public research', summary: '', private: false }, undefined);
  await assert.rejects(Rs.addLink('family', contributor, project.id, 'picture', key, false, undefined), /research\.err\.picture_of_a_post/);
  await d().run("INSERT INTO research_picture (project, media, created_by, created_at) VALUES (?, ?, 'x', '2026-01-01')", project.id, key);
  const asGuest = { id: '', name: '', role: 'viewer' as const, protectLiving: true };
  assert.deepEqual((await Rs.projectView('family', project.id, asGuest))!.pictures, []);
  assert.equal((await Rs.listProjects('family', asGuest)).find((p) => p.id === project.id)!.counts.pictures, 0);
  await d().run('DELETE FROM research_picture WHERE media = ?', key);
  // Nor can a source rest on it: it goes with its post.
  const source = { title: 'A photograph', author: null, publication: null, reference: null, date: null, note: '', document: null, media: key };
  await assert.rejects(Sources.saveSource('family', editor, source, undefined), /sources\.err\.picture_of_a_post/);
  // Once a post holds it, the members see it, under "From messages"; a guest still does not.
  const { id } = await P.createPost('family', contributor, { body: 'Now it is shared', media: [key] });
  assert.equal((await Photos.gallery('family')).media.find((m) => m.key === key)?.post, id);
  assert.ok(!(await Photos.gallery('family', false, true)).media.some((m) => m.key === key));
  assert.equal(await Photos.pictureFor('family', key, false, true), undefined);
  await assert.rejects(Rs.addLink('family', contributor, project.id, 'picture', key, false, undefined), /research\.err\.picture_of_a_post/, 'nor once it is in a post');
});

test('removing a post deletes only the pictures uploaded for it', async () => {
  const mine = await upload(contributor);
  const { id } = await P.createPost('family', contributor, { body: 'Two pictures', media: [mine] });
  // No change can put an ordinary picture in a post; were one there, it would stay in the gallery when the post goes.
  const album = await galleryUpload(contributor, null, 'An album picture');
  await d().run('INSERT INTO post_media (post, media, ord) VALUES (?, ?, 1)', id, album);
  await P.removePost('family', { ...contributor, role: 'viewer' }, id);
  assert.equal(await count('post', `id = '${id}'`), 0);
  assert.equal(await count('media', `key = '${mine}'`), 0, 'its own picture went');
  assert.equal(await count('media', `key = '${album}'`), 1, 'the gallery’s stayed');
  assert.ok(await db.media.get('family', album), 'in storage too');
});

test('the writer deletes their own leftovers; nobody else’s, and never a picture in a post or an ordinary one', async () => {
  const [left, kept] = [await upload(contributor), await upload(contributor)];
  const theirs = await upload(other);
  const plain = await galleryUpload(contributor);
  await P.createPost('family', contributor, { body: 'One of them', media: [kept] });
  await assert.rejects(P.discardPictures('family', guest, [left]), noAccess);
  assert.deepEqual(await P.discardPictures('family', contributor, [left, kept, theirs, plain]), { removed: 1 });
  assert.equal(await count('media', `key = '${left}'`), 0);
  assert.ok(!(await db.media.get('family', left)), 'its picture left storage');
  for (const k of [kept, theirs, plain]) assert.equal(await count('media', `key = '${k}'`), 1, `${k} stays`);
  assert.deepEqual(await P.discardPictures('family', contributor, [left]), { removed: 0 }, 'twice changes nothing');
  process.env.KINDRED_DEMO = '1';
  try {
    await assert.rejects(P.discardPictures('family', other, [theirs]), /demo/i);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
});

test('the daily job deletes leftovers a day old, from the table and the storage, and nothing younger or in a post', async () => {
  const now = new Date('2026-11-12T03:00:00.000Z');
  const [old, young, posted] = [await upload(other), await upload(other), await upload(other)];
  const plain = await galleryUpload(other);
  await P.createPost('family', other, { body: 'Kept', media: [posted] });
  const at = (key: string, iso: string) => d().run('UPDATE media SET uploaded_at = ? WHERE key = ?', iso, key);
  await at(old, '2026-11-11T02:59:59.000Z');
  await at(young, '2026-11-11T03:00:01.000Z');
  for (const k of [posted, plain]) await at(k, '2026-11-01T00:00:00.000Z');
  const thumb = (await d().get<{ thumb: string }>('SELECT thumb FROM media WHERE key = ?', old))!.thumb;
  const { feedJob } = await load<typeof import('../jobs/feed.ts')>('/src/lib/jobs/feed.ts');
  const logs: string[] = [];
  await feedJob.run({ trees: ['family'], now, env: () => undefined, log: (m) => logs.push(m) });
  assert.equal(await count('media', `key = '${old}'`), 0, 'a day old: gone');
  assert.ok(!(await db.media.get('family', old)) && !(await db.media.get('family', thumb)), 'with its picture and small copy');
  for (const k of [young, posted, plain]) assert.equal(await count('media', `key = '${k}'`), 1, `${k} stays`);
  assert.ok(await db.media.get('family', young));
  assert.match(logs.join('\n'), /removed [1-9]\d* pictures/);
  // A demo writes nothing, as everywhere.
  process.env.KINDRED_DEMO = '1';
  try {
    await assert.rejects(P.sweepLeftovers('family', new Date('2026-11-13T03:00:00.000Z')), /demo/i);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal(await count('media', `key = '${young}'`), 1);
});

test('only the writer changes a post; the writer or an editor removes it, never another contributor', async () => {
  const { id } = await P.createPost('family', contributor, { body: 'First words', people: ['ada'] });
  await assert.rejects(P.editPost('family', other, id, { body: 'Not yours' }), forbidden);
  await assert.rejects(P.editPost('family', editor, id, { body: 'Not even an editor' }), forbidden);
  await assert.rejects(P.editPost('family', contributor, id, { body: '   ' }), /feed\.err\.empty/);
  await P.editPost('family', contributor, id, { body: 'Better words', people: ['ben'] });
  let seen = (await P.postView('family', contributor, id))!;
  assert.equal(seen.body, 'Better words');
  assert.deepEqual(seen.people, ['ben']);
  assert.ok(seen.editedAt, 'it says it was changed');
  assert.equal(seen.mine, true);
  assert.equal(seen.removable, true);
  // Changing only who it is about is not a change of words.
  const { id: quiet } = await P.createPost('family', contributor, { body: 'Same words' });
  await P.editPost('family', contributor, quiet, { body: 'Same words', people: ['ada'] });
  assert.equal((await P.postView('family', contributor, quiet))!.editedAt, null);
  // Without `people`, they stay as they are.
  await P.editPost('family', contributor, id, { body: 'Better words still' });
  assert.deepEqual((await P.postView('family', contributor, id))!.people, ['ben']);

  await assert.rejects(P.removePost('family', other, id), forbidden);
  await assert.rejects(P.removePost('family', viewer, id), forbidden);
  seen = (await P.postView('family', editor, id))!;
  assert.equal(seen.mine, false);
  assert.equal(seen.removable, true, 'an editor may remove anyone’s');
  assert.deepEqual(await P.removePost('family', editor, id), { removed: true });
  assert.equal(await P.postView('family', editor, id), null);
  assert.deepEqual(await P.removePost('family', editor, id), { removed: false }, 'removing it twice changes nothing');
  await assert.rejects(P.editPost('family', contributor, id, { body: 'Too late' }), /feed\.err\.post_gone/);
  // A writer who is only a viewer now still removes their own.
  const demoted = await member('Dee Demoted', 'contributor');
  const { id: own } = await P.createPost('family', demoted, { body: 'Mine' });
  assert.deepEqual(await P.removePost('family', { ...demoted, role: 'viewer' }, own), { removed: true });
});

test('reactions and comments work on a post as on a memory, and go with it; its pictures go too, without a history row', async () => {
  const key = await upload(contributor);
  const { id } = await P.createPost('family', contributor, { body: 'Photos from Sunday', media: [key] });
  assert.deepEqual(await R.react('family', viewer, 'post', id, 'heart', true), { added: true });
  await assert.rejects(R.addComment('family', viewer, 'post', id, 'Lovely'), forbidden);
  const { id: commentId } = await R.addComment('family', other, 'post', id, 'What a day that was.');
  await R.addComment('family', editor, 'media', key, 'On the picture itself');
  const counts = await R.responseCounts('family', viewer);
  assert.deepEqual(counts[`post:${id}`], { reactions: { heart: 1 }, mine: ['heart'], comments: 1 });
  const thread = await R.thread('family', contributor, 'post', id);
  assert.deepEqual(thread.comments.map((c) => [c.id, c.authorName, c.body]), [[commentId, 'Ona Other', 'What a day that was.']]);
  assert.deepEqual(thread.reactors, { heart: ['Vi Viewer'] });
  await assert.rejects(R.react('family', viewer, 'post', '00000000-0000-4000-8000-000000000000', 'heart', true), /responses\.err\.gone/);

  const stored = await Photos.pictureFor('family', key, false);
  assert.ok(await db.media.get('family', stored!.key), 'the picture is in storage');
  const historyBefore = await count('history', "kind = 'photo'");
  await P.removePost('family', contributor, id);
  assert.equal(await count('reaction', `target = '${id}'`), 0);
  assert.equal(await count('comment', `target = '${id}'`), 0);
  assert.equal(await count('media', `key = '${key}'`), 0, 'its picture left the Gallery');
  assert.equal(await count('comment', `target = '${key}'`), 0, 'and the comment on the picture');
  assert.ok(!(await db.media.get('family', key)), 'and the storage');
  assert.equal(await count('history', "kind = 'photo'"), historyBefore, 'a picture uploaded for a post is part of it, not a record: no history row, coming or going');
  assert.equal(await count('post_media'), await count('post_media', 'post IN (SELECT id FROM post)'));
});

test('a removed picture or person leaves the post standing', async () => {
  const key = await upload(contributor);
  await d().run("INSERT INTO person (id, given, living) VALUES ('dan', 'Dan', 1)");
  const { id } = await P.createPost('family', contributor, { body: 'With Dan', media: [key], people: ['dan', 'ada'] });
  await Photos.removePhoto('family', key, undefined);
  await d().run("DELETE FROM person WHERE id = 'dan'");
  const seen = (await P.postView('family', viewer, id))!;
  assert.deepEqual(seen.pictures, []);
  assert.deepEqual(seen.people, ['ada']);
  assert.equal(seen.body, 'With Dan');
});

test('a member who leaves keeps their posts, under their name and with their face; nobody can change them, an editor can remove them', async () => {
  const lou = await member('Lou Leaving', 'contributor', 'cleo');
  const key = await upload(lou);
  const { id } = await P.createPost('family', lou, { body: 'Before I go', media: [key] });
  await R.addComment('family', other, 'post', id, 'Safe travels');
  await R.react('family', lou, 'post', id, 'thanks', true);
  await M.endMembership('family', lou.id);
  const seen = (await P.postView('family', viewer, id))!;
  assert.equal(seen.body, 'Before I go');
  assert.deepEqual(seen.author, { name: 'Lou Leaving', person: 'cleo' }, 'the name it was written under, and who they stood for then');
  assert.equal(seen.pictures.length, 1);
  assert.equal((await R.thread('family', viewer, 'post', id)).comments.length, 1, 'the comments under it stay');
  assert.equal(await count('reaction', `account = '${lou.id}'`), 0, 'their own reactions go, as everywhere');
  assert.equal(await count('post', `account = '${lou.id}'`), 1);
  assert.deepEqual(await P.removePost('family', editor, id), { removed: true });
});

test('a member who says who they are later has their face on what they wrote before', async () => {
  const nia = await member('Nia New', 'contributor');
  const { id } = await P.createPost('family', nia, { body: 'Hello, I am new here.' });
  assert.equal((await P.postView('family', viewer, id))!.author.person, null);
  await store.accounts().run("UPDATE membership SET person = 'cleo' WHERE user = ? AND tree = 'family'", nia.id);
  assert.equal((await P.postView('family', viewer, id))!.author.person, 'cleo');
});

test('an invented family’s voices: a seed’s account is one of its people, with a name and a face', async () => {
  await d().run("INSERT INTO post (id, account, author_name, author_person, body, created_at) VALUES ('00000000-0000-4000-8000-00000000feed', 'seed:ben', 'Ben Alder', 'ben', 'From the seed', '2026-01-01T10:00:00.000Z')");
  await d().run("INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES ('post', '00000000-0000-4000-8000-00000000feed', 'seed:cleo', 'heart', '2026-01-01T11:00:00.000Z')");
  await d().run("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('c-seed', 'post', '00000000-0000-4000-8000-00000000feed', 'seed:cleo', 'Cleo Alder', 'Well said', '2026-01-01T12:00:00.000Z')");
  const thread = await R.thread('family', viewer, 'post', '00000000-0000-4000-8000-00000000feed');
  assert.deepEqual(thread.reactors, { heart: ['Cleo Alder'] });
  assert.equal(thread.comments[0]!.person, 'cleo');
  assert.equal((await P.postView('family', viewer, '00000000-0000-4000-8000-00000000feed'))!.author.person, 'ben');
});

// ---------- the push about a new post ----------

async function device(user: string, endpoint: string, posts: 0 | 1, at: number) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await store.accounts().run(
    `INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen, posts)
     VALUES (?, ?, 'family', ?, ?, ?, '[0]', '["birthday"]', 'de', ?, ?, ?)`, crypto.randomUUID(), user, endpoint, p256dh, auth, at, at, posts);
}
async function vapidKeys() {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:family@example.org' };
}

test('the push about a new post: only to devices that asked, never to the writer, at most one in six hours', async () => {
  const T0 = new Date('2026-11-10T09:00:00Z');
  const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);
  await device(viewer.id, 'https://web.push.apple.com/viewer', 1, T0.getTime());
  await device(editor.id, 'https://web.push.apple.com/editor-off', 0, T0.getTime());
  await device(contributor.id, 'https://web.push.apple.com/writer', 1, T0.getTime());
  await device(steward.id, 'https://web.push.apple.com/stale', 1, T0.getTime() - 400 * 86_400_000);
  const vapid = await vapidKeys();
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;
  const options = { vapid, fetchImpl };

  assert.equal(await Push.notifyPost('family', contributor, { ...options, vapid: null, now: T0 }), 0, 'nothing without the server’s keys');
  assert.equal(await Push.notifyPost('family', contributor, { ...options, now: T0 }), 1);
  assert.deepEqual(sent, ['https://web.push.apple.com/viewer'], 'not the writer, not a device that did not ask, not one unopened for long');
  assert.equal(await Push.notifyPost('family', contributor, { ...options, now: hours(1) }), 0, 'a busy hour is one push');
  // Someone else's post reaches the first writer's own device, which has not been told anything yet; the other stays quiet.
  assert.equal(await Push.notifyPost('family', other, { ...options, now: hours(2) }), 1);
  assert.equal(await Push.notifyPost('family', other, { ...options, now: hours(5.9) }), 0);
  // Six hours after its last push, a device is told again.
  assert.equal(await Push.notifyPost('family', other, { ...options, now: hours(6) }), 1);
  assert.equal(await Push.notifyPost('family', other, { ...options, now: hours(8) }), 1);
  assert.deepEqual(sent, ['viewer', 'writer', 'viewer', 'writer'].map((d) => `https://web.push.apple.com/${d}`));
  // A device whose owner has left is not sent to; one the push service no longer knows is forgotten.
  const gone = await member('Gus Gone', 'viewer');
  await device(gone.id, 'https://web.push.apple.com/gone', 1, T0.getTime());
  await store.accounts().run("DELETE FROM membership WHERE user = ? AND tree = 'family'", gone.id);
  const expired = (async () => new Response(null, { status: 410 })) as typeof fetch;
  assert.equal(await Push.notifyPost('family', other, { vapid, fetchImpl: expired, now: hours(20) }), 0);
  assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM push_subscription WHERE endpoint LIKE '%/viewer' OR endpoint LIKE '%/writer'"))!.n, 0);
  assert.equal((await store.accounts().get<{ n: number }>("SELECT count(*) AS n FROM push_subscription WHERE endpoint LIKE '%/gone'"))!.n, 1, 'never contacted');
});

test('the push says who wrote and never what, in the device’s language', async () => {
  const T0 = new Date('2026-12-01T09:00:00Z');
  const reader = await member('Rae Reader', 'viewer');
  await device(reader.id, 'https://web.push.apple.com/reader', 1, T0.getTime());
  const { translate } = await load<typeof import('../i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');
  for (const locale of ['en', 'de', 'af'] as const) {
    const title = translate(locale, 'feed.push.title', { name: 'Cal Contributor', family: 'The Alders' });
    const body = translate(locale, 'feed.push.body', { name: 'Cal Contributor', family: 'The Alders' });
    assert.match(title, /Cal Contributor/);
    assert.match(body, /The Alders/);
  }
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response(null, { status: 201 }); }) as typeof fetch;
  assert.equal(await Push.notifyPost('family', contributor, { vapid: await vapidKeys(), fetchImpl, now: T0 }), 1);
  assert.equal(calls, 1);
});

test('a demo and a steward’s preview write no post and send no push', async () => {
  const T0 = new Date('2027-01-05T09:00:00Z');
  const reader = await member('Pat Preview', 'viewer');
  await device(reader.id, 'https://web.push.apple.com/preview', 1, T0.getTime());
  const vapid = await vapidKeys();
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response(null, { status: 201 }); }) as typeof fetch;
  const before = await count('post');

  process.env.KINDRED_DEMO = '1';
  try {
    await assert.rejects(P.createPost('family', contributor, { body: 'In a demo' }), /demo/i);
    await assert.rejects(P.removePost('family', editor, '00000000-0000-4000-8000-00000000feed'), /demo/i);
    assert.equal(await Push.notifyPost('family', contributor, { vapid, fetchImpl, now: T0 }), 0);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  // A preview is one request's property: the guard answers for it (auth/guard.server.ts); here the test does.
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as a contributor. Stop the preview to change something.'));
  try {
    await assert.rejects(P.createPost('family', contributor, { body: 'In a preview' }), /viewing as/);
    await assert.rejects(P.editPost('family', contributor, '00000000-0000-4000-8000-00000000feed', { body: 'x' }), /viewing as/);
    assert.equal(await Push.notifyPost('family', contributor, { vapid, fetchImpl, now: T0 }), 0);
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.equal(calls, 0);
  assert.equal(await count('post'), before);
  assert.equal(await Push.notifyPost('family', contributor, { vapid, fetchImpl, now: T0 }), 1, 'the control: outside both it is sent');
});

test('the choice to be told is the device’s, saved with its other reminder choices, and off until asked for', async () => {
  const reminders = await load<typeof import('../reminders.server.ts')>('/src/lib/reminders.server.ts');
  const { parseChoices } = await load<typeof import('../reminders.ts')>('/src/lib/reminders.ts');
  const dev = await member('Dev Device', 'viewer');
  const registration = { user: dev.id, tree: 'family', subscription: { endpoint: 'https://web.push.apple.com/dev', keys: { p256dh: 'p', auth: 'a' } }, choices: parseChoices([0], ['birthday'])!, locale: 'en' as const };
  const posts = async () => (await reminders.subscriptionOf(dev.id, 'family', 'https://web.push.apple.com/dev'))?.posts;
  await reminders.saveRegistration(registration);
  assert.equal(await posts(), 0);
  await reminders.saveRegistration({ ...registration, posts: true });
  assert.equal(await posts(), 1);
  await reminders.saveRegistration({ ...registration, posts: false });
  assert.equal(await posts(), 0);
});

// ---------- what's new, and the weekly push ----------

test('a post is news: "What’s new" names who wrote, the weekly push counts it, and replies to a post reach its writer', async () => {
  await new Promise((done) => setTimeout(done, 5));
  const since = Date.now();
  await new Promise((done) => setTimeout(done, 5));
  const wren = await member('Wren Writer', 'contributor');
  const { id } = await P.createPost('family', wren, { body: 'The garden is in bloom, come and see it before the frost.\nBring boots.' });
  await P.createPost('family', wren, { body: 'And bring cake.' });
  await R.addComment('family', other, 'post', id, 'We will!');
  await R.react('family', viewer, 'post', id, 'heart', true);

  const forViewer = await H.whatsNew(d(), { account: viewer.id, role: 'viewer', guest: false }, since);
  assert.deepEqual(forViewer.posts, [{ author: 'Wren Writer', count: 2 }]);
  assert.ok(forViewer.total >= 2);
  const forWren = await H.whatsNew(d(), { account: wren.id, role: 'contributor', guest: false }, since);
  assert.deepEqual(forWren.posts, [], 'your own posts are not news to you');
  assert.deepEqual(forWren.replies.map((r) => [r.kind, r.target, r.count, r.author]), [['comment', 'post', 1, 'Ona Other'], ['reaction', 'post', 1, '']]);
  assert.equal(forWren.replies[0]!.label, 'The garden is in bloom, come and see it before the frost. Br…', 'a post’s first words say which one');
  const asGuest = await H.whatsNew(d(), { account: null, role: 'viewer', guest: true }, since);
  assert.deepEqual(asGuest.posts, []);

  assert.ok((await H.newsCount(d(), { account: viewer.id, role: 'viewer', guest: false }, since)) >= 2);
  assert.equal(await H.newsCount(d(), { account: null, role: 'viewer', guest: true }, since), 0);

  const message = WeekPush.weeklyMessage('family', 'The Alders', 'en', { since: '', first: false, groups: [], replies: [], posts: forViewer.posts, total: 2 })!;
  assert.equal(message.body, 'Wren Writer wrote 2 messages to the family');
  assert.equal(message.url, '/family/today', 'a week of only messages opens where they are');
});

// ---------- the family's backup ----------

test('posts go into the Markdown archive with their comments, a file per year, and not into GEDCOM', async () => {
  const key = await upload(contributor);
  const { id } = await P.createPost('family', contributor, { body: 'ARCHIVE-POST first line\n# not a heading', media: [key], people: ['ada'] }, undefined, new Date('2025-03-04T10:00:00Z'));
  await R.addComment('family', other, 'post', id, 'ARCHIVE-COMMENT');
  const tree = await readTree(d());
  const { files, losses } = markdownArchive(tree);
  const year = files.find((f) => f.path === 'feed/2025.md');
  assert.ok(year, 'the year has its file');
  const text = String(year.data);
  assert.match(text, /## 2025-03-04, Cal Contributor\n\n> ARCHIVE-POST first line\n> # not a heading\n\n\*About \[\[people\/ada\]\]\. With 1 picture, kept in the gallery\.\*\n\n### Comments\n\n\*\*Ona Other\*\*, \d{4}-\d{2}-\d{2}:\n\n> ARCHIVE-COMMENT/);
  assert.ok(files.some((f) => /^feed\/20\d\d\.md$/.test(f.path) && f.path !== 'feed/2025.md'), 'and the other years theirs');
  assert.ok(losses.some((l) => /shared in the family’s feed (is|are) not in the archive/.test(l)), 'the archive says the pictures are not in it');
  const { text: ged } = writeGedcom(tree);
  assert.ok(!ged.includes('ARCHIVE-POST') && !ged.includes('ARCHIVE-COMMENT'));
});

