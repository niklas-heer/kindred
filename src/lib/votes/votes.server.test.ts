// node --test src/lib/votes/votes.server.test.ts — starting, changing, closing and removing a vote and casting ballots, on a
// private data folder with a fresh family per test: who may do what, the limits, a ballot's rules, a vote that closed
// between reading and voting, guests and their limits, a secret vote's ballots that a backup cannot tie to their voters,
// striking a guest, and that a demo and a steward's preview store nothing. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-votes-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('./votes.server.ts')>('/src/lib/votes/votes.server.ts');
const K = await load<typeof import('./voter-key.server.ts')>('/src/lib/votes/voter-key.server.ts');
const readOnly = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { MAX_OPTIONS, MAX_VOTES_AN_HOUR, MIN_CLOSE_MS, MAX_CLOSE_DAYS, GUEST_VOTERS_PER_NETWORK, GUEST_VOTERS_PER_LINK } =
  await load<typeof import('./types.ts')>('/src/lib/votes/types.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
type Input = Parameters<typeof V.createVote>[2];

const NOW = new Date('2026-11-15T10:00:00.000Z');
const DAY = 86_400_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);

let families = 0;
/** A fresh, empty family for one test, with Ada in its tree. */
async function family(): Promise<string> {
  const id = `votes${++families}`;
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
const guestWho = { id: '', name: '', role: 'viewer' as const, guest: true };
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });
const guest = (n: number, net = n, link = 'link-1', name = `Guest ${n}`) => ({ kind: 'guest' as const, key: `g:key-${n}`, name, link, net });

const input = (over: Partial<Input> = {}): Input => ({
  question: 'Where do we meet next summer?', description: 'The reunion', kind: 'single', secret: false, addOptions: false, guests: false,
  closesAt: later(7 * DAY).toISOString(), options: ['Beach', 'Mountains', 'Lake'], ...over,
});
const forbidden = /permission/;
const count = async (tree: string, table: string, where = '1 = 1') => (await db.db(tree).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const optionIds = async (tree: string, vote: string) => (await db.db(tree).all<{ id: string }>('SELECT id FROM vote_option WHERE vote = ? ORDER BY ord', vote)).map((r) => r.id);
/**
 * Runs `between` just before the next batch family `t` sends, and counts that write's attempts: a change that lands between
 * a plan's reads and its write, as another request's would.
 */
function beforeNextBatch(t: string, between: () => Promise<unknown>) {
  const d = db.db(t);
  const send = d.batch;
  const seen = { attempts: 0 };
  d.batch = async (queries) => {
    seen.attempts++;
    d.batch = send;
    await between();
    d.batch = async (again) => { seen.attempts++; return send.call(d, again); };
    return send.call(d, queries);
  };
  return { seen, done: () => { d.batch = send; } };
}

test('a contributor starts a vote; a viewer may not; the sixth vote in an hour is refused', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ question: '  Where   do we meet?  ' }), undefined, NOW);
  const row = await db.db(t).get<Record<string, unknown>>('SELECT * FROM vote WHERE id = ?', id);
  assert.equal(row?.question, 'Where do we meet?');
  assert.equal(row?.account, ada.id);
  assert.equal(row?.author_name, 'Ada Alder');
  assert.equal(row?.author_person, 'ada');
  assert.equal(row?.kind, 'single');
  assert.equal(row?.secret, 0);
  assert.equal(row?.closes_at, later(7 * DAY).toISOString());
  assert.equal(row?.closed_at, null);
  assert.equal(row?.created_at, NOW.toISOString());
  const options = await db.db(t).all<{ label: string; ord: number; added_by_account: string }>('SELECT label, ord, added_by_account FROM vote_option WHERE vote = ? ORDER BY ord', id);
  assert.deepEqual(options.map((o) => o.label), ['Beach', 'Mountains', 'Lake']);
  assert.ok(options.every((o) => o.added_by_account === ada.id));

  await assert.rejects(V.createVote(t, carl, input(), undefined, NOW), forbidden);
  await assert.rejects(V.createVote(t, guestWho, input(), undefined, NOW), /access/i);
  // Bo's person is not confirmed: the vote is not signed with a face.
  const { id: bos } = await V.createVote(t, bo, input(), undefined, NOW);
  assert.equal((await db.db(t).get<{ p: string | null }>('SELECT author_person AS p FROM vote WHERE id = ?', bos))?.p, null);

  for (let i = 1; i < MAX_VOTES_AN_HOUR; i++) await V.createVote(t, ada, input(), undefined, later(i * 60_000));
  await assert.rejects(V.createVote(t, ada, input(), undefined, later(10 * 60_000)), /votes\.err\.too_many/);
  assert.equal(await count(t, 'vote', `account = '${ada.id}'`), MAX_VOTES_AN_HOUR);
  // An hour on, she may again.
  await V.createVote(t, ada, input({ closesAt: later(8 * DAY).toISOString() }), undefined, later(61 * 60_000));
});

