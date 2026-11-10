// The history's daily job: every family's change history older than KINDRED_HISTORY_YEARS (three by default; 0 keeps it for
// ever) is deleted, and the devices that asked for "This week in <family>" get it when their week is up and something is new
// (src/lib/history-push.server.ts). Without VAPID keys the pruning still runs and nothing is sent.
import { vapidFrom } from '../reminders.server.ts';
import type { DailyJob } from './types.ts';

export const historyJob: DailyJob = {
  name: 'history',
  async run(ctx) {
    const { keepYears, pruneHistory } = await import('../history.server.ts');
    const { db } = await import('../db.server.ts');
    const years = keepYears(ctx.env);
    let pruned = 0, errors = 0;
    for (const tree of ctx.trees) {
      try {
        pruned += await pruneHistory(db(tree), years, ctx.now.getTime());
      } catch (e) {
        errors += 1;
        ctx.log(`family ${tree}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    ctx.log(`pruned ${pruned} rows older than ${years || 'forever'} years, family errors ${errors}`);
    const vapid = vapidFrom(ctx.env);
    if (!vapid) return;
    const { sendWeeklyNews } = await import('../history-push.server.ts');
    const t = await sendWeeklyNews({ trees: ctx.trees, now: ctx.now, vapid, log: ctx.log });
    ctx.log(`weekly news: sent ${t.sent}, skipped ${t.skipped}, failed ${t.failed}, removed ${t.removed}, family errors ${t.errors}`);
  },
};
