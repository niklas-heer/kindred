// node --test src/lib/votes/feed.test.ts — votes in the family feed, on a private data folder with a fresh family per test:
// a vote is an entry when it starts and another when it closes (by hand, or when its closing time has passed), with only the
// winners' labels even for a secret vote; a guest still gets no feed; reactions and comments on a vote are on both entries
// and go with the vote; a page with votes is still one batch of reads, and paging shows each entry once. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-vote-feed-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('./votes.server.ts')>('/src/lib/votes/votes.server.ts');
const F = await load<typeof import('../feed/feed.server.ts')>('/src/lib/feed/feed.server.ts');
const R = await load<typeof import('../responses.server.ts')>('/src/lib/responses.server.ts');
type FeedItem = import('../feed/types.ts').FeedItem;

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
type Input = Parameters<typeof V.createVote>[2];

const NOW = new Date('2026-11-15T10:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);

let families = 0;
/** A fresh, empty family for one test, with Ada in its tree. */
async function family(): Promise<string> {
  const id = `vfeed${++families}`;
  await db.store.ensureTree(id);
  await db.db(id).run("INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1950', 1)");
  return id;
}
const who = (id: string, name: string, role: Role, person: string | null = null) => ({ id, name, role, person, personConfirmed: !!person });
const ada = who('acc-ada', 'Ada Alder', 'contributor', 'ada');
const bo = who('acc-bo', 'Bo Birch', 'contributor');
const carl = who('acc-carl', 'Carl Cedar', 'viewer');
const guestWho = { id: '', name: '', role: 'viewer' as const, guest: true };
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });

const input = (over: Partial<Input> = {}): Input => ({
  question: 'Where do we meet next summer?', description: '', kind: 'single', secret: false, addOptions: false, guests: false,
  closesAt: later(7 * DAY).toISOString(), options: ['Beach', 'Mountains', 'Lake'], ...over,
});
const optionIds = async (tree: string, vote: string) => (await db.db(tree).all<{ id: string }>('SELECT id FROM vote_option WHERE vote = ? ORDER BY ord', vote)).map((r) => r.id);
const votesOf = (items: FeedItem[]) => items.filter((i) => i.type === 'vote' || i.type === 'vote_result');

test('a new vote is an entry of the feed: who asked, the question, and when it closes', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  const page = await F.feedPage(t, carl, null, undefined, later(HOUR));
  assert.deepEqual(votesOf(page.items), [{
    type: 'vote', at: NOW.toISOString(), key: `vote:${id}`, id, question: 'Where do we meet next summer?',
    author: { name: 'Ada Alder', person: 'ada' }, closesAt: later(7 * DAY).toISOString(),
  }]);
});

test('a closed vote is a second entry at its closing time, with only the winners’ labels', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  const [beach, , lake] = await optionIds(t, id);
  await V.castBallot(t, member(bo), id, [lake], later(HOUR));
  await V.castBallot(t, member(carl), id, [lake], later(HOUR));
  await V.castBallot(t, member(ada), id, [beach], later(HOUR));
  await V.closeVote(t, ada, id, undefined, later(2 * HOUR));

  const items = votesOf((await F.feedPage(t, carl, null, undefined, later(3 * HOUR))).items);
  assert.deepEqual(items.map((i) => i.key), [`vote_result:${id}`, `vote:${id}`], 'newest first');
  assert.deepEqual(items[0], { type: 'vote_result', at: later(2 * HOUR).toISOString(), key: `vote_result:${id}`, id, question: 'Where do we meet next summer?', winners: ['Lake'] });
  const start = items[1]!;
  assert.ok(start.type === 'vote');
  assert.equal(start.closesAt, later(2 * HOUR).toISOString(), 'closed by hand: when it closed');
});

test('a vote whose closing time passed is a result at that time, and only once that time has passed', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ closesAt: later(DAY).toISOString() }), undefined, NOW);
  const [beach] = await optionIds(t, id);
  await V.castBallot(t, member(bo), id, [beach], later(HOUR));

  const before = votesOf((await F.feedPage(t, carl, null, undefined, later(DAY - 1))).items);
  assert.deepEqual(before.map((i) => i.type), ['vote'], 'still open: no result');
  const after = votesOf((await F.feedPage(t, carl, null, undefined, later(DAY + 1))).items);
  assert.deepEqual(after.map((i) => [i.type, i.at]), [['vote_result', later(DAY).toISOString()], ['vote', NOW.toISOString()]]);
  assert.equal(await db.db(t).get('SELECT closed_at FROM vote WHERE closed_at IS NOT NULL'), undefined, 'reading the feed writes nothing');
});