test('a closing time too soon or too far away is refused', async () => {
  const t = await family();
  await assert.rejects(V.createVote(t, ada, input({ closesAt: later(MIN_CLOSE_MS - 1).toISOString() }), undefined, NOW), /votes\.err\.closes_at/);
  await assert.rejects(V.createVote(t, ada, input({ closesAt: later(MAX_CLOSE_DAYS * DAY + 1).toISOString() }), undefined, NOW), /votes\.err\.closes_at/);
  await assert.rejects(V.createVote(t, ada, input({ closesAt: 'next week' }), undefined, NOW), /votes\.err\.closes_at/);
  await V.createVote(t, ada, input({ closesAt: later(MIN_CLOSE_MS).toISOString() }), undefined, NOW);
  await V.createVote(t, ada, input({ closesAt: later(MAX_CLOSE_DAYS * DAY).toISOString() }), undefined, NOW);
});

test('fewer than two or more than twenty options, or the same label twice, are refused', async () => {
  const t = await family();
  await assert.rejects(V.createVote(t, ada, input({ options: ['Beach'] }), undefined, NOW), /votes\.err\.options/);
  await assert.rejects(V.createVote(t, ada, input({ options: ['Beach', '  '] }), undefined, NOW), /votes\.err\.options/);
  const many = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `Place ${i}`);
  await assert.rejects(V.createVote(t, ada, input({ options: many }), undefined, NOW), /votes\.err\.options/);
  await assert.rejects(V.createVote(t, ada, input({ options: ['Beach', ' beach ', 'Lake'] }), undefined, NOW), /votes\.err\.options/);
  await assert.rejects(V.createVote(t, ada, input({ question: '   ' }), undefined, NOW), /votes\.err\.question/);
  assert.equal(await count(t, 'vote'), 0);
  await V.createVote(t, ada, input({ options: many.slice(0, MAX_OPTIONS) }), undefined, NOW);
});

test('a viewer casts a single-choice ballot and changes it: one voter row and one ballot remain', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  const [beach, mountains, lake] = await optionIds(t, id);
  await V.castBallot(t, member(carl), id, [beach], later(1000));
  await V.castBallot(t, member({ ...carl, name: 'Carl C.' }), id, [lake], later(2000));
  assert.equal(await count(t, 'vote_voter', `vote = '${id}'`), 1);
  assert.equal(await count(t, 'ballot', `vote = '${id}'`), 1);
  const voter = await db.db(t).get<{ account: string; name: string; guest_key: string | null }>('SELECT account, name, guest_key FROM vote_voter WHERE vote = ?', id);
  assert.deepEqual({ ...voter }, { account: carl.id, name: 'Carl C.', guest_key: null });
  const ballot = await db.db(t).get<{ voter: string; choices: string; changed_at: string | null }>('SELECT voter, choices, changed_at FROM ballot WHERE vote = ?', id);
  assert.equal(ballot?.voter, carl.id, 'an open vote keys the ballot by the account');
  assert.deepEqual(JSON.parse(ballot!.choices), [lake]);
  assert.equal(ballot?.changed_at, later(2000).toISOString());
  // A single choice is exactly one option.
  await assert.rejects(V.castBallot(t, member(carl), id, [beach, mountains], later(3000)), /votes\.err\.choice/);
  await assert.rejects(V.castBallot(t, member(carl), id, [], later(3000)), /votes\.err\.choice/);
  await assert.rejects(V.castBallot(t, { kind: 'member', who: guestWho }, id, [beach], later(3000)), /access/i);
});

