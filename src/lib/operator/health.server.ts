// The operator console's Health tab (docs/hosting-many-families.md, "Health"): how the daily jobs last ran (accounts table
// `job_run`, migration 0047, written by the job runner), which families failed a migration or have not caught up yet
// (`family_schema`, reported by the storage drivers, src/lib/store/schema-report.ts), how old the last backup is when this
// install makes one (the nightly archive, src/lib/jobs/archive.ts), the running version and the update check's last answer.
// Reads the accounts database only: no family is opened.
import type { JobRun } from '../jobs/index.ts';
import { sanitiseFailure } from '../jobs/failure.ts';
import { appCommit, appVersion } from '../version.ts';
import { q, store } from '../store/index.ts';
import type { Health, PausedAi } from './health-shared.ts';
import { audit } from './settings.server.ts';
import { updateStatus } from './updates.server.ts';

const accounts = () => store.accounts();
/** At most this many families are named in each list; the count says how many there are. */
const LISTED = 50;

/**
 * Stores how a daily job's run ended (the runner's `record`): a failure as its code and a sanitised message, with no family's
 * id, address or quoted text in it (../jobs/failure.ts; the server's log has the whole message). Never throws: a run is not
 * failed by its bookkeeping.
 */
export async function recordJobRun(run: JobRun): Promise<void> {
  try {
    const failed = run.error !== null;
    const message = failed ? sanitiseFailure(run.error!, await store.treeIds().catch(() => [])) : null;
    await accounts().run(
      `INSERT INTO job_run (job, started_at, finished_at, ok, error, code, last_ok_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job) DO UPDATE SET started_at = excluded.started_at, finished_at = excluded.finished_at, ok = excluded.ok,
       error = excluded.error, code = excluded.code, last_ok_at = COALESCE(excluded.last_ok_at, job_run.last_ok_at)`,
      run.job, run.startedAt, run.finishedAt, failed ? 0 : 1, message, failed ? (run.code ?? 'error') : null, failed ? null : run.finishedAt,
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
  const month = new Date().toISOString().slice(0, 7);
  const [jobs, schemas, families, check, overage, paused] = await Promise.all([
    accounts().all<{ job: string; started_at: number; finished_at: number; ok: number; error: string | null; code: string | null; last_ok_at: number | null }>(
      'SELECT job, started_at, finished_at, ok, error, code, last_ok_at FROM job_run ORDER BY job'),
    accounts().all<{ tree: string; migration: string | null; error: string | null; reported_at: number }>(
      'SELECT tree, migration, error, reported_at FROM family_schema ORDER BY tree'),
    store.treeIds(),
    updateStatus({ version: opts.version, commit: opts.commit }),
    // Operator-funded AI calls the provider billed above their reservation this month (operator-funding.server.ts).
    accounts().get<{ calls: number; micros: number | null }>('SELECT count(*) AS calls, sum(micros) AS micros FROM ai_operator_overage WHERE month = ?', month),
    // Each family and model paused by an overage the operator has not acknowledged yet, from any month.
    accounts().all<PausedAi>(`SELECT family, model, count(*) AS calls, sum(micros) AS micros, min(at) AS since FROM ai_operator_overage
      WHERE acknowledged_at IS NULL AND model IS NOT NULL GROUP BY family, model ORDER BY min(at)`),
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
    jobs: jobs.map((j) => ({ job: j.job, startedAt: j.started_at, finishedAt: j.finished_at, ok: j.ok === 1, code: j.ok === 1 ? null : j.code, error: j.error, lastOkAt: j.last_ok_at })),
    families: {
      total: families.length,
      newest,
      failed: { count: failed.length, list: failed.slice(0, LISTED).map((s) => ({ tree: s.tree, migration: s.migration, error: s.error, at: s.reported_at })) },
      behind: { count: behind.length, list: behind.slice(0, LISTED).map((s) => ({ tree: s.tree, migration: s.migration, error: null, at: s.reported_at })) },
      unreported: families.filter((f) => !reported.has(f)).length,
    },
    backup: archive ? { configured: true, lastOkAt: archiveRun?.last_ok_at ?? null, failing: archiveRun ? archiveRun.ok === 0 : false } : { configured: false, lastOkAt: null, failing: false },
    aiOverage: (overage && overage.calls > 0) || paused.length
      ? { month, calls: overage?.calls ?? 0, micros: Number(overage?.micros ?? 0), paused: paused.map((p) => ({ ...p, calls: Number(p.calls), micros: Number(p.micros), since: Number(p.since) })) }
      : null,
    check: { enabled: check.enabled, checkedAt: check.checkedAt, latest: check.latest, error: check.error, updateAvailable: check.updateAvailable },
  };
}

/**
 * The operator acknowledges the overage of a family and model (operator-funding.server.ts): its operator-funded AI runs again.
 * Logged.
 */
export async function acknowledgeOverage(op: { id: string; name: string }, family: string, model: string, now = Date.now()): Promise<void> {
  await accounts().batch([
    q('UPDATE ai_operator_overage SET acknowledged_at = ?, acknowledged_by = ? WHERE family = ? AND model = ? AND acknowledged_at IS NULL', now, op.id, family, model),
    audit(op, 'ai.overage_acknowledged', family, { model }, now),
  ]);
}