test('a secret vote’s result in the feed carries the winners and nothing about any voter; a tie names both; nobody voting names none', async () => {
  const t = await family();
  const { id: secret } = await V.createVote(t, ada, input({ secret: true, question: 'Which name for the dog?', options: ['Rex', 'Fido'] }), undefined, NOW);
  const [rex, fido] = await optionIds(t, secret);
  await V.castBallot(t, member(bo), secret, [rex], later(HOUR));
  await V.castBallot(t, member(carl), secret, [fido], later(HOUR));
  await V.closeVote(t, ada, secret, undefined, later(2 * HOUR));
  const { id: empty } = await V.createVote(t, ada, input({ question: 'Cake or pie?', options: ['Cake', 'Pie'] }), undefined, NOW);
  await V.closeVote(t, ada, empty, undefined, later(3 * HOUR));

  const results = votesOf((await F.feedPage(t, bo, null, undefined, later(4 * HOUR))).items).filter((i) => i.type === 'vote_result');
  assert.deepEqual(results, [
    { type: 'vote_result', at: later(3 * HOUR).toISOString(), key: `vote_result:${empty}`, id: empty, question: 'Cake or pie?', winners: [] },
    { type: 'vote_result', at: later(2 * HOUR).toISOString(), key: `vote_result:${secret}`, id: secret, question: 'Which name for the dog?', winners: ['Rex', 'Fido'] },
  ]);
  const text = JSON.stringify(results);
  for (const leak of [bo.id, carl.id, 'Bo Birch', 'Carl Cedar', rex, fido]) assert.ok(!text.includes(leak), `nothing per voter: ${leak}`);
});

test('a guest’s feed request is still refused, votes or not', async () => {
  const t = await family();
  await V.createVote(t, ada, input({ guests: true }), undefined, NOW);
  await assert.rejects(F.feedPage(t, guestWho, null, undefined, later(HOUR)), /access/i);
});

test('reactions and comments on a vote: members give them, both entries carry the one thread, and they go with the vote', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  await V.closeVote(t, ada, id, undefined, later(HOUR));
  await R.react(t, carl, 'vote', id, '❤️', true);
  const { id: comment } = await R.addComment(t, bo, 'vote', id, 'The lake, surely!');
  await assert.rejects(R.addComment(t, bo, 'vote', '00000000-0000-4000-8000-000000000000', 'Hello?'), /responses\.err\.gone/);
  await assert.rejects(R.react(t, guestWho, 'vote', id, '❤️', true), /access/i);

  const items = votesOf((await F.feedPage(t, carl, null, undefined, later(2 * HOUR))).items);
  assert.deepEqual(items.map((i) => i.id), [id, id], 'both entries name the vote, the target of their reactions and comments');
  const counts = await R.responseCounts(t, carl);
  assert.deepEqual(counts[`vote:${id}`], { reactions: { '❤️': 1 }, mine: ['❤️'], comments: 1 });
  const thread = await R.thread(t, carl, 'vote', id);
  assert.deepEqual(thread.comments.map((c) => [c.id, c.body, c.authorName]), [[comment, 'The lake, surely!', 'Bo Birch']]);

  assert.deepEqual(await V.removeVote(t, ada, id), { removed: true });
  assert.equal((await db.db(t).get<{ n: number }>("SELECT count(*) AS n FROM reaction WHERE target_kind = 'vote'"))!.n, 0);
  assert.equal((await db.db(t).get<{ n: number }>("SELECT count(*) AS n FROM comment WHERE target_kind = 'vote'"))!.n, 0);
  assert.deepEqual(votesOf((await F.feedPage(t, carl, null, undefined, later(2 * HOUR))).items), []);
});

test('a page with votes is still one batch of reads, and paging shows every vote entry once', async () => {
  const t = await family();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const by = i % 2 ? bo : ada;
    const { id } = await V.createVote(t, by, input({ question: `Question ${i}?` }), undefined, later(i * HOUR));
    ids.push(id);
    if (i < 3) await V.closeVote(t, by, id, undefined, later(i * HOUR + 30 * 60_000));
  }
  const d = db.db(t);
  const calls: string[] = [];
  let batches = 0;
  const all = d.all.bind(d), get = d.get.bind(d), rb = d.readBatch.bind(d);
  d.all = ((sql: string, ...p: never[]) => { calls.push(sql); return all(sql, ...p); }) as typeof d.all;
  d.get = ((sql: string, ...p: never[]) => { calls.push(sql); return get(sql, ...p); }) as typeof d.get;
  d.readBatch = ((qs: { sql: string }[]) => { batches += 1; return rb(qs as never); }) as typeof d.readBatch;
  try {
    assert.equal(votesOf((await F.feedPage(t, carl, null, undefined, later(DAY))).items).length, 8);
  } finally {
    d.all = all; d.get = get; d.readBatch = rb;
  }
  assert.equal(batches, 1, 'one round trip');
  assert.deepEqual(calls, [], 'and no read per entry');

  for (const limit of [1, 2, 3]) {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < 50; n++) {
      const page = await F.feedPage(t, carl, cursor, limit, later(DAY));
      seen.push(...page.items.map((i) => i.key));
      if (!page.next) break;
      cursor = page.next;
    }
    assert.equal(new Set(seen).size, seen.length, `no entry twice at ${limit} a page`);
    assert.deepEqual(new Set(seen), new Set([...ids.map((id) => `vote:${id}`), ...ids.slice(0, 3).map((id) => `vote_result:${id}`)]), `every entry at ${limit} a page`);
  }
});
