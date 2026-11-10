// The campaign's one push: "a province of your house has fallen". At most one a day for each member, sent only to
// members who turned reminders on for this family (they have a device in push_subscription), in each device's language.
// The claim for the day is a row in the family database (campaign_push), written before the send, so two requests that
// see the same province fall send one message between them.
import { accounts, q } from '../auth/store.server.ts';
import { db } from '../db.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { STALE_DAYS, envSetting, subscriptionFrom, vapidFrom, type PushRow } from '../reminders.server.ts';
import { sendPush, type VapidConfig } from '../webpush.ts';
import { accountsOfSide, sideName, type Fallen } from './campaign.server.ts';

const DAY_MS = 86_400_000;

/**
 * Tells the members of each house that lost a province. Returns how many messages were sent. Never throws: a push that
 * fails must not fail the order or the page that caused it. Nothing is logged that names a person or a device.
 */
export async function notifyFallen(tree: string, fallen: Fallen[], options: { now?: Date; vapid?: VapidConfig | null; fetchImpl?: typeof fetch } = {}): Promise<number> {
  if (!fallen.length) return 0;
  const now = options.now ?? new Date();
  const vapid = options.vapid === undefined ? vapidFrom(envSetting) : options.vapid;
  if (!vapid) return 0;
  const day = now.toISOString().slice(0, 10);
  let sent = 0;
  try {
    // One message for each house that lost something: its first loss speaks for the day.
    const first = new Map<string, Fallen>();
    for (const f of fallen) if (!first.has(f.from)) first.set(f.from, f);
    for (const f of first.values()) {
      const taker = await sideName(tree, f.season, f.to);
      for (const account of await accountsOfSide(tree, f.season, f.from)) {
        if (account === f.by) continue;
        const devices = (await accounts().all<PushRow>('SELECT * FROM push_subscription WHERE tree = ? AND user = ?', tree, account)).filter((row) => now.getTime() - row.last_seen < STALE_DAYS * DAY_MS);
        if (!devices.length) continue;
        const claim = await db(tree).run('INSERT INTO campaign_push (account, day) VALUES (?, ?) ON CONFLICT (account, day) DO NOTHING', account, day);
        if (claim.changes !== 1) continue;
        for (const row of devices) {
          const message = {
            title: translate(row.locale, 'campaign.push.title'),
            body: translate(row.locale, 'campaign.push.fell', { province: f.province, house: taker }),
            tag: `kindred-campaign-${tree}`,
            url: `/${tree}/campaign`,
          };
          try {
            const response = await sendPush(subscriptionFrom(row), message, vapid, options.fetchImpl ?? fetch);
            await response.body?.cancel();
            if (response.status === 404 || response.status === 410) await accounts().batch([q('DELETE FROM push_subscription WHERE id = ?', row.id)]);
            else if (response.ok) sent += 1;
          } catch {
            // An unreachable push service: the day's claim stays, since the message may have been delivered.
          }
        }
      }
    }
  } catch {
    // Reading the devices failed: the game goes on without the message.
  }
  return sent;
}
