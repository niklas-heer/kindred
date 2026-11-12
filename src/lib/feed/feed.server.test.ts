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
for (const tree of ['family', 'busy', 'quiet', 'edits', 'values']) {
  const f = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  f.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'The Alders'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
    INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1890', 0), ('ben', 'Ben', 'Alder', '1960-02-03', 1), ('cleo', 'Cleo', 'Alder', '2010-04-02', 1);
  `);
  f.close();
}

const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const F = await load<typeof import('./feed.server.ts')>('/src/lib/feed/feed.server.ts');
const H = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const R = await load<typeof import('../responses.server.ts')>('/src/lib/responses.server.ts');
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
  await store.accounts().batch([insert, ...['family', 'busy', 'quiet', 'edits', 'values'].map((t) => store.upsertMembership(user.id, t, role))]);
  if (person) await store.accounts().run('UPDATE membership SET person = ?, person_confirmed = 1 WHERE user = ?', person, user.id);
  return { id: user.id, name, role, person };
}
const guest = { id: '', name: '', role: 'viewer' as const, guest: true };
const mara = await member('Mara Alder', 'contributor', 'ben');
const viewer = await member('Vi Viewer', 'viewer');
const eda = await member('Eda Editor', 'editor');
const maraKey = await H.authorKey('busy', mara.id);

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

/** A row of the change history, as `once` writes it. */
const change = (tree: string, when: string, by: { id: string; name: string } | null, kind: string, record: string, action: string, person: string | null,
  fields: object | null = null, level = 'family', count = 1) =>
  run(tree, 'INSERT INTO history (at, account, name, kind, record, person, action, level, owner, fields, count, fn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    when, by?.id ?? null, by?.name ?? '', kind, record, person, action, level, level === 'personal' ? by?.id ?? null : null, fields && JSON.stringify(fields), count, 'test');
const field = (tree: string, id: string, person: string, type: string, visibility = 'family') =>
  run(tree, 'INSERT INTO person_field (id, person, type, label, value, visibility, owner) VALUES (?, ?, ?, ?, ?, ?, ?)', id, person, type, type, '{}', visibility, visibility === 'personal' ? mara.id : null);

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
      expected.push(`people:${d}|${maraKey}`);
    }
    if (day % 4 === 0) {
      // A life event recorded and a detail changed: one entry of the day's updates, whatever their number.
      await change(t, at(d, '16:00:00'), mara, 'event', `ev${day}`, 'added', 'ada');
      await change(t, at(d, '16:30:00'), mara, 'person', 'ada', 'changed', 'ada', { f: { born: ['1890', '1891'] } });
      expected.push(`updates:${d}|${maraKey}`);
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

test('a day of one member’s updates is one event, person by person: contact details by kind, with the day’s new value', async () => {
  const t = 'edits';
  const d = '2026-11-02';
  await field(t, 'f-phone', 'ben', 'phone');
  await field(t, 'f-addr', 'ben', 'address', 'editors');
  await field(t, 'f-job', 'cleo', 'occupation');
  await field(t, 'f-note', 'cleo', 'notes', 'personal');
  await change(t, at(d, '09:00:00'), mara, 'field', 'f-phone', 'changed', 'ben', { f: { value: ['+44 1', '+44 2'] } });
  await change(t, at(d, '09:05:00'), mara, 'field', 'f-phone', 'changed', 'ben', { f: { value: ['+44 2', '+44 3'] } });
  await change(t, at(d, '09:10:00'), mara, 'field', 'f-addr', 'added', 'ben', null, 'editors');
  await change(t, at(d, '09:20:00'), mara, 'field', 'f-job', 'added', 'cleo');
  await change(t, at(d, '09:25:00'), mara, 'field', 'f-note', 'changed', 'cleo', null, 'personal');
  await change(t, at(d, '09:30:00'), mara, 'event', 'e1', 'added', 'cleo');
  await change(t, at(d, '09:31:00'), mara, 'event', 'e1', 'changed', 'cleo', { f: { place: [null, 'Leeds'] } });
  await change(t, at(d, '09:40:00'), mara, 'citation', 'c1', 'added', 'cleo');
  await change(t, at(d, '09:45:00'), mara, 'portrait', 'cleo', 'changed', 'cleo', { f: { photo: [null, null] }, o: ['photo'] });
  await change(t, at(d, '09:50:00'), mara, 'source', 'src1', 'added', null);
  await change(t, at(d, '09:55:00'), mara, 'event', 'e2', 'removed', 'ben');
  // Another member's day is its own event; a removal and a Personal field are in nobody's.
  await change(t, at(d, '10:00:00'), eda, 'person', 'cleo', 'changed', 'cleo', { f: { nickname: [null, 'Clo'] } });

  const ofViewer = (await F.feedPage(t, viewer)).items.filter((i) => i.type === 'updates');
  const ofEditor = (await F.feedPage(t, eda)).items.filter((i) => i.type === 'updates');
  assert.equal(ofViewer.length, 2);
  const mine = ofViewer.find((i) => i.type === 'updates' && i.by === 'Mara Alder');
  assert.ok(mine && mine.type === 'updates');
  assert.equal(mine.key, `updates:${d}|${await H.authorKey(t, mara.id)}`);
  assert.equal(mine.target, mine.key);
  assert.equal(mine.at, at(d, '09:50:00'), 'when the day’s last change was made');
  assert.equal(mine.count, 2, 'two people');
  assert.deepEqual(mine.people, [
    { id: 'ben', contact: ['phone'], details: [], events: 0, sources: 0, portrait: false, tagged: 0, values: [{ name: 'field:phone', value: '+44 3', label: 'phone' }] },
    { id: 'cleo', contact: [], details: ['field:occupation'], events: 1, sources: 1, portrait: true, tagged: 0 },
    { id: null, contact: [], details: [], events: 0, sources: 1, portrait: false, tagged: 0 },
  ], 'the address is for editors; the Personal note and the removal are in nobody’s');
  assert.doesNotMatch(JSON.stringify(ofViewer), /\+44 1|\+44 2|Leeds/, 'only the day’s last value travels, and no life event’s');
  // An editor reads the same entry, and the address's news as an entry of its own, with a thread of its own.
  const forEditor = ofEditor.filter((i) => i.type === 'updates' && i.by === 'Mara Alder');
  assert.deepEqual(forEditor.map((i) => i.key).sort(), [mine.key, `${mine.key}|e`]);
  const shared = forEditor.find((i) => i.key === mine.key)!;
  assert.ok(shared.type === 'updates' && !shared.editors);
  assert.deepEqual(shared.people, mine.people, 'the entry every member reads is the same for an editor');
  const onlyEditors = forEditor.find((i) => i.key === `${mine.key}|e`)!;
  assert.ok(onlyEditors.type === 'updates' && onlyEditors.editors && onlyEditors.target === onlyEditors.key);
  assert.deepEqual(onlyEditors.people, [{ id: 'ben', contact: ['address'], details: [], events: 0, sources: 0, portrait: false, tagged: 0 }]);
  const eda1 = ofViewer.find((i) => i.type === 'updates' && i.by === 'Eda Editor');
  assert.ok(eda1 && eda1.type === 'updates');
  assert.deepEqual(eda1.people, [{ id: 'cleo', contact: [], details: ['nickname'], events: 0, sources: 0, portrait: false, tagged: 0, values: [{ name: 'nickname', value: 'Clo' }] }]);
  // Members react to it and comment on it like a post; nobody can react to an event that is not there.
  assert.deepEqual(await R.react(t, viewer, 'event', mine.target, '🎉', true), { added: true });
  const { id } = await R.addComment(t, mara, 'event', mine.target, 'Thanks for the update!');
  assert.ok(id);
  const counts = await R.responseCounts(t, viewer);
  assert.deepEqual(counts[`event:${mine.target}`], { reactions: { '🎉': 1 }, mine: ['🎉'], comments: 1 });
  await assert.rejects(R.react(t, viewer, 'event', `updates:2026-01-01|${await H.authorKey(t, mara.id)}`, '🎉', true), /responses\.err\.gone/);
  await assert.rejects(R.react(t, viewer, 'event', `updates:${d}|0000000000000000`, '🎉', true), /responses\.err\.gone/);
  await assert.rejects(R.react(t, viewer, 'event', 'updates:nonsense', '🎉', true), /responses\.err\.gone/);
  // The editors' entry: an editor reacts and comments, and reads both; a viewer can neither react, nor comment, nor read it.
  const secret = `${mine.key}|e`;
  assert.deepEqual(await R.react(t, eda, 'event', secret, '👀', true), { added: true });
  await R.addComment(t, eda, 'event', secret, 'The new address is in.');
  assert.deepEqual((await R.thread(t, eda, 'event', secret)).comments.map((c) => c.body), ['The new address is in.']);
  assert.deepEqual((await R.responseCounts(t, eda))[`event:${secret}`], { reactions: { '👀': 1 }, mine: ['👀'], comments: 1 });
  assert.deepEqual((await R.thread(t, eda, 'event', mine.target)).comments.map((c) => c.body), ['Thanks for the update!'], 'the threads are apart');
  await assert.rejects(R.react(t, viewer, 'event', secret, '🎉', true), /responses\.err\.gone/);
  await assert.rejects(R.addComment(t, mara, 'event', secret, 'Where?'), /responses\.err\.gone/);
  assert.deepEqual(await R.thread(t, viewer, 'event', secret), { comments: [], reactors: {} });
  assert.equal((await R.responseCounts(t, viewer))[`event:${secret}`], undefined, 'not even a count');
  // A key of the editors' level stands only on editors-level rows, and the plain key only on the family's.
  await assert.rejects(R.react(t, eda, 'event', `updates:${d}|${await H.authorKey(t, eda.id)}|e`, '👀', true), /responses\.err\.gone/);
  // A birthday or an anniversary today, keyed by the year: the person or the couple must be there.
  assert.deepEqual(await R.react(t, viewer, 'event', 'b:cleo:2026', '🎂', true), { added: true });
  await assert.rejects(R.react(t, viewer, 'event', 'b:nobody:2026', '🎂', true), /responses\.err\.gone/);
  await assert.rejects(R.react(t, guest, 'event', 'b:cleo:2026', '🎂', true), /access/i);
});

test('a busy day of one member hides nobody else’s updates that day, and the feed goes on below it', async () => {
  const t = 'quiet';
  const d = '2026-06-10';
  // An older day with an update, then a day where Eda adds 120 life events and then autosaves one person 450 times, and
  // Mara changes one thing: three entries of updates, every author's.
  await change(t, at('2026-06-09', '09:00:00'), mara, 'event', 'old-ev', 'added', 'ada');
  const qs = Array.from({ length: 450 }, (_, i) => db.q("INSERT INTO history (at, account, name, kind, record, person, action, level, fields, count, fn) VALUES (?, ?, ?, 'person', 'ben', 'ben', 'changed', 'family', ?, 1, 'test')",
    `${d}T12:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`, eda.id, eda.name, JSON.stringify({ f: { [i % 2 ? 'nickname' : 'occupation']: [null, `v${i}`] } })));
  for (let i = 0; i < 120; i++) qs.push(db.q("INSERT INTO history (at, account, name, kind, record, person, action, level, count, fn) VALUES (?, ?, ?, 'event', ?, 'ada', 'added', 'family', 1, 'test')",
    `${d}T11:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`, eda.id, eda.name, `busy-ev-${i}`));
  for (let i = 0; i < qs.length; i += 50) await db.db(t).batch(qs.slice(i, i + 50));
  await change(t, at(d, '08:00:00'), mara, 'source', 'quiet-src', 'added', null);

  const items = (await whole(t, 20)).flat().filter((i) => i.type === 'updates');
  const day = items.filter((i) => i.at.startsWith(d));
  assert.deepEqual(day.map((i) => i.type === 'updates' && i.by).sort(), ['Eda Editor', 'Mara Alder'], 'both authors of the day');
  const busy = day.find((i) => i.type === 'updates' && i.by === 'Eda Editor')!;
  assert.ok(busy.type === 'updates' && busy.more, 'it says there was more');
  assert.deepEqual(busy.people.find((p) => p.id === 'ben')!.details.sort(), ['nickname', 'occupation'], 'a record changed 450 times is one, with every detail');
  const quiet = day.find((i) => i.type === 'updates' && i.by === 'Mara Alder')!;
  assert.ok(quiet.type === 'updates' && !quiet.more && quiet.people[0]!.sources === 1);
  assert.ok(items.some((i) => i.at.startsWith('2026-06-09')), 'and the day before follows');
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});

test('an update shows the new value only to a reader who may see that field of that person now, and never an old one', async () => {
  const t = 'values';
  const d = '2026-11-05';
  const steward = await member('Sol Steward', 'steward');
  // A "View as" preview of a viewer: the previewed role, and an account that owns nothing (auth/view-as.server.ts).
  const preview = { id: 'view-as', name: 'Sol Steward', role: 'viewer' as const };
  const fieldOf = (id: string, person: string, type: string, value: object, visibility = 'family') =>
    run(t, 'INSERT INTO person_field (id, person, type, label, value, visibility, owner) VALUES (?, ?, ?, ?, ?, ?, ?)', id, person, type, 'mobile', JSON.stringify(value), visibility, visibility === 'personal' ? mara.id : null);
  await fieldOf('v-phone', 'ben', 'phone', { number: '+49 30 1234' });
  await fieldOf('v-mail', 'ben', 'email', { address: 'ben@example.org' }, 'editors');
  // Shared with the family that day, made Personal since: its kind stays, its value goes.
  await fieldOf('v-job', 'ben', 'occupation', { title: 'Baker' }, 'personal');
  await fieldOf('v-hidden', 'cleo', 'phone', { number: '+49 40 5678' });
  await change(t, at(d, '09:00:00'), mara, 'field', 'v-phone', 'changed', 'ben', { f: { value: ['+49 30 0000', '+49 30 1234'] } });
  await change(t, at(d, '09:05:00'), mara, 'field', 'v-mail', 'added', 'ben', null, 'editors');
  await change(t, at(d, '09:10:00'), mara, 'field', 'v-job', 'added', 'ben');
  // A value the history kept without content is said by its kind.
  await change(t, at(d, '09:15:00'), mara, 'field', 'v-hidden', 'changed', 'cleo', { f: { value: [null, null] }, o: ['value'] });
  // Ada's own facts: new dates and places, a removed occupation, a title kept for editors only.
  await change(t, at(d, '09:20:00'), mara, 'person', 'ada', 'changed', 'ada', {
    f: { born: ['1890', '1890-05-03'], born_place: [null, 'Graz'], occupation: ['Smith', null], title: [null, 'Dr'], living: [1, 0] }, e: ['title'],
  });

  const updates = async (who: Parameters<typeof F.feedPage>[1]) =>
    (await F.feedPage(t, who)).items.filter((i) => i.type === 'updates' && i.at.startsWith(d)) as Extract<FeedItem, { type: 'updates' }>[];
  const valuesBy = (items: Extract<FeedItem, { type: 'updates' }>[]) =>
    Object.fromEntries(items.flatMap((i) => i.people.map((p) => [`${i.editors ? 'e:' : ''}${p.id}`, p.values ?? []])));

  const forViewer = valuesBy(await updates(viewer));
  assert.deepEqual(forViewer, {
    ben: [{ name: 'field:phone', value: '+49 30 1234', label: 'mobile' }],
    cleo: [],
    ada: [{ name: 'born', value: '1890-05-03' }, { name: 'born_place', value: 'Graz' }, { name: 'occupation', value: null }],
  }, 'the phone and Ada’s facts; not the Personal occupation, not a value kept without content, not the editors’ title');
  const viewerEntry = (await updates(viewer)).find((i) => i.people.some((p) => p.id === 'ben'))!;
  assert.deepEqual(viewerEntry.people.find((p) => p.id === 'ben')!.details, ['field:occupation'], 'the hidden value is still said by its kind');

  const forEditor = valuesBy(await updates(eda));
  assert.deepEqual(forEditor['e:ben'], [{ name: 'field:email', value: 'ben@example.org', label: 'mobile' }], 'an editor reads the editors’ field’s value now');
  assert.deepEqual(forEditor.ada!.find((v) => v.name === 'title'), { name: 'title', value: 'Dr' });
  assert.equal(forEditor.ben!.some((v) => v.name === 'field:occupation'), false, 'a Personal field is its owner’s alone, an editor’s neither');
  // Its owner reads it.
  assert.deepEqual((valuesBy(await updates(mara))).ben!.find((v) => v.name === 'field:occupation'), { name: 'field:occupation', value: 'Baker', label: 'mobile' });

  // A steward reads as an editor; a "View as" preview of a viewer reads exactly what a viewer does.
  assert.ok(valuesBy(await updates(steward))['e:ben']);
  assert.deepEqual(valuesBy(await updates(preview)), forViewer);

  // A field made editors-only after the day: its value leaves a viewer's feed.
  await run(t, "UPDATE person_field SET visibility = 'editors' WHERE id = 'v-phone'");
  assert.deepEqual(valuesBy(await updates(viewer)).ben, []);
  assert.deepEqual(valuesBy(await updates(eda)).ben, [{ name: 'field:phone', value: '+49 30 1234', label: 'mobile' }]);

  for (const who of [viewer, eda, mara, steward, preview]) {
    const text = JSON.stringify(await updates(who));
    assert.doesNotMatch(text, /Smith|\+49 30 0000/, 'an old or removed value reaches nobody');
  }
  // A share-link guest reads no feed at all, so no value reaches one, a living person's least of all.
  await assert.rejects(F.feedPage(t, guest));
});

test('an import of hundreds of people is one event, not hundreds', async () => {
  const t = 'edits';
  const d = '2026-11-04';
  await change(t, at(d, '08:00:00'), eda, 'import', at(d, '08:00:00'), 'added', null, { f: { people: [null, 500], events: [null, 900] } }, 'family', 500);
  const page = await F.feedPage(t, viewer);
  const imports = page.items.filter((i) => i.type === 'updates' && i.imported > 0);
  assert.equal(imports.length, 1);
  const only = imports[0]!;
  assert.ok(only.type === 'updates');
  assert.equal(only.imported, 500);
  assert.equal(only.count, 0);
});

test('posts and events of a day come interleaved by time', async () => {
  const t = 'edits';
  const d = '2026-11-06';
  await post(t, '00000000-0000-4000-8000-0000000e0001', at(d, '08:00:00'), 'Morning');
  await change(t, at(d, '09:00:00'), mara, 'event', 'e9', 'added', 'ben');
  await post(t, '00000000-0000-4000-8000-0000000e0002', at(d, '10:00:00'), 'Later');
  const types = (await F.feedPage(t, viewer)).items.filter((i) => i.at.startsWith(d)).map((i) => i.type);
  assert.deepEqual(types, ['post', 'updates', 'post']);
});
