// The pushes about family votes, to the devices that asked (push_subscription.votes, accounts migration 0060; the switch is
// with the other reminder choices). Two kinds:
// - "<name> asked the family": a new vote, when it starts. As the push about a post (feed/post-push.server.ts): never to the
//   creator, at most one per device in QUIET_HOURS however many votes start (the device's time, `votes_sent_at`, is claimed
//   with one conditional UPDATE before the send);
// - "A vote closes soon": the reminder, from the daily job (jobs/votes.ts). The jobs run once a day, so each run reminds of
//   the open votes closing within the next REMIND_HOURS: every vote is in exactly one run's window when it was started
//   before that run, and a vote started after the day's run that closes before the next one gets no reminder. It goes to
//   each member who has a device that asked and has not voted; whether they voted is read from `vote_voter.account`, never
//   from a ballot, so a secret vote is reminded alike and nothing is read of anyone's choice. The claim is the member's
//   `vote_reminded` row, written before the send: one reminder per member and vote, however often the job runs.
// Both name the question, never a choice, a tally or who voted. Gentle by rule: never to someone who is no longer a member,
// never to a device unopened for STALE_DAYS, nothing from a demo or a steward's preview, and never a throw: a push that
// fails must not fail the vote or the job. Nothing is logged that names a person or a device.
import { accounts, q } from '../auth/store.server';
import { db } from '../db.server';
import { translate } from '../i18n/dictionary';
import { readOnly } from '../read-only';
import { STALE_DAYS, envSetting, subscriptionFrom, vapidFrom, type PushRow } from '../reminders.server';
import { fitsPush, sendPush, type VapidConfig } from '../webpush';
import { QUIET_HOURS } from '../feed/post-push.server';

/** How far ahead of its closing a vote is reminded of: the daily job's interval. */
export const REMIND_HOURS = 24;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface PushOptions { now?: Date; vapid?: VapidConfig | null; fetchImpl?: typeof fetch }
type Message = { title: string; body: string; tag: string; url: string };

/** The server's keys, when pushes may go out from here for this family now; else null. */
async function pushKeys(tree: string, options: PushOptions): Promise<VapidConfig | null> {
  if (readOnly()) return null;
  const vapid = options.vapid === undefined ? vapidFrom(envSetting) : options.vapid;
  if (!vapid || !(await (await import('../operator/policy.server.ts')).familyAllows(tree, 'feature.push'))) return null;
  return vapid;
}

/** Sends one message to one device; true when the push service took it. A device the service no longer knows is forgotten. */
async function deliver(row: PushRow, message: Message, vapid: VapidConfig, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await sendPush(subscriptionFrom(row), message, vapid, fetchImpl);
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) await accounts().batch([q('DELETE FROM push_subscription WHERE id = ?', row.id)]);
    return response.ok;
  } catch {
    // An unreachable push service: the claim stays, since the message may have been delivered.
    return false;
  }
}

