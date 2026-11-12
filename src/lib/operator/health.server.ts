// The operator console's Health tab (docs/hosting-many-families.md, "Health"): how the daily jobs last ran (accounts table
// `job_run`, migration 0047, written by the job runner), which families failed a migration or have not caught up yet
// (`family_schema`, reported by the storage drivers, src/lib/store/schema-report.ts), how old the last backup is when this
// install makes one (the nightly archive, src/lib/jobs/archive.ts), the running version and the update check's last answer.
// Reads the accounts database only: no family is opened.
import type { JobRun } from '../jobs/index.ts';
import { appCommit, appVersion } from '../version.ts';
import { store } from '../store/index.ts';
import type { Health } from './health-shared.ts';
import { updateStatus } from './updates.server.ts';

const accounts = () => store.accounts();
/** At most this many families are named in each list; the count says how many there are. */
const LISTED = 50;

/** Stores how a daily job's run ended (the runner's `record`). Never throws: a run is not failed by its bookkeeping. */
export async function recordJobRun(run: JobRun): Promise<void> {
  try {
    await accounts().run(
      `INSERT INTO job_run (job, started_at, finished_at, ok, error, last_ok_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(job) DO UPDATE SET started_at = excluded.started_at, finished_at = excluded.finished_at, ok = excluded.ok,
       error = excluded.error, last_ok_at = COALESCE(excluded.last_ok_at, job_run.last_ok_at)`,
      run.job, run.startedAt, run.finishedAt, run.error ? 0 : 1, run.error?.slice(0, 300) ?? null, run.error ? null : run.finishedAt,
    );
  } catch (e) {
    console.warn(`[kindred] could not record the ${run.job} job's run: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Whether this install archives any family nightly (KINDRED_ARCHIVE_<ID>_REPO, docs/exchange.md). */
export const archiveConfigured = (env: Record<string, string | undefined> = process.env): boolean =>
  Object.keys(env).some((k) => /^KINDRED_ARCHIVE_[A-Z0-9_]+_REPO$/.test(k) && !!env[k]?.trim());

/** Everything the Health tab shows, at `now`. `version` and `commit` are for tests (a test build has none). */
export async function readHealth(opts: { version?: string | null; commit?: string | null; archive?: boolean } = {}): Promise<Health> {
  const [jobs, schemas, families, check] = await Promise.all([
    accounts().all<{ job: string; started_at: number; finished_at: number; ok: number; error: string | null; last_ok_at: number | null }>(
      'SELECT job, started_at, finished_at, ok, error, last_ok_at FROM job_run ORDER BY job'),
    accounts().all<{ tree: string; migration: string | null; error: string | null; reported_at: number }>(
      'SELECT tree, migration, error, reported_at FROM family_schema ORDER BY tree'),
    store.treeIds(),
    updateStatus({ version: opts.version, commit: opts.commit }),
  ]);
  const known = new Set(families);
  const rows = schemas.filter((s) => known.has(s.tree));
  // The newest migration any family reported is this deploy's (each family reports what it holds once opened after a deploy).
  const newest = rows.reduce<string | null>((m, s) => (s.migration && (!m || s.migration > m) ? s.migration : m), null);
  const failed = rows.filter((s) => s.error);
  const behind = rows.filter((s) => !s.error && newest && s.migration && s.migration < newest);
  const reported = new Set(rows.map((s) => s.tree));
  const archive = opts.archive ?? archiveConfigured();
  const archiveRun = jobs.find((j) => j.job === 'archive');
  return {
    version: opts.version !== undefined ? opts.version : appVersion(),
    commit: opts.commit !== undefined ? opts.commit : appCommit(),
    lastDailyRun: jobs.reduce<number | null>((m, j) => (m === null || j.started_at > m ? j.started_at : m), null),
    jobs: jobs.map((j) => ({ job: j.job, startedAt: j.started_at, finishedAt: j.finished_at, ok: j.ok === 1, error: j.error, lastOkAt: j.last_ok_at })),
    families: {
      total: families.length,
      newest,
      failed: { count: failed.length, list: failed.slice(0, LISTED).map((s) => ({ tree: s.tree, migration: s.migration, error: s.error, at: s.reported_at })) },
      behind: { count: behind.length, list: behind.slice(0, LISTED).map((s) => ({ tree: s.tree, migration: s.migration, error: null, at: s.reported_at })) },
      unreported: families.filter((f) => !reported.has(f)).length,
    },
    backup: archive ? { configured: true, lastOkAt: archiveRun?.last_ok_at ?? null, failing: archiveRun ? archiveRun.ok === 0 : false } : { configured: false, lastOkAt: null, failing: false },
    check: { enabled: check.enabled, checkedAt: check.checkedAt, latest: check.latest, error: check.error, updateAvailable: check.updateAvailable },
  };
}
