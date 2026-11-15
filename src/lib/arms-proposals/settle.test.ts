// node --test src/lib/arms-proposals/settle.test.ts — settling a house's arms vote: the vote is first marked closed (its own
// guarded write, so no ballot lands after it), then settled once, credited to the family's vote: a winning proposal's arms
// go to the house through the house-write plan, it is accepted and the others not chosen; Keep winning, no ballots or a tie
// leave the arms; two runs at once settle once; struck guests do not count. In vote mode the same run starts the house's
// next vote with the waiting proposals (oldest first, declining any equal to the new arms), also when an earlier start
// failed, but never with a proposal that came back from a removed vote. The callers: members' vote reads, a steward's
// close, the daily job (without push keys); never a guest's read, a preview, or the feed. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { Reader } from '../auth/guard.server.ts';
import type { House } from '../types.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-arms-settle-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;
delete process.env.KINDRED_VAPID_PUBLIC_KEY;
delete process.env.KINDRED_VAPID_PRIVATE_KEY;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('../votes/votes.server.ts')>('/src/lib/votes/votes.server.ts');
const P = await load<typeof import('./proposals.server.ts')>('/src/lib/arms-proposals/proposals.server.ts');
const S = await load<typeof import('./settle.server.ts')>('/src/lib/arms-proposals/settle.server.ts');
const F = await load<typeof import('../feed/feed.server.ts')>('/src/lib/feed/feed.server.ts');
const { votesJob } = await load<typeof import('../jobs/votes.ts')>('/src/lib/jobs/votes.ts');
const { actingAs } = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const { VOTE_AUTHOR } = await load<typeof import('../history.ts')>('/src/lib/history.ts');
const { onRequestReadOnly } = await load<typeof import('../read-only.ts')>('/src/lib/read-only.ts');
const { ARMS_VOTE_DAYS } = await load<typeof import('./types.ts')>('/src/lib/arms-proposals/types.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
type Arms = House['arms'];
const NOW = new Date('2026-11-15T10:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);
/** A day after an arms vote started at NOW has closed. */
const AFTER = later((ARMS_VOTE_DAYS + 1) * DAY);

const ARMS: Arms = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' };
const arms = (charge: Arms['charge'], field: Arms['field'] = 'gules'): Arms => ({ field, division: 'plain', charge, chargeTincture: 'or' });

let families = 0;
/** A fresh family for one test, with Ada in its tree and House Birch bearing a gold lion on blue. */
async function family(mode: 'steward' | 'vote' | 'choose' = 'vote'): Promise<string> {
  const id = `settle${++families}`;
  await db.store.ensureTree(id);
  const d = db.db(id);
  await d.run("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', 'The Alders') ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
  await d.run("INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1950', 1)");
  await d.run("INSERT INTO house (id, name, motto, arms) VALUES ('h1', 'Birch', 'Bend, not break', ?)", JSON.stringify(ARMS));
  await d.run("INSERT INTO meta (key, value) VALUES ('arms_mode', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", mode);
  return id;
}
const who = (id: string, name: string, role: Role, person: string | null = null) => ({ id, name, role, person, personConfirmed: !!person });
const ada = who('acc-ada', 'Ada Alder', 'contributor', 'ada');
const bo = who('acc-bo', 'Bo Birch', 'contributor');
const carl = who('acc-carl', 'Carl Cedar', 'viewer');
const eve = who('acc-eve', 'Eve Elm', 'steward');
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });
const guest = (n: number) => ({ kind: 'guest' as const, key: `g:guest-${n}`, name: `Guest ${n}`, link: 'link-1', net: n });
const reader = (w: ReturnType<typeof who>): Reader => ({
  user: { id: w.id, name: w.name, email: null, handle: w.id, created: 0, last_seen: null, locale: null },
  role: w.role, person: w.person, personConfirmed: w.personConfirmed, guest: false, protectLiving: false,
});
const guestReader: Reader = { user: null, role: 'viewer', person: null, personConfirmed: false, guest: true, protectLiving: false };

const propose = (t: string, w: ReturnType<typeof who>, name: string, a: Arms, at = NOW) => P.proposeArms(t, w, 'h1', { name, arms: a }, undefined, at);
const proposal = (t: string, id: string) =>
  db.db(t).get<{ status: string; reason: string | null; decided_by: string | null; decided_by_name: string | null; decided_at: string | null }>(
    'SELECT status, reason, decided_by, decided_by_name, decided_at FROM arms_proposal WHERE id = ?', id);
const houseArms = async (t: string) => JSON.parse((await db.db(t).get<{ arms: string }>("SELECT arms FROM house WHERE id = 'h1'"))!.arms) as Arms;
const seen = async (t: string) => {
  const h = (await db.db(t).get<{ name: string; motto: string | null; arms: string }>("SELECT name, motto, arms FROM house WHERE id = 'h1'"))!;
  return { name: h.name, motto: h.motto, arms: JSON.parse(h.arms) };
};
const voteRow = (t: string, id: string) =>
  db.db(t).get<{ closes_at: string; closed_at: string | null; settled_at: string | null; account: string; author_name: string }>(
    'SELECT closes_at, closed_at, settled_at, account, author_name FROM vote WHERE id = ?', id);
const unsettled = (t: string) => db.db(t).all<{ id: string; account: string; author_name: string; closes_at: string }>(
  "SELECT id, account, author_name, closes_at FROM vote WHERE subject_kind = 'house' AND settled_at IS NULL");
/** The vote's option ids by proposal (`keep` for the Keep option). */
async function optionsOf(t: string, vote: string): Promise<Record<string, string>> {
  const rows = await db.db(t).all<{ id: string; proposal: string | null }>('SELECT id, proposal FROM vote_option WHERE vote = ? ORDER BY ord', vote);
  return Object.fromEntries(rows.map((r) => [r.proposal ?? 'keep', r.id]));
}
const houseHistory = (t: string) =>
  db.db(t).all<{ account: string | null; name: string; label: string; fn: string }>("SELECT account, name, label, fn FROM history WHERE kind = 'house' AND record = 'h1' ORDER BY id");
/** Runs `between` just before the next batch family `t` sends. */
function beforeNextBatch(t: string, between: () => Promise<unknown>) {
  const d = db.db(t);
  const send = d.batch;
  d.batch = async (queries) => {
    d.batch = send;
    await between();
    return send.call(d, queries);
  };
}
/** Fails the `n`th batch family `t` sends from now (1 is the next), as a lost connection would. */
function failBatch(t: string, n: number) {
  const d = db.db(t);
  const send = d.batch;
  let seenBatches = 0;
  d.batch = async (queries) => {
    if (++seenBatches === n) {
      d.batch = send;
      throw new Error('the connection was lost');
    }
    return send.call(d, queries);
  };
}
/** Collects console.error lines while `fn` runs. */
async function errorsDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try { await fn(); } finally { console.error = original; }
  return lines;
}

