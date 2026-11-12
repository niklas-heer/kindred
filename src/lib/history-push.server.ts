// "This week in <family>": a weekly push to the devices that asked for it (push_subscription.weekly, accounts migration 0026),
// sent by the daily job, only when the week brought something this member may see and did not do themselves. At most one
// push per device in seven days: the device's week is claimed with one conditional UPDATE before the send, as the daily
// reminders claim their day (reminders.server.ts). Nothing is logged that names a person or a device.
import { accounts, membership, q } from './auth/store.server.ts';
import { db } from './db.server.ts';
import { lineText } from './history-text.ts';
import { whatsNew } from './history.server.ts';
import { translate } from './i18n/dictionary.ts';
import type { Locale } from './i18n/types.ts';
import { can } from './roles.ts';
import { dayKey, type ReminderMessage } from './reminders.ts';
import { STALE_DAYS, subscriptionFrom, type PushRow } from './reminders.server.ts';
import { replyKey, type WhatsNew } from './history.ts';
import { fitsPush, sendPush, type VapidConfig } from './webpush.ts';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** The lines a weekly push shows before "and n more". */
const LINES = 4;

/** The push for one member's week, in one language. Null when there is nothing to say. */
export function weeklyMessage(tree: string, family: string, locale: Locale, news: WhatsNew): ReminderMessage | null {
  const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate(locale, key, vars);
  const lines: string[] = [];
  for (const g of news.groups) {
    for (const l of g.lines) lines.push(g.name ? `${g.name}: ${lineText(t, l)}` : lineText(t, l));
  }
  for (const p of news.posts) lines.push(t('feed.news.posts', { author: p.author, count: p.count }));
  for (const r of news.replies) {
    lines.push(t(replyKey(r), { author: r.author, count: r.count }));
  }
  if (!lines.length) return null;
  const message = (shown: number): ReminderMessage => ({
    title: t('history.push.title', { family }),
    body: [...lines.slice(0, shown), ...(lines.length > shown ? [t('history.push.more', { count: lines.length - shown })] : [])].join('\n'),
    tag: `kindred-week-${tree}`,
    // The history has the changes; a week that brought only messages opens where they are.
    url: news.groups.length ? `/${tree}/history` : `/${tree}/today`,
  });
  let shown = Math.min(LINES, lines.length);
  while (shown > 1 && !fitsPush(message(shown))) shown -= 1;
  const m = message(shown);
  return fitsPush(m) ? m : { ...m, body: m.body.slice(0, 300) };
}

export interface WeeklyTotals { sent: number; skipped: number; failed: number; removed: number; errors: number }

/**
 * Sends each device that asked for it its family's week, at most once in seven days. A device is sent nothing when its
 * owner is no longer a member, when it has not been opened for STALE_DAYS, or when the week holds nothing new for its
 * owner. The claim is taken only when there is something to send, so a quiet week does not use up the next one.
 */
export async function sendWeeklyNews({ trees, now, vapid, fetchImpl = fetch, log }: {
  trees: string[]; now: Date; vapid: VapidConfig; fetchImpl?: typeof fetch; log: (message: string) => void;
}): Promise<WeeklyTotals> {
  const totals: WeeklyTotals = { sent: 0, skipped: 0, failed: 0, removed: 0, errors: 0 };
  const today = dayKey(now);
  const weekAgo = dayKey(new Date(now.getTime() - WEEK_MS + DAY_MS / 2));
  for (const tree of trees) {
    try {
      // The operator's policy: a family whose push is off gets none, and its devices stay registered.
      if (!(await (await import('./operator/policy.server.ts')).familyAllows(tree, 'feature.push'))) continue;
      const rows = await accounts().all<PushRow & { weekly_sent_day: string | null }>('SELECT * FROM push_subscription WHERE tree = ? AND weekly = 1', tree);
      if (!rows.length) continue;
      const family = (await db(tree).get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value ?? tree;
      const newsOf = new Map<string, WhatsNew | null>();
      for (const row of rows) {
        if (now.getTime() - row.last_seen >= STALE_DAYS * DAY_MS || (row.weekly_sent_day && row.weekly_sent_day > weekAgo)) {
          totals.skipped += 1;
          continue;
        }
        if (!newsOf.has(row.user)) {
          const m = await membership(row.user, tree);
          newsOf.set(row.user, m && can(m.role, 'view')
            ? await whatsNew(db(tree), { account: row.user, role: m.role, guest: false }, now.getTime() - WEEK_MS)
            : null);
        }
        const news = newsOf.get(row.user);
        const message = news && weeklyMessage(tree, family, row.locale, news);
        if (!message) {
          totals.skipped += 1;
          continue;
        }
        const claim = await accounts().run(
          'UPDATE push_subscription SET weekly_sent_day = ? WHERE id = ? AND (weekly_sent_day IS NULL OR weekly_sent_day <= ?)', today, row.id, weekAgo);
        if (claim.changes !== 1) {
          totals.skipped += 1;
          continue;
        }
        try {
          const response = await sendPush(subscriptionFrom(row), message, vapid, fetchImpl);
          await response.body?.cancel();
          if (response.status === 404 || response.status === 410) {
            await accounts().batch([q('DELETE FROM push_subscription WHERE id = ?', row.id)]);
            totals.removed += 1;
          } else if (response.ok) totals.sent += 1;
          else totals.failed += 1;
        } catch {
          // Maybe delivered: the week's claim stays, as a duplicate is worse than a miss.
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
