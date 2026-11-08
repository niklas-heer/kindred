// Web Push reminders on the server: the device subscriptions (accounts database, migrations/accounts/0005_push.sql),
// the VAPID settings, the test push, and the daily run that sends each device its reminders. Pure rules are in
// ./reminders.ts, the encryption in ./webpush.ts. Server functions for the browser are in ./reminders.functions.ts.
import { AuthError } from './auth/errors.ts';
import { accounts, commit, guard, membership, now, q } from './auth/store.server.ts';
import { can } from './roles.ts';
import { translate } from './i18n/dictionary.ts';
import type { Locale } from './i18n/types.ts';
import { dayKey, displayNameOf, OFFSETS, occasionsOn, parseChoices, reminderMessage, testMessage, type Offset, type Choices } from './reminders.ts';
import { pushServiceAllowed, sendPush, validDeviceKey, type PushSubscriptionLike, type VapidConfig } from './webpush.ts';
import type { Graph } from './types.ts';

/** A device may hold reminders for this many separate browsers (endpoints) at once. */
export const MAX_DEVICES_PER_PERSON = 10;
/** A device that has not opened the app for this long is paused: nothing is sent to it until it opens the app again. */
export const STALE_DAYS = 35;
/** A device that has not opened the app for this long is removed. */
export const EXPIRE_DAYS = 60;
const DAY_MS = 86_400_000;
const AUTH_SECRET = /^[A-Za-z0-9_-]{22}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;

// ---------- settings ----------

/**
 * The VAPID keys (RFC 8292) that sign every push, from the environment or Worker secrets. Null when any is missing or
 * malformed: the feature is then hidden and the daily run skips. docs/self-host.md and docs/deploy-cloudflare.md say
 * how to make them (`mise run vapid-keys`).
 */
export function vapidFrom(read: (name: string) => string | undefined): VapidConfig | null {
  const publicKey = read('KINDRED_VAPID_PUBLIC_KEY')?.trim();
  const jwk = read('KINDRED_VAPID_PRIVATE_JWK')?.trim();
  const subject = read('KINDRED_VAPID_SUBJECT')?.trim();
  if (!publicKey || !PUBLIC_KEY.test(publicKey) || !jwk || !subject) return null;
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) return null;
  let privateJwk: JsonWebKey;
  try {
    privateJwk = JSON.parse(jwk) as JsonWebKey;
  } catch {
    return null;
  }
  if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || typeof privateJwk.d !== 'string') return null;
  return { publicKey, privateJwk, subject };
}

/** The settings from the process environment (Node, and Workers with nodejs_compat). */
export const envSetting = (name: string) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

// ---------- the stored device ----------

export interface PushRow {
  id: string;
  user: string;
  tree: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  offsets: string;
  kinds: string;
  locale: Locale;
  created: number;
  last_seen: number;
}

/** The device's row for one family, if it has one. */
export const subscriptionOf = (user: string, tree: string, endpoint: string) =>
  accounts().get<PushRow>('SELECT * FROM push_subscription WHERE user = ? AND tree = ? AND endpoint = ?', user, tree, endpoint);

/** What the push helpers need from a stored row. */
export const subscriptionFrom = (row: PushRow): PushSubscriptionLike => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } });

/** The choices a stored row holds, or null when they are not valid (then nothing is sent for that row). */
export function choicesOf(row: Pick<PushRow, 'offsets' | 'kinds'>): Choices | null {
  try {
    return parseChoices(JSON.parse(row.offsets), JSON.parse(row.kinds));
  } catch {
    return null;
  }
}

// ---------- registering a device ----------

export interface Registration {
  user: string;
  tree: string;
  subscription: PushSubscriptionLike;
  choices: Choices;
  locale: Locale;
}

/**
 * Stores (or updates) a device's reminders for one family. The browser's endpoint belongs to one person at a time, and a
 * person holds at most MAX_DEVICES_PER_PERSON devices. Each rule the check relies on is restated as a guard in the batch,
 * so a racing registration cannot break it. The caller has checked the membership and the endpoint and keys.
 */
export async function saveRegistration({ user, tree, subscription, choices, locale }: Registration): Promise<void> {
  const { endpoint, keys } = subscription;
  const a = accounts();
  await commit(async () => {
    const other = await a.get<{ n: number }>('SELECT count(*) AS n FROM push_subscription WHERE endpoint = ? AND user <> ?', endpoint, user);
    if (other?.n) throw new AuthError('invalid', translate('en', 'reminders.err.otherUser'));
    const devices = await a.get<{ n: number }>('SELECT count(DISTINCT endpoint) AS n FROM push_subscription WHERE user = ? AND endpoint <> ?', user, endpoint);
    if ((devices?.n ?? 0) >= MAX_DEVICES_PER_PERSON) throw new AuthError('invalid', translate('en', 'reminders.err.devices'));
    const stamp = now();
    return {
      writes: [
        guard('NOT EXISTS (SELECT 1 FROM push_subscription WHERE endpoint = ? AND user <> ?)', endpoint, user),
        guard('(SELECT count(DISTINCT endpoint) FROM push_subscription WHERE user = ? AND endpoint <> ?) < ?', user, endpoint, MAX_DEVICES_PER_PERSON),
        guard('EXISTS (SELECT 1 FROM membership WHERE user = ? AND tree = ?)', user, tree),
        q(
          `INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tree, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
             offsets = excluded.offsets, kinds = excluded.kinds, locale = excluded.locale, last_seen = excluded.last_seen`,
          crypto.randomUUID(), user, tree, endpoint, keys.p256dh, keys.auth, JSON.stringify(choices.offsets), JSON.stringify(choices.kinds), locale, stamp, stamp,
        ),
      ],
      result: undefined,
      // A racing change that the guards caught: the reader sends again and is checked afresh.
      refused: () => new AuthError('invalid', translate('en', 'err.somethingWrong')),
    };
  });
}

