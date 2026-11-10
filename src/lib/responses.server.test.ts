// node --test src/lib/responses.server.test.ts — reactions and comments on a private data folder: who may react, comment,
// change and remove; that a guest gets nothing; the counts in one read; that a story's or a photo's responses go with it and a
// removed member's comments stay with their name; the opt-in push, at most one a day; and the Markdown archive and GEDCOM.
// Server modules load through Vite (ssrLoadModule), as the app does.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-responses-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const family = openSqlite(join(dir, 'family.db'), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', 'family'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1890', 0), ('ben', 'Ben', 'Alder', '1920', 0), ('cleo', 'Cleo', 'Alder', '2010-04-02', 1);
  INSERT INTO media (key, mime, width, height, uploaded_by, uploaded_at) VALUES ('gallery/0000-photo.jpg', 'image/jpeg', 4, 3, 'u-contrib', '2026-01-01T00:00:00Z');
`);
family.close();

const db = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const R = await load<typeof import('./responses.server.ts')>('/src/lib/responses.server.ts');
const store = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const Rel = await load<typeof import('./relations.server.ts')>('/src/lib/relations.server.ts');
const Photos = await load<typeof import('./photos.server.ts')>('/src/lib/photos.server.ts');
const Story = await load<typeof import('./story.server.ts')>('/src/lib/story.server.ts');
const { readTree } = await load<typeof import('./exchange/model.ts')>('/src/lib/exchange/model.ts');
const { markdownArchive } = await load<typeof import('./exchange/markdown.ts')>('/src/lib/exchange/markdown.ts');
const { writeGedcom } = await load<typeof import('./exchange/gedcom.ts')>('/src/lib/exchange/gedcom.ts');
const { b64url } = await load<typeof import('./webpush.ts')>('/src/lib/webpush.ts');

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
  return { id: user.id, name, role };
}
const guest = { id: '', name: '', role: 'viewer' as const, guest: true };
const forbidden = /permission/;
const noAccess = /access/i;
let n = 0;
/** A story about `person`, written by `author` (an account) as the app writes it. */
async function story(person: string, author: { id: string; name: string } | null, body = 'We went to the lake.') {
  const id = `s${++n}`;
  await db.db('family').run('INSERT INTO story (id, person, kind, body, author, at, author_account) VALUES (?, ?, ?, ?, ?, ?, ?)', id, person, 'memory', body, author?.name ?? 'Someone', new Date().toISOString(), author?.id ?? null);
  return id;
}
const count = async (table: string, where = '1 = 1') => (await db.db('family').get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;

const steward = await member('Stella Steward', 'steward');
const editor = await member('Eda Editor', 'editor');
const contributor = await member('Cal Contributor', 'contributor', 'ben');
const viewer = await member('Vi Viewer', 'viewer');

test('the migration is plain SQL both drivers run, with the tables other features read', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/tree/0027_reactions_comments.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK)\b|^\s*BEGIN\s*;/im);
  const d = openSqlite(join(dir, 'family.db'), 'tree');
  const names = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('reaction', 'comment', 'response_push')").all() as { name: string }[]).map((r) => r.name).sort();
  const cols = (t: string) => (d.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((r) => r.name);
  const [reaction, comment] = [cols('reaction'), cols('comment')];
  d.close();
  assert.deepEqual(names, ['comment', 'reaction', 'response_push']);
  // Another feature ("what's new") reads these by name.
  assert.deepEqual(reaction, ['target_kind', 'target', 'account', 'kind', 'created_at']);
  assert.deepEqual(comment, ['id', 'target_kind', 'target', 'account', 'author_name', 'body', 'created_at', 'edited_at']);
});

test('a guest gets nothing: no counts, no thread, no reaction, no comment, no push choice', async () => {
  const s = await story('ada', contributor);
  await assert.rejects(R.responseCounts('family', guest), noAccess);
  await assert.rejects(R.thread('family', guest, 'story', s), noAccess);
  await assert.rejects(R.react('family', guest, 'story', s, 'heart', true), noAccess);
  await assert.rejects(R.addComment('family', guest, 'story', s, 'Hello'), noAccess);
  await assert.rejects(R.removeComment('family', guest, 'x'), noAccess);
  await assert.rejects(R.setResponsePush('family', guest, true), noAccess);
  // And the Chronicle a guest reads carries no account of a writer.
  const rows = await db.chronicle('family', 300, false);
  assert.ok(rows.length);
  for (const r of rows) assert.equal('author_account' in r, false);
});

test('every member reacts; the same reaction twice is one; taking it back removes only theirs', async () => {
  const s = await story('ada', contributor);
  assert.deepEqual(await R.react('family', viewer, 'story', s, 'remember', true), { added: true });
  assert.deepEqual(await R.react('family', viewer, 'story', s, 'remember', true), { added: false });
  await R.react('family', editor, 'story', s, 'remember', true);
  await R.react('family', editor, 'story', s, 'candle', true);
  let counts = await R.responseCounts('family', viewer);
  assert.deepEqual(counts[`story:${s}`].reactions, { remember: 2, candle: 1 });
  assert.deepEqual(counts[`story:${s}`].mine, ['remember']);
  await R.react('family', viewer, 'story', s, 'remember', false);
  counts = await R.responseCounts('family', editor);
  assert.deepEqual(counts[`story:${s}`].reactions, { remember: 1, candle: 1 });
  assert.deepEqual(counts[`story:${s}`].mine.sort(), ['candle', 'remember']);
  await assert.rejects(R.react('family', viewer, 'story', 'no-such-story', 'heart', true), /responses\.err\.gone/);
  await assert.rejects(R.react('family', viewer, 'media', 'gallery/none.jpg', 'heart', true), /responses\.err\.gone/);
});

test('comments are a contributor’s; plain text with its line breaks, at most 1,000 characters', async () => {
  const s = await story('ben', editor);
  await assert.rejects(R.addComment('family', viewer, 'story', s, 'Hello'), forbidden);
  const { id } = await R.addComment('family', contributor, 'story', s, '  Line one\r\nLine two\n\n\n\n\n<b>bold</b>  ');
  const t = await R.thread('family', contributor, 'story', s);
  assert.equal(t.comments.length, 1);
  assert.equal(t.comments[0].id, id);
  assert.equal(t.comments[0].body, 'Line one\nLine two\n\n\n<b>bold</b>', 'kept as text, line breaks folded to plain ones');
  assert.equal(t.comments[0].authorName, 'Cal Contributor', 'the member’s own name, never one the browser sends');
  assert.equal(t.comments[0].person, 'ben', 'the person the member stands for, for the portrait');
  assert.equal(t.comments[0].mine, true);
  await assert.rejects(R.addComment('family', contributor, 'story', s, 'x'.repeat(1001)), /responses\.err\.long/);
  await assert.rejects(R.addComment('family', contributor, 'story', s, ' \n '), /responses\.err\.empty/);
  await R.addComment('family', contributor, 'story', s, 'x'.repeat(1000));
  assert.equal((await R.responseCounts('family', viewer))[`story:${s}`].comments, 2);
});

test('only the writer changes a comment; the writer or an editor removes it, never another contributor', async () => {
  const s = await story('ben', editor);
  const other = await member('Ola Other', 'contributor');
  const { id } = await R.addComment('family', contributor, 'story', s, 'First words');
  await assert.rejects(R.editComment('family', other, id, 'Hijacked'), forbidden);
  await assert.rejects(R.editComment('family', editor, id, 'Edited by an editor'), forbidden, 'an editor removes, but never puts words in someone’s mouth');
  await R.editComment('family', contributor, id, 'Better words');
  const [c] = (await R.thread('family', viewer, 'story', s)).comments;
  assert.equal(c.body, 'Better words');
  assert.ok(c.editedAt);
  assert.equal(c.mine, false);
  assert.equal(c.removable, false, 'a viewer may not remove it');
  assert.equal((await R.thread('family', editor, 'story', s)).comments[0].removable, true);
  assert.equal((await R.thread('family', steward, 'story', s)).comments[0].removable, true);
  await assert.rejects(R.removeComment('family', other, id), forbidden);
  assert.deepEqual(await R.removeComment('family', editor, id), { removed: true });
  assert.deepEqual(await R.removeComment('family', editor, id), { removed: false });
  // The writer removes their own, even after their role went down to viewer.
  const { id: mine } = await R.addComment('family', other, 'story', s, 'Mine to take back');
  await assert.rejects(R.editComment('family', { ...other, role: 'viewer' }, mine, 'Changed'), forbidden);
  assert.deepEqual(await R.removeComment('family', { ...other, role: 'viewer' }, mine), { removed: true });
});

test('a story’s or a photo’s reactions and comments go with it, by whatever route it goes', async () => {
  // A story removed on its own.
  const a = await story('ada', contributor);
  await R.react('family', viewer, 'story', a, 'heart', true);
  await R.addComment('family', contributor, 'story', a, 'Gone soon');
  await Story.removeStory('family', a, undefined);
  assert.equal(await count('reaction', `target = '${a}'`), 0);
  assert.equal(await count('comment', `target = '${a}'`), 0);
  // A story that goes with its person.
  await db.db('family').run("INSERT INTO person (id, given, living) VALUES ('dora', 'Dora', 0)");
  const b = await story('dora', contributor);
  await R.react('family', viewer, 'story', b, 'laugh', true);
  await R.addComment('family', contributor, 'story', b, 'About Dora');
  await db.once('family', undefined, 'removePerson', (d) => Rel.removePlan(d, 'family', 'dora'));
  assert.equal(await count('story', "person = 'dora'"), 0);
  assert.equal(await count('reaction', `target = '${b}'`), 0);
  assert.equal(await count('comment', `target = '${b}'`), 0);
  // A photo.
  await db.db('family').run("INSERT INTO media (key, mime, uploaded_by, uploaded_at) VALUES ('gallery/1111-gone.jpg', 'image/jpeg', 'u', '2026-01-01')");
  await R.react('family', viewer, 'media', 'gallery/1111-gone.jpg', 'heart', true);
  await R.addComment('family', contributor, 'media', 'gallery/1111-gone.jpg', 'Lovely');
  await Photos.removePhoto('family', 'gallery/1111-gone.jpg', undefined);
  assert.equal(await count('reaction', "target = 'gallery/1111-gone.jpg'"), 0);
  assert.equal(await count('comment', "target = 'gallery/1111-gone.jpg'"), 0);
});

test('a member who leaves keeps their comments, under the name they wrote them with, and their reactions', async () => {
  const s = await story('ada', editor);
  const leaving = await member('Lou Leaving', 'contributor', 'ada');
  await R.addComment('family', leaving, 'story', s, 'Goodbye, all');
  await R.react('family', leaving, 'story', s, 'thanks', true);
  await store.accounts().run('DELETE FROM membership WHERE user = ?', leaving.id);
  let t = await R.thread('family', viewer, 'story', s);
  assert.equal(t.comments[0].authorName, 'Lou Leaving');
  assert.equal(t.comments[0].person, null, 'no longer standing for anyone here');
  assert.deepEqual(t.reactors.thanks, ['Lou Leaving']);
  await store.accounts().run('DELETE FROM user WHERE id = ?', leaving.id);
  t = await R.thread('family', viewer, 'story', s);
  assert.equal(t.comments[0].authorName, 'Lou Leaving', 'even once the account is gone');
  assert.deepEqual(t.reactors.thanks, [''], 'a reaction without a name still counts');
});

test('the counts for the whole family are two reads, whatever their number', async () => {
  const before = await R.responseCounts('family', viewer);
  const ids = await Promise.all(Array.from({ length: 40 }, () => story('ada', contributor)));
  for (const id of ids) await R.react('family', viewer, 'story', id, 'heart', true);
  const d = db.db('family');
  const calls: string[] = [];
  const all = d.all.bind(d), get = d.get.bind(d), rb = d.readBatch.bind(d);
  d.all = ((sql: string, ...p: never[]) => { calls.push(sql); return all(sql, ...p); }) as typeof d.all;
  d.get = ((sql: string, ...p: never[]) => { calls.push(sql); return get(sql, ...p); }) as typeof d.get;
  d.readBatch = ((qs: { sql: string }[]) => { calls.push(...qs.map((x) => x.sql)); return rb(qs as never); }) as typeof d.readBatch;
  try {
    const after = await R.responseCounts('family', viewer);
    assert.equal(Object.keys(after).length - Object.keys(before).length, 40);
  } finally {
    d.all = all; d.get = get; d.readBatch = rb;
  }
  assert.equal(calls.length, 2);
});

test('the push to the author: only when they chose it, never for their own answer, at most one a day', async () => {
  const author = await member('Pia Poster', 'contributor', 'ben');
  const s = await story('ben', author);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const T0 = new Date();
  await store.accounts().run(
    "INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen) VALUES ('d-pia', ?, 'family', 'https://web.push.apple.com/pia', ?, ?, '[0]', '[\"birthday\"]', 'af', ?, ?)",
    author.id, p256dh, auth, T0.getTime(), T0.getTime(),
  );
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:family@example.org' };
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;
  const answer = { kind: 'story' as const, target: s, by: viewer, what: 'reaction' as const, reaction: 'heart' as const };

  assert.equal(await R.notifyAuthor('family', answer, { now: T0, vapid, fetchImpl }), 0, 'off until the author turns it on');
  assert.equal(await R.responsePush('family', author), false);
  await R.setResponsePush('family', author, true);
  assert.equal(await R.responsePush('family', author), true);
  assert.equal(await R.notifyAuthor('family', { ...answer, by: author }, { now: T0, vapid, fetchImpl }), 0, 'not for their own reaction');
  assert.equal(await R.notifyAuthor('family', answer, { now: T0, vapid, fetchImpl }), 1);
  assert.equal(await R.notifyAuthor('family', { ...answer, what: 'comment' }, { now: T0, vapid, fetchImpl }), 0, 'one a day');
  assert.equal(await R.notifyAuthor('family', { ...answer, what: 'comment' }, { now: new Date(T0.getTime() + 86_400_000), vapid, fetchImpl }), 1, 'and again the next day');
  assert.deepEqual(sent, ['https://web.push.apple.com/pia', 'https://web.push.apple.com/pia']);
  // A photo they shared counts too; a photo someone else shared does not.
  await db.db('family').run("INSERT INTO media (key, mime, uploaded_by, uploaded_at) VALUES ('gallery/2222-pia.jpg', 'image/jpeg', ?, '2026-01-01')", author.id);
  assert.equal(await R.notifyAuthor('family', { kind: 'media', target: 'gallery/2222-pia.jpg', by: viewer, what: 'comment' }, { now: new Date(T0.getTime() + 2 * 86_400_000), vapid, fetchImpl }), 1);
  assert.equal(await R.notifyAuthor('family', { kind: 'media', target: 'gallery/0000-photo.jpg', by: viewer, what: 'comment' }, { now: new Date(T0.getTime() + 3 * 86_400_000), vapid, fetchImpl }), 0);
  await R.setResponsePush('family', author, false);
  assert.equal(await R.notifyAuthor('family', answer, { now: new Date(T0.getTime() + 4 * 86_400_000), vapid, fetchImpl }), 0, 'and off again');
});

test('comments go into the Markdown archive with their story, and not into GEDCOM', async () => {
  const s = await story('cleo', contributor, 'Cleo learned to swim.');
  await R.addComment('family', editor, 'story', s, 'I was there!\nShe was so proud.');
  await R.addComment('family', contributor, 'media', 'gallery/0000-photo.jpg', 'What a day');
  const tree = await readTree(db.db('family'));
  const { files, losses } = markdownArchive(tree);
  const note = files.find((f) => f.path === 'memories/cleo.md');
  assert.ok(note, 'the stories about Cleo have their file');
  const text = String(note.data);
  assert.match(text, /Cleo learned to swim\./);
  assert.match(text, /### Comments\n\n\*\*Eda Editor\*\*, \d{4}-\d{2}-\d{2}:\n\n> I was there!\n> She was so proud\./);
  assert.ok(!losses.some((l) => /stories, memories/.test(l)), 'the stories are in the archive now');
  assert.ok(losses.some((l) => /comment on a gallery photo is not in the archive/.test(l)));
  const { text: ged } = writeGedcom(tree);
  assert.doesNotMatch(ged, /I was there/);
  assert.doesNotMatch(ged, /What a day/);
});
