// node --test src/lib/votes/reads.test.ts — what each reader of a vote sees, on a private data folder with a fresh family per
// test: tallies only after voting in an open vote and only after closing in a secret one, who chose what only in an open
// vote and only to members, a guest who reads no member's name or face, a struck guest's ballot left out of the count, and a
// vote whose closing time has passed reading as closed (and being marked so by the first member, never by a guest or a
// demo). Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { Reader } from '../auth/guard.server.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-vote-reads-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('./votes.server.ts')>('/src/lib/votes/votes.server.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');

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
  const id = `reads${++families}`;
  await db.store.ensureTree(id);
  await db.db(id).run("INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1950', 1)");
  return id;
}
const who = (id: string, name: string, role: Role, person: string | null = null) => ({ id, name, role, person, personConfirmed: !!person });
const ada = who('acc-ada', 'Ada Alder', 'contributor', 'ada');
const bo = who('acc-bo', 'Bo Birch', 'contributor');
const carl = who('acc-carl', 'Carl Cedar', 'viewer');
const dee = who('acc-dee', 'Dee Dune', 'editor');
const eve = who('acc-eve', 'Eve Elm', 'steward');
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });
const guest = (n: number, name = `Guest ${n}`) => ({ kind: 'guest' as const, key: `g:key-${n}`, name, link: 'link-1', net: n });

/** A member reading, as `requireReader` answers for them. */
const reader = (w: ReturnType<typeof who>): Reader => ({
  user: { id: w.id, name: w.name, email: null, handle: w.id, created: 0, last_seen: null, locale: null },
  role: w.role, person: w.person, personConfirmed: w.personConfirmed, guest: false, protectLiving: false,
});
/** A share-link guest reading, as `requireReader` answers for them. */
const GUEST: Reader = { user: null, role: 'viewer', person: null, personConfirmed: false, guest: true, protectLiving: true };
/** Anything that would tell a guest who a member is: a name, an account, a face. */
const MEMBERS = /Ada|Bo |Birch|Carl|Dee|Eve|acc-|"ada"/;

const input = (over: Partial<Input> = {}): Input => ({
  question: 'Where do we meet next summer?', description: 'The reunion', kind: 'single', secret: false, addOptions: false, guests: false,
  closesAt: later(7 * DAY).toISOString(), options: ['Beach', 'Mountains', 'Lake'], ...over,
});
const optionIds = async (tree: string, vote: string) => (await db.db(tree).all<{ id: string }>('SELECT id FROM vote_option WHERE vote = ? ORDER BY ord', vote)).map((r) => r.id);
const closedAt = async (tree: string, vote: string) => (await db.db(tree).get<{ c: string | null }>('SELECT closed_at AS c FROM vote WHERE id = ?', vote))?.c;
const view = async (tree: string, r: Reader, id: string, at = later(HOUR), guestKey?: string) => {
  const v = await V.voteView(tree, r, id, guestKey, at);
  assert.ok(v, 'the vote reads');
  return v;
};

test('an open vote: the tallies and who chose what only once the reader has voted', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  const [beach, mountains, lake] = await optionIds(t, id);

  const before = await view(t, reader(carl), id);
  assert.equal(before.result, null);
  assert.equal(before.ballots, null);
  assert.equal(before.voted, false);
  assert.equal(before.mine, null);
  assert.equal(before.voterCount, 0);
  assert.equal(before.closed, false);
  assert.equal(before.winners, null);
  assert.deepEqual(before.author, { name: 'Ada Alder', person: 'ada' });
  assert.deepEqual(before.options.map((o) => [o.label, o.addedBy]), [['Beach', 'Ada Alder'], ['Mountains', 'Ada Alder'], ['Lake', 'Ada Alder']]);
  assert.deepEqual(before.voters, []);

  await V.castBallot(t, member(bo), id, [mountains], later(1000));
  await V.castBallot(t, member(carl), id, [beach], later(2000));
  const after = await view(t, reader(carl), id);
  assert.equal(after.voted, true);
  assert.deepEqual(after.mine, [beach]);
  assert.equal(after.voterCount, 2);
  assert.ok(after.result?.kind === 'single');
  assert.deepEqual(after.result.tallies, { [beach]: 1, [mountains]: 1, [lake]: 0 });
  assert.deepEqual(after.ballots, [
    { name: 'Bo Birch', person: null, guest: false, choices: [mountains] },
    { name: 'Carl Cedar', person: null, guest: false, choices: [beach] },
  ]);
  assert.deepEqual(after.voters?.map((v) => v.name), ['Bo Birch', 'Carl Cedar']);
  assert.ok(after.voters?.every((v) => !('struck' in v)), 'struck is for stewards');
  // Ada started it but has not voted: vote first, then see.
  const creator = await view(t, reader(ada), id);
  assert.equal(creator.result, null);
  assert.equal(creator.ballots, null);
});

