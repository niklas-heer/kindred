// Telling a family's stewards something the server decided (accounts migration 0052, `steward_notice`): today the lifecycle of
// abandoned families (src/lib/lifecycle/). One call, `notifyStewards(tree, kind, vars)`, reaches them every way the server has:
//   in the app   a notice row the family's bar reads (src/components/lifecycle/LifecycleNotice.tsx)
//   by push      every device of the family's stewards that has push on, in that device's language
//   by email     each steward with a verified address, when the server sends email (src/lib/email/); the final notice before a
//                deletion is a `notice`, which cannot be unsubscribed, the others carry the family notices' unsubscribe
// The notice row records how many stewards the email and the push reached (`emailed`, `pushed`; accounts migration 0056): the
// lifecycle deletes a family by itself only once its final notice reached one of them (src/lib/lifecycle/lifecycle.server.ts).
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

/** The kinds a steward cannot unsubscribe from by email: the last word before the family is deleted. */
const MUST_REACH: readonly StewardNoticeKind[] = ['lifecycle_final'];

/**
 * Tells the stewards of `tree`. The in-app notice is written first (it throws if it cannot be); the email and the push are best
 * effort, and a device the push service reports gone is removed, as the reminders remove theirs. Waits for both (the daily job
 * calls it, not a page), records on the notice how many stewards each reached, and returns that.
 */
export async function notifyStewards(tree: string, kind: StewardNoticeKind, vars: NoticeVars, opts: NotifyOptions): Promise<{ emailed: number; pushed: number }> {
  const now = opts.now ?? Date.now();
  const [inserted] = await accounts().batch([q('INSERT INTO steward_notice (tree, kind, vars, at) VALUES (?, ?, ?, ?) RETURNING id', tree, kind, JSON.stringify(vars), now)]);
  const id = (inserted!.rows as { id: number }[])[0]!.id;
  // By email too, where the server sends email: each steward with a verified address, in their language, with the same title
  // and body and a link to the family (KINDRED_ORIGIN: a job has no request). Never fails the notice (src/lib/email/notify.server.ts).
  let emailed = 0;
  try {
    const { mailStewards } = await import('../email/notify.server.ts');
    emailed = await mailStewards(tree, (_t, { origin, family, locale }) => {
      const n = noticeText(kind, vars, locale, family);
      return { subject: n.title, paragraphs: [n.body], action: { label: translate(locale, 'lifecycle.email_action'), url: `${origin}/${tree}` } };
    }, { category: MUST_REACH.includes(kind) ? 'notice' : 'family' });
  } catch {}
  const pushed = await pushToStewards(tree, kind, vars, opts);
  try {
    await accounts().run('UPDATE steward_notice SET emailed = ?, pushed = ? WHERE id = ?', emailed, pushed, id);
  } catch {}
  return { emailed, pushed };
}

/** Whether the latest notice of `kind` to the stewards of `tree` reached one of them by email or by push. A query's condition. */
export const NOTICE_REACHED = (kind: StewardNoticeKind) =>
  `EXISTS (SELECT 1 FROM steward_notice n WHERE n.tree = ? AND n.kind = '${kind}' AND (n.emailed > 0 OR n.pushed > 0))`;

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
