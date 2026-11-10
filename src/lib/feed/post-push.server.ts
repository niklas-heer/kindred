// "Someone wrote to the family": a push about a new post, to the devices that asked for it (push_subscription.posts,
// accounts migration 0029; the switch is with the other reminder choices). Gentle by rule:
// - never to the writer, never to someone who is no longer a member, never to a device unopened for STALE_DAYS;
// - at most one push per device in QUIET_HOURS, however many posts arrive: the device's time is claimed with one
//   conditional UPDATE before the send, as the weekly push claims its week (history-push.server.ts). The posts in
//   between are on the feed, in "What's new" and in the weekly push;
// - it says who wrote, never what: the words stay in the family's app;
// - nothing is sent from a demo or a steward's preview (neither can write a post in the first place);
// - it never throws: a push that fails must not fail the post. Nothing is logged that names a person or a device.
import { accounts, q } from '../auth/store.server';
import { db } from '../db.server';
import { translate } from '../i18n/dictionary';
import { readOnly } from '../read-only';
import { STALE_DAYS, envSetting, subscriptionFrom, vapidFrom, type PushRow } from '../reminders.server';
import { fitsPush, sendPush, type VapidConfig } from '../webpush';

/** How long a device is left in peace after a push about a post. */
export const QUIET_HOURS = 6;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Tells the family's devices that asked about a new post by `by`. Returns how many got it. */
export async function notifyPost(tree: string, by: { id: string; name: string }, options: { now?: Date; vapid?: VapidConfig | null; fetchImpl?: typeof fetch } = {}): Promise<number> {
  if (readOnly()) return 0;
  const at = (options.now ?? new Date()).getTime();
  const vapid = options.vapid === undefined ? vapidFrom(envSetting) : options.vapid;
  if (!vapid) return 0;
  let sent = 0;
  try {
    // Members' devices only: a row whose owner has left is not sent to (and is removed with the membership anyway).
    const rows = await accounts().all<PushRow>(
      `SELECT s.* FROM push_subscription s JOIN membership m ON m.user = s.user AND m.tree = s.tree
       WHERE s.tree = ? AND s.posts = 1 AND s.user <> ? AND (s.posts_sent_at IS NULL OR s.posts_sent_at <= ?)`,
      tree, by.id, at - QUIET_HOURS * HOUR_MS,
    );
    const devices = rows.filter((row) => at - row.last_seen < STALE_DAYS * DAY_MS);
    if (!devices.length) return 0;
    const family = (await db(tree).get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value ?? tree;
    for (const row of devices) {
      const message = {
        title: translate(row.locale, 'feed.push.title', { name: by.name, family }),
        body: translate(row.locale, 'feed.push.body', { name: by.name, family }),
        tag: `kindred-feed-${tree}`,
        url: `/${tree}/today`,
      };
      if (!fitsPush(message)) continue;
      const claim = await accounts().run(
        'UPDATE push_subscription SET posts_sent_at = ? WHERE id = ? AND posts = 1 AND (posts_sent_at IS NULL OR posts_sent_at <= ?)', at, row.id, at - QUIET_HOURS * HOUR_MS);
      if (claim.changes !== 1) continue;
      try {
        const response = await sendPush(subscriptionFrom(row), message, vapid, options.fetchImpl ?? fetch);
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410) await accounts().batch([q('DELETE FROM push_subscription WHERE id = ?', row.id)]);
        else if (response.ok) sent += 1;
      } catch {
        // An unreachable push service: the claim stays, since the message may have been delivered.
      }
    }
  } catch {
    // Reading the devices failed: the post stands without the message.
  }
  return sent;
}
