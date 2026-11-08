// The reminders job: each device gets its reminders for the day, in its own language (src/lib/reminders.server.ts).
// Without VAPID keys (KINDRED_VAPID_*) it does nothing, and says so once a day.
import { graph } from '../db.server.ts';
import { sendDailyReminders, vapidFrom } from '../reminders.server.ts';
import type { DailyJob } from './types.ts';

export const remindersJob: DailyJob = {
  name: 'reminders',
  async run(ctx) {
    const vapid = vapidFrom(ctx.env);
    if (!vapid) {
      ctx.log('the VAPID keys are not set (KINDRED_VAPID_PUBLIC_KEY, KINDRED_VAPID_PRIVATE_JWK, KINDRED_VAPID_SUBJECT); nothing sent');
      return;
    }
    const totals = await sendDailyReminders({ trees: ctx.trees, now: ctx.now, vapid, log: ctx.log, loadGraph: graph });
    ctx.log(`sent ${totals.sent}, removed ${totals.removed}, failed ${totals.failed}, skipped ${totals.skipped}, family errors ${totals.errors}`);
  },
};