test('a secret vote while open: no tallies and no ballots for anyone, only who has voted, A to Z', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ secret: true, guests: true }), undefined, NOW);
  const [beach, mountains] = await optionIds(t, id);
  await V.castBallot(t, member(eve), id, [beach], later(1000));
  await V.castBallot(t, member(carl), id, [mountains], later(2000));
  await V.castBallot(t, guest(1, 'Anna Guest'), id, [beach], later(3000));
  await V.castBallot(t, member(bo), id, [beach], later(4000));
  for (const r of [reader(carl), reader(ada), reader(eve)]) {
    const v = await view(t, r, id);
    assert.equal(v.result, null, `no result for ${r.user?.name}`);
    assert.equal(v.ballots, null, `no ballots for ${r.user?.name}`);
    assert.equal(v.winners, null);
    assert.equal(v.voterCount, 4);
    assert.deepEqual(v.voters?.map((x) => [x.name, x.guest]), [['Anna Guest', true], ['Bo Birch', false], ['Carl Cedar', false], ['Eve Elm', false]]);
    assert.doesNotMatch(JSON.stringify(v), /tallies|changed/);
  }
  assert.deepEqual((await view(t, reader(carl), id)).mine, [mountains]);
  assert.deepEqual((await view(t, reader(eve), id)).mine, [beach]);
  assert.equal((await view(t, reader(ada), id)).mine, null);
  // The guest sees how many, their own ballot, and nobody.
  const g = await view(t, GUEST, id, later(HOUR), 'g:key-1');
  assert.deepEqual(g.mine, [beach]);
  assert.equal(g.voters, null);
  assert.equal(g.result, null);
  assert.doesNotMatch(JSON.stringify(g), MEMBERS);
});

test('a secret vote once closed: the result for everyone, who chose what for nobody', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ secret: true, guests: true }), undefined, NOW);
  const [beach, mountains, lake] = await optionIds(t, id);
  await V.castBallot(t, member(carl), id, [beach], later(1000));
  await V.castBallot(t, member(bo), id, [beach], later(2000));
  await V.castBallot(t, guest(1), id, [mountains], later(3000));
  await V.closeVote(t, ada, id, undefined, later(4000));
  for (const [r, key] of [[reader(carl)], [reader(ada)], [reader(eve)], [reader(dee)], [GUEST, 'g:key-1'], [GUEST]] as [Reader, string?][]) {
    const v = await view(t, r, id, later(HOUR), key);
    assert.equal(v.closed, true);
    assert.ok(v.result?.kind === 'single');
    assert.deepEqual(v.result.tallies, { [beach]: 2, [mountains]: 1, [lake]: 0 });
    assert.deepEqual(v.winners, ['Beach']);
    assert.equal(v.ballots, null);
  }
});

test('a guest reads an open vote that allows guests without any member’s name, face or choice', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ guests: true }), undefined, NOW);
  const [beach, mountains] = await optionIds(t, id);
  await V.castBallot(t, member(bo), id, [mountains], later(1000));
  await V.castBallot(t, member(carl), id, [beach], later(1500));
  await V.castBallot(t, guest(2, 'Other Guest'), id, [beach], later(1800));

  const before = await view(t, GUEST, id, later(HOUR), 'g:key-1');
  assert.equal(before.voted, false);
  assert.equal(before.result, null);

  await V.castBallot(t, guest(1), id, [mountains], later(2000));
  const v = await view(t, GUEST, id, later(HOUR), 'g:key-1');
  assert.equal(v.voted, true);
  assert.deepEqual(v.mine, [mountains]);
  assert.equal(v.voterCount, 4);
  assert.ok(v.result?.kind === 'single');
  assert.equal(v.result.tallies[mountains], 2);
  assert.equal(v.ballots, null);
  assert.equal(v.voters, null);
  assert.deepEqual(v.author, { name: '', person: null });
  assert.ok(v.options.every((o) => o.addedBy === ''));
  assert.deepEqual(v.may, { edit: false, close: false, remove: false, addOption: false, strike: false });
  const json = JSON.stringify(v);
  assert.doesNotMatch(json, MEMBERS);
  assert.doesNotMatch(json, /Other Guest/);
  // The list too.
  const list = await V.listVotes(t, GUEST, 'g:key-1', later(HOUR));
  assert.deepEqual(list.map((s) => [s.id, s.voted]), [[id, true]]);
  assert.doesNotMatch(JSON.stringify(list), MEMBERS);
});

