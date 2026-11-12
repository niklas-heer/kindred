// Telling the operators about a new request (accounts migration 0037, `operator_push`; docs/hosting-many-families.md). An
// operator turns it on for a device in the console; a new family request or data request then pushes "a new request is
// waiting" to each such device, with nothing of what was asked or by whom, at most once in OPERATOR_PUSH_GAP_MS per device, so
// a flood of requests is one push. A device stops when its operator turns it off, signs out on it, or is no longer an operator.
import { translate } from '../i18n/dictionary.ts';
import type { Locale } from '../i18n/types.ts';
import { checkSubscription, envSetting, vapidFrom } from '../reminders.server.ts';
import { q, store } from '../store/index.ts';
import { pushServiceAllowed, sendPush, type PushSubscriptionLike, type VapidConfig } from '../webpush.ts';

const accounts = () => store.accounts();

/** The shortest time between two pushes to one operator device. */
export const OPERATOR_PUSH_GAP_MS = 10 * 60_000;

/** Whether this device (its push endpoint) tells this operator about new requests. */
export async function operatorPushOn(user: string, endpoint: string): Promise<boolean> {
  return !!(await accounts().get<{ id: string }>('SELECT id FROM operator_push WHERE user = ? AND endpoint = ?', user, endpoint));
}

/** Turns it on for a device: the subscription is checked as the reminders check theirs. A device belongs to one account. */
export async function saveOperatorPush(user: string, subscription: PushSubscriptionLike, locale: Locale, now = Date.now()): Promise<void> {
  await checkSubscription(subscription);
  await accounts().run(
    `INSERT INTO operator_push (id, user, endpoint, p256dh, auth, locale, created) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user = excluded.user, p256dh = excluded.p256dh, auth = excluded.auth, locale = excluded.locale`,
    crypto.randomUUID(), user, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, locale, now);
}

/** Turns it off for a device. Returns how many family reminders still use the device, so the browser keeps its subscription for them. */
export async function removeOperatorPush(user: string, endpoint: string): Promise<number> {
  await accounts().run('DELETE FROM operator_push WHERE user = ? AND endpoint = ?', user, endpoint);
  return (await accounts().get<{ n: number }>('SELECT count(*) AS n FROM push_subscription WHERE user = ? AND endpoint = ?', user, endpoint))?.n ?? 0;
}

/**
 * Pushes "a new request" to every operator device that asked for it and was not told in the last OPERATOR_PUSH_GAP_MS. Each
 * device's turn is claimed with one conditional UPDATE before the send, so two requests at once send one push. Never throws,
 * logs nothing; devices the push service reports gone are removed. Returns how many were sent.
 */
export async function notifyOperators(kind: 'family' | 'data', vapid: VapidConfig | null = vapidFrom(envSetting), fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<number> {
  if (!vapid) return 0;
  let sent = 0;
  try {
    const due = now - OPERATOR_PUSH_GAP_MS;
    const rows = await accounts().all<{ id: string; endpoint: string; p256dh: string; auth: string; locale: Locale }>(
      'SELECT p.id, p.endpoint, p.p256dh, p.auth, p.locale FROM operator_push p JOIN user u ON u.id = p.user WHERE u.operator = 1 AND (p.sent_at IS NULL OR p.sent_at <= ?)', due);
    await Promise.allSettled(rows.filter((r) => pushServiceAllowed(r.endpoint)).map(async (r) => {
      const claim = await accounts().run('UPDATE operator_push SET sent_at = ? WHERE id = ? AND (sent_at IS NULL OR sent_at <= ?)', now, r.id, due);
      if (claim.changes !== 1) return;
      const message = {
        title: translate(r.locale, 'operator.push_title'),
        body: translate(r.locale, kind === 'family' ? 'operator.push_family' : 'operator.push_data'),
        tag: 'kindred-operator',
        url: `/operator?tab=${kind === 'family' ? 'requests' : 'data'}`,
      };
      const response = await sendPush({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, message, vapid, fetchImpl);
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) await accounts().batch([q('DELETE FROM operator_push WHERE id = ?', r.id)]);
      else if (response.ok) sent++;
    }));
  } catch {}
  return sent;
}
