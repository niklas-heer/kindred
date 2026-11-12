// Telling a family's stewards something the server decided (accounts migration 0052, `steward_notice`): today the lifecycle of
// abandoned families (src/lib/lifecycle/). One call, `notifyStewards(tree, kind, vars)`, reaches them every way the server has:
//   in the app   a notice row the family's bar reads (src/components/lifecycle/LifecycleNotice.tsx)
//   by push      every device of the family's stewards that has push on, in that device's language
//   by email     not yet (see EMAIL below)
// Never throws past the in-app notice, and logs nothing that names anyone. `vars` are dates and numbers, never record content.
import { formatDate, translate, type Key } from '../i18n/dictionary.ts';
import type { Locale } from '../i18n/types.ts';
import { envSetting, vapidFrom } from '../reminders.server.ts';
import { q, store } from '../store/index.ts';
import { pushServiceAllowed, sendPush, type VapidConfig } from '../webpush.ts';

const accounts = () => store.accounts();

export const STEWARD_NOTICE_KINDS = ['lifecycle_warning', 'lifecycle_readonly', 'lifecycle_due', 'lifecycle_final'] as const;
export type StewardNoticeKind = (typeof STEWARD_NOTICE_KINDS)[number];
/** Dates (ms since 1970) and counts. A key ending in `At` is a date, written in the reader's language. */
export type NoticeVars = Record<string, number>;

const TEXT: Record<StewardNoticeKind, { title: Key; body: Key }> = {
  lifecycle_warning: { title: 'lifecycle.push_warning_title', body: 'lifecycle.push_warning_body' },
  lifecycle_readonly: { title: 'lifecycle.push_readonly_title', body: 'lifecycle.push_readonly_body' },
  lifecycle_due: { title: 'lifecycle.push_due_title', body: 'lifecycle.push_due_body' },
  lifecycle_final: { title: 'lifecycle.push_final_title', body: 'lifecycle.push_final_body' },
};

/** The values as a sentence takes them in `locale`: dates written out, numbers as they are. */
export const noticeVars = (vars: NoticeVars, locale: Locale, name: string): Record<string, string | number> =>
  Object.fromEntries([['family', name], ...Object.entries(vars).map(([k, v]) => [k, k.endsWith('At') ? formatDate(v, locale, { dateStyle: 'long' }) : v])]);

/** What the push says, in the device's language. */
export const noticeText = (kind: StewardNoticeKind, vars: NoticeVars, locale: Locale, name: string) => {
  const v = noticeVars(vars, locale, name);
  return { title: translate(locale, TEXT[kind].title, v), body: translate(locale, TEXT[kind].body, v) };
};

export interface NotifyOptions {
  /** The family's name, for the push. */
  name: string;
  vapid?: VapidConfig | null;
  fetchImpl?: typeof fetch;
  now?: number;
}

/**
 * Tells the stewards of `tree`. The in-app notice is written first (it throws if it cannot be); the push is best effort, and a
 * device the push service reports gone is removed, as the reminders remove theirs. Returns how many pushes were delivered.
 */
export async function notifyStewards(tree: string, kind: StewardNoticeKind, vars: NoticeVars, opts: NotifyOptions): Promise<number> {
  const now = opts.now ?? Date.now();
  await accounts().batch([q('INSERT INTO steward_notice (tree, kind, vars, at) VALUES (?, ?, ?, ?)', tree, kind, JSON.stringify(vars), now)]);
  // EMAIL: once the server can send email (the `email` lane), each steward with a verified address gets this notice too,
  // in their language, with the same title and body (noticeText) and a link to the family.
  return pushToStewards(tree, kind, vars, opts);
}

async function pushToStewards(tree: string, kind: StewardNoticeKind, vars: NoticeVars, opts: NotifyOptions): Promise<number> {
  const vapid = opts.vapid === undefined ? vapidFrom(envSetting) : opts.vapid;
  if (!vapid) return 0;
  let sent = 0;
  try {
    if (!(await (await import('../operator/policy.server.ts')).familyAllows(tree, 'feature.push', { evenSuspended: true }))) return 0;
    const rows = await accounts().all<{ id: string; endpoint: string; p256dh: string; auth: string; locale: Locale }>(
      "SELECT p.id, p.endpoint, p.p256dh, p.auth, p.locale FROM push_subscription p JOIN membership m ON m.user = p.user AND m.tree = p.tree WHERE p.tree = ? AND m.role = 'steward'",
      tree);
    await Promise.allSettled(rows.filter((r) => pushServiceAllowed(r.endpoint)).map(async (r) => {
      const message = { ...noticeText(kind, vars, r.locale, opts.name), tag: `kindred-${kind}-${tree}`, url: `/${tree}` };
      const response = await sendPush({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, message, vapid, opts.fetchImpl ?? fetch);
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) await accounts().run('DELETE FROM push_subscription WHERE id = ?', r.id);
      else if (response.ok) sent++;
    }));
  } catch {}
  return sent;
}

/** Withdraws the notices of these kinds (the lifecycle's, once the family is active again). A query, for the caller's batch. */
export const withdrawNotices = (tree: string, kinds: readonly StewardNoticeKind[] = STEWARD_NOTICE_KINDS) =>
  q(`DELETE FROM steward_notice WHERE tree = ? AND kind IN (${kinds.map(() => '?').join(', ')})`, tree, ...kinds);