test('a ranked ballot naming an option twice, or one that is not the vote’s, is refused', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ kind: 'ranked' }), undefined, NOW);
  const { id: otherVote } = await V.createVote(t, ada, input(), undefined, NOW);
  const [beach, mountains, lake] = await optionIds(t, id);
  const [foreign] = await optionIds(t, otherVote);
  await assert.rejects(V.castBallot(t, member(carl), id, [beach, mountains, beach], later(1000)), /votes\.err\.choice/);
  await assert.rejects(V.castBallot(t, member(carl), id, [beach, 'no-such-option'], later(1000)), /votes\.err\.choice/);
  await assert.rejects(V.castBallot(t, member(carl), id, [beach, foreign], later(1000)), /votes\.err\.choice/);
  await assert.rejects(V.castBallot(t, member(carl), id, [], later(1000)), /votes\.err\.choice/);
  assert.equal(await count(t, 'ballot'), 0);
  await V.castBallot(t, member(carl), id, [lake, beach], later(1000));
  assert.deepEqual(JSON.parse((await db.db(t).get<{ choices: string }>('SELECT choices FROM ballot WHERE vote = ?', id))!.choices), [lake, beach]);
});

test('after the first ballot only the closing time may change, never into the past', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  // Before any ballot: everything, by the creator alone.
  await V.editVote(t, ada, id, { question: 'Where shall we meet?', options: ['Beach', 'Forest'] }, undefined, later(1000));
  const row = await db.db(t).get<{ question: string; edited_at: string | null }>('SELECT question, edited_at FROM vote WHERE id = ?', id);
  assert.equal(row?.question, 'Where shall we meet?');
  assert.equal(row?.edited_at, later(1000).toISOString());
  assert.deepEqual((await db.db(t).all<{ label: string }>('SELECT label FROM vote_option WHERE vote = ? ORDER BY ord', id)).map((r) => r.label), ['Beach', 'Forest']);
  await assert.rejects(V.editVote(t, bo, id, { question: 'Mine now?' }, undefined, later(1000)), /votes\.err\.not_yours/);
  await assert.rejects(V.editVote(t, dee, id, { question: 'An editor’s?' }, undefined, later(1000)), /votes\.err\.not_yours/);
  await assert.rejects(V.editVote(t, ada, id, { options: ['Beach'] }, undefined, later(1000)), /votes\.err\.options/);

  const [beach] = await optionIds(t, id);
  await V.castBallot(t, member(carl), id, [beach], later(2000));
  await assert.rejects(V.editVote(t, ada, id, { options: ['Beach', 'Forest', 'Lake'] }, undefined, later(3000)), /votes\.err\.locked/);
  await assert.rejects(V.editVote(t, ada, id, { question: 'Something else?' }, undefined, later(3000)), /votes\.err\.locked/);
  await assert.rejects(V.editVote(t, ada, id, { secret: true }, undefined, later(3000)), /votes\.err\.locked/);
  // Sending the same question again with a new closing time is no change to it.
  const closesAt = later(20 * DAY).toISOString();
  await V.editVote(t, ada, id, { question: 'Where shall we meet?', closesAt }, undefined, later(3000));
  assert.equal((await db.db(t).get<{ c: string }>('SELECT closes_at AS c FROM vote WHERE id = ?', id))?.c, closesAt);
  // Shorter, but not into the past nor past ninety days from the start.
  await assert.rejects(V.editVote(t, ada, id, { closesAt: later(-DAY).toISOString() }, undefined, later(3000)), /votes\.err\.closes_at/);
  await assert.rejects(V.editVote(t, ada, id, { closesAt: later(MAX_CLOSE_DAYS * DAY + 1).toISOString() }, undefined, later(10 * DAY)), /votes\.err\.closes_at/);
  await V.editVote(t, ada, id, { closesAt: later(2 * DAY).toISOString() }, undefined, later(DAY));
  assert.equal(await count(t, 'vote_option', `vote = '${id}'`), 2);
});