/** A vote-mode family with Ada's stag and Bo's eagle in the house's arms vote. */
async function stagAndEagle() {
  const t = await family('vote');
  const stag = await propose(t, ada, 'The stag', arms('stag'));
  const eagle = await propose(t, bo, 'The eagle', arms('eagle'), later(HOUR));
  assert.ok(stag.vote && eagle.vote === stag.vote);
  return { t, vote: stag.vote, stag: stag.id, eagle: eagle.id, o: await optionsOf(t, stag.vote) };
}

// ---------- outcomes ----------

test('a winning proposal\'s arms go to the house once, credited to the family\'s vote; it is accepted, the other not chosen', async () => {
  const { t, vote, stag, eagle, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!, o.keep!], later(2 * HOUR));
  await V.castBallot(t, member(bo), vote, [o[stag]!], later(2 * HOUR));
  await V.castBallot(t, member(eve), vote, [o.keep!], later(2 * HOUR));
  const historyBefore = (await houseHistory(t)).length;

  // Whoever's request runs it, the change is the family's vote's.
  actingAs({ account: 'acc-carl', name: 'Carl Cedar' });
  try {
    assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 0 });
  } finally {
    actingAs(undefined);
  }
  assert.deepEqual(await houseArms(t), arms('stag'));
  const v = await voteRow(t, vote);
  assert.equal(v?.closed_at, v?.closes_at, 'marked closed at its closing time');
  assert.equal(v?.settled_at, AFTER.toISOString());
  assert.deepEqual({ ...(await proposal(t, stag)) }, { status: 'accepted', reason: null, decided_by: null, decided_by_name: null, decided_at: AFTER.toISOString() });
  assert.deepEqual({ ...(await proposal(t, eagle)) }, { status: 'declined', reason: 'not_chosen', decided_by: null, decided_by_name: null, decided_at: AFTER.toISOString() });
  const history = await houseHistory(t);
  assert.equal(history.length, historyBefore + 1);
  assert.deepEqual({ ...history.at(-1)! }, { account: null, name: VOTE_AUTHOR, label: 'Birch', fn: 'settleArmsVote' });

  // Settled is settled: another run changes nothing.
  assert.deepEqual(await S.settleArmsVotes(t, later(DAY, AFTER)), { settled: 0, started: 0 });
  assert.equal((await houseHistory(t)).length, historyBefore + 1);
});

