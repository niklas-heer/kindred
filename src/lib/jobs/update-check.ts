// "Am I up to date?" (src/lib/operator/updates.server.ts): asks GitHub for the latest release at most once a day, only after
// an operator agreed to it and unless KINDRED_UPDATE_CHECK=off. A failure is logged and kept for the console.
import type { DailyJob } from './types.ts';

export const updateCheckJob: DailyJob = {
  name: 'update-check',
  async run(ctx) {
    const { checkForUpdate } = await import('../operator/updates.server.ts');
    ctx.log((await checkForUpdate(ctx.now.getTime())) ? 'asked for the latest release' : 'nothing to ask today');
  },
};
