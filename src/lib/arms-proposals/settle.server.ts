// Settling a house's arms vote (`settleArmsVotes`), and in vote mode starting the house's next one. Run by a member's read
// of the votes or of the houses, a steward's close of an arms vote, and the daily votes job; never by the feed, a guest, a
// demo or a preview.
//
// What it promises:
// - Two steps, never one batch. First a vote past its closing time is marked closed at that time, in its own guarded write
//   (`markClosed`), after which no ballot or strike lands. Then each closed, unsettled arms vote is settled in one batch
//   guarded on `closed_at IS NOT NULL AND settled_at IS NULL`, so two runs at once settle it once and the loser finds
//   nothing to do.
// - The count is the votes' own (`resultOf`: struck guests left out). One winning proposal → the house takes its arms
//   through the house-write plan (`houseWritePlan` with `settlingVote`, over the Keep snapshot, so arms saved since the
//   start are never overwritten), credited to the family's vote (`FAMILY_VOTE`, account NULL); it is `accepted` and the
//   others `declined` (`not_chosen`). Keep winning, no ballots or any tie → the arms stay, and every proposal is not
//   chosen. `settled_at` is written for every outcome, which ends the house's freeze. `decided_by` stays NULL: a vote.
// - In vote mode, each house with waiting proposals (not back from a removed vote, `vote_removed`) and no unsettled arms
//   vote gets one (`startArmsVotePlan`): the oldest nineteen, started for the proposer of the oldest, after declining
//   (`not_chosen`) any whose arms equal the house's. The start is guarded, so two runs start one; a start that failed is
//   made by the next run. A chained start sends no push (the feed shows it).
// - It never throws: a failure is logged without names (the error's message only) and the next run tries again.
import { canonical, db, guard, houseWritePlan, NOT_A_RECORD, once, q, type Query } from '../db.server';
import { FAMILY_VOTE } from '../history.server';
import { readOnly } from '../read-only';
import type { House } from '../types';
import { markClosed, resultOf } from '../votes/votes.server';
import type { VoteKind } from '../votes/types';
import { startArmsVotePlan } from './proposals.server';
import { MAX_PROPOSALS_PER_VOTE } from './types';

/** A house's unsettled arms vote (`?` the house). */
const UNSETTLED = "subject_kind = 'house' AND subject = ? AND settled_at IS NULL";
/** The arms votes past their closing time that nothing has marked closed yet (`?` the time). */
const DUE = "SELECT id FROM vote WHERE subject_kind = 'house' AND closed_at IS NULL AND closes_at <= ?";
/** The arms votes marked closed and not yet settled. */
const CLOSED = "SELECT id FROM vote WHERE subject_kind = 'house' AND closed_at IS NOT NULL AND settled_at IS NULL";
/** The houses whose waiting proposals a vote-mode run puts to a new vote: none back from a removed vote, no vote running. */
const WAITING = `SELECT DISTINCT p.house AS house FROM arms_proposal p WHERE p.status = 'waiting' AND p.reason IS NOT 'vote_removed'
  AND NOT EXISTS (SELECT 1 FROM vote v WHERE v.subject_kind = 'house' AND v.subject = p.house AND v.settled_at IS NULL)`;

const failed = (what: string) => (e: unknown) => {
  // The error only: no family, house, proposal or proposer.
  console.error(`[arms] could not ${what}`, e instanceof Error ? e.message : e);
};
const sameArms = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * Closes the family's arms votes whose closing time has passed, settles every closed one not yet settled, and in vote mode
 * starts the next vote for each house with waiting proposals. Answers how many it settled and started. Does nothing in a
 * demo or a preview; never throws.
 */
export async function settleArmsVotes(tree: string, now: Date = new Date()): Promise<{ settled: number; started: number }> {
  const out = { settled: 0, started: 0 };
  if (readOnly()) return out;
  const at = now.toISOString();
  try {
    const [due, closed] = (await db(tree).readBatch([q(DUE, at), q(CLOSED)])) as unknown as [{ id: string }[], { id: string }[]];
    // Step one, its own write: once marked closed, no ballot lands, so the count below is final.
    if (due.length) await markClosed(tree, due.map((v) => v.id), at, 'closeArmsVote').catch(failed('mark arms votes closed'));
    for (const id of new Set([...closed, ...due].map((v) => v.id))) {
      if (await settleVote(tree, id, now).catch((e) => void failed('settle an arms vote')(e))) out.settled++;
    }
    const mode = await db(tree).get<{ value: string }>("SELECT value FROM meta WHERE key = 'arms_mode'");
    if (mode?.value !== 'vote') return out;
    for (const { house } of await db(tree).all<{ house: string }>(WAITING)) {
      if (await startNext(tree, house, now).catch((e) => void failed('start an arms vote')(e))) out.started++;
    }
  } catch (e) {
    failed('settle arms votes')(e);
  }
  return out;
}

interface VoteRow { id: string; kind: VoteKind; secret: number; subject: string; closed_at: string | null; settled_at: string | null }
interface OptionRow { id: string; label: string; proposal: string | null; arms: string | null }

