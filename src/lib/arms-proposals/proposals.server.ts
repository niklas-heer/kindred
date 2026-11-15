// Arms proposals on the server (tree migration 0038): the family's setting, proposing arms for a house, withdrawing and
// declining a proposal, a steward's Accept, and putting a proposal to the house's arms vote. Settling a vote is
// settle.server.ts; what each reader sees comes later.
//
//   propose-arms  contributor  propose arms for a house; withdraw your own
//   edit-house    steward      accept, decline, put to a vote; change the family's setting
//
// What it promises:
// - A proposal is the family talking, not a record: it writes no change history (NOT_A_RECORD). Accept writes the house's
//   change through the house-write plan (`houseWritePlan`), so the arms freeze holds and the history names the house only.
// - The setting decides the actions when they are taken, not when the proposal was made: steward mode is Accept and
//   Decline; vote mode puts each new proposal to a vote and leaves Decline and Put to a vote; choose mode has all three.
// - A house has at most one unsettled arms vote. A proposal joins it only while it is open, has no ballot and fewer than
//   nineteen proposals; otherwise one starts when none exists, else the proposal waits (or Put to a vote is refused).
//   `status = 'voting'` is written in the batch that inserts the proposal's option; leaving a vote (withdraw, decline) is
//   allowed only while the vote is open with no ballot, and the last proposal leaving a vote removes the vote.
// - Every check that another request could undo meanwhile is restated as a guard in the batch, so the plan decides again.
// - Errors are translation keys (`arms.err.*`), translated where they are shown:
//     gone        the house or the proposal is not there      same       the design equals the house's current arms
//     name        the design's name is empty or too long      note       the note is too long
//     reason      the decline's reason is too long            settings   the setting is not one of the modes
//     name_taken  another open proposal has the name          too_many   the member has three open for the house
//     not_yours   only its proposer withdraws a proposal      state      the proposal is not waiting (or no longer open)
//     mode        the family's setting does not offer that    vote_busy  the house's arms vote takes no more proposals
//     locked      its vote has a ballot or has closed         frozen     (the house-write plan) a vote holds the arms
import { fail } from '../auth/guard.server';
import { forbidden } from '../auth/errors';
import { canonical, change, db, guard, houseWritePlan, normalArms, NOT_A_RECORD, once, q, type Db, type HouseSeen, type OpKey, type Query } from '../db.server';
import { needsMember, type Who } from '../feed/posts.server';
import { cleanComment } from '../responses';
import { can, needs as lowestRole, type Action } from '../roles';
import type { House } from '../types';
import { removeVoteWrites } from '../votes/votes.server';
import {
  ARMS_VOTE_DAYS, MAX_DECLINE_REASON, MAX_OPEN_PER_MEMBER, MAX_PROPOSAL_NAME, MAX_PROPOSAL_NOTE, MAX_PROPOSALS_PER_VOTE,
  type ArmsMode, type ProposalStatus,
} from './types';

/** An arms vote's question as stored: the English fallback, which the reads translate for each reader. */
export const armsQuestion = (house: string) => `Which arms should House ${house} bear?`;
/** The "keep" option's label as stored, in English (translated where read). */
export const KEEP_LABEL = 'Keep our current arms';

const DAY_MS = 86_400_000;
const MODES: readonly ArmsMode[] = ['steward', 'vote', 'choose'];
/** The person column's value: the id when that person is in the tree, else NULL. */
const PERSON = '(SELECT id FROM person WHERE id = ?)';
const OPEN_STATUS = "status IN ('waiting', 'voting')";
/** The house's (`?`) unsettled arms vote. */
const UNSETTLED = "subject_kind = 'house' AND subject = ? AND settled_at IS NULL";

const personOf = (p: string | null | undefined) => (p && p !== '-' ? p : null);
const oneLine = (text: string) => cleanComment(text).replace(/\s+/g, ' ').trim();
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameArms = (a: unknown, b: unknown) => canonical(a) === canonical(b);

function needs(who: Who, action: Action) {
  needsMember(who);
  if (!can(who.role, action)) throw fail(forbidden(action, lowestRole(action)));
}

// ---------- the family's setting ----------

export interface ArmsSettings { mode: ArmsMode; guests: boolean }

