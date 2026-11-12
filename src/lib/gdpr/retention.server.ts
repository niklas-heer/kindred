// How long the server keeps what it no longer needs (GDPR Art. 5(1)(e), storage limitation), as a daily job
// (src/lib/jobs/retention.ts). docs/gdpr.md, "Retention", lists the rules:
//
//   accounts          an account with no family (no membership), not an operator, unseen for 24 months: deleted as "Delete my
//                     account" deletes (account.server.ts), with what it wrote kept under "A former member"
//   invitations       an invitation never used, 90 days after it expired or was withdrawn (its email address goes with it)
//   family requests   a declined request for a family, 90 days after it was declined
//   data requests     a data request answered three years ago (the time to show it was answered, then it goes)
//   terms records     who accepted the terms and the processing agreement, three years after the account is gone
//
// The job starts in report mode: every day it counts what it would delete and keeps that report, and deletes nothing. The
// operator reads the report in the console's Privacy tab and switches deletion on (logged). Family records are the family's
// business (a family decides what its tree keeps) and are not touched here; the history keeps its own three years
// (KINDRED_HISTORY_YEARS, src/lib/jobs/history.ts), and join requests and guest statistics their own (src/lib/jobs/join.ts).
import { guard, isGuardError, q, store } from '../store/index.ts';
import { addMonths } from '../operator/shared.ts';
import { audit } from '../operator/settings.server.ts';
import { newPseudonym, removeAccount } from './account.server.ts';

const accounts = () => store.accounts();
const DAY = 86_400_000;

export const ACCOUNT_MONTHS = 24;
export const STALE_DAYS = 90;
export const RECORD_YEARS = 3;

export type RetentionMode = 'report' | 'delete';
export interface RetentionCounts { accounts: number; invites: number; familyRequests: number; dataRequests: number; termsRecords: number }
/** What became of each account the deletion run selected: deleted, kept (it was used or joined a family meanwhile), or failed. */
export interface AccountOutcome { deleted: number; kept: number; failed: number }
/**
 * A day's run. `counts` is what the rules name (in a deletion run, `accounts` is how many were really deleted); `deleted` whether
 * it deleted; `outcome` and `failedAccounts` (ids, to look at; they still exist) what became of each selected account.
 */
export interface RetentionReport { at: number; mode: RetentionMode; counts: RetentionCounts; deleted: boolean; outcome?: AccountOutcome; failedAccounts?: string[] }

const MODE_KEY = 'retention_mode';
const REPORT_KEY = 'retention_report';

export async function retentionMode(): Promise<RetentionMode> {
  const row = await accounts().get<{ value: string }>('SELECT value FROM instance_setting WHERE key = ?', MODE_KEY);
  return row?.value === 'delete' ? 'delete' : 'report';
}

export async function lastReport(): Promise<RetentionReport | null> {
  const row = await accounts().get<{ value: string }>('SELECT value FROM instance_setting WHERE key = ?', REPORT_KEY);
  try { return row ? (JSON.parse(row.value) as RetentionReport) : null; } catch { return null; }
}

/** The cut-offs, as of `now`. */
function cutoffs(now: number) {
  return {
    account: addMonths(now, -ACCOUNT_MONTHS),
    stale: now - STALE_DAYS * DAY,
    record: addMonths(now, -12 * RECORD_YEARS),
  };
}

const STALE_ACCOUNTS = `SELECT id, name, operator, retiring FROM user u WHERE retiring IS NOT NULL OR (operator = 0 AND coalesce(last_seen, created) < ?
  AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.user = u.id)
  AND NOT EXISTS (SELECT 1 FROM join_request j WHERE j.user = u.id AND j.status = 'open'))`;
/** The same rule for one account (its id, then the cut-off), as a guard: the claim's batch holds it again. */
const STILL_STALE = `EXISTS (SELECT 1 FROM user u WHERE u.id = ? AND operator = 0 AND coalesce(last_seen, created) < ?
  AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.user = u.id)
  AND NOT EXISTS (SELECT 1 FROM join_request j WHERE j.user = u.id AND j.status = 'open'))`;

/**
 * Retires one account the rules selected. First the claim: one batch, guarded by the rule still holding (it may have signed in
 * or joined a family since it was selected), that marks the account `retiring` with the pseudonym its writing will get and ends
 * its sessions. Only then is anything of it changed. While it is marked, no session of it is a way in and a visit is not counted
 * (store.server.ts), so nothing it does can race the cleanup. A cleanup that stops part-way leaves the mark: the next run
 * selects the account again and finishes it under the same pseudonym. An account whose claim's guard fails is kept untouched.
 */