test('Keep winning, no ballots, or a tie leave the arms as they are; every proposal is not chosen; the arms are free again', async () => {
  const cases: [string, (t: string, vote: string, o: Record<string, string>, stag: string, eagle: string) => Promise<void>][] = [
    ['keep wins', async (t, vote, o, stag) => {
      await V.castBallot(t, member(carl), vote, [o.keep!], later(2 * HOUR));
      await V.castBallot(t, member(eve), vote, [o.keep!], later(2 * HOUR));
      await V.castBallot(t, member(bo), vote, [o[stag]!], later(2 * HOUR));
    }],
    ['no ballots', async () => {}],
    ['a tie between proposals', async (t, vote, o, stag, eagle) => {
      await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
      await V.castBallot(t, member(bo), vote, [o[eagle]!], later(2 * HOUR));
    }],
  ];
  for (const [name, ballots] of cases) {
    const { t, vote, stag, eagle, o } = await stagAndEagle();
    await ballots(t, vote, o, stag, eagle);
    const historyBefore = (await houseHistory(t)).length;
    assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 0 }, name);
    assert.deepEqual(await houseArms(t), ARMS, name);
    for (const p of [stag, eagle]) assert.deepEqual([(await proposal(t, p))?.status, (await proposal(t, p))?.reason], ['declined', 'not_chosen'], name);
    assert.ok((await voteRow(t, vote))?.settled_at, `${name}: settled, so the house is not frozen for ever`);
    assert.equal((await houseHistory(t)).length, historyBefore, `${name}: no change to the house`);
    await db.updateHouse(t, 'h1', { name: 'Birch', motto: 'Bend, not break', arms: arms('rose') }, await seen(t));
    assert.deepEqual(await houseArms(t), arms('rose'), `${name}: a steward saves new arms after it`);
  }
});

test('a struck guest\'s ballot does not count toward the winner', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, guest(1), vote, [o[stag]!], later(2 * HOUR));
  await V.castBallot(t, guest(2), vote, [o[stag]!], later(2 * HOUR));
  await V.castBallot(t, member(carl), vote, [o.keep!], later(2 * HOUR));
  const voters = await db.db(t).all<{ id: string }>('SELECT id FROM vote_voter WHERE vote = ? AND guest_key IS NOT NULL', vote);
  for (const x of voters) await V.strikeVoter(t, eve, vote, x.id, true, undefined, later(3 * HOUR));
  assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 0 });
  assert.deepEqual(await houseArms(t), ARMS, 'Keep won one to nothing once the guests were struck');
  assert.equal((await proposal(t, stag))?.status, 'declined');
});

