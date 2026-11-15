// node --test src/lib/arms-proposals/proposals.test.ts — proposing arms and settling a proposal by hand: the family's setting,
// who may propose and the limits (same arms, a name taken, three open per member), withdrawing and declining (only while
// waiting or in a vote without a ballot; a ballotless vote that loses its last proposal goes), a steward's Accept (through
// the house-write plan, so the freeze applies), putting a proposal to a vote (starting the house's arms vote or joining it
// while it has no ballot and fewer than nineteen proposals), and the votes rules for an arms vote: only a steward closes,
// changes the closing time or removes it, nobody adds an option, and removing it returns its proposals. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { Reader } from '../auth/guard.server.ts';
import type { House } from '../types.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-arms-proposals-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('../votes/votes.server.ts')>('/src/lib/votes/votes.server.ts');
const P = await load<typeof import('./proposals.server.ts')>('/src/lib/arms-proposals/proposals.server.ts');
const { MAX_OPEN_PER_MEMBER, MAX_PROPOSALS_PER_VOTE, ARMS_VOTE_DAYS, MAX_PROPOSAL_NAME, MAX_PROPOSAL_NOTE, MAX_DECLINE_REASON } =
  await load<typeof import('./types.ts')>('/src/lib/arms-proposals/types.ts');
const { MAX_VOTES_AN_HOUR } = await load<typeof import('../votes/types.ts')>('/src/lib/votes/types.ts');
const { asV2, storeV2 } = await load<typeof import('../heraldry/convert.ts')>('/src/lib/heraldry/convert.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
const NOW = new Date('2026-11-15T10:00:00.000Z');
const DAY = 86_400_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);

const ARMS: House['arms'] = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' };
type Arms = House['arms'];
const arms = (charge: Arms['charge'], field: Arms['field'] = 'gules'): Arms => ({ field, division: 'plain', charge, chargeTincture: 'or' });
const CHARGES: Arms['charge'][] = ['boar', 'crescent', 'eagle', 'fleur', 'key', 'rose', 'stag', 'star', 'sword', 'tower'];
/** The `i`th of many different designs, none of them the house's. */
const design = (i: number) => arms(CHARGES[i % CHARGES.length]!, (['gules', 'vert', 'sable'] as const)[Math.floor(i / CHARGES.length)]);