export async function retireAccount(u: { id: string; name: string; operator: number; retiring?: string | null }, now: number): Promise<'deleted' | 'kept' | 'failed'> {
  const cutoff = cutoffs(now).account;
  let pseudonym = u.retiring ?? (await accounts().get<{ retiring: string | null }>('SELECT retiring FROM user WHERE id = ?', u.id))?.retiring ?? null;
  if (!pseudonym) {
    if (!(await accounts().get(`SELECT 1 WHERE ${STILL_STALE}`, u.id, cutoff))) return 'kept';
    pseudonym = newPseudonym();
    try {
      await accounts().batch([
        guard(STILL_STALE, u.id, cutoff),
        q('UPDATE user SET retiring = ? WHERE id = ? AND retiring IS NULL', pseudonym, u.id),
        q('DELETE FROM session WHERE user = ?', u.id),
      ]);
    } catch (e) {
      // It came back between the check and the claim: nothing of it was changed.
      if (isGuardError(e)) return 'kept';
      throw e;
    }
  }
  // The claim is the decision: the deletion's batch only holds that it is still this claim. (A stale account is no steward and
  // no operator, so no other guard of the deletion's can refuse it.)
  await removeAccount(u, { pseudonym, guards: [guard('EXISTS (SELECT 1 FROM user WHERE id = ? AND retiring = ?)', u.id, pseudonym)] });
  return 'deleted';
}
const STALE_INVITES = 'FROM invite WHERE used_at IS NULL AND ((revoked_at IS NOT NULL AND revoked_at < ?) OR (revoked_at IS NULL AND expires < ?))';
const OLD_DECLINED = "FROM family_request WHERE status = 'declined' AND decided_at < ?";
const OLD_ANSWERED = "FROM data_request WHERE status = 'done' AND coalesce(updated_at, created) < ?";
const ORPHAN_TERMS = 'FROM terms_acceptance WHERE at < ? AND user NOT IN (SELECT id FROM user)';

/** What the rules would delete now: counts only. */
export async function retentionCounts(now = Date.now()): Promise<RetentionCounts> {
  const c = cutoffs(now);
  const [[a], [i], [f], [d], [t]] = (await accounts().readBatch([
    q(`SELECT count(*) AS n FROM (${STALE_ACCOUNTS})`, c.account),
    q(`SELECT count(*) AS n ${STALE_INVITES}`, c.stale, c.stale),
    q(`SELECT count(*) AS n ${OLD_DECLINED}`, c.stale),
    q(`SELECT count(*) AS n ${OLD_ANSWERED}`, c.record),
    q(`SELECT count(*) AS n ${ORPHAN_TERMS}`, c.record),
  ])) as unknown as [{ n: number }][];
  return { accounts: a!.n, invites: i!.n, familyRequests: f!.n, dataRequests: d!.n, termsRecords: t!.n };
}

/**
 * The daily run: counts, and deletes when the operator has switched deletion on. Keeps the report for the console. `dryRun`
 * only counts and stores nothing (the console's "Check now").
 */
export async function runRetention(now = Date.now(), { dryRun = false, log }: { dryRun?: boolean; log?: (message: string) => void } = {}): Promise<RetentionReport> {
  const mode = await retentionMode();
  const counts = await retentionCounts(now);
  const deleting = mode === 'delete' && !dryRun;
  const outcome: AccountOutcome = { deleted: 0, kept: 0, failed: 0 };
  const failedAccounts: string[] = [];
  if (deleting) {
    const c = cutoffs(now);
    // Accounts one at a time, as each touches its families; one failing leaves the rest to go.
    const stale = await accounts().all<{ id: string; name: string; operator: number; retiring: string | null }>(STALE_ACCOUNTS, c.account);
    for (const u of stale) {
      try {
        outcome[await retireAccount(u, now)] += 1;
      } catch (e) {
        outcome.failed += 1;
        failedAccounts.push(u.id);
        log?.(`account ${u.id} could not be deleted: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    counts.accounts = outcome.deleted;
    await accounts().batch([
      q(`DELETE ${STALE_INVITES}`, c.stale, c.stale),
      q(`DELETE ${OLD_DECLINED}`, c.stale),
      q(`DELETE ${OLD_ANSWERED}`, c.record),
      q(`DELETE ${ORPHAN_TERMS}`, c.record),
    ]);
  }
  const report: RetentionReport = deleting ? { at: now, mode, counts, deleted: true, outcome, failedAccounts } : { at: now, mode, counts, deleted: false };
  if (!dryRun) {
    await accounts().run('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      REPORT_KEY, JSON.stringify(report), now);
  }
  return report;
}

/** The operator switches deletion on or back to reports. Logged. */
export async function setRetentionMode(op: { id: string; name: string }, mode: RetentionMode, now = Date.now()): Promise<void> {
  await accounts().batch([
    mode === 'report'
      ? q('DELETE FROM instance_setting WHERE key = ?', MODE_KEY)
      : q('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', MODE_KEY, mode, now, op.id),
    audit(op, 'retention.mode', null, { mode }, now),
  ]);
}