test('a winner over arms that are no longer the ones the vote started from settles as no change, with one log line and no names', async () => {
  const { t, vote, stag, eagle, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  // The house's arms changed around the freeze (a write from before it, a restored backup): Keep's snapshot no longer holds.
  await db.db(t).run("UPDATE house SET arms = ? WHERE id = 'h1'", JSON.stringify(arms('rose')));
  const historyBefore = (await houseHistory(t)).length;
  const errors = await errorsDuring(async () => assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 0 }));
  assert.deepEqual(await houseArms(t), arms('rose'), 'the arms saved meanwhile are never overwritten');
  assert.equal((await voteRow(t, vote))?.settled_at, AFTER.toISOString(), 'settled, so it is not tried for ever');
  for (const p of [stag, eagle]) assert.deepEqual([(await proposal(t, p))?.status, (await proposal(t, p))?.reason], ['declined', 'not_chosen']);
  assert.equal((await houseHistory(t)).length, historyBefore);
  assert.equal(errors.length, 1);
  assert.doesNotMatch(errors[0]!, /Birch|stag|eagle|Ada|Bo |Carl|acc-|h1/);
  assert.deepEqual(await errorsDuring(async () => assert.deepEqual(await S.settleArmsVotes(t, later(DAY, AFTER)), { settled: 0, started: 0 })), []);
});

test('arms that differ from the snapshot only in how they are written still take the winner', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  await db.db(t).run("UPDATE house SET arms = ? WHERE id = 'h1'", JSON.stringify({ chargeTincture: 'or', charge: 'lion', division: 'plain', field: 'azure' }));
  assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 0 });
  assert.deepEqual(await houseArms(t), arms('stag'));
});

// ---------- two steps, once ----------

test('two settlements at once apply the vote once', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  const historyBefore = (await houseHistory(t)).length;
  const runs = await Promise.all([S.settleArmsVotes(t, AFTER), S.settleArmsVotes(t, AFTER)]);
  assert.equal(runs[0].settled + runs[1].settled, 1);
  assert.equal((await houseHistory(t)).length, historyBefore + 1);
  assert.deepEqual(await houseArms(t), arms('stag'));
});

test('a settlement landing between another\'s reads and its write makes that one find nothing to do, whatever the outcome', async () => {
  for (const outcome of ['a winner', 'no ballots']) {
    const { t, vote, stag, o } = await stagAndEagle();
    if (outcome === 'a winner') await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
    // Marked closed already (as a steward's close or a reader would), so the next batch is the settlement's own.
    await db.db(t).run('UPDATE vote SET closed_at = closes_at WHERE id = ?', vote);
    const historyBefore = (await houseHistory(t)).length;
    let inner: { settled: number; started: number } | undefined;
    beforeNextBatch(t, async () => { inner = await S.settleArmsVotes(t, AFTER); });
    const errors = await errorsDuring(async () => assert.deepEqual(await S.settleArmsVotes(t, later(HOUR, AFTER)), { settled: 0, started: 0 }, outcome));
    assert.deepEqual(inner, { settled: 1, started: 0 }, outcome);
    assert.deepEqual(errors, [], `${outcome}: the losing run is no failure`);
    assert.equal((await voteRow(t, vote))?.settled_at, AFTER.toISOString(), `${outcome}: settled by the first`);
    assert.equal((await houseHistory(t)).length, historyBefore + (outcome === 'a winner' ? 1 : 0), outcome);
    assert.equal((await proposal(t, stag))?.status, outcome === 'a winner' ? 'accepted' : 'declined', outcome);
  }
});

