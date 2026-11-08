// The background AI tasks, once a day: the arms review, and the occupation and chronicle translations, for each family that
// switched one on (src/lib/ai/background.server.ts). Off by default, and a family without its AI set up is skipped quietly.
// The run is capped in calls (CALLS_PER_DAILY_RUN) and each task works in small batches, so work left over waits for the next day.
import type { DailyJob } from './types.ts';

export const aiTasksJob: DailyJob = {
  name: 'ai-tasks',
  async run(ctx) {
    // With no family there is nothing to do. The AI modules load only when there is a family to work on, so loading the job
    // registry (the daily runner, and the tests that load it) does not pull them in.
    if (ctx.trees.length === 0) return;
    const { runScheduled } = await import('../ai/background.server.ts');
    await runScheduled(ctx.trees, ctx.now, ctx.log);
  },
};
