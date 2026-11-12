// Starts a daily run: the families this deployment serves, then every daily job. Called by src/server.ts on both
// targets: from Cloudflare's cron trigger (scheduled) and from server/node.ts's daily timer.
import { families } from '../auth/trees.server.ts';
import { envSetting } from '../reminders.server.ts';
import { runDailyJobs } from './index.ts';
import { isDemo } from '../demo.ts';

/** Runs every daily job for the families this server holds, at `now`. */
export async function runJobs(now: Date, env: (name: string) => string | undefined, log: (message: string) => void = (message) => console.log(`[kindred] ${message}`)): Promise<void> {
  // A demo has nobody to remind and may change nothing, so its daily run has nothing to do.
  if (isDemo()) return log('demo: no daily jobs');
  const trees = (await families()).map((family) => family.id);
  const { recordJobRun } = await import('../operator/health.server.ts');
  await runDailyJobs({ trees, now, env, log }, undefined, recordJobRun);
}

/**
 * A setting reader for a Worker's `env` object (its variables and secrets). Falls back to process.env, which carries the
 * same values under nodejs_compat, so a setting is found wherever it was put.
 */
export function workerSetting(bindings: unknown): (name: string) => string | undefined {
  const record = (bindings ?? {}) as Record<string, unknown>;
  return (name) => {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    return envSetting(name)?.trim();
  };
}