test('a settlement landing between another\'s read of the vote and its read of the house is no failure either', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  await db.db(t).run('UPDATE vote SET closed_at = closes_at WHERE id = ?', vote);
  // Just before the house-write plan reads the house, another run settles the vote (so the arms are no longer Keep's).
  const d = db.db(t);
  const get = d.get;
  let inner: { settled: number; started: number } | undefined;
  d.get = (async (sql: string, ...args: Parameters<typeof get>[1][]) => {
    if (sql.startsWith('SELECT name, motto, arms, founder FROM house')) {
      d.get = get;
      inner = await S.settleArmsVotes(t, AFTER);
    }
    return get.call(d, sql, ...args);
  }) as typeof d.get;
  const errors = await errorsDuring(async () => assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 0, started: 0 }));
  d.get = get;
  assert.deepEqual(inner, { settled: 1, started: 0 });
  assert.deepEqual(errors, []);
  assert.deepEqual(await houseArms(t), arms('stag'));
});

test('no ballot or strike lands after the close step, even with a clock from before the closing time', async () => {
  const { t, vote, stag, eagle, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 0 });
  const early = later(3 * HOUR);
  await assert.rejects(V.castBallot(t, member(bo), vote, [o[eagle]!], early), /votes\.err\.closed/);
  await assert.rejects(V.castBallot(t, guest(3), vote, [o[eagle]!], early), /votes\.err\.closed/);
  assert.equal((await db.db(t).get<{ n: number }>('SELECT count(*) AS n FROM ballot WHERE vote = ?', vote))?.n, 1);
  assert.deepEqual(await houseArms(t), arms('stag'));
});

test('reading the feed writes nothing: an arms vote past its closing time stays unmarked and unsettled', async () => {
  const { t, vote, stag } = await stagAndEagle();
  await F.feedPage(t, carl, null, undefined, AFTER);
  const v = await voteRow(t, vote);
  assert.equal(v?.closed_at, null);
  assert.equal(v?.settled_at, null);
  assert.equal((await proposal(t, stag))?.status, 'voting');
  assert.deepEqual(await houseArms(t), ARMS);
});

// ---------- the next vote ----------

test('in vote mode, settling starts the next vote with the waiting proposals, oldest first, declining any equal to the new arms', async () => {
  const t = await family('vote');
  const stag = await propose(t, ada, 'The stag', arms('stag'));
  const o = await optionsOf(t, stag.vote!);
  await V.castBallot(t, member(carl), stag.vote!, [o[stag.id]!], later(HOUR));
  // The vote has a ballot, so these wait.
  const twin = await propose(t, bo, 'Another stag', arms('stag'), later(2 * HOUR));
  const eagle = await propose(t, bo, 'The eagle', arms('eagle'), later(3 * HOUR));
  const rose = await propose(t, ada, 'The rose', arms('rose'), later(4 * HOUR));
  for (const p of [twin, eagle, rose]) assert.equal(p.vote, null);

  assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 1 });
  assert.deepEqual(await houseArms(t), arms('stag'));
  assert.deepEqual([(await proposal(t, twin.id))?.status, (await proposal(t, twin.id))?.reason], ['declined', 'not_chosen'], 'equal to the arms the house now bears');
  const [next, ...more] = await unsettled(t);
  assert.equal(more.length, 0);
  assert.notEqual(next!.id, stag.vote);
  assert.deepEqual([next!.account, next!.author_name], ['acc-bo', 'Bo Birch'], 'started for the proposer of the oldest');
  assert.equal(next!.closes_at, later(ARMS_VOTE_DAYS * DAY, AFTER).toISOString());
  assert.deepEqual(Object.keys(await optionsOf(t, next!.id)), ['keep', eagle.id, rose.id]);
  const keep = await db.db(t).get<{ arms: string }>('SELECT arms FROM vote_option WHERE vote = ? AND proposal IS NULL', next!.id);
  assert.deepEqual(JSON.parse(keep!.arms), arms('stag'), 'Keep shows the arms the last vote chose');
  for (const p of [eagle, rose]) assert.equal((await proposal(t, p.id))?.status, 'voting');
});