let families = 0;
/** A fresh family for one test, with Ada in its tree and House Birch bearing a gold lion on blue. */
async function family(mode?: 'steward' | 'vote' | 'choose'): Promise<string> {
  const id = `arms${++families}`;
  await db.store.ensureTree(id);
  const d = db.db(id);
  await d.run("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', 'The Alders') ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
  await d.run("INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1950', 1)");
  await d.run("INSERT INTO house (id, name, motto, arms) VALUES ('h1', 'Birch', 'Bend, not break', ?)", JSON.stringify(ARMS));
  if (mode) await d.run("INSERT INTO meta (key, value) VALUES ('arms_mode', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", mode);
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
const reader = (w: ReturnType<typeof who>): Reader => ({
  user: { id: w.id, name: w.name, email: null, handle: w.id, created: 0, last_seen: null, locale: null },
  role: w.role, person: w.person, personConfirmed: w.personConfirmed, guest: false, protectLiving: false,
});
const forbidden = /permission/;

const propose = (t: string, w: ReturnType<typeof who>, name: string, a: House['arms'] = arms('stag'), at = NOW, note?: string) =>
  P.proposeArms(t, w, 'h1', { name, note, arms: a }, undefined, at);
const row = (t: string, id: string) => db.db(t).get<{ status: string; reason: string | null; decided_by: string | null; decided_by_name: string | null; decided_at: string | null; arms: string; name: string; note: string; author_person: string | null }>('SELECT * FROM arms_proposal WHERE id = ?', id);
const houseArms = async (t: string) => JSON.parse((await db.db(t).get<{ arms: string }>("SELECT arms FROM house WHERE id = 'h1'"))!.arms) as House['arms'];
const seen = async (t: string) => {
  const h = (await db.db(t).get<{ name: string; motto: string | null; arms: string }>("SELECT name, motto, arms FROM house WHERE id = 'h1'"))!;
  return { name: h.name, motto: h.motto, arms: JSON.parse(h.arms) };
};
const armsVotes = (t: string) => db.db(t).all<{ id: string; account: string; question: string; kind: string; secret: number; guests: number; add_options: number; closes_at: string; subject_kind: string; subject: string }>("SELECT * FROM vote WHERE subject_kind = 'house'");
const options = (t: string, vote: string) => db.db(t).all<{ id: string; label: string; proposal: string | null; arms: string | null; ord: number }>('SELECT id, label, proposal, arms, ord FROM vote_option WHERE vote = ? ORDER BY ord', vote);
const count = async (t: string, table: string, where = '1 = 1') => (await db.db(t).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
/** Members enough to put `n` proposals up, three each. */
const crowd = (n: number) => Array.from({ length: Math.ceil(n / MAX_OPEN_PER_MEMBER) }, (_, i) => who(`acc-m${i}`, `Member ${i}`, 'contributor'));
/** Runs `between` just before the next batch family `t` sends: a change landing between a plan's reads and its write. */
function beforeNextBatch(t: string, between: () => Promise<unknown>) {
  const d = db.db(t);
  const send = d.batch;
  d.batch = async (queries) => {
    d.batch = send;
    await between();
    return send.call(d, queries);
  };
}

// ---------- the family's setting ----------

test('the setting defaults to "steward chooses" with guests; only a steward changes it, and the change is in the history', async () => {
  const t = await family();
  assert.deepEqual(await P.armsSettings(t), { mode: 'choose', guests: true });
  await assert.rejects(P.saveArmsSettings(t, dee, { mode: 'vote', guests: false }), forbidden);
  await assert.rejects(P.saveArmsSettings(t, eve, { mode: 'everyone' as 'vote', guests: false }), /arms\.err\.settings/);
  await P.saveArmsSettings(t, eve, { mode: 'vote', guests: false });
  assert.deepEqual(await P.armsSettings(t), { mode: 'vote', guests: false });
  const h = await db.db(t).get<{ kind: string; record: string; fn: string }>('SELECT kind, record, fn FROM history ORDER BY id DESC LIMIT 1');
  assert.deepEqual({ ...h }, { kind: 'family', record: 'arms_settings', fn: 'saveArmsSettings' });
  await P.saveArmsSettings(t, eve, { mode: 'steward', guests: true });
  assert.deepEqual(await P.armsSettings(t), { mode: 'steward', guests: true });
});

// ---------- proposing ----------

test('a contributor proposes arms, stored normalised and waiting; a viewer or a guest may not', async () => {
  const t = await family('choose');
  const { id, vote } = await propose(t, ada, '  The   stag ', { ...arms('stag'), field2: 'argent' }, NOW, ' A stag for the woods ');
  assert.equal(vote, null);
  const r = await row(t, id);
  assert.equal(r?.status, 'waiting');
  assert.equal(r?.name, 'The stag');
  assert.equal(r?.note, 'A stag for the woods');
  assert.equal(r?.author_person, 'ada');
  // A plain field keeps no second tincture: the steward's normaliser.
  assert.deepEqual(JSON.parse(r!.arms), arms('stag'));
  await assert.rejects(propose(t, carl, 'Carl’s'), forbidden);
  await assert.rejects(propose(t, guestWho as never, 'A guest’s'), /access/i);
  await assert.rejects(propose(t, ada, ' '), /arms\.err\.name/);
  await assert.rejects(propose(t, ada, 'x'.repeat(MAX_PROPOSAL_NAME + 1)), /arms\.err\.name/);
  await assert.rejects(propose(t, ada, 'Long note', arms('key'), NOW, 'x'.repeat(MAX_PROPOSAL_NOTE + 1)), /arms\.err\.note/);
  await assert.rejects(P.proposeArms(t, ada, 'nowhere', { name: 'Lost', arms: arms('key') }), /arms\.err\.gone/);
});

test('a proposal equal to the current arms, or named like another open one, is refused', async () => {
  const t = await family('choose');
  await assert.rejects(propose(t, ada, 'The lion', { ...ARMS, field2: 'argent' }), /arms\.err\.same/);
  // The designer sends its design (v2): the house's v1 arms read as v2 are the same arms.
  await assert.rejects(propose(t, ada, 'The lion', storeV2(asV2(ARMS))), /arms\.err\.same/);
  const { id } = await propose(t, ada, 'The stag');
  await assert.rejects(propose(t, bo, ' THE STAG '), /arms\.err\.name_taken/);
  // A closed proposal's name is free again.
  await P.withdrawProposal(t, ada, id);
  await propose(t, bo, 'The stag');
});

test('a proposal named like the vote’s Keep option, in any language and any case, is refused', async () => {
  const t = await family('choose');
  // English, German and Japanese Keep labels: the vote would show two options that read alike.
  for (const name of ['Keep our current arms', ' KEEP OUR CURRENT ARMS ', 'unser jetziges wappen behalten', '今の紋章のままにします']) {
    await assert.rejects(propose(t, ada, name), /arms\.err\.name_taken/, name);
  }
  await propose(t, ada, 'Keep the stag');
});

test('a member has at most three open proposals per house; a withdrawn one frees a place', async () => {
  const t = await family('choose');
  const ids = [];
  for (let i = 0; i < MAX_OPEN_PER_MEMBER; i++) ids.push((await propose(t, ada, `Design ${i}`, design(i))).id);
  await assert.rejects(propose(t, ada, 'One more', arms('key')), /arms\.err\.too_many/);
  await propose(t, bo, 'Bo’s', arms('key'));
  await P.withdrawProposal(t, ada, ids[0]!);
  await propose(t, ada, 'One more', arms('tower'));
});

test('two proposals of the same name sent at once: the second is refused', async () => {
  const t = await family('choose');
  beforeNextBatch(t, () => propose(t, bo, 'The stag', arms('stag', 'vert')));
  await assert.rejects(propose(t, ada, 'the stag'), /arms\.err\.name_taken/);
  assert.equal(await count(t, 'arms_proposal'), 1);
});

// ---------- vote mode ----------

test('in vote mode a proposal starts the house’s arms vote: ranked, secret, seven days, Keep with a snapshot', async () => {
  const t = await family('vote');
  await db.db(t).run("INSERT INTO meta (key, value) VALUES ('arms_vote_guests', '0')");
  const { id, vote } = await propose(t, ada, 'The stag');
  const [v] = await armsVotes(t);
  assert.equal(vote, v!.id);
  assert.equal(v!.subject, 'h1');
  assert.equal(v!.account, ada.id);
  assert.equal(v!.question, 'Which arms should House Birch bear?');
  assert.deepEqual([v!.kind, v!.secret, v!.guests, v!.add_options], ['ranked', 1, 0, 0]);
  assert.equal(v!.closes_at, later(ARMS_VOTE_DAYS * DAY).toISOString());
  const [keep, stag] = await options(t, v!.id);
  assert.equal(keep!.label, 'Keep our current arms');
  assert.equal(keep!.proposal, null);
  assert.deepEqual(JSON.parse(keep!.arms!), ARMS);
  assert.deepEqual([stag!.label, stag!.proposal, stag!.arms], ['The stag', id, null]);
  assert.equal((await row(t, id))?.status, 'voting');

  // The next joins while nobody has voted; after a ballot the one after waits.
  const second = await propose(t, bo, 'The oak', arms('key'));
  assert.equal(second.vote, v!.id);
  assert.equal((await options(t, v!.id)).length, 3);
  await V.castBallot(t, member(carl), v!.id, [stag!.id], later(1000));
  const third = await propose(t, bo, 'The bee', arms('rose'), later(2000));
  assert.equal(third.vote, null);
  assert.equal((await row(t, third.id))?.status, 'waiting');
  assert.equal(await count(t, 'vote'), 1);
});

test('guests take part in an arms vote by default', async () => {
  const t = await family('vote');
  await propose(t, ada, 'The stag');
  assert.equal((await armsVotes(t))[0]!.guests, 1);
});

test('starting a vote counts as no ordinary vote: the proposer still has their hourly votes', async () => {
  const t = await family('vote');
  await propose(t, ada, 'The stag');
  const input = { question: 'Where?', kind: 'single' as const, secret: false, addOptions: false, guests: false, closesAt: later(DAY).toISOString(), options: ['A', 'B'] };
  for (let i = 0; i < MAX_VOTES_AN_HOUR; i++) await V.createVote(t, ada, input, undefined, NOW);
  await assert.rejects(V.createVote(t, ada, input, undefined, NOW), /votes\.err\.too_many/);
});

// ---------- putting to a vote ----------

test('a steward puts a waiting proposal to a vote in choose mode; not in steward mode, and not as a contributor', async () => {
  const t = await family('steward');
  const { id } = await propose(t, ada, 'The stag');
  await assert.rejects(P.putToVote(t, eve, id, undefined, NOW), /arms\.err\.mode/);
  await P.saveArmsSettings(t, eve, { mode: 'choose', guests: true });
  await assert.rejects(P.putToVote(t, ada, id, undefined, NOW), forbidden);
  await assert.rejects(P.putToVote(t, dee, id, undefined, NOW), forbidden);
  const { vote } = await P.putToVote(t, eve, id, undefined, NOW);
  const [v] = await armsVotes(t);
  assert.equal(vote, v!.id);
  assert.equal(v!.account, eve.id);
  assert.equal((await row(t, id))?.status, 'voting');
  // Already in a vote: not again.
  await assert.rejects(P.putToVote(t, eve, id, undefined, NOW), /arms\.err\.state/);
  // A second joins it.
  const b = await propose(t, bo, 'The oak', arms('key'));
  assert.equal((await P.putToVote(t, eve, b.id, undefined, NOW)).vote, v!.id);
});

test('joining is refused after the first ballot and at nineteen proposals; one landing meanwhile is caught', async () => {
  const t = await family('choose');
  const members = crowd(MAX_PROPOSALS_PER_VOTE + 1);
  const ids: string[] = [];
  for (let i = 0; i <= MAX_PROPOSALS_PER_VOTE; i++) ids.push((await propose(t, members[Math.floor(i / MAX_OPEN_PER_MEMBER)]!, `Design ${i}`, design(i))).id);
  for (const id of ids.slice(0, MAX_PROPOSALS_PER_VOTE)) await P.putToVote(t, eve, id, undefined, NOW);
  const [v] = await armsVotes(t);
  assert.equal((await options(t, v!.id)).length, MAX_PROPOSALS_PER_VOTE + 1);
  await assert.rejects(P.putToVote(t, eve, ids[MAX_PROPOSALS_PER_VOTE]!, undefined, NOW), /arms\.err\.vote_busy/);
  assert.equal((await row(t, ids[MAX_PROPOSALS_PER_VOTE]!))?.status, 'waiting');

  const u = await family('choose');
  const a = await propose(u, ada, 'The stag');
  const b = await propose(u, bo, 'The oak', arms('key'));
  const { vote } = await P.putToVote(u, eve, a.id, undefined, NOW);
  const [keep] = await options(u, vote);
  // A ballot lands between the plan's reads and its batch: the plan decides again and refuses.
  beforeNextBatch(u, () => V.castBallot(u, member(carl), vote, [keep!.id], later(1000)));
  await assert.rejects(P.putToVote(u, eve, b.id, undefined, later(500)), /arms\.err\.vote_busy/);
  assert.equal((await options(u, vote)).length, 2);
  assert.equal((await row(u, b.id))?.status, 'waiting');
});

test('two steward requests starting the house’s vote at once start one vote', async () => {
  const t = await family('choose');
  const a = await propose(t, ada, 'The stag');
  const b = await propose(t, bo, 'The oak', arms('key'));
  beforeNextBatch(t, () => P.putToVote(t, eve, b.id, undefined, NOW));
  await P.putToVote(t, eve, a.id, undefined, NOW);
  assert.equal(await count(t, 'vote'), 1);
  assert.equal((await options(t, (await armsVotes(t))[0]!.id)).length, 3);
});

test('a proposal whose arms the house now bears cannot be put to a vote or accepted', async () => {
  const t = await family('choose');
  const { id } = await propose(t, ada, 'The stag');
  await db.updateHouse(t, 'h1', { ...(await seen(t)), arms: arms('stag') }, await seen(t));
  await assert.rejects(P.putToVote(t, eve, id, undefined, NOW), /arms\.err\.same/);
  await assert.rejects(P.acceptProposal(t, eve, id, await seen(t)), /arms\.err\.same/);
});

// ---------- accepting ----------

test('a steward accepts a proposal in steward or choose mode: the house takes its arms, the history names the house only', async () => {
  const t = await family('steward');
  const { id } = await propose(t, ada, 'The stag');
  await assert.rejects(P.acceptProposal(t, ada, id, await seen(t)), forbidden);
  const stale = { ...(await seen(t)), arms: arms('rose') };
  await assert.rejects(P.acceptProposal(t, eve, id, stale), (e: Error) => e.message === db.HOUSE_CHANGED);
  await P.acceptProposal(t, eve, id, await seen(t));
  assert.deepEqual(await houseArms(t), arms('stag'));
  const r = await row(t, id);
  assert.deepEqual([r?.status, r?.decided_by, r?.decided_by_name], ['accepted', eve.id, 'Eve Elm']);
  assert.ok(r?.decided_at);
  const h = await db.db(t).get<{ kind: string; record: string; label: string }>('SELECT kind, record, label FROM history ORDER BY id DESC LIMIT 1');
  assert.deepEqual({ ...h }, { kind: 'house', record: 'h1', label: 'Birch' });
  // Decided: not again.
  await assert.rejects(P.acceptProposal(t, eve, id, await seen(t)), /arms\.err\.state/);

  const w = await family('steward');
  const p = await propose(w, ada, 'The stag');
  await P.saveArmsSettings(w, eve, { mode: 'vote', guests: true });
  // A proposal left waiting by a switch to vote mode gets vote mode's actions: no Accept.
  await assert.rejects(P.acceptProposal(w, eve, p.id, await seen(w)), /arms\.err\.mode/);
});

test('accepting while the house’s arms vote runs is refused: the arms are frozen', async () => {
  const t = await family('choose');
  const a = await propose(t, ada, 'The stag');
  const b = await propose(t, bo, 'The oak', arms('key'));
  await P.putToVote(t, eve, a.id, undefined, NOW);
  await assert.rejects(P.acceptProposal(t, eve, b.id, await seen(t)), /arms\.err\.frozen/);
  assert.deepEqual(await houseArms(t), ARMS);
  assert.equal((await row(t, b.id))?.status, 'waiting');
});

// ---------- withdrawing and declining ----------

test('a proposer withdraws their own; a steward declines with a reason; neither once decided', async () => {
  const t = await family('choose');
  const a = await propose(t, ada, 'The stag');
  const b = await propose(t, ada, 'The oak', arms('key'));
  await assert.rejects(P.withdrawProposal(t, bo, a.id), /arms\.err\.not_yours/);
  await assert.rejects(P.declineProposal(t, dee, a.id), forbidden);
  await P.withdrawProposal(t, ada, a.id);
  assert.equal((await row(t, a.id))?.status, 'withdrawn');
  await assert.rejects(P.withdrawProposal(t, ada, a.id), /arms\.err\.state/);
  await assert.rejects(P.declineProposal(t, eve, b.id, 'x'.repeat(MAX_DECLINE_REASON + 1)), /arms\.err\.reason/);
  await P.declineProposal(t, eve, b.id, '  Too like the Cedars’ ');
  const r = await row(t, b.id);
  assert.deepEqual([r?.status, r?.reason, r?.decided_by, r?.decided_by_name], ['declined', 'Too like the Cedars’', eve.id, 'Eve Elm']);
  await assert.rejects(P.declineProposal(t, eve, b.id), /arms\.err\.state/);
  await assert.rejects(P.withdrawProposal(t, ada, b.id), /arms\.err\.state/);
});

test('leaving a ballotless vote takes the option out; the last proposal leaving removes the vote; after a ballot, neither', async () => {
  const t = await family('vote');
  const a = await propose(t, ada, 'The stag');
  const b = await propose(t, bo, 'The oak', arms('key'));
  const [v] = await armsVotes(t);
  await P.withdrawProposal(t, ada, a.id);
  assert.deepEqual((await options(t, v!.id)).map((o) => o.proposal), [null, b.id]);
  await P.declineProposal(t, eve, b.id, 'Not now');
  assert.equal(await count(t, 'vote'), 0);
  assert.equal(await count(t, 'vote_option'), 0);
  assert.equal((await row(t, b.id))?.status, 'declined');

  const u = await family('vote');
  const c = await propose(u, ada, 'The stag');
  const d = await propose(u, bo, 'The oak', arms('key'));
  const [w] = await armsVotes(u);
  const [keep] = await options(u, w!.id);
  await V.castBallot(u, member(carl), w!.id, [keep!.id], later(1000));
  await assert.rejects(P.withdrawProposal(u, ada, c.id), /arms\.err\.locked/);
  await assert.rejects(P.declineProposal(u, eve, d.id), /arms\.err\.locked/);
  assert.equal((await row(u, c.id))?.status, 'voting');
});

test('a proposal in a vote that has closed is no longer withdrawn or declined', async () => {
  const t = await family('vote');
  const a = await propose(t, ada, 'The stag');
  const after = later(ARMS_VOTE_DAYS * DAY + 1000);
  await assert.rejects(P.withdrawProposal(t, ada, a.id, undefined, after), /arms\.err\.locked/);
  await assert.rejects(P.declineProposal(t, eve, a.id, undefined, undefined, after), /arms\.err\.locked/);
});

// ---------- the arms vote under the votes rules ----------

test('the proposer who started an arms vote, or an editor, cannot close, change or remove it; a steward can', async () => {
  const t = await family('vote');
  await propose(t, ada, 'The stag');
  const [v] = await armsVotes(t);
  const id = v!.id;
  await assert.rejects(V.closeVote(t, ada, id, undefined, NOW), forbidden);
  await assert.rejects(V.closeVote(t, dee, id, undefined, NOW), forbidden);
  await assert.rejects(V.editVote(t, ada, id, { closesAt: later(3 * DAY).toISOString() }, undefined, NOW), forbidden);
  await assert.rejects(V.editVote(t, dee, id, { closesAt: later(3 * DAY).toISOString() }, undefined, NOW), forbidden);
  await assert.rejects(V.removeVote(t, ada, id), forbidden);
  await assert.rejects(V.removeVote(t, dee, id), forbidden);
  await assert.rejects(V.addOption(t, ada, id, 'A lion again', undefined, NOW), /votes\.err\.locked/);
  await assert.rejects(V.addOption(t, eve, id, 'A lion again', undefined, NOW), /votes\.err\.locked/);

  // A steward changes only the closing time.
  await assert.rejects(V.editVote(t, eve, id, { question: 'Something else?' }, undefined, NOW), /votes\.err\.locked/);
  await assert.rejects(V.editVote(t, eve, id, { secret: false }, undefined, NOW), /votes\.err\.locked/);
  await V.editVote(t, eve, id, { closesAt: later(3 * DAY).toISOString() }, undefined, NOW);
  assert.equal((await armsVotes(t))[0]!.closes_at, later(3 * DAY).toISOString());

  for (const w of [ada, dee, carl]) {
    const view = await V.voteView(t, reader(w), id, undefined, later(1000));
    assert.deepEqual(view?.may, { edit: false, close: false, remove: false, addOption: false, strike: false }, w.name);
  }
  const steward = await V.voteView(t, reader(eve), id, undefined, later(1000));
  assert.deepEqual(steward?.may, { edit: true, close: true, remove: true, addOption: false, strike: true });

  await V.closeVote(t, eve, id, undefined, later(2000));
  assert.ok((await db.db(t).get<{ closed_at: string | null }>('SELECT closed_at FROM vote WHERE id = ?', id))?.closed_at);
});

test('removing an unsettled arms vote returns its proposals to waiting, marked; a settled one keeps their outcomes', async () => {
  const t = await family('choose');
  const a = await propose(t, ada, 'The stag');
  const b = await propose(t, bo, 'The oak', arms('key'));
  const { vote } = await P.putToVote(t, eve, a.id, undefined, NOW);
  await P.putToVote(t, eve, b.id, undefined, NOW);
  await V.castBallot(t, member(carl), vote, [(await options(t, vote))[1]!.id], later(1000));
  await V.removeVote(t, eve, vote);
  assert.equal(await count(t, 'vote'), 0);
  for (const id of [a.id, b.id]) assert.deepEqual([(await row(t, id))?.status, (await row(t, id))?.reason], ['waiting', 'vote_removed']);
  // Putting it to a vote again clears the mark.
  await P.putToVote(t, eve, a.id, undefined, later(2000));
  assert.deepEqual([(await row(t, a.id))?.status, (await row(t, a.id))?.reason], ['voting', null]);

  const u = await family('choose');
  const c = await propose(u, ada, 'The stag');
  const { vote: settled } = await P.putToVote(u, eve, c.id, undefined, NOW);
  // As a settlement leaves it: closed, settled, its proposal decided.
  await db.db(u).run('UPDATE vote SET closed_at = ?, settled_at = ? WHERE id = ?', NOW.toISOString(), NOW.toISOString(), settled);
  await db.db(u).run("UPDATE arms_proposal SET status = 'declined', reason = 'not_chosen' WHERE id = ?", c.id);
  await V.removeVote(u, eve, settled);
  assert.deepEqual([(await row(u, c.id))?.status, (await row(u, c.id))?.reason], ['declined', 'not_chosen']);
  assert.deepEqual(await houseArms(u), ARMS);
});

test('a proposal from a removed vote may be withdrawn or declined while waiting', async () => {
  const t = await family('choose');
  const a = await propose(t, ada, 'The stag');
  const { vote } = await P.putToVote(t, eve, a.id, undefined, NOW);
  await V.removeVote(t, eve, vote);
  await P.declineProposal(t, eve, a.id);
  assert.deepEqual([(await row(t, a.id))?.status, (await row(t, a.id))?.reason], ['declined', null]);
});