/** Turns reminders off for this device in one family. Returns how many families still have this device registered. */
export async function removeRegistration(user: string, tree: string, endpoint: string): Promise<number> {
  const a = accounts();
  await a.batch([q('DELETE FROM push_subscription WHERE user = ? AND tree = ? AND endpoint = ?', user, tree, endpoint)]);
  return (await a.get<{ n: number }>('SELECT count(*) AS n FROM push_subscription WHERE user = ? AND endpoint = ?', user, endpoint))?.n ?? 0;
}

/** Opening the app: the device has been seen now, so it is not paused or removed. */
export async function touchRegistration(user: string, tree: string, endpoint: string): Promise<void> {
  await accounts().run('UPDATE push_subscription SET last_seen = ? WHERE user = ? AND tree = ? AND endpoint = ?', now(), user, tree, endpoint);
}

/** The endpoint and keys a browser may register with: a push service Kindred may send to, and a real P-256 device key. */
export async function checkSubscription(subscription: PushSubscriptionLike): Promise<void> {
  if (!pushServiceAllowed(subscription.endpoint)) throw new AuthError('invalid', translate('en', 'reminders.err.endpoint'));
  if (!AUTH_SECRET.test(subscription.keys.auth) || !(await validDeviceKey(subscription.keys.p256dh))) {
    throw new AuthError('invalid', translate('en', 'reminders.err.keys'));
  }
}

// ---------- sending ----------

/** Sends this device a test message. Expired devices (404/410) are removed, as the daily run removes them. */
export async function sendTest(
  { user, tree, endpoint }: { user: string; tree: string; endpoint: string },
  vapid: VapidConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: 'sent' } | { status: 'expired' } | { status: 'failed'; code: number }> {
  const row = await subscriptionOf(user, tree, endpoint);
  if (!row) throw new AuthError('invalid', translate('en', 'reminders.testNeedsOn'));
  const response = await sendPush(subscriptionFrom(row), testMessage(tree, row.locale), vapid, fetchImpl);
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) {
    await accounts().batch([q('DELETE FROM push_subscription WHERE id = ?', row.id)]);
    return { status: 'expired' };
  }
  return response.ok ? { status: 'sent' } : { status: 'failed', code: response.status };
}

export interface DailyTotals { sent: number; removed: number; failed: number; skipped: number; errors: number }

/**
 * The daily run for the given families: every device gets the reminders due today at its chosen days (0, 1 and 7
 * days ahead), in its own language. A device is sent nothing when its owner is no longer a member, when it has not
 * been opened for STALE_DAYS, or when there is nothing due. Devices the owner has left, expired devices, and devices
 * the push service reports as gone (404, 410) are removed. One family failing does not stop the others. Nothing
 * is logged that names a person or a device.
 */
export async function sendDailyReminders({
  trees,
  now: at,
  vapid,
  fetchImpl = fetch,
  log,
  loadGraph,
}: {
  trees: string[];
  now: Date;
  vapid: VapidConfig;
  fetchImpl?: typeof fetch;
  log: (message: string) => void;
  loadGraph: (tree: string) => Promise<Graph>;
}): Promise<DailyTotals> {
  const totals: DailyTotals = { sent: 0, removed: 0, failed: 0, skipped: 0, errors: 0 };
  const utc = (offset: number) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + offset));
  const today = dayKey(utc(0));
  for (const tree of trees) {
    try {
      const graph = await loadGraph(tree);
      const occasions = new Map(OFFSETS.map((offset) => [offset as Offset, occasionsOn(graph, utc(offset))]));
      const names = new Map(graph.people.map((p) => [p.id, displayNameOf(p)]));
      const rows = await accounts().all<PushRow>('SELECT * FROM push_subscription WHERE tree = ?', tree);
      for (const row of rows) {
        const age = at.getTime() - row.last_seen;
        const member = await membership(row.user, tree);
        if (!member || !can(member.role, 'view') || age >= EXPIRE_DAYS * DAY_MS) {
          await accounts().batch([q('DELETE FROM push_subscription WHERE id = ?', row.id)]);
          totals.removed += 1;
          continue;
        }
        if (age >= STALE_DAYS * DAY_MS) continue;
        const choices = choicesOf(row);
        const message = choices && reminderMessage({ tree, locale: row.locale, choices, day: today }, occasions, names);
        if (!message) {
          totals.skipped += 1;
          continue;
        }
        try {
          const response = await sendPush(subscriptionFrom(row), message, vapid, fetchImpl);
          await response.body?.cancel();
          if (response.status === 404 || response.status === 410) {
            await accounts().batch([q('DELETE FROM push_subscription WHERE id = ?', row.id)]);
            totals.removed += 1;
          } else if (response.ok) {
            totals.sent += 1;
          } else {
            totals.failed += 1;
          }
        } catch {
          // One unreachable push service must not stop the others.
          totals.failed += 1;
        }
      }
    } catch (e) {
      totals.errors += 1;
      log(`family ${tree}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  return totals;
}