test('a chain start that failed is made by the next run, without the proposer\'s or the house\'s name in the log', async () => {
  const t = await family('vote');
  const stag = await propose(t, ada, 'The stag', arms('stag'));
  const o = await optionsOf(t, stag.vote!);
  await V.castBallot(t, member(carl), stag.vote!, [o[stag.id]!], later(HOUR));
  const eagle = await propose(t, bo, 'The eagle', arms('eagle'), later(2 * HOUR));
  // The batches: the close, the settlement, then the next vote's start, which fails.
  failBatch(t, 3);
  let first: { settled: number; started: number } | undefined;
  const errors = await errorsDuring(async () => { first = await S.settleArmsVotes(t, AFTER); });
  assert.deepEqual(first, { settled: 1, started: 0 });
  assert.equal(errors.length, 1);
  for (const name of ['Birch', 'Bo', 'Ada', 'eagle', 'stag', 'Alders']) assert.ok(!errors[0]!.includes(name), `the log names no ${name}`);
  assert.equal((await proposal(t, eagle.id))?.status, 'waiting');

  assert.deepEqual(await S.settleArmsVotes(t, later(HOUR, AFTER)), { settled: 0, started: 1 });
  assert.equal((await proposal(t, eagle.id))?.status, 'voting');
  assert.equal((await unsettled(t)).length, 1);
});

test('proposals left waiting by a switch to vote mode go to a vote; two runs at once start one', async () => {
  const t = await family('choose');
  const stag = await propose(t, ada, 'The stag', arms('stag'));
  const eagle = await propose(t, bo, 'The eagle', arms('eagle'), later(HOUR));
  assert.deepEqual(await S.settleArmsVotes(t, later(2 * HOUR)), { settled: 0, started: 0 }, 'choose mode starts nothing');
  await P.saveArmsSettings(t, eve, { mode: 'vote', guests: true });
  const runs = await Promise.all([S.settleArmsVotes(t, later(2 * HOUR)), S.settleArmsVotes(t, later(2 * HOUR))]);
  assert.equal(runs[0].started + runs[1].started, 1);
  const [v, ...more] = await unsettled(t);
  assert.equal(more.length, 0);
  assert.equal(v!.account, 'acc-ada');
  assert.deepEqual(Object.keys(await optionsOf(t, v!.id)), ['keep', stag.id, eagle.id]);
});

test('a proposal back from a removed vote is not started again by settlement', async () => {
  const t = await family('vote');
  const stag = await propose(t, ada, 'The stag', arms('stag'));
  await V.removeVote(t, eve, stag.vote!);
  assert.deepEqual([(await proposal(t, stag.id))?.status, (await proposal(t, stag.id))?.reason], ['waiting', 'vote_removed']);
  assert.deepEqual(await S.settleArmsVotes(t, later(HOUR)), { settled: 0, started: 0 });
  assert.equal((await unsettled(t)).length, 0);
  assert.equal((await proposal(t, stag.id))?.status, 'waiting');
});

// ---------- who settles ----------

test('the daily job settles without push keys', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  const lines: string[] = [];
  await votesJob.run({ trees: [t], now: AFTER, env: () => undefined, log: (m) => lines.push(m) });
  assert.deepEqual(await houseArms(t), arms('stag'));
  assert.ok((await voteRow(t, vote))?.settled_at);
  assert.deepEqual(lines, ['settled 1 arms votes and started 0', 'the VAPID keys are not set; no reminders sent']);
});

test('a member\'s read of the votes settles; a guest\'s, or a preview\'s, does not', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  await V.listVotes(t, guestReader, undefined, AFTER);
  await V.voteView(t, guestReader, vote, undefined, AFTER);
  assert.equal((await voteRow(t, vote))?.settled_at, null, 'a guest stores nothing');
  onRequestReadOnly(() => ({ code: 'forbidden', message: 'preview' }) as never);
  try {
    assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 0, started: 0 });
    await V.listVotes(t, reader(carl), undefined, AFTER);
  } finally {
    onRequestReadOnly(() => undefined);
  }
  assert.equal((await voteRow(t, vote))?.settled_at, null, 'a preview stores nothing');
  await V.listVotes(t, reader(carl), undefined, AFTER);
  assert.ok((await voteRow(t, vote))?.settled_at);
  assert.deepEqual(await houseArms(t), arms('stag'));
});

