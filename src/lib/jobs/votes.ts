// The votes' daily job. First, for every family, it settles the arms votes that closed (src/lib/arms-proposals/settle.server.ts
// `settleArmsVotes`: marks them closed, settles them, and in vote mode starts each house's next one), whether or not push is
// set up. Then the reminder about a day before a vote closes, to each member who asked for pushes about votes and has not
// voted (src/lib/votes/vote-push.server.ts `remindVotes`). The jobs run once a day, so each run reminds of the open votes
// closing within the next 30 hours (a day, and slack for a late run). A family whose reminders fail is skipped. An ordinary
// vote needs no job to close: one past its closing time reads as closed. Without VAPID keys (KINDRED_VAPID_*) it sends
// nothing. A demo runs no daily jobs (run.server.ts).
import { vapidFrom } from '../reminders.server.ts';
import type { DailyJob } from './types.ts';

export const votesJob: DailyJob = {
  name: 'votes',
  async run(ctx) {
    // Before the push keys are asked for: a house's arms vote is settled without them (settleArmsVotes never throws).
    const { settleArmsVotes } = await import('../arms-proposals/settle.server.ts');
    let settled = 0;
    let started = 0;
    for (const tree of ctx.trees) {
      const r = await settleArmsVotes(tree, ctx.now);
      settled += r.settled;
      started += r.started;
    }
    if (settled || started) ctx.log(`settled ${settled} arms votes and started ${started}`);
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