/** Settles one closed arms vote, credited to the family's vote. False when there was nothing to settle (any more). */
function settleVote(tree: string, id: string, now: Date): Promise<boolean> {
  return once(tree, undefined, 'settleArmsVote', async (d) => {
    const nothing = { writes: [], history: NOT_A_RECORD, result: false };
    const settled = async () => {
      const v = await d.get<VoteRow>("SELECT id, kind, secret, subject, closed_at, settled_at FROM vote WHERE id = ? AND subject_kind = 'house'", id);
      return v && v.closed_at && !v.settled_at ? v : null;
    };
    const v = await settled();
    if (!v) return nothing;
    const [options, ballots, struck] = (await d.readBatch([
      q('SELECT id, label, proposal, arms FROM vote_option WHERE vote = ? ORDER BY ord', id),
      q('SELECT voter, choices FROM ballot WHERE vote = ?', id),
      q('SELECT account, guest_key FROM vote_voter WHERE vote = ? AND struck = 1', id),
    ])) as unknown as [OptionRow[], { voter: string; choices: string }[], { account: string | null; guest_key: string | null }[]];
    const { winners } = await resultOf(v, options, ballots, struck);
    // One winner, and a proposal: a tie, no ballots, or Keep leave the arms.
    const won = winners.length === 1 ? (options.find((o) => o.id === winners[0])?.proposal ?? null) : null;
    const at = now.toISOString();

    let house: { writes: Query[]; history: Awaited<ReturnType<typeof houseWritePlan>>['history'] } | null = null;
    if (won) {
      const p = await d.get<{ arms: string }>('SELECT arms FROM arms_proposal WHERE id = ?', won);
      const h = await d.get<{ name: string; motto: string | null }>('SELECT name, motto FROM house WHERE id = ?', v.subject);
      const keep = options.find((o) => !o.proposal)?.arms;
      // A house that is gone takes nothing (its proposals went with it); the vote is settled all the same.
      if (p && h && keep) {
        try {
          // Over the Keep snapshot: arms that are no longer what the vote started from are never overwritten.
          house = await houseWritePlan(d, v.subject, { name: h.name, motto: h.motto, arms: JSON.parse(p.arms) as House['arms'] }, { name: h.name, motto: h.motto, arms: JSON.parse(keep) }, { settlingVote: id });
        } catch (e) {
          // Another run settled it between the reads above and this one: nothing to do, and no failure.
          if (!(await settled())) return nothing;
          throw e;
        }
      }
    }
    return {
      writes: [
        // Closed and unsettled, as read: a settlement meanwhile makes the plan decide again, and find nothing to do.
        guard('EXISTS (SELECT 1 FROM vote WHERE id = ? AND closed_at IS NOT NULL AND settled_at IS NULL)', id),
        q('UPDATE vote SET settled_at = ? WHERE id = ?', at, id),
        ...(house?.writes ?? []),
        ...(won && house ? [q("UPDATE arms_proposal SET status = 'accepted', reason = NULL, decided_by = NULL, decided_by_name = NULL, decided_at = ? WHERE id = ? AND status = 'voting'", at, won)] : []),
        q(`UPDATE arms_proposal SET status = 'declined', reason = 'not_chosen', decided_by = NULL, decided_by_name = NULL, decided_at = ?
           WHERE status = 'voting' AND id IN (SELECT proposal FROM vote_option WHERE vote = ? AND proposal IS NOT NULL)`, at, id),
      ],
      history: house ? house.history : NOT_A_RECORD,
      result: true,
    };
  }, { actor: FAMILY_VOTE });
}

interface WaitingRow { id: string; account: string; author_name: string; author_person: string | null; arms: string }

/**
 * Starts a vote-mode house's next arms vote with its waiting proposals, oldest first, at most nineteen, after declining any
 * equal to the house's arms. False when the house has a vote already (another run started it) or nothing to put to one.
 */
function startNext(tree: string, house: string, now: Date): Promise<boolean> {
  return once(tree, undefined, 'startArmsVote', async (d) => {
    const nothing = { writes: [], history: NOT_A_RECORD, result: false };
    const mode = await d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'arms_mode'");
    if (mode?.value !== 'vote' || (await d.get(`SELECT 1 AS x FROM vote WHERE ${UNSETTLED}`, house))) return nothing;
    const h = await d.get<{ arms: string }>('SELECT arms FROM house WHERE id = ?', house);
    if (!h) return nothing;
    const waiting = await d.all<WaitingRow>(
      "SELECT id, account, author_name, author_person, arms FROM arms_proposal WHERE house = ? AND status = 'waiting' AND reason IS NOT 'vote_removed' ORDER BY created_at, id", house);
    const current = JSON.parse(h.arms);
    const same = waiting.filter((p) => sameArms(JSON.parse(p.arms), current));
    const next = waiting.filter((p) => !same.includes(p)).slice(0, MAX_PROPOSALS_PER_VOTE);
    const at = now.toISOString();
    const declines = same.flatMap((p) => [
      guard("EXISTS (SELECT 1 FROM arms_proposal WHERE id = ? AND status = 'waiting')", p.id),
      q("UPDATE arms_proposal SET status = 'declined', reason = 'not_chosen', decided_by = NULL, decided_by_name = NULL, decided_at = ? WHERE id = ?", at, p.id),
    ]);
    const oldest = next[0];
    const start = oldest ? await startArmsVotePlan(d, house, next.map((p) => p.id), { id: oldest.account, name: oldest.author_name, person: oldest.author_person }, now) : null;
    if (!start && !declines.length) return nothing;
    return {
      writes: [
        // Still vote mode, and the arms as read (the "same" check was decided on them); the start restates its own guards.
        guard("(SELECT value FROM meta WHERE key = 'arms_mode') = 'vote'"),
        guard('EXISTS (SELECT 1 FROM house WHERE id = ? AND arms = ?)', house, h.arms),
        ...declines,
        ...(start?.writes ?? []),
      ],
      history: NOT_A_RECORD,
      result: !!start,
    };
  });
}