test('a guest gets nothing of a vote that does not allow guests', async () => {
  const t = await family();
  const { id: closedToGuests } = await V.createVote(t, ada, input(), undefined, NOW);
  const { id: open } = await V.createVote(t, ada, input({ guests: true }), undefined, NOW);
  assert.equal(await V.voteView(t, GUEST, closedToGuests, 'g:key-1', later(HOUR)), null);
  assert.equal(await V.voteView(t, GUEST, closedToGuests, undefined, later(HOUR)), null);
  assert.deepEqual((await V.listVotes(t, GUEST, undefined, later(HOUR))).map((s) => s.id), [open]);
  // Closed, it stays out of a guest's reach.
  await V.closeVote(t, ada, closedToGuests, undefined, later(1000));
  assert.equal(await V.voteView(t, GUEST, closedToGuests, undefined, later(HOUR)), null);
  assert.deepEqual((await V.listVotes(t, GUEST, undefined, later(HOUR))).map((s) => s.id), [open]);
  assert.equal(await V.voteView(t, reader(carl), 'no-such-vote', undefined, later(HOUR)), null);
});

test('a struck guest’s ballot does not count, open vote or secret; only a steward sees it struck', async () => {
  for (const secret of [false, true]) {
    const t = await family();
    const { id } = await V.createVote(t, ada, input({ guests: true, secret }), undefined, NOW);
    const [beach, , lake] = await optionIds(t, id);
    await V.castBallot(t, guest(1), id, [lake], later(1000));
    await V.castBallot(t, guest(2), id, [lake], later(1000));
    await V.castBallot(t, member(carl), id, [beach], later(2000));
    const rows = await db.db(t).all<{ id: string }>('SELECT id FROM vote_voter WHERE vote = ? AND guest_key IS NOT NULL', id);
    for (const r of rows) await V.strikeVoter(t, eve, id, r.id, true, undefined, later(3000));

    const steward = await view(t, reader(eve), id, later(4000));
    assert.deepEqual(steward.voters?.map((v) => [v.name, v.struck]), [['Carl Cedar', false], ['Guest 1', true], ['Guest 2', true]]);
    assert.equal(steward.may.strike, true);
    const carls = await view(t, reader(carl), id, later(4000));
    assert.deepEqual(carls.voters?.map((v) => v.name), ['Carl Cedar'], 'a struck guest is not shown to others');
    assert.ok(carls.voters?.every((v) => !('struck' in v)));
    assert.equal(carls.voterCount, 1);
    assert.equal(carls.may.strike, false);
    if (!secret) {
      assert.ok(carls.result?.kind === 'single');
      assert.deepEqual([carls.result.tallies[beach], carls.result.tallies[lake]], [1, 0]);
      assert.deepEqual(carls.ballots?.map((b) => b.name), ['Carl Cedar']);
    }
    // A struck guest still reads their own ballot, and is not told.
    const g = await view(t, GUEST, id, later(4000), 'g:key-1');
    assert.deepEqual(g.mine, [lake]);
    assert.doesNotMatch(JSON.stringify(g), /struck/);

    await V.closeVote(t, ada, id, undefined, later(5000));
    const closed = await view(t, reader(carl), id, later(6000));
    assert.ok(closed.result?.kind === 'single');
    assert.deepEqual([closed.result.tallies[beach], closed.result.tallies[lake], closed.result.ballots], [1, 0, 1], `secret: ${secret}`);
    assert.deepEqual(closed.winners, ['Beach']);
    const [summary] = await V.listVotes(t, reader(carl), undefined, later(6000));
    assert.deepEqual([summary.voterCount, summary.winners], [1, ['Beach']]);
  }
});