test('an option may be added only where the vote allows it, by a contributor', async () => {
  const t = await family();
  const { id: closedSet } = await V.createVote(t, ada, input(), undefined, NOW);
  await assert.rejects(V.addOption(t, bo, closedSet, 'Forest', undefined, later(1000)), /votes\.err\.locked/);
  const { id } = await V.createVote(t, ada, input({ addOptions: true }), undefined, NOW);
  await assert.rejects(V.addOption(t, carl, id, 'Forest', undefined, later(1000)), forbidden);
  await assert.rejects(V.addOption(t, bo, id, ' LAKE ', undefined, later(1000)), /votes\.err\.options/);
  const [beach] = await optionIds(t, id);
  await V.castBallot(t, member(carl), id, [beach], later(1500));
  const { id: forest } = await V.addOption(t, bo, id, 'Forest', undefined, later(2000));
  const added = await db.db(t).get<{ label: string; ord: number; added_by_account: string; added_by_name: string }>('SELECT label, ord, added_by_account, added_by_name FROM vote_option WHERE id = ?', forest);
  assert.deepEqual({ ...added }, { label: 'Forest', ord: 3, added_by_account: bo.id, added_by_name: 'Bo Birch' });
  await V.castBallot(t, member(carl), id, [forest], later(3000));
});

test('a ballot, an option or an edit after the closing time is refused, though nothing marked the vote closed', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ addOptions: true, closesAt: later(2 * 3_600_000).toISOString() }), undefined, NOW);
  const [beach] = await optionIds(t, id);
  const after = later(2 * 3_600_000);
  assert.equal((await db.db(t).get<{ c: string | null }>('SELECT closed_at AS c FROM vote WHERE id = ?', id))?.c, null);
  await assert.rejects(V.castBallot(t, member(carl), id, [beach], after), /votes\.err\.closed/);
  await assert.rejects(V.addOption(t, bo, id, 'Forest', undefined, after), /votes\.err\.closed/);
  await assert.rejects(V.editVote(t, ada, id, { closesAt: later(DAY, after).toISOString() }, undefined, after), /votes\.err\.closed/);
  assert.equal(await count(t, 'ballot'), 0);

  // Closed early by hand: the same.
  const { id: early } = await V.createVote(t, ada, input(), undefined, NOW);
  const [first] = await optionIds(t, early);
  await assert.rejects(V.closeVote(t, bo, early, undefined, later(1000)), forbidden);
  await V.closeVote(t, ada, early, undefined, later(1000));
  assert.equal((await db.db(t).get<{ c: string | null }>('SELECT closed_at AS c FROM vote WHERE id = ?', early))?.c, later(1000).toISOString());
  await assert.rejects(V.castBallot(t, member(carl), early, [first], later(2000)), /votes\.err\.closed/);
  // An editor may close anyone's.
  const { id: third } = await V.createVote(t, ada, input(), undefined, NOW);
  await V.closeVote(t, dee, third, undefined, later(1000));
  assert.equal(await count(t, 'vote', 'closed_at IS NOT NULL'), 2);
});

