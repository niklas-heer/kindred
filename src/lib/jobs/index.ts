// The daily job runner. Each job runs once a day for every family: on Cloudflare from the cron trigger (src/server.ts,
// scheduled), on Node from a timer (server/node.ts). Jobs run in turn; a failure is logged, and the next job still runs.
import { aiTasksJob } from './ai-tasks.ts';
import { archiveJob } from './archive.ts';
import { joinJob } from './join.ts';
import { feedJob } from './feed.ts';
import { historyJob } from './history.ts';
import { instanceStatsJob } from './instance-stats.ts';
import { recipesJob } from './recipes.ts';
import { remindersJob } from './reminders.ts';
import { statsJob } from './stats.ts';
import { storageJob } from './storage.ts';
import { updateCheckJob } from './update-check.ts';
import type { DailyJob, JobContext } from './types.ts';

export type { DailyJob, JobContext } from './types.ts';

/** Every daily job, in the order they run. */
export const DAILY_JOBS: readonly DailyJob[] = [
  remindersJob,
  archiveJob,
  aiTasksJob,
  statsJob,
  joinJob,
  historyJob,
  feedJob,
  recipesJob,
  storageJob,
  instanceStatsJob,
  updateCheckJob,
];

/** How a job's run ended, for the operator's Health tab (src/lib/operator/health.server.ts). */
export interface JobRun { job: string; startedAt: number; finishedAt: number; error: string | null }

/**
 * Runs each job with the context, its log lines marked with the job's name. A job that throws is logged and skipped:
 * the rest still run. `record`, when given, hears how each one ended; it must not throw (runJobs passes one that stores it).
 */
export async function runDailyJobs(ctx: JobContext, jobs: readonly DailyJob[] = DAILY_JOBS, record?: (run: JobRun) => Promise<void>): Promise<void> {
  for (const job of jobs) {
    const log = (message: string) => ctx.log(`${job.name}: ${message}`);
    const startedAt = Date.now();
    let error: string | null = null;
    try {
      await job.run({ ...ctx, log });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log(`failed: ${error}`);
    }
    await record?.({ job: job.name, startedAt, finishedAt: Date.now(), error });
  }
}
