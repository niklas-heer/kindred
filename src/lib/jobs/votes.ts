// The votes' daily job: the reminder about a day before a vote closes, to each member who asked for pushes about votes and
// has not voted (src/lib/votes/vote-push.server.ts `remindVotes`). The jobs run once a day, so each run reminds of the open
// votes closing within the next 30 hours (a day, and slack for a late run). A family whose reminders fail is skipped. A
// vote needs no job to close: one past its closing time reads as closed. Without VAPID keys (KINDRED_VAPID_*) it sends
// nothing. A demo runs no daily jobs (run.server.ts).
import { vapidFrom } from '../reminders.server.ts';
import type { DailyJob } from './types.ts';

export const votesJob: DailyJob = {
  name: 'votes',
  async run(ctx) {
    const vapid = vapidFrom(ctx.env);
    if (!vapid) {
      ctx.log('the VAPID keys are not set; no reminders sent');
      return;
    }
    const { remindVotes } = await import('../votes/vote-push.server.ts');
    let sent = 0;
    for (const tree of ctx.trees) sent += await remindVotes(tree, ctx.now, { vapid });
    ctx.log(`sent ${sent} reminders about votes closing within the next 30 hours`);
  },
};