test('a vote past its closing time reads as closed; the first member to read it marks it so, never a guest or a demo', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ guests: true, kind: 'ranked', closesAt: later(HOUR).toISOString() }), undefined, NOW);
  const [beach, mountains, lake] = await optionIds(t, id);
  await V.castBallot(t, member(carl), id, [lake, beach], later(1000));
  await V.castBallot(t, member(bo), id, [beach], later(2000));
  await V.castBallot(t, member(dee), id, [beach, lake], later(2500));
  await V.castBallot(t, guest(1), id, [mountains, lake], later(3000));
  const past = later(2 * HOUR);

  const g = await view(t, GUEST, id, past);
  assert.equal(g.closed, true);
  assert.deepEqual(g.winners, ['Beach']);
  assert.equal(g.result?.kind, 'ranked');
  assert.equal(await closedAt(t, id), null, 'a guest’s read writes nothing');

  process.env.KINDRED_DEMO = '1';
  try {
    assert.equal((await view(t, reader(carl), id, past)).closed, true);
    assert.equal((await V.listVotes(t, reader(carl), undefined, past))[0].closed, true);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as a viewer.'));
  try {
    assert.equal((await view(t, reader(carl), id, past)).closed, true);
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.equal(await closedAt(t, id), null, 'a demo and a preview write nothing');

  const [summary] = await V.listVotes(t, reader(carl), undefined, past);
  assert.deepEqual([summary.id, summary.closed, summary.winners, summary.voterCount], [id, true, ['Beach'], 4]);
  // Closed at its closing time, not at the read's.
  assert.equal(await closedAt(t, id), later(HOUR).toISOString());
  const v = await view(t, reader(carl), id, past);
  assert.deepEqual([v.closed, v.closesAt, v.winners], [true, later(HOUR).toISOString(), ['Beach']]);
  assert.equal(v.may.close, false);
  assert.equal(v.may.edit, false);
  // A vote closed early says when.
  const { id: early } = await V.createVote(t, bo, input(), undefined, NOW);
  await V.closeVote(t, bo, early, undefined, later(1000));
  assert.equal((await view(t, reader(carl), early, past)).closesAt, later(1000).toISOString());
  // The view of a past vote marks it too.
  const { id: other } = await V.createVote(t, bo, input({ closesAt: later(HOUR).toISOString() }), undefined, NOW);
  assert.equal((await view(t, reader(dee), other, past)).closed, true);
  assert.equal(await closedAt(t, other), later(HOUR).toISOString());
});

test('the list: open votes closing soonest first, then closed ones newest first, with counts and the reader’s own mark', async () => {
  const t = await family();
  const make = async (w: ReturnType<typeof who>, days: number) => (await V.createVote(t, w, input({ closesAt: later(days * DAY).toISOString() }), undefined, NOW)).id;
  const late = await make(ada, 9);
  const soon = await make(ada, 2);
  const mid = await make(bo, 5);
  const closedFirst = await make(bo, 6);
  const closedLast = await make(bo, 7);
  await V.closeVote(t, bo, closedFirst, undefined, later(1000));
  await V.closeVote(t, bo, closedLast, undefined, later(2000));
  const [beach] = await optionIds(t, mid);
  await V.castBallot(t, member(carl), mid, [beach], later(3000));
  await V.castBallot(t, member(bo), mid, [beach], later(3000));
  const list = await V.listVotes(t, reader(carl), undefined, later(HOUR));
  assert.deepEqual(list.map((s) => s.id), [soon, mid, late, closedLast, closedFirst]);
  assert.deepEqual(list.map((s) => [s.closed, s.voterCount, s.voted]), [[false, 0, false], [false, 2, true], [false, 0, false], [true, 0, false], [true, 0, false]]);
  assert.deepEqual(list.map((s) => s.winners), [null, null, null, [], []]);
  assert.deepEqual(list[0].author, { name: 'Ada Alder', person: 'ada' });
  assert.equal((await V.listVotes(t, reader(bo), undefined, later(HOUR)))[1].voted, true);
});

test('what a reader may do: edit and add only while open, close and remove as creator or editor, strike as steward', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ addOptions: true, guests: true }), undefined, NOW);
  const may = async (r: Reader) => (await view(t, r, id)).may;
  assert.deepEqual(await may(reader(ada)), { edit: true, close: true, remove: true, addOption: true, strike: false });
  assert.deepEqual(await may(reader(bo)), { edit: false, close: false, remove: false, addOption: true, strike: false });
  assert.deepEqual(await may(reader(carl)), { edit: false, close: false, remove: false, addOption: false, strike: false });
  assert.deepEqual(await may(reader(dee)), { edit: false, close: true, remove: true, addOption: true, strike: false });
  assert.deepEqual(await may(reader(eve)), { edit: false, close: true, remove: true, addOption: true, strike: true });
  assert.deepEqual(await may(GUEST), { edit: false, close: false, remove: false, addOption: false, strike: false });
  await V.closeVote(t, ada, id, undefined, later(1000));
  assert.deepEqual(await may(reader(ada)), { edit: false, close: false, remove: true, addOption: false, strike: false });
  assert.deepEqual(await may(reader(eve)), { edit: false, close: false, remove: true, addOption: false, strike: false });
});
