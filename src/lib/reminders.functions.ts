// Web Push reminders, for the browser: whether this server can send them, this device's choices for one family, and
// the actions that change them (turn on or save, turn off, a test, and the refresh when the app opens). Every call
// needs a membership of the family, so only its members can register a device for it. Server-only code is imported
// inside each handler, so none of it ships to the browser (the pattern in src/lib/auth/functions.ts).
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { LOCALES } from './i18n/types.ts';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const endpoint = z.string().min(1).max(1024);
const subscription = z.object({ endpoint, keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

const member = () => import('./auth/guard.server.ts');
const remind = () => import('./reminders.server.ts');

/** Gives an auth error its HTTP status (400, 401, 403) before it is thrown, as the rest of the app does. Other errors pass on. */
async function refuse(e: unknown): Promise<never> {
  const [{ fail }, { AuthError }] = await Promise.all([member(), import('./auth/errors.ts')]);
  if (e instanceof AuthError) throw fail(e);
  throw e;
}

/** Whether this server has its VAPID keys, so reminders can be offered at all. Needs no sign-in: it reveals nothing. */
export const fetchRemindersAvailable = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean> => {
  const r = await remind();
  return r.vapidFrom(r.envSetting) !== null;
});

export interface ReminderStatus {
  /** The server has its VAPID keys; false hides the feature. */
  available: boolean;
  /** The public key the browser subscribes with (not a secret). */
  publicKey: string | null;
  /** This device has reminders for this family. */
  subscribed: boolean;
  offsets: number[];
  kinds: string[];
  /** This device also gets "This week in <family>". */
  weekly: boolean;
  /** This device is also told of a new post in the family's feed. */
  posts: boolean;
}

export const reminderStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, endpoint: endpoint.optional() }))
  .handler(async ({ data }): Promise<ReminderStatus> => {
    const [{ requireMember }, r] = await Promise.all([member(), remind()]);
    const { user } = await requireMember(data.tree);
    const vapid = r.vapidFrom(r.envSetting);
    const row = data.endpoint ? await r.subscriptionOf(user.id, data.tree, data.endpoint) : undefined;
    const choices = row ? r.choicesOf(row) : null;
    return {
      available: vapid !== null,
      publicKey: vapid?.publicKey ?? null,
      subscribed: !!row,
      offsets: choices?.offsets ?? [],
      kinds: choices?.kinds ?? [],
      weekly: row?.weekly === 1,
      posts: row?.posts === 1,
    };
  });

/** Turns reminders on for this device in this family, or saves changed choices. */
export const saveReminders = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, subscription, offsets: z.array(z.number()).max(3), kinds: z.array(z.string()).max(3), locale: z.enum(LOCALES), weekly: z.boolean().optional(), posts: z.boolean().optional() }))
  .handler(async ({ data }) => {
    try {
      const [{ requireMember }, r, { translate }, { parseChoices }, { AuthError }] = await Promise.all([
        member(), remind(), import('./i18n/dictionary.ts'), import('./reminders.ts'), import('./auth/errors.ts'),
      ]);
      const { user } = await requireMember(data.tree);
      if (!r.vapidFrom(r.envSetting)) throw new AuthError('invalid', translate('en', 'reminders.err.unavailable'));
      const choices = parseChoices(data.offsets, data.kinds);
      if (!choices) throw new AuthError('invalid', translate('en', 'reminders.chooseSomething'));
      await r.checkSubscription(data.subscription);
      await r.saveRegistration({ user: user.id, tree: data.tree, subscription: data.subscription, choices, locale: data.locale, weekly: data.weekly === true, posts: data.posts === true });
    } catch (e) {
      throw await refuse(e);
    }
  });

/** Turns reminders off for this device in this family. `remaining` counts the families that still have the device. */
export const removeReminders = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, endpoint }))
  .handler(async ({ data }): Promise<{ remaining: number }> => {
    const [{ requireMember }, r] = await Promise.all([member(), remind()]);
    const { user } = await requireMember(data.tree);
    return { remaining: await r.removeRegistration(user.id, data.tree, data.endpoint) };
  });

/** Signing out on this device: the signed-in account's reminders for this browser are removed, in every family. */
export const forgetThisDevice = createServerFn({ method: 'POST' })
  .validator(z.object({ endpoint }))
  .handler(async ({ data }): Promise<void> => {
    const [{ currentSession }, r] = await Promise.all([member(), remind()]);
    const { user } = await currentSession();
    if (user) await r.forgetDevice(user.id, data.endpoint);
  });

/** The app was opened on this device: its last-seen time is refreshed, so it keeps getting reminders. */
export const touchReminders = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, endpoint }))
  .handler(async ({ data }) => {
    const [{ requireMember }, r] = await Promise.all([member(), remind()]);
    const { user } = await requireMember(data.tree);
    await r.touchRegistration(user.id, data.tree, data.endpoint);
  });

export type TestResult = { status: 'sent' } | { status: 'expired' } | { status: 'failed'; code: number };

/** One test push to this device. The device must have reminders on for the family. */
export const sendTestReminder = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, endpoint }))
  .handler(async ({ data }): Promise<TestResult> => {
    try {
      const [{ requireMember }, r, { translate }, { AuthError }] = await Promise.all([member(), remind(), import('./i18n/dictionary.ts'), import('./auth/errors.ts')]);
      const { user } = await requireMember(data.tree);
      const vapid = r.vapidFrom(r.envSetting);
      if (!vapid) throw new AuthError('invalid', translate('en', 'reminders.err.unavailable'));
      return await r.sendTest({ user: user.id, tree: data.tree, endpoint: data.endpoint }, vapid);
    } catch (e) {
      throw await refuse(e);
    }
  });