const familyName = async (tree: string) => (await db(tree).get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value ?? tree;
const voteUrl = (tree: string, vote: string) => `/${tree}/votes/${encodeURIComponent(vote)}`;

/** Tells the family's devices that asked about the vote `vote`, which `by` started. Returns how many got it. */
export async function notifyVote(tree: string, by: { id: string; name: string }, vote: string, options: PushOptions = {}): Promise<number> {
  const vapid = await pushKeys(tree, options);
  if (!vapid) return 0;
  const at = (options.now ?? new Date()).getTime();
  let sent = 0;
  try {
    const row = await db(tree).get<{ question: string }>('SELECT question FROM vote WHERE id = ?', vote);
    if (!row) return 0;
    // Members' devices only: a row whose owner has left is not sent to (and is removed with the membership anyway).
    const devices = (await accounts().all<PushRow>(
      `SELECT s.* FROM push_subscription s JOIN membership m ON m.user = s.user AND m.tree = s.tree
       WHERE s.tree = ? AND s.votes = 1 AND s.user <> ? AND (s.votes_sent_at IS NULL OR s.votes_sent_at <= ?)`,
      tree, by.id, at - QUIET_HOURS * HOUR_MS,
    )).filter((d) => at - d.last_seen < STALE_DAYS * DAY_MS);
    if (!devices.length) return 0;
    const family = await familyName(tree);
    for (const device of devices) {
      const vars = { name: by.name, question: row.question, family };
      const message = { title: translate(device.locale, 'votes.push.title', vars), body: translate(device.locale, 'votes.push.body', vars), tag: `kindred-votes-${tree}`, url: voteUrl(tree, vote) };
      if (!fitsPush(message)) continue;
      const claim = await accounts().run(
        'UPDATE push_subscription SET votes_sent_at = ? WHERE id = ? AND votes = 1 AND (votes_sent_at IS NULL OR votes_sent_at <= ?)', at, device.id, at - QUIET_HOURS * HOUR_MS);
      if (claim.changes !== 1) continue;
      if (await deliver(device, message, vapid, options.fetchImpl ?? fetch)) sent += 1;
    }
  } catch {
    // Reading the vote or the devices failed: the vote stands without the message.
  }
  return sent;
}

/**
 * Reminds the members who asked and have not voted of each open vote closing within REMIND_HOURS of `now`: once per member
 * and vote (the `vote_reminded` row, claimed before the send), to each of their devices that asked. A member with no such
 * device is not claimed, so turning the switch on later still brings the reminder. Returns how many devices got one.
 */
export async function remindVotes(tree: string, now: Date = new Date(), options: Omit<PushOptions, 'now'> = {}): Promise<number> {
  const vapid = await pushKeys(tree, options);
  if (!vapid) return 0;
  const at = now.getTime();
  let sent = 0;
  try {
    const d = db(tree);
    const votes = await d.all<{ id: string; question: string }>(
      'SELECT id, question FROM vote WHERE closed_at IS NULL AND closes_at > ? AND closes_at <= ? ORDER BY closes_at, id',
      now.toISOString(), new Date(at + REMIND_HOURS * HOUR_MS).toISOString(),
    );
    if (!votes.length) return 0;
    const devices = (await accounts().all<PushRow>(
      `SELECT s.* FROM push_subscription s JOIN membership m ON m.user = s.user AND m.tree = s.tree WHERE s.tree = ? AND s.votes = 1`, tree,
    )).filter((row) => at - row.last_seen < STALE_DAYS * DAY_MS);
    if (!devices.length) return 0;
    const byUser = new Map<string, PushRow[]>();
    for (const row of devices) byUser.set(row.user, [...(byUser.get(row.user) ?? []), row]);
    const family = await familyName(tree);
    for (const vote of votes) {
      // Who has taken part, by account: the voter list, not the ballots, so a secret vote says no more here than its page does.
      const done = new Set([
        ...(await d.all<{ account: string }>('SELECT account FROM vote_voter WHERE vote = ? AND account IS NOT NULL', vote.id)).map((r) => r.account),
        ...(await d.all<{ account: string }>('SELECT account FROM vote_reminded WHERE vote = ?', vote.id)).map((r) => r.account),
      ]);
      for (const [user, rows] of byUser) {
        if (done.has(user)) continue;
        const claim = await d.run('INSERT INTO vote_reminded (vote, account) VALUES (?, ?) ON CONFLICT DO NOTHING', vote.id, user);
        if (claim.changes !== 1) continue;
        for (const row of rows) {
          const vars = { question: vote.question, family };
          const message = { title: translate(row.locale, 'votes.push.remind_title', vars), body: translate(row.locale, 'votes.push.remind_body', vars), tag: `kindred-votes-${tree}-${vote.id}`, url: voteUrl(tree, vote.id) };
          if (fitsPush(message) && (await deliver(row, message, vapid, options.fetchImpl ?? fetch))) sent += 1;
        }
      }
    }
  } catch {
    // Reading the votes or the devices failed: tomorrow's run tries again for what was not claimed.
  }
  return sent;
}
