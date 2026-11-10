// The campaign's daily job: in every family that has the game on, the nights that have passed are played (the regents
// move, the levy arrives, a finished season is closed and the next begins), and members whose house lost a province
// get their one push of the day. The same catch-up runs when someone opens the game (src/lib/campaign/campaign.server.ts),
// so a server without daily jobs still plays correctly.
import { vapidFrom } from '../reminders.server.ts';
import type { DailyJob } from './types.ts';

export const campaignJob: DailyJob = {
  name: 'campaign',
  async run(ctx) {
    const { advance } = await import('../campaign/campaign.server.ts');
    const { notifyFallen } = await import('../campaign/push.server.ts');
    const vapid = vapidFrom(ctx.env);
    let played = 0, sent = 0, errors = 0;
    for (const tree of ctx.trees) {
      try {
        const fallen = await advance(tree, ctx.now);
        played += 1;
        sent += await notifyFallen(tree, fallen, { now: ctx.now, vapid });
      } catch (e) {
        errors += 1;
        ctx.log(`family ${tree}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    ctx.log(`families ${played}, pushes ${sent}, family errors ${errors}`);
  },
};