test('removing a vote takes its options, voters and ballots: the creator’s own, or anyone’s for an editor', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  const [beach] = await optionIds(t, id);
  await V.castBallot(t, member(carl), id, [beach], later(1000));
  await assert.rejects(V.removeVote(t, bo, id), forbidden);
  assert.deepEqual(await V.removeVote(t, { ...ada, role: 'viewer' }, id), { removed: true });
  for (const table of ['vote', 'vote_option', 'vote_voter', 'ballot']) assert.equal(await count(t, table), 0, table);
  assert.deepEqual(await V.removeVote(t, ada, id), { removed: false });
  const { id: next } = await V.createVote(t, ada, input(), undefined, NOW);
  assert.deepEqual(await V.removeVote(t, dee, next), { removed: true });
});

test('a guest votes only where the vote allows guests, and only so many from one network or one link', async () => {
  const t = await family();
  const { id: closedToGuests } = await V.createVote(t, ada, input(), undefined, NOW);
  const [x] = await optionIds(t, closedToGuests);
  await assert.rejects(V.castBallot(t, guest(1), closedToGuests, [x], later(1000)), /votes\.err\.guests/);

  const { id } = await V.createVote(t, ada, input({ guests: true }), undefined, NOW);
  const [beach, mountains] = await optionIds(t, id);
  await assert.rejects(V.castBallot(t, guest(1, 1, 'link-1', '  '), id, [beach], later(1000)), /votes\.err\.name/);
  await assert.rejects(V.castBallot(t, guest(1, 1, 'link-1', 'x'.repeat(61)), id, [beach], later(1000)), /votes\.err\.name/);
  // One network: twelve guests, not thirteen.
  for (let n = 1; n <= GUEST_VOTERS_PER_NETWORK; n++) await V.castBallot(t, guest(n, 7), id, [beach], later(1000 + n));
  await assert.rejects(V.castBallot(t, guest(100, 7), id, [beach], later(2000)), /votes\.err\.limit/);
  // One already counted may still change their ballot.
  await V.castBallot(t, guest(1, 7), id, [mountains], later(3000));
  const row = await db.db(t).get<Record<string, unknown>>('SELECT account, guest_key, name, person, link, net FROM vote_voter WHERE guest_key = ?', 'g:key-1');
  assert.deepEqual({ ...row }, { account: null, guest_key: 'g:key-1', name: 'Guest 1', person: null, link: 'link-1', net: 7 });
  // One link: forty guests, not forty-one (each from a network of their own).
  for (let n = GUEST_VOTERS_PER_NETWORK + 1; n <= GUEST_VOTERS_PER_LINK; n++) await V.castBallot(t, guest(n), id, [beach], later(4000 + n));
  assert.equal(await count(t, 'vote_voter', `vote = '${id}'`), GUEST_VOTERS_PER_LINK);
  await assert.rejects(V.castBallot(t, guest(200), id, [beach], later(5000)), /votes\.err\.limit/);
  // Another link's guests are counted apart.
  await V.castBallot(t, guest(201, 201, 'link-2'), id, [beach], later(6000));
  // Members are no guests: never limited by them.
  await V.castBallot(t, member(carl), id, [beach], later(7000));
});