/** The setting as stored (`stored` is the raw mode, for a guard), with the defaults: choose, and guests may vote. */
async function settingsIn(d: Db): Promise<ArmsSettings & { stored: string | null }> {
  const rows = await d.all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key IN ('arms_mode', 'arms_vote_guests')");
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const stored = m.get('arms_mode') ?? null;
  return { mode: MODES.includes(stored as ArmsMode) ? (stored as ArmsMode) : 'choose', guests: m.get('arms_vote_guests') !== '0', stored };
}
/** A guard: the mode is still as read, so an action the mode allowed is not taken after a steward changed it. */
const sameMode = (stored: string | null) => guard("(SELECT value FROM meta WHERE key = 'arms_mode') IS ?", stored);

/** How the family settles arms proposals, and whether guests vote on arms. */
export async function armsSettings(tree: string): Promise<ArmsSettings> {
  const { mode, guests } = await settingsIn(db(tree));
  return { mode, guests };
}

/** Changes the family's setting (a steward). `meta` is a record, so the change is in the history. */
export async function saveArmsSettings(tree: string, who: Who, s: ArmsSettings, op?: OpKey): Promise<void> {
  needs(who, 'edit-house');
  if (!MODES.includes(s.mode) || typeof s.guests !== 'boolean') throw new Error('arms.err.settings');
  return once(tree, op, 'saveArmsSettings', async (d) => {
    const had = await settingsIn(d);
    const family = (await d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value ?? tree;
    return {
      writes: [
        guard("EXISTS (SELECT 1 FROM meta WHERE key = 'id')"),
        q("INSERT INTO meta (key, value) VALUES ('arms_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", s.mode),
        q("INSERT INTO meta (key, value) VALUES ('arms_vote_guests', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", s.guests ? '1' : '0'),
      ],
      history: change('family', 'arms_settings', { arms_mode: had.mode, arms_vote_guests: had.guests ? 1 : 0 }, { arms_mode: s.mode, arms_vote_guests: s.guests ? 1 : 0 }, { label: family }),
      result: undefined,
    };
  });
}

// ---------- reads a plan decides on ----------

interface ProposalRow { id: string; house: string; account: string; name: string; arms: string; status: ProposalStatus }
async function proposalOf(d: Db, id: string): Promise<ProposalRow> {
  const row = await d.get<ProposalRow>('SELECT id, house, account, name, arms, status FROM arms_proposal WHERE id = ?', id);
  if (!row) throw new Error('arms.err.gone');
  return row;
}
interface HouseRow { name: string; arms: string }
async function houseOf(d: Db, id: string): Promise<HouseRow> {
  const row = await d.get<HouseRow>('SELECT name, arms FROM house WHERE id = ?', id);
  if (!row) throw new Error('arms.err.gone');
  return row;
}
/** A vote as leaving or joining it needs it: open, with a ballot, and how many proposals it has. */
interface ArmsVoteRow { id: string; closes_at: string; closed_at: string | null; ballots: number; proposals: number }
const ARMS_VOTE_COLUMNS = `v.id AS id, v.closes_at AS closes_at, v.closed_at AS closed_at, EXISTS (SELECT 1 FROM ballot b WHERE b.vote = v.id) AS ballots,
  (SELECT count(*) FROM vote_option o WHERE o.vote = v.id AND o.proposal IS NOT NULL) AS proposals`;
const isOpen = (v: ArmsVoteRow, at: string) => !v.closed_at && v.closes_at > at;

/** A guard: the house's arms are still as read (the "same arms" check and the "keep" snapshot were decided on them). */
const sameHouseArms = (house: string, arms: string) => guard('EXISTS (SELECT 1 FROM house WHERE id = ? AND arms = ?)', house, arms);

// ---------- putting to a vote ----------

/** Who a vote is started by: shown as its starter, granting nothing. `person` only when confirmed. */
export interface Starter { id: string; name: string; person: string | null }
const starterOf = (who: Who): Starter => ({ id: who.id, name: who.name, person: who.personConfirmed ? personOf(who.person) : null });

/**
 * One waiting proposal of this house into the vote: still waiting and in no unsettled vote (guarded), its option labelled
 * with its name and credited to its proposer, and its status `voting` (a `vote_removed` mark cleared) in the same batch.
 */
const joinWrites = (vote: string, house: string, proposal: string, at: string): Query[] => [
  guard("EXISTS (SELECT 1 FROM arms_proposal WHERE id = ? AND house = ? AND status = 'waiting')", proposal, house),
  guard('NOT EXISTS (SELECT 1 FROM vote_option o JOIN vote v ON v.id = o.vote WHERE o.proposal = ? AND v.settled_at IS NULL)', proposal),
  q(`INSERT INTO vote_option (id, vote, ord, label, added_by_account, added_by_name, created_at, proposal)
     SELECT ?, ?, (SELECT coalesce(max(ord), -1) + 1 FROM vote_option WHERE vote = ?), name, account, author_name, ?, id FROM arms_proposal WHERE id = ?`,
  crypto.randomUUID(), vote, vote, at, proposal),
  q("UPDATE arms_proposal SET status = 'voting', reason = NULL WHERE id = ?", proposal),
];

/**
 * The writes that start a house's arms vote with these waiting proposals (oldest first, at most nineteen): ranked, secret,
 * guests per the family's setting, closing in seven days, its question and "keep" label in English, and the "keep" option
 * with a snapshot of the house's arms. Guarded: no other unsettled arms vote for the house, the arms as read, and each
 * proposal still waiting and in no other vote. The caller checks that no proposal equals the current arms.
 * The one way an arms vote starts: Put to a vote, vote mode's proposing, and settlement's next vote.
 */
export async function startArmsVotePlan(d: Db, house: string, proposalIds: readonly string[], starter: Starter, now: Date): Promise<{ writes: Query[]; vote: string }> {
  if (!proposalIds.length || proposalIds.length > MAX_PROPOSALS_PER_VOTE) throw new Error('arms.err.vote_busy');
  const h = await houseOf(d, house);
  const { guests } = await settingsIn(d);
  const vote = crypto.randomUUID();
  const at = now.toISOString();
  const closesAt = new Date(now.getTime() + ARMS_VOTE_DAYS * DAY_MS).toISOString();
  return {
    vote,
    writes: [
      // One unsettled arms vote per house: one started meanwhile makes the plan decide again (and join it, or wait).
      guard(`NOT EXISTS (SELECT 1 FROM vote WHERE ${UNSETTLED})`, house),
      sameHouseArms(house, h.arms),
      q(`INSERT INTO vote (id, account, author_name, author_person, question, kind, secret, add_options, guests, closes_at, created_at, subject_kind, subject)
         VALUES (?, ?, ?, ${PERSON}, ?, 'ranked', 1, 0, ?, ?, ?, 'house', ?)`,
      vote, starter.id, starter.name, starter.person, armsQuestion(h.name), guests ? 1 : 0, closesAt, at, house),
      q('INSERT INTO vote_option (id, vote, ord, label, added_by_account, added_by_name, created_at, arms) VALUES (?, ?, 0, ?, ?, ?, ?, ?)',
        crypto.randomUUID(), vote, KEEP_LABEL, starter.id, starter.name, at, h.arms),
      ...proposalIds.flatMap((p) => joinWrites(vote, house, p, at)),
    ],
  };
}

/**
 * A waiting proposal into the house's arms vote: joining the unsettled one while it is open, has no ballot and fewer than
 * nineteen proposals, or starting one when there is none. Null when the vote takes no more (the proposal waits).
 */
async function toVote(d: Db, house: string, h: HouseRow, proposal: string, starter: Starter, now: Date): Promise<{ writes: Query[]; vote: string } | null> {
  const v = await d.get<ArmsVoteRow>(`SELECT ${ARMS_VOTE_COLUMNS} FROM vote v WHERE v.subject_kind = 'house' AND v.subject = ? AND v.settled_at IS NULL`, house);
  if (!v) return startArmsVotePlan(d, house, [proposal], starter, now);
  const at = now.toISOString();
  if (!isOpen(v, at) || v.ballots || v.proposals >= MAX_PROPOSALS_PER_VOTE) return null;
  return {
    vote: v.id,
    writes: [
      // Still open, unsettled and without a ballot, with room: a ballot cast meanwhile makes the plan decide again.
      guard(`EXISTS (SELECT 1 FROM vote WHERE id = ? AND ${UNSETTLED} AND closed_at IS NULL AND closes_at > ?)`, v.id, house, at),
      guard('NOT EXISTS (SELECT 1 FROM ballot WHERE vote = ?)', v.id),
      guard('(SELECT count(*) FROM vote_option WHERE vote = ? AND proposal IS NOT NULL) < ?', v.id, MAX_PROPOSALS_PER_VOTE),
      sameHouseArms(house, h.arms),
      ...joinWrites(v.id, house, proposal, at),
    ],
  };
}

// ---------- changes ----------

function nameOf(text: string): string {
  const name = oneLine(text);
  if (!name || name.length > MAX_PROPOSAL_NAME) throw new Error('arms.err.name');
  return name;
}
function textOf(text: string | undefined, max: number, code: string): string {
  const out = cleanComment(text ?? '').trim();
  if (out.length > max) throw new Error(code);
  return out;
}

/**
 * Proposes arms for a house under the member's name, waiting for the family to settle it. Refused when the design equals the
 * house's arms, another open proposal for the house has its name (in any case), or the member has three open for the house.
 * In vote mode it goes to the house's arms vote in the same batch when it can (`vote` is then that vote's id).
 */
export async function proposeArms(
  tree: string, who: Who, house: string, input: { name: string; note?: string; arms: House['arms'] }, op?: OpKey, now: Date = new Date(),
): Promise<{ id: string; vote: string | null }> {
  needs(who, 'propose-arms');
  const name = nameOf(input.name);
  const note = textOf(input.note, MAX_PROPOSAL_NOTE, 'arms.err.note');
  const arms = normalArms(input.arms);
  const starter = starterOf(who);
  return once(tree, op, 'proposeArms', async (d) => {
    const h = await houseOf(d, house);
    if (sameArms(JSON.parse(h.arms), arms)) throw new Error('arms.err.same');
    const open = await d.all<{ id: string; account: string; name: string }>(`SELECT id, account, name FROM arms_proposal WHERE house = ? AND ${OPEN_STATUS}`, house);
    if (open.some((p) => sameName(p.name, name))) throw new Error('arms.err.name_taken');
    if (open.filter((p) => p.account === who.id).length >= MAX_OPEN_PER_MEMBER) throw new Error('arms.err.too_many');
    const settings = await settingsIn(d);
    const id = crypto.randomUUID();
    const at = now.toISOString();
    const voting = settings.mode === 'vote' ? await toVote(d, house, h, id, starter, now) : null;
    const ids = JSON.stringify(open.map((p) => p.id));
    return {
      writes: [
        // The house's open proposals exactly as read: one proposed, withdrawn or decided meanwhile makes the plan decide
        // again, so neither the name check nor the member's three can be raced past.
        guard(`(SELECT count(*) FROM arms_proposal WHERE house = ? AND ${OPEN_STATUS}) = ? AND (SELECT count(*) FROM arms_proposal WHERE house = ? AND ${OPEN_STATUS} AND id IN (SELECT value FROM json_each(?))) = ?`,
          house, open.length, house, ids, open.length),
        sameHouseArms(house, h.arms),
        ...(voting ? [sameMode(settings.stored)] : []),
        q(`INSERT INTO arms_proposal (id, house, account, author_name, author_person, name, note, arms, status, created_at) VALUES (?, ?, ?, ?, ${PERSON}, ?, ?, ?, 'waiting', ?)`,
          id, house, who.id, who.name, starter.person, name, note, JSON.stringify(arms), at),
        ...(voting?.writes ?? []),
      ],
      history: NOT_A_RECORD,
      result: { id, vote: voting?.vote ?? null },
    };
  });
}

/**
 * The guards and writes that take a proposal out of where it is: a waiting one stays as read; one in a vote leaves it
 * while the vote is open with no ballot (else `locked`), taking its option out, or the whole vote when it was the last.
 */
async function leaving(d: Db, p: ProposalRow, now: Date): Promise<Query[]> {
  if (p.status === 'waiting') return [guard("EXISTS (SELECT 1 FROM arms_proposal WHERE id = ? AND status = 'waiting')", p.id)];
  if (p.status !== 'voting') throw new Error('arms.err.state');
  const v = await d.get<ArmsVoteRow>(`SELECT ${ARMS_VOTE_COLUMNS} FROM vote_option x JOIN vote v ON v.id = x.vote WHERE x.proposal = ? AND v.settled_at IS NULL`, p.id);
  if (!v) throw new Error('arms.err.state');
  const at = now.toISOString();
  if (!isOpen(v, at) || v.ballots) throw new Error('arms.err.locked');
  return [
    guard("EXISTS (SELECT 1 FROM arms_proposal WHERE id = ? AND status = 'voting')", p.id),
    guard('EXISTS (SELECT 1 FROM vote WHERE id = ? AND closed_at IS NULL AND closes_at > ? AND settled_at IS NULL)', v.id, at),
    guard('NOT EXISTS (SELECT 1 FROM ballot WHERE vote = ?)', v.id),
    // The vote's proposals as read: one joining meanwhile means the vote no longer goes with this one.
    guard('(SELECT count(*) FROM vote_option WHERE vote = ? AND proposal IS NOT NULL) = ?', v.id, v.proposals),
    ...(v.proposals <= 1 ? removeVoteWrites(v.id) : [q('DELETE FROM vote_option WHERE vote = ? AND proposal = ?', v.id, p.id)]),
  ];
}

/** Withdraws the member's own proposal, while it waits or is in a vote without a ballot. */
export async function withdrawProposal(tree: string, who: Who, id: string, op?: OpKey, now: Date = new Date()): Promise<void> {
  needs(who, 'propose-arms');
  return once(tree, op, 'withdrawProposal', async (d) => {
    const p = await proposalOf(d, id);
    if (p.account !== who.id) throw new Error('arms.err.not_yours');
    return {
      writes: [...(await leaving(d, p, now)), q("UPDATE arms_proposal SET status = 'withdrawn', reason = NULL, decided_at = ? WHERE id = ?", now.toISOString(), id)],
      history: NOT_A_RECORD,
      result: undefined,
    };
  });
}

/** Declines a proposal (a steward, in every mode), with an optional reason the proposer sees; the same limits as withdrawing. */
export async function declineProposal(tree: string, who: Who, id: string, reason?: string, op?: OpKey, now: Date = new Date()): Promise<void> {
  needs(who, 'edit-house');
  const text = textOf(reason, MAX_DECLINE_REASON, 'arms.err.reason');
  return once(tree, op, 'declineProposal', async (d) => {
    const p = await proposalOf(d, id);
    return {
      writes: [
        ...(await leaving(d, p, now)),
        q("UPDATE arms_proposal SET status = 'declined', reason = ?, decided_by = ?, decided_by_name = ?, decided_at = ? WHERE id = ?", text || null, who.id, who.name, now.toISOString(), id),
      ],
      history: NOT_A_RECORD,
      result: undefined,
    };
  });
}

/**
 * Accepts a waiting proposal (a steward, in steward or choose mode): the house takes its arms through the house-write plan,
 * over the name, motto and arms the steward saw (`before`, refused if they changed) and never while an arms vote holds them.
 */
export async function acceptProposal(tree: string, who: Who, id: string, before: HouseSeen, op?: OpKey, now: Date = new Date()): Promise<void> {
  needs(who, 'edit-house');
  return once(tree, op, 'acceptProposal', async (d) => {
    const p = await proposalOf(d, id);
    const settings = await settingsIn(d);
    if (settings.mode === 'vote') throw new Error('arms.err.mode');
    if (p.status !== 'waiting') throw new Error('arms.err.state');
    const arms = JSON.parse(p.arms) as House['arms'];
    if (sameArms(JSON.parse((await houseOf(d, p.house)).arms), arms)) throw new Error('arms.err.same');
    const house = await houseWritePlan(d, p.house, { name: before.name, motto: before.motto, arms }, before);
    return {
      writes: [
        guard("EXISTS (SELECT 1 FROM arms_proposal WHERE id = ? AND status = 'waiting')", id),
        sameMode(settings.stored),
        ...house.writes,
        q("UPDATE arms_proposal SET status = 'accepted', reason = NULL, decided_by = ?, decided_by_name = ?, decided_at = ? WHERE id = ?", who.id, who.name, now.toISOString(), id),
      ],
      history: house.history,
      result: undefined,
    };
  });
}

/**
 * Puts a waiting proposal to the house's arms vote (a steward, in choose or vote mode), clearing a `vote_removed` mark:
 * it joins the unsettled vote while that has no ballot and room, starts one when there is none, else `vote_busy`.
 */
export async function putToVote(tree: string, who: Who, id: string, op?: OpKey, now: Date = new Date()): Promise<{ vote: string }> {
  needs(who, 'edit-house');
  const starter = starterOf(who);
  return once(tree, op, 'putToVote', async (d) => {
    const p = await proposalOf(d, id);
    const settings = await settingsIn(d);
    if (settings.mode === 'steward') throw new Error('arms.err.mode');
    if (p.status !== 'waiting') throw new Error('arms.err.state');
    const h = await houseOf(d, p.house);
    if (sameArms(JSON.parse(h.arms), JSON.parse(p.arms))) throw new Error('arms.err.same');
    const voting = await toVote(d, p.house, h, id, starter, now);
    if (!voting) throw new Error('arms.err.vote_busy');
    return { writes: [sameMode(settings.stored), ...voting.writes], history: NOT_A_RECORD, result: { vote: voting.vote } };
  });
}
