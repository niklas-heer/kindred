// The daily clean-up of usage statistics: last-seen markers past their retention and very old counters (src/lib/stats).
import type { DailyJob } from './types.ts';

export const statsJob: DailyJob = {
  name: 'stats',
  run: async (ctx) => {
    const { pruneStats } = await import('../stats/store.server.ts');
    await pruneStats(ctx.now.getTime());
  },
};
