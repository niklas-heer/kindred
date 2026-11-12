// The operator's statistics of the whole server (src/lib/operator/stats.server.ts): yesterday's aggregates, on the first run
// the days before it reconstructed, and rows past three years deleted. Reads the accounts database only. A demo runs no daily
// jobs (run.server.ts).
import type { DailyJob } from './types.ts';

export const instanceStatsJob: DailyJob = {
  name: 'instance-stats',
  async run(ctx) {
    const { snapshot, pruneInstanceDays } = await import('../operator/stats.server.ts');
    const now = ctx.now.getTime();
    const r = await snapshot(ctx.trees, now);
    await pruneInstanceDays(now);
    ctx.log(`counted ${r.day}${r.backfilled ? `, reconstructed ${r.backfilled} earlier days` : ''}`);
  },
};
