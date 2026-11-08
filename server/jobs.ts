// The Node server's daily timer for the jobs (src/lib/jobs): the next run is 06:00 UTC, never at startup. The timer
// re-arms itself after each run. server/node.ts starts it unless KINDRED_JOBS=off.

/** The hour (UTC) every daily run starts: the same instant as the Cloudflare cron trigger in wrangler.jsonc. */
export const JOBS_HOUR_UTC = 6;

/** The next 06:00 UTC strictly after `now`. */
export function nextJobsAt(now: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), JOBS_HOUR_UTC));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Calls `run` at each 06:00 UTC, with that time. Returns a function that stops the timer. A run that throws is logged,
 * and the next one is still scheduled.
 */
export function scheduleDailyJobs(run: (now: Date) => Promise<void>, clock: () => Date = () => new Date()): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    const current = clock();
    timer = setTimeout(() => {
      run(clock())
        .catch((e: unknown) => console.error(`[kindred] daily jobs failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(arm);
    }, Math.max(0, nextJobsAt(current).getTime() - current.getTime()));
  };
  arm();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