test('a secret vote’s ballots carry no account, no time, and nothing a backup could join to who voted', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ secret: true, guests: true, kind: 'ranked' }), undefined, NOW);
  const [beach, mountains] = await optionIds(t, id);
  await V.castBallot(t, member(carl), id, [beach], later(1000));
  await V.castBallot(t, member(bo), id, [mountains, beach], later(2000));
  await V.castBallot(t, guest(1), id, [mountains], later(3000));
  // Carl changes his: still one row, still no time.
  await V.castBallot(t, member(carl), id, [mountains], later(4000));
  const ballots = await db.db(t).all<Record<string, unknown>>('SELECT * FROM ballot WHERE vote = ?', id);
  const voters = await db.db(t).all<Record<string, unknown>>('SELECT * FROM vote_voter WHERE vote = ?', id);
  assert.equal(ballots.length, 3);
  assert.equal(voters.length, 3);
  for (const b of ballots) {
    assert.equal(b.changed_at, null);
    assert.ok(![ada.id, bo.id, carl.id, 'g:key-1'].includes(b.voter as string), 'no account id or guest key');
  }
  const voterValues = new Set(voters.flatMap((v) => Object.entries(v).filter(([k]) => k !== 'vote').map(([, value]) => value)).filter((value) => value !== null));
  for (const b of ballots) for (const [k, value] of Object.entries(b)) if (k !== 'vote' && value !== null) assert.ok(!voterValues.has(value), `ballot.${k} equals a vote_voter column`);
  // The server can still find Carl's own ballot.
  const key = await K.voterKey(id, true, carl.id);
  assert.deepEqual(JSON.parse((await db.db(t).get<{ choices: string }>('SELECT choices FROM ballot WHERE vote = ? AND voter = ?', id, key))!.choices), [mountains]);
  assert.notEqual(await K.voterKey('another-vote', true, carl.id), key, 'the key is the vote’s own');
  assert.equal(await K.voterKey(id, false, carl.id), carl.id);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
});

test('a steward strikes and restores a guest’s ballot while the vote is open, never a member’s', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ guests: true }), undefined, NOW);
  const [beach] = await optionIds(t, id);
  await V.castBallot(t, guest(1), id, [beach], later(1000));
  await V.castBallot(t, member(carl), id, [beach], later(1000));
  const rowOf = async (where: string) => (await db.db(t).get<{ id: string }>(`SELECT id FROM vote_voter WHERE vote = ? AND ${where}`, id))!.id;
  const guestRow = await rowOf('guest_key IS NOT NULL');
  const memberRow = await rowOf('account IS NOT NULL');
  await assert.rejects(V.strikeVoter(t, dee, id, guestRow, true, undefined, later(2000)), forbidden);
  await assert.rejects(V.strikeVoter(t, eve, id, memberRow, true, undefined, later(2000)), forbidden);
  await V.strikeVoter(t, eve, id, guestRow, true, undefined, later(2000));
  assert.equal(await count(t, 'vote_voter', 'struck = 1'), 1);
  // A struck guest votes no more.
  await assert.rejects(V.castBallot(t, guest(1), id, [beach], later(2500)), /votes\.err\.guests/);
  await V.strikeVoter(t, eve, id, guestRow, false, undefined, later(3000));
  assert.equal(await count(t, 'vote_voter', 'struck = 1'), 0);
  await V.closeVote(t, ada, id, undefined, later(4000));
  await assert.rejects(V.strikeVoter(t, eve, id, guestRow, true, undefined, later(5000)), /votes\.err\.closed/);
});

test('a demo and a steward’s preview store nothing', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ addOptions: true, guests: true }), undefined, NOW);
  const [beach] = await optionIds(t, id);
  await V.castBallot(t, guest(1), id, [beach], later(1000));
  const guestRow = (await db.db(t).get<{ id: string }>('SELECT id FROM vote_voter WHERE vote = ?', id))!.id;
  const writes = () => [
    () => V.createVote(t, ada, input(), undefined, NOW),
    () => V.editVote(t, ada, id, { closesAt: later(3 * DAY).toISOString() }, undefined, later(1000)),
    () => V.closeVote(t, ada, id, undefined, later(1000)),
    () => V.removeVote(t, ada, id),
    () => V.addOption(t, bo, id, 'Forest', undefined, later(1000)),
    () => V.castBallot(t, member(carl), id, [beach], later(1000)),
    () => V.castBallot(t, guest(2), id, [beach], later(1000)),
    () => V.strikeVoter(t, eve, id, guestRow, true, undefined, later(1000)),
  ];
  const snapshot = async () => Promise.all(['vote', 'vote_option', 'vote_voter', 'ballot', 'vote WHERE closed_at IS NOT NULL', 'vote_voter WHERE struck = 1'].map((s) => count(t, s.split(' ')[0], s.split(' WHERE ')[1])));
  const before = await snapshot();
  process.env.KINDRED_DEMO = '1';
  try {
    for (const w of writes()) await assert.rejects(w(), /demo/i);
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  readOnly.onRequestReadOnly(() => new AuthError('forbidden', 'You are viewing as a contributor. Stop the preview to change something.'));
  try {
    for (const w of writes()) await assert.rejects(w(), /viewing as/);
  } finally {
    readOnly.onRequestReadOnly(() => undefined);
  }
  assert.deepEqual(await snapshot(), before);
});

