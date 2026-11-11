// node --test src/lib/whois/whois.server.test.ts — "Who is this?": a name a member gives is a proposal, never a tag by
// itself; it becomes a tag when someone who may tag pictures agrees and is not the one who proposed it; confirming writes
// the tag with its history row and the proposer's credit; a round never repeats what the member answered; a demo plays and
// keeps nothing; a guest is not told who named someone.
// A scratch family; never data/. Invented people only. Server modules load through Vite (ssrLoadModule), as the app does.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-whois-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const { db } = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const whois = await load<typeof import('./whois.server.ts')>('/src/lib/whois/whois.server.ts');
const rules = await load<typeof import('./rules.ts')>('/src/lib/whois/rules.ts');
const photos = await load<typeof import('../photos.server.ts')>('/src/lib/photos.server.ts');
after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});
type Who = import('./whois.server.ts').Who;

const ada: Who = { account: 'acc-ada', name: 'Ada', role: 'viewer' };
const bo: Who = { account: 'acc-bo', name: 'Bo', role: 'viewer' };
const cy: Who = { account: 'acc-cy', name: 'Cy', role: 'contributor' };
const di: Who = { account: 'acc-di', name: 'Di', role: 'editor' };
const BOX = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };

/** Four people and five pictures, `p1` newest; `p5` already has Gran tagged. */
function family(tree: string) {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'Testers'), ('tagline', ''), ('theme', 'codex'), ('focus', 'gran')`);
  for (const [id, living] of [['gran', 0], ['gramps', 0], ['mum', 1], ['kid', 1]] as const) d.exec(`INSERT INTO person (id, given, surname, living) VALUES ('${id}', '${id}', 'Tester', ${living})`);
  for (let i = 1; i <= 5; i++) {
    d.exec(`INSERT INTO media (key, mime, width, height, caption, uploaded_by, uploaded_at, for_post) VALUES ('gallery/p${i}.jpg', 'image/jpeg', 800, 600, 'Picnic ${i}', 'acc-up', '2026-0${9 - i}-01T00:00:00Z', 0)`);
  }
  d.exec(`INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at) VALUES ('gallery/p5.jpg', 'gran', 0.1, 0.1, 0.2, 0.2, 1, 'acc-up', '2026-01-01')`);
  d.close();
}

const count = async (tree: string, table: string, where = '1 = 1') => (await db(tree).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const keys = (r: { photos: { key: string }[] }) => r.photos.map((p) => p.key);
const NOW = new Date('2026-11-11T10:00:00Z');

// ---------- the rule ----------

test('only someone who may tag pictures confirms, and never their own proposal', () => {
  assert.equal(rules.mayConfirm('viewer', 'a', 'b'), false, 'a viewer cannot tag, so cannot confirm');
  assert.equal(rules.mayConfirm('contributor', 'a', 'b'), true);
  assert.equal(rules.mayConfirm('steward', 'a', 'a'), false, 'not one\'s own');
  assert.equal(rules.onNaming({ role: 'editor', account: 'a', tagged: true, proposers: ['b'] }), 'already');
  assert.equal(rules.onNaming({ role: 'editor', account: 'a', tagged: false, proposers: [] }), 'propose', 'the first to name someone proposes, even an editor');
  assert.equal(rules.onNaming({ role: 'viewer', account: 'a', tagged: false, proposers: ['b'] }), 'propose', 'a viewer agreeing is another proposal');
  assert.equal(rules.onNaming({ role: 'contributor', account: 'a', tagged: false, proposers: ['b'] }), 'confirm');
  assert.equal(rules.onNaming({ role: 'contributor', account: 'a', tagged: false, proposers: ['a'] }), 'propose');
  const b = rules.boxAround(0.98, 0.01);
  assert.ok(b.x + b.w <= 1 && b.y >= 0, 'a tapped box stays inside the picture');
  assert.equal(rules.monthStart(NOW), '2026-11-01T00:00:00.000Z');
});

// ---------- rounds ----------

test('a round shows untagged pictures, never one answered or seen, and skipped ones last', async () => {
  family('round');
  const first = await whois.round('round', ada, [], NOW);
  assert.deepEqual(keys(first), ['gallery/p1.jpg', 'gallery/p2.jpg', 'gallery/p3.jpg', 'gallery/p4.jpg'], 'newest first; p5 has someone tagged');
  assert.equal(await whois.answer('round', ada, { key: 'gallery/p1.jpg', verdict: 'skip' }), 'noted');
  assert.equal(await whois.answer('round', ada, { key: 'gallery/p2.jpg', verdict: 'unknown' }), 'noted');
  assert.equal(await whois.answer('round', ada, { key: 'gallery/p3.jpg', verdict: 'named', person: 'gran', box: BOX }), 'proposed');
  const next = await whois.round('round', ada, [], NOW);
  assert.deepEqual(keys(next), ['gallery/p4.jpg', 'gallery/p1.jpg'], 'the skipped one after the rest; "I don\'t know" and named ones gone');
  assert.equal(next.photos[1]!.skipped, true);
  assert.deepEqual(keys(await whois.round('round', ada, ['gallery/p4.jpg', 'gallery/p1.jpg'], NOW)), [], 'what this visit showed is not shown again');
  assert.deepEqual(keys(await whois.round('round', bo, [], NOW)).length, 4, 'another member still gets every untagged picture');
  assert.deepEqual((await whois.round('round', ada, [], NOW)).month, { named: 1, confirmed: 0 });
});

// ---------- proposals and confirmations ----------

test('a proposal is not a tag; a second member who may tag makes it one, credited to the first', async () => {
  family('agree');
  const key = 'gallery/p1.jpg';
  assert.equal(await whois.answer('agree', ada, { key, verdict: 'named', person: 'gramps', box: BOX }, NOW), 'proposed');
  assert.equal(await whois.answer('agree', bo, { key, verdict: 'named', person: 'gramps', box: null }, NOW), 'proposed', 'a viewer agreeing does not confirm');
  assert.equal(await count('agree', 'media_person', `media = '${key}'`), 0, 'no tag yet');
  assert.equal(await count('agree', 'history', "kind = 'tag'"), 0, 'and no history: a proposal is the game\'s');
  const waiting = (await whois.round('agree', cy, [], NOW)).review;
  assert.equal(waiting.length, 1);
  assert.deepEqual(waiting[0]!.names, ['Ada', 'Bo']);
  assert.deepEqual((await whois.round('agree', ada, [], NOW)).review, [], 'a viewer is asked to confirm nothing');

  assert.equal(await whois.answer('agree', cy, { key, verdict: 'named', person: 'gramps', box: null }, NOW), 'confirmed', 'a contributor naming the same person agrees');
  const tag = await db('agree').get<{ confirmed: number; named_by: string; tagged_by: string; x: number }>(`SELECT confirmed, named_by, tagged_by, x FROM media_person WHERE media = '${key}'`);
  assert.deepEqual({ ...tag }, { confirmed: 1, named_by: 'Ada', tagged_by: 'acc-cy', x: 0.2 }, 'credited to Ada, at the box Ada tapped');
  assert.equal(await count('agree', 'history', "kind = 'tag' AND action = 'added' AND person = 'gramps'"), 1, 'the tag is in the history');
  assert.equal(await count('agree', 'tag_proposal', "status = 'open'"), 0);
  assert.deepEqual((await whois.round('agree', ada, [], NOW)).month, { named: 1, confirmed: 1 });
  assert.equal(await whois.answer('agree', di, { key, verdict: 'named', person: 'gramps', box: null }, NOW), 'already');
  assert.ok(!keys(await whois.round('agree', di, [], NOW)).includes(key), 'a tagged picture leaves the game');

  const gallery = await photos.gallery('agree');
  assert.equal(gallery.media.find((m) => m.key === key)!.tags[0]!.namedBy, 'Ada', 'the gallery says who named them');
  const asGuest = await photos.gallery('agree', false, true);
  assert.equal(asGuest.media.find((m) => m.key === key)!.tags[0]!.namedBy, undefined, 'a guest is not told');
});

test('a proposer cannot confirm their own; another may confirm or decline it', async () => {
  family('decide');
  await whois.answer('decide', cy, { key: 'gallery/p1.jpg', verdict: 'named', person: 'mum', box: BOX }, NOW);
  await whois.answer('decide', ada, { key: 'gallery/p2.jpg', verdict: 'named', person: 'kid', box: null }, NOW);
  assert.equal(await count('decide', 'media_person', "media = 'gallery/p1.jpg'"), 0, 'even a contributor\'s name waits for a second person');
  const mine = (await db('decide').get<{ id: number }>("SELECT id FROM tag_proposal WHERE account = 'acc-cy'"))!.id;
  await assert.rejects(whois.decide('decide', cy, mine, true, NOW), /whois\.err\.not_yours/);
  await assert.rejects(whois.decide('decide', bo, mine, true, NOW), /whois\.err\.not_yours/, 'nor a viewer');
  assert.equal(await whois.decide('decide', di, mine, true, NOW), 'confirmed');
  assert.equal((await db('decide').get<{ named_by: string }>("SELECT named_by FROM media_person WHERE media = 'gallery/p1.jpg'"))!.named_by, 'Cy');
  await assert.rejects(whois.decide('decide', di, mine, true, NOW), /whois\.err\.decided/, 'decided once');

  const adas = (await db('decide').get<{ id: number }>("SELECT id FROM tag_proposal WHERE account = 'acc-ada'"))!.id;
  assert.equal(await whois.decide('decide', cy, adas, false, NOW), 'declined');
  assert.equal(await count('decide', 'media_person', "media = 'gallery/p2.jpg'"), 0, 'declining tags nobody');
  assert.equal(await count('decide', 'history', "kind = 'tag'"), 1, 'and writes no history');
  assert.deepEqual((await whois.round('decide', di, [], NOW)).review, []);
});

test('confirming someone the AI finder suggested confirms that box rather than adding a second', async () => {
  family('suggest');
  const key = 'gallery/p1.jpg';
  await photos.suggestTags('suggest', 'acc-up', key, [{ personId: 'mum', box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } }], undefined);
  await whois.answer('suggest', ada, { key, verdict: 'named', person: 'mum', box: null }, NOW);
  const id = (await db('suggest').get<{ id: number }>('SELECT id FROM tag_proposal'))!.id;
  assert.equal(await whois.decide('suggest', di, id, true, NOW), 'confirmed');
  const rows = await db('suggest').all<{ confirmed: number; x: number; named_by: string }>(`SELECT confirmed, x, named_by FROM media_person WHERE media = '${key}'`);
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ confirmed: 1, x: 0.5, named_by: 'Ada' }]);
});

test('a person tagged in the gallery meanwhile settles the proposal without a second tag', async () => {
  family('race');
  const key = 'gallery/p1.jpg';
  await whois.answer('race', ada, { key, verdict: 'named', person: 'kid', box: null }, NOW);
  await photos.addTag('race', 'acc-di', key, 'kid', BOX, undefined);
  const id = (await db('race').get<{ id: number }>('SELECT id FROM tag_proposal'))!.id;
  assert.equal(await whois.decide('race', di, id, true, NOW), 'already');
  assert.equal(await count('race', 'media_person', `media = '${key}'`), 1);
});

test('a missing picture or person is refused', async () => {
  family('missing');
  await assert.rejects(whois.answer('missing', ada, { key: 'gallery/none.jpg', verdict: 'skip' }), /photo_gone/);
  await assert.rejects(whois.answer('missing', ada, { key: 'gallery/p1.jpg', verdict: 'named', person: 'nobody', box: null }), /person_not_found/);
});

test('in a demo the game is played and nothing is kept', async () => {
  family('demo-who');
  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal(await whois.answer('demo-who', cy, { key: 'gallery/p1.jpg', verdict: 'named', person: 'gran', box: BOX }, NOW), 'not-stored');
    assert.equal(await whois.answer('demo-who', cy, { key: 'gallery/p2.jpg', verdict: 'skip' }, NOW), 'not-stored');
    assert.equal(await whois.decide('demo-who', di, 1, true, NOW), 'not-stored');
    assert.equal((await whois.round('demo-who', cy, [], NOW)).photos.length, 4, 'a round is still dealt');
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal(await count('demo-who', 'tag_proposal'), 0);
  assert.equal(await count('demo-who', 'tag_pass'), 0);
});
