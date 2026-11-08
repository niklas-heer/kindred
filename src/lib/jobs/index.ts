// The daily job runner. Each job runs once a day for every family: on Cloudflare from the cron trigger (src/server.ts,
// scheduled), on Node from a timer (server/node.ts). Jobs run in turn; a failure is logged, and the next job still runs.
import { aiTasksJob } from './ai-tasks.ts';
import { archiveJob } from './archive.ts';
import { remindersJob } from './reminders.ts';
import type { DailyJob, JobContext } from './types.ts';

export type { DailyJob, JobContext } from './types.ts';

/** Every daily job, in the order they run. */
export const DAILY_JOBS: readonly DailyJob[] = [
  remindersJob,
  archiveJob,
  aiTasksJob,
];

/**
 * Runs each job with the context, its log lines marked with the job's name. A job that throws is logged and skipped:
 * the rest still run.
 */
export async function runDailyJobs(ctx: JobContext, jobs: readonly DailyJob[] = DAILY_JOBS): Promise<void> {
  for (const job of jobs) {
    const log = (message: string) => ctx.log(`${job.name}: ${message}`);
    try {
      await job.run({ ...ctx, log });
    } catch (e) {
      log(`failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