test('a ballot decides again when the vote turned secret or single-choice between its reading and its writing', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  const [beach] = await optionIds(t, id);
  const hook = beforeNextBatch(t, () => V.editVote(t, ada, id, { secret: true }, undefined, later(500)));
  try {
    await V.castBallot(t, member(carl), id, [beach], later(1000));
  } finally {
    hook.done();
  }
  const ballot = await db.db(t).get<{ voter: string; changed_at: string | null }>('SELECT voter, changed_at FROM ballot WHERE vote = ?', id);
  assert.equal(ballot?.voter, await K.voterKey(id, true, carl.id), 'keyed as the secret vote it now is');
  assert.equal(ballot?.changed_at, null);

  const { id: ranked } = await V.createVote(t, ada, input({ kind: 'ranked' }), undefined, NOW);
  const [first, second] = await optionIds(t, ranked);
  const flip = beforeNextBatch(t, () => V.editVote(t, ada, ranked, { kind: 'single' }, undefined, later(500)));
  try {
    await assert.rejects(V.castBallot(t, member(carl), ranked, [first, second], later(1000)), /votes\.err\.choice/);
  } finally {
    flip.done();
  }
  assert.equal(await count(t, 'ballot', `vote = '${ranked}'`), 0);
});

test('a ballot leaves no retry key behind: the op table would keep who sent which choices', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ secret: true }), undefined, NOW);
  const [beach] = await optionIds(t, id);
  const before = await count(t, 'op');
  await V.castBallot(t, member(carl), id, [beach], later(1000));
  assert.equal(V.castBallot.length, 4, 'castBallot takes no retry key');
  assert.equal(await count(t, 'op'), before);
});

test('changing the options and adding one decide again on the options as they are when they meet', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, input({ addOptions: true }), undefined, NOW);
  // Bo adds Forest while Ada saves the same list with Forest: hers decides again, finds it there, and keeps Bo's.
  const added = beforeNextBatch(t, () => V.addOption(t, bo, id, 'Forest', undefined, later(500)));
  try {
    await V.editVote(t, ada, id, { options: ['Beach', 'Mountains', 'Lake', 'Forest'] }, undefined, later(1000));
  } finally {
    added.done();
  }
  assert.equal(added.seen.attempts, 2);
  const forest = await db.db(t).get<{ added_by_account: string }>("SELECT added_by_account FROM vote_option WHERE vote = ? AND label = 'Forest'", id);
  assert.equal(forest?.added_by_account, bo.id);

  // Ada renames Mountains to Hills while Bo adds "hills": his decides again and finds the label taken.
  const renamed = beforeNextBatch(t, () => V.editVote(t, ada, id, { options: ['Beach', 'Hills', 'Lake', 'Forest'] }, undefined, later(1500)));
  try {
    await assert.rejects(V.addOption(t, bo, id, 'hills', undefined, later(2000)), /votes\.err\.options/);
  } finally {
    renamed.done();
  }
  assert.equal(await count(t, 'vote_option', `vote = '${id}'`), 4);
});

test('a kind that is neither single nor ranked is refused with a key', async () => {
  const t = await family();
  await assert.rejects(V.createVote(t, ada, input({ kind: 'plural' as never }), undefined, NOW), /votes\.err\.kind/);
  const { id } = await V.createVote(t, ada, input(), undefined, NOW);
  await assert.rejects(V.editVote(t, ada, id, { kind: 'plural' as never }, undefined, later(1000)), /votes\.err\.kind/);
});