test('a member opening a closed arms vote settles it', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  await V.voteView(t, reader(bo), vote, undefined, AFTER);
  assert.ok((await voteRow(t, vote))?.settled_at);
  assert.deepEqual(await houseArms(t), arms('stag'));
});

test('a read that settled an arms vote says so (the page then reads the house again); the next read, or a guest\'s, does not', async () => {
  // A house's proposals.
  {
    const { t, vote, stag, o } = await stagAndEagle();
    await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
    const read = await P.houseProposals(t, bo, 'h1', AFTER);
    assert.equal(read.settled, true);
    assert.deepEqual(await houseArms(t), arms('stag'));
    assert.equal((await P.houseProposals(t, bo, 'h1', AFTER)).settled, false);
  }
  // One vote's page.
  {
    const { t, vote, stag, o } = await stagAndEagle();
    await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
    assert.equal((await V.voteView(t, guestReader, vote, undefined, AFTER))!.settled, false);
    assert.equal((await V.voteView(t, reader(bo), vote, undefined, AFTER))!.settled, true);
    assert.equal((await V.voteView(t, reader(bo), vote, undefined, AFTER))!.settled, false);
  }
  // The votes list.
  {
    const { t, vote, stag, o } = await stagAndEagle();
    await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
    assert.equal((await V.votesPage(t, guestReader, undefined, AFTER)).settled, false, 'a guest settles nothing');
    const page = await V.votesPage(t, reader(carl), undefined, AFTER);
    assert.equal(page.settled, true);
    assert.equal(page.votes.length, 1);
    assert.deepEqual(await houseArms(t), arms('stag'));
    assert.equal((await V.votesPage(t, reader(carl), undefined, AFTER)).settled, false);
  }
  // In vote mode, a read that starts the house's next vote says so too: its proposals are in a vote now.
  {
    const t = await family('choose');
    await propose(t, bo, 'The eagle', arms('eagle'));
    await P.saveArmsSettings(t, eve, { mode: 'vote', guests: true });
    assert.equal((await P.houseProposals(t, bo, 'h1', later(HOUR))).settled, true);
    assert.equal((await unsettled(t)).length, 1);
  }
});

test('a run with nothing due asks one cheap question and stops, as on every house page a member opens', async () => {
  const t = await family('vote');
  const { vote } = await propose(t, ada, 'The stag', arms('stag'));
  const d = db.db(t);
  const reads: string[] = [];
  const spied = { get: d.get, all: d.all, readBatch: d.readBatch };
  d.get = ((sql: string, ...p: never[]) => { reads.push(sql); return spied.get.call(d, sql, ...p); }) as typeof d.get;
  d.all = ((sql: string, ...p: never[]) => { reads.push(sql); return spied.all.call(d, sql, ...p); }) as typeof d.all;
  d.readBatch = ((qs: Parameters<typeof d.readBatch>[0]) => { reads.push('batch'); return spied.readBatch.call(d, qs); }) as typeof d.readBatch;
  try {
    // The vote runs for a week yet, and no proposal waits without one.
    assert.deepEqual(await S.settleArmsVotes(t, later(HOUR)), { settled: 0, started: 0 });
    assert.equal(reads.length, 1, `one read, not ${reads.length}`);
  } finally {
    Object.assign(d, spied);
  }
  // Once something is due, the run does its work.
  assert.deepEqual(await S.settleArmsVotes(t, AFTER), { settled: 1, started: 0 });
  assert.ok((await voteRow(t, vote!))?.settled_at);
});

test('a steward closing an arms vote early settles it at once', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  await V.closeVote(t, eve, vote, undefined, later(DAY));
  const v = await voteRow(t, vote);
  assert.equal(v?.closed_at, later(DAY).toISOString());
  assert.equal(v?.settled_at, later(DAY).toISOString());
  assert.deepEqual(await houseArms(t), arms('stag'));
});
