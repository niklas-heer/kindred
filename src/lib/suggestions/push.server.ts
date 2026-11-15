// The push to reviewers that suggestions are waiting (push_subscription.suggestions, accounts migration 0061; the switch is
// with the other reminder choices, and offered to members whose role may review suggestions). Sent when a suggestion is made
// (the server function calls `notifySuggestion` from its keepAlive), never from the daily job. As the push about a post
// (feed/post-push.server.ts): at most one per device in QUIET_HOURS however many suggestions arrive (the device's time,
// `suggestions_sent_at`, is claimed with one conditional UPDATE before the send). It says only how many are waiting: no name,
// no person, no content. Gentle by rule: never to someone who is no longer a member or whose role cannot review, never to a
// device unopened for STALE_DAYS, never to the suggester themselves, nothing from a demo or a steward's preview, and never a
// throw: a push that fails must not fail the suggestion. Nothing is logged that names a person or a device.
import { accounts } from '../auth/store.server.ts';
import { db } from '../db.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { STALE_DAYS, type PushRow } from '../reminders.server.ts';
import { can, type Role } from '../roles.ts';
import { QUIET_HOURS } from '../feed/post-push.server.ts';
import { deliver, pushKeys, type PushOptions } from '../votes/vote-push.server.ts';
import { fitsPush } from '../webpush.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Tells the family's reviewers' devices that asked how many suggestions wait, after one was made. `by` is the suggester's
 * account (a member), who is not told of their own. Returns how many devices got it.
 */
export async function notifySuggestion(tree: string, options: PushOptions & { by?: string | null } = {}): Promise<number> {
  const at = (options.now ?? new Date()).getTime();
  let sent = 0;
  try {
    const vapid = await pushKeys(tree, options);
    if (!vapid) return 0;
    const waiting = (await db(tree).get<{ n: number }>("SELECT count(*) AS n FROM suggestion WHERE status = 'waiting'"))?.n ?? 0;
    if (!waiting) return 0;
    const devices = (await accounts().all<PushRow & { role: Role }>(
      `SELECT s.*, m.role AS role FROM push_subscription s JOIN membership m ON m.user = s.user AND m.tree = s.tree
       WHERE s.tree = ? AND s.suggestions = 1 AND (s.suggestions_sent_at IS NULL OR s.suggestions_sent_at <= ?)`,
      tree, at - QUIET_HOURS * HOUR_MS,
    )).filter((d) => d.user !== options.by && can(d.role, 'review-suggestions') && at - d.last_seen < STALE_DAYS * DAY_MS);
    for (const device of devices) {
      const vars = { count: waiting };
      const message = {
        title: translate(device.locale, 'suggest.push.title', vars), body: translate(device.locale, 'suggest.push.body', vars),
        tag: `kindred-suggestions-${tree}`, url: `/${tree}/today`,
      };
      if (!fitsPush(message)) continue;
      const claim = await accounts().run(
        'UPDATE push_subscription SET suggestions_sent_at = ? WHERE id = ? AND suggestions = 1 AND (suggestions_sent_at IS NULL OR suggestions_sent_at <= ?)',
        at, device.id, at - QUIET_HOURS * HOUR_MS);
      if (claim.changes !== 1) continue;
      if (await deliver(device, message, vapid, options.fetchImpl ?? fetch)) sent += 1;
    }
  } catch {
    // Reading the family's policy, the suggestions or the devices failed: the suggestion stands without the message.
  }
  return sent;
}
