// node --test src/lib/feed/feed.server.test.ts — the family feed on a private data folder: what a page mixes (posts,
// memories and answers, a day's photos as one entry, people added, a season's end), that it is refused to a guest, that a
// page is one batch of reads however long it is, and that paging to the end shows every entry once, also through a day
// of more uploads than a page looks at. Server modules load through Vite (ssrLoadModule). Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-feed-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
for (const tree of ['family', 'busy', 'quiet']) {
  const f = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  f.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'The Alders'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
    INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1890', 0), ('ben', 'Ben', 'Alder', '1960-02-03', 1), ('cleo', 'Cleo', 'Alder', '2010-04-02', 1);
  `);
  f.close();
}

const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const F = await load<typeof import('./feed.server.ts')>('/src/lib/feed/feed.server.ts');
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
type FeedItem = import('./types.ts').FeedItem;

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
async function member(name: string, role: Role, person: string | null = null) {
  const { user, insert } = store.newUser(name, null);
  await store.accounts().batch([insert, ...['family', 'busy', 'quiet'].map((t) => store.upsertMembership(user.id, t, role))]);
  if (person) await store.accounts().run('UPDATE membership SET person = ? WHERE user = ?', person, user.id);
  return { id: user.id, name, role, person };
}
const guest = { id: '', name: '', role: 'viewer' as const, guest: true };
const mara = await member('Mara Alder', 'contributor', 'ben');
const viewer = await member('Vi Viewer', 'viewer');

const at = (day: string, time = '12:00:00') => `${day}T${time}.000Z`;
const run = (tree: string, sql: string, ...p: (string | number | null)[]) => db.db(tree).run(sql, ...p);
const post = (tree: string, id: string, when: string, body = 'Hello', by = mara) =>
  run(tree, 'INSERT INTO post (id, account, author_name, author_person, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, by.id, by.name, by.person, body, when);
const story = (tree: string, id: string, when: string, kind = 'memory', person = 'ada') =>
  run(tree, 'INSERT INTO story (id, person, kind, title, body, author, at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, person, kind, null, `Story ${id}`, 'Mara Alder', when);
const photo = (tree: string, key: string, when: string, album: string | null = null, by = mara.id, forPost = 0) =>
  run(tree, 'INSERT INTO media (key, mime, width, height, album, uploaded_by, uploaded_at, for_post) VALUES (?, ?, 4, 3, ?, ?, ?, ?)', `gallery/${key}.jpg`, 'image/jpeg', album, by, when, forPost);
const addedPerson = (tree: string, id: string, when: string, by = mara, born: string | null = null) =>
  db.db(tree).batch([
    db.q('INSERT INTO person (id, given, surname, born, living) VALUES (?, ?, ?, ?, 1)', id, id, 'Alder', born),
    db.q("INSERT INTO history (at, account, name, kind, record, person, person_name, action, fn) VALUES (?, ?, ?, 'person', ?, ?, ?, 'added', 'test')", when, by.id, by.name, id, id, `${id} Alder`),
  ]);

/** Every page of a family's feed, to the end. */
async function whole(tree: string, limit: number) {
  const pages: FeedItem[][] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 400; i++) {
    const page = await F.feedPage(tree, viewer, cursor, limit);
    pages.push(page.items);
    assert.ok(page.items.length <= limit);
    if (!page.next) return pages;
    assert.notEqual(page.next, cursor, 'a page always moves on');
    cursor = page.next;
  }
  throw new Error('the feed did not end');
}

test('a guest gets no feed', async () => {
  await assert.rejects(F.feedPage('family', guest), /access/i);
});

test('an empty family has an empty feed that ends', async () => {
  assert.deepEqual(await F.feedPage('quiet', viewer), { items: [], next: null });
});

test('a page mixes posts, memories and answers, a day’s photos as one entry, people added and a season’s end, newest first', async () => {
  const t = 'family';
  await post(t, '00000000-0000-4000-8000-000000000001', at('2026-11-09', '18:00:00'), 'We moved to Aldersbrook.');
  await run(t, "INSERT INTO post_person (post, person) VALUES ('00000000-0000-4000-8000-000000000001', 'cleo')");
  await story(t, 's-memory', at('2026-11-09', '10:00:00'));
  await story(t, 's-saying', at('2026-11-08', '10:00:00'), 'quote');
  await story(t, 's-answer', at('2026-11-07', '10:00:00'));
  await run(t, "INSERT INTO today_answer (story, week, question) VALUES ('s-answer', '2026-W45', 'q07')");
  // Thirty photos on one day in one album are one entry; three in no album another; a different day another.
  await run(t, "INSERT INTO album (id, name, at) VALUES ('alb', 'Summer at the lake', '2026-01-01')");
  for (let i = 0; i < 30; i++) await photo(t, `lake-${String(i).padStart(2, '0')}`, at('2026-11-06', `09:${String(i).padStart(2, '0')}:00`), 'alb');
  for (let i = 0; i < 3; i++) await photo(t, `loose-${i}`, at('2026-11-06', `08:0${i}:00`));
  await photo(t, 'earlier', at('2026-11-02'));
  // A post's own pictures are the post's, not a "photos" entry; one uploaded for a post never made is nobody's.
  await photo(t, 'of-the-post', at('2026-11-09', '17:59:00'), null, mara.id, 1);
  await photo(t, 'for-no-post', at('2026-11-09', '17:58:00'), null, mara.id, 1);
  await run(t, "INSERT INTO post_media (post, media, ord) VALUES ('00000000-0000-4000-8000-000000000001', 'gallery/of-the-post.jpg', 0)");
  // Two people added on one day by one member are one entry; one of them was born that week.
  await addedPerson(t, 'dan', at('2026-11-05', '10:00:00'));
  await addedPerson(t, 'eve', at('2026-11-05', '10:05:00'), mara, '2026-11-01');
  // A person added and removed again is not named; an editors-only row is not family news.
  await run(t, "INSERT INTO history (at, account, name, kind, record, person, person_name, action, fn) VALUES (?, ?, ?, 'person', 'gone', 'gone', 'Gone Alder', 'added', 'test')", at('2026-11-05', '11:00:00'), mara.id, mara.name);
  await run(t, "INSERT INTO campaign_season (season, seed, started, map, sides, state, ended, winner, result) VALUES (2, 's', 1, '{}', '[]', '{}', ?, 'h1', ?)", at('2026-11-04'), JSON.stringify({ winner: { id: 'h1', name: 'House Alder', arms: {} }, standings: [] }));
  await run(t, "INSERT INTO campaign_season (season, seed, started, map, sides, state) VALUES (3, 's', 1, '{}', '[]', '{}')");

  const { items, next } = await F.feedPage(t, viewer);
  assert.equal(next, null);
  assert.deepEqual(items.map((i) => i.type), ['post', 'story', 'story', 'story', 'photos', 'photos', 'people', 'season', 'photos']);
  assert.deepEqual(items.map((i) => i.at), [...items.map((i) => i.at)].sort().reverse(), 'newest first');

  const [first, memory, saying, answer, lake, loose, people, season] = items;
  assert.ok(first!.type === 'post');
  assert.equal(first.post.body, 'We moved to Aldersbrook.');
  assert.deepEqual(first.post.author, { name: 'Mara Alder', person: 'ben' });
  assert.deepEqual(first.post.pictures, [{ key: 'gallery/of-the-post.jpg', width: 4, height: 3 }]);
  assert.deepEqual(first.post.people, ['cleo']);
  assert.ok(memory!.type === 'story' && memory.id === 's-memory' && memory.week === null && memory.person === 'ada');
  assert.ok(saying!.type === 'story' && saying.kind === 'quote');
  assert.ok(answer!.type === 'story' && answer.week === '2026-W45', 'an answer to the question of the week says so');
  assert.ok(lake!.type === 'photos');
  assert.equal(lake.count, 30);
  assert.equal(lake.more, false);
  assert.deepEqual(lake.album, { id: 'alb', name: 'Summer at the lake' });
  assert.deepEqual(lake.by, { name: 'Mara Alder', person: 'ben' });
  assert.deepEqual(lake.pictures.map((p) => p.key), ['gallery/lake-29.jpg', 'gallery/lake-28.jpg', 'gallery/lake-27.jpg', 'gallery/lake-26.jpg'], 'the newest few are shown');
  assert.ok(loose!.type === 'photos' && loose.count === 3 && loose.album === null);
  assert.ok(people!.type === 'people');
  assert.equal(people.by, 'Mara Alder');
  assert.deepEqual(people.people, [{ id: 'eve', born: '2026-11-01' }, { id: 'dan', born: null }]);
  assert.equal(people.count, 2);
  assert.deepEqual(season, { type: 'season', at: at('2026-11-04'), key: 'season:2', season: 2, winner: 'House Alder' });
  // Every entry has its own key, which is what the page keys its list by.
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});

test('what a member may do with a post depends on who reads the feed', async () => {
  const mine = (await F.feedPage('family', mara)).items.find((i) => i.type === 'post')!;
  assert.ok(mine.type === 'post' && mine.post.mine && mine.post.removable);
  const theirs = (await F.feedPage('family', viewer)).items.find((i) => i.type === 'post')!;
  assert.ok(theirs.type === 'post' && !theirs.post.mine && !theirs.post.removable);
});

test('a page is one batch of reads in the family’s database, whatever is on it', async () => {
  const d = db.db('family');
  const calls: string[] = [];
  let batches = 0;
  const all = d.all.bind(d), get = d.get.bind(d), rb = d.readBatch.bind(d);
  d.all = ((sql: string, ...p: never[]) => { calls.push(sql); return all(sql, ...p); }) as typeof d.all;
  d.get = ((sql: string, ...p: never[]) => { calls.push(sql); return get(sql, ...p); }) as typeof d.get;
  d.readBatch = ((qs: { sql: string }[]) => { batches += 1; return rb(qs as never); }) as typeof d.readBatch;
  try {
    const page = await F.feedPage('family', viewer);
    assert.ok(page.items.length >= 9);
  } finally {
    d.all = all; d.get = get; d.readBatch = rb;
  }
  assert.equal(batches, 1, 'one round trip');
  assert.deepEqual(calls, [], 'and no read per entry');
});

test('paging to the end shows every entry once, in order, at any page size', async () => {
  const t = 'busy';
  const expected: string[] = [];
  // Sixty days: a post, a memory and photos on most of them, some at the very same instant.
  for (let day = 1; day <= 60; day++) {
    const d = `2026-${day <= 30 ? '09' : '10'}-${String(day <= 30 ? day : day - 30).padStart(2, '0')}`;
    const id = `00000000-0000-4000-8000-${String(day).padStart(12, '0')}`;
    await post(t, id, at(d, '12:00:00'));
    expected.push(`post:${id}`);
    await story(t, `s${String(day).padStart(3, '0')}`, at(d, day % 5 === 0 ? '12:00:00' : '13:00:00'));
    expected.push(`story:s${String(day).padStart(3, '0')}`);
    if (day % 3 === 0) {
      for (let i = 0; i < 4; i++) await photo(t, `p${day}-${i}`, at(d, `14:0${i}:00`));
      expected.push(`photos:${d}||${mara.id}`);
    }
    if (day % 7 === 0) {
      await addedPerson(t, `kid${day}`, at(d, '15:00:00'));
      expected.push(`people:${d}|${mara.id}`);
    }
  }
  for (const limit of [1, 7, 20, 50]) {
    const pages = await whole(t, limit);
    const keys = pages.flat().map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, `nothing twice at ${limit} a page`);
    assert.deepEqual([...keys].sort(), [...expected].sort(), `nothing missing at ${limit} a page`);
    const order = pages.flat().map((i) => `${i.at} ${i.key}`);
    assert.deepEqual(order, [...order].sort().reverse(), `newest first across pages at ${limit} a page`);
    // Full pages until the last, apart from where a page had to stop at the edge of what it had read.
    assert.ok(pages.length <= Math.ceil(expected.length / limit) + 2, `${pages.length} pages at ${limit} a page`);
  }
  // A photo entry is whole on whichever page it falls: its count never splits across pages.
  for (const item of (await whole(t, 7)).flat()) if (item.type === 'photos') assert.equal(item.count, 4);
});

test('a day of more uploads than a page reads is one entry that says "more than", and the feed goes on below it', async () => {
  const t = 'quiet';
  await post(t, '00000000-0000-4000-8000-0000000000aa', at('2026-08-03', '09:00:00'), 'After the wedding');
  // 450 photos on one day; a few more the day before; an older post and memory below.
  const d = db.db(t);
  const rows = Array.from({ length: 450 }, (_, i) => db.q('INSERT INTO media (key, mime, width, height, uploaded_by, uploaded_at) VALUES (?, ?, 4, 3, ?, ?)',
    `gallery/wedding-${String(i).padStart(3, '0')}.jpg`, 'image/jpeg', mara.id, `2026-08-02T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`));
  for (let i = 0; i < rows.length; i += 50) await d.batch(rows.slice(i, i + 50));
  for (let i = 0; i < 5; i++) await photo(t, `eve-${i}`, at('2026-08-01', `10:0${i}:00`));
  await post(t, '00000000-0000-4000-8000-0000000000ab', at('2026-08-02', '08:00:00'), 'Getting ready');
  await post(t, '00000000-0000-4000-8000-0000000000ac', at('2026-07-20'), 'Invitations are out');
  await story(t, 's-old', at('2026-07-01'));

  const pages = await whole(t, 20);
  const items = pages.flat();
  assert.deepEqual(items.map((i) => (i.type === 'photos' ? `photos ${i.count}${i.more ? '+' : ''}` : i.key)), [
    'post:00000000-0000-4000-8000-0000000000aa',
    'photos 400+',
    'post:00000000-0000-4000-8000-0000000000ab',
    'photos 5',
    'post:00000000-0000-4000-8000-0000000000ac',
    'story:s-old',
  ]);
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});

test('a cursor that is not one starts at the top', async () => {
  const top = await F.feedPage('family', viewer);
  for (const cursor of ['', 'nonsense', '~', 'x'.repeat(400), "2026-11-09' OR 1=1 --~post:x"]) {
    assert.deepEqual((await F.feedPage('family', viewer, cursor)).items.map((i) => i.key), top.items.map((i) => i.key), cursor);
  }
  // And one that is well formed is only ever compared, never run.
  assert.deepEqual((await F.feedPage('family', viewer, "2026-11-01~x' OR '1'='1")).items.map((i) => i.type), []);
});

test('a member who left still signs what they shared', async () => {
  const lou = await member('Lou Leaving', 'contributor', 'cleo');
  await photo('family', 'lou-1', at('2026-11-10', '08:00:00'), null, lou.id);
  await post('family', '00000000-0000-4000-8000-0000000000b1', at('2026-11-10', '09:00:00'), 'Before I go', lou);
  await store.accounts().run("DELETE FROM membership WHERE user = ? AND tree = 'family'", lou.id);
  const { items } = await F.feedPage('family', viewer);
  const [p, ph] = items;
  assert.ok(p!.type === 'post');
  assert.deepEqual(p.post.author, { name: 'Lou Leaving', person: 'cleo' }, 'a post keeps its name and its face');
  assert.ok(ph!.type === 'photos');
  assert.deepEqual(ph.by, { name: '', person: null }, 'a photo upload keeps no name: the page says "someone"');
});
