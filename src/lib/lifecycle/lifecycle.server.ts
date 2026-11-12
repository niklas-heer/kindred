// The lifecycle of abandoned families (docs/hosting-many-families.md, "Lifecycle"; accounts migration 0052). Off by default. Once
// the operator turns it on, a daily job (src/lib/jobs/lifecycle.ts) looks at each family's last activity and moves a quiet one a
// step at a time: its stewards are warned, then it becomes read-only (a suspension its stewards may lift themselves), then it is
// due for deletion, which the operator confirms or, if they chose so, the job does after a final notice. The rule is
// `nextStep` (./shared.ts).
//
// Activity is a member's visit or write (`family_visit`, which a write notes too: src/lib/auth/guard.server.ts), a steward
// turning the family back on, or the operator letting it be used again (`family_admin.active_at`); for a family nobody has used
// yet, when it was made. A guest's visit is not activity; nor is anything during a preview or a demo, which write nothing.
//
// Every step is claim-then-act, as the retention job's (src/lib/gdpr/retention.server.ts): one batch that holds the rule once more
// (nobody was active since the family was selected, it is still at the stage it was) and makes the change with its audit entry.
// A member who opens the family between the selection and the batch wins: the guard fails and the family is kept as it was. A
// deletion is claimed in such a batch before anything of the family is deleted; a deletion that stops part-way is finished by the
// next run.
import { AuthError } from '../auth/errors.ts';
import { families } from '../auth/trees.server.ts';
import { deleteFamily } from '../families.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { isDemo } from '../demo.ts';
import { notifyStewards, STEWARD_NOTICE_KINDS, withdrawNotices, type NotifyOptions } from '../notify/stewards.server.ts';
import { audit, type AuditActor } from '../operator/settings.server.ts';
import { guard, isGuardError, q, store, type Query } from '../store/index.ts';
import {
  DISMISS_DAYS, FINAL_NOTICE_DAYS, LIFECYCLE_DEFAULTS, nextStep, plannedDates, validSettings,
  type FamilyLifecycle, type LifecycleFacts, type LifecycleFamily, type LifecycleReport, type LifecycleRow, type LifecycleSettings, type LifecycleStep,
} from './shared.ts';

const accounts = () => store.accounts();
const DAY = 86_400_000;
const invalid = (key: Parameters<typeof translate>[1]) => new AuthError('invalid', translate('en', key));
/** Who the log names for what the daily job does. */
export const LIFECYCLE_ACTOR: AuditActor = { id: 'kindred', name: 'Kindred' };

const SETTINGS_KEY = 'lifecycle';
const REPORT_KEY = 'lifecycle_report';
const setting = (key: string, value: string, now: number, by: string | null) =>
  q('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', key, value, now, by);

// ---------- settings ----------

export async function lifecycleSettings(): Promise<LifecycleSettings> {
  const row = await accounts().get<{ value: string }>('SELECT value FROM instance_setting WHERE key = ?', SETTINGS_KEY);
  if (!row) return { ...LIFECYCLE_DEFAULTS };
  try {
    const s = { ...LIFECYCLE_DEFAULTS, ...(JSON.parse(row.value) as Partial<LifecycleSettings>) };
    return validSettings(s) ? s : { ...LIFECYCLE_DEFAULTS, on: false };
  } catch {
    return { ...LIFECYCLE_DEFAULTS };
  }
}

/** What the lifecycle made read-only opens again, and its warnings go: turning it off undoes it (a deletion claimed stays). */
const UNDO = (now: number): Query[] => [
  q(`UPDATE family_admin SET status = 'active', closed = 0, status_reason = NULL, status_ground = NULL, status_at = ?, status_by = NULL
     WHERE status_by = 'lifecycle' AND tree NOT IN (SELECT tree FROM family_lifecycle WHERE claim IS NOT NULL)`, now),
  q(`DELETE FROM steward_notice WHERE kind IN (${STEWARD_NOTICE_KINDS.map(() => '?').join(', ')}) AND tree NOT IN (SELECT tree FROM family_lifecycle WHERE claim IS NOT NULL)`, ...STEWARD_NOTICE_KINDS),
  q('DELETE FROM steward_notice_dismissal'),
  q('DELETE FROM family_lifecycle WHERE claim IS NULL'),
];

/** The operator's settings. Turning it off opens every family it made read-only and withdraws its warnings. Logged. */
export async function saveLifecycleSettings(op: AuditActor, next: LifecycleSettings, now = Date.now()): Promise<void> {
  if (!validSettings(next)) throw invalid('lifecycle.err.periods');
  const before = await lifecycleSettings();
  const s: LifecycleSettings = { on: next.on, warnMonths: next.warnMonths, readOnlyMonths: next.readOnlyMonths, deleteMonths: next.deleteMonths, autoDelete: next.autoDelete };
  await accounts().batch([
    setting(SETTINGS_KEY, JSON.stringify(s), now, op.id),
    ...(before.on && !s.on ? UNDO(now) : []),
    audit(op, 'lifecycle.settings', null, { ...s }, now),
  ]);
}

export async function lastLifecycleReport(): Promise<LifecycleReport | null> {
  const row = await accounts().get<{ value: string }>('SELECT value FROM instance_setting WHERE key = ?', REPORT_KEY);
  try { return row ? (JSON.parse(row.value) as LifecycleReport) : null; } catch { return null; }
}

// ---------- activity ----------

interface Selected { id: string; name: string; facts: LifecycleFacts; step: LifecycleStep }

const rowOf = (r: { stage: LifecycleRow['stage']; quiet_since: number; warned_at: number; readonly_at: number | null; due_at: number | null; final_notice_at: number | null; claim: string | null }): LifecycleRow =>
  ({ stage: r.stage, quietSince: r.quiet_since, warnedAt: r.warned_at, readOnlyAt: r.readonly_at, dueAt: r.due_at, finalNoticeAt: r.final_notice_at, claim: r.claim });

type LifecycleDbRow = Parameters<typeof rowOf>[0] & { tree: string };

/** Every family's facts, as the rule reads them, from the accounts database alone (no family's records are opened). */
async function factsOf(only?: string): Promise<Map<string, LifecycleFacts>> {
  const where = only ? ' WHERE v.tree = ?' : '';
  const [visits, admin, firsts, rows] = (await accounts().readBatch([
    q(`SELECT v.tree, max(v.last_seen) AS at FROM family_visit v JOIN membership m ON m.user = v.user AND m.tree = v.tree${where} GROUP BY v.tree`, ...(only ? [only] : [])),
    q(`SELECT tree, status, closed, status_by, active_at, created_at FROM family_admin${only ? ' WHERE tree = ?' : ''}`, ...(only ? [only] : [])),
    q(`SELECT tree, min(created) AS at FROM membership${only ? ' WHERE tree = ?' : ''} GROUP BY tree`, ...(only ? [only] : [])),
    q(`SELECT * FROM family_lifecycle${only ? ' WHERE tree = ?' : ''}`, ...(only ? [only] : [])),
  ])) as unknown as [
    { tree: string; at: number }[],
    { tree: string; status: 'active' | 'suspended'; closed: number; status_by: string | null; active_at: number | null; created_at: number | null }[],
    { tree: string; at: number }[], LifecycleDbRow[],
  ];
  const trees = new Set([...visits, ...admin, ...firsts, ...rows].map((r) => r.tree));
  const out = new Map<string, LifecycleFacts>();
  for (const tree of trees) {
    const a = admin.find((r) => r.tree === tree);
    const known = [visits.find((r) => r.tree === tree)?.at, a?.active_at, a?.created_at ?? firsts.find((r) => r.tree === tree)?.at].filter((x): x is number => typeof x === 'number');
    const row = rows.find((r) => r.tree === tree);
    out.set(tree, {
      lastActivity: known.length ? Math.max(...known) : null,
      status: a?.status === 'suspended' ? (a.closed === 1 ? 'closed' : 'suspended') : 'active',
      byLifecycle: a?.status === 'suspended' && a.closed !== 1 && a.status_by === 'lifecycle',
      row: row ? rowOf(row) : null,
    });
  }
  return out;
}

/** What the rule would do to each family now. Families gone part-way (a claimed deletion) are included, to finish. */
async function select(now: number, s: LifecycleSettings): Promise<Selected[]> {
  const [all, facts] = await Promise.all([families(), factsOf()]);
  const names = new Map(all.map((f) => [f.id, f.name]));
  const out: Selected[] = [];
  for (const [id, f] of facts) {
    if (!names.has(id) && !f.row?.claim) continue;
    const step = nextStep(f, s, now);
    if (step) out.push({ id, name: names.get(id) ?? id, facts: f, step });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- the guards a step's batch holds again ----------

/** Nobody was active in the family after `at`: no member's visit or write, no reactivation, no resuming by the operator. */
const quietSince = (tree: string, at: number) => guard(
  `NOT EXISTS (SELECT 1 FROM family_visit v JOIN membership m ON m.user = v.user AND m.tree = v.tree WHERE v.tree = ? AND v.last_seen > ?)
   AND NOT EXISTS (SELECT 1 FROM family_admin WHERE tree = ? AND active_at > ?)`, tree, at, tree, at);
const stillAt = (tree: string, r: LifecycleRow) =>
  guard('EXISTS (SELECT 1 FROM family_lifecycle WHERE tree = ? AND stage = ? AND quiet_since = ? AND claim IS NULL)', tree, r.stage, r.quietSince);
const activeFamily = (tree: string) => guard("NOT EXISTS (SELECT 1 FROM family_admin WHERE tree = ? AND status = 'suspended')", tree);
const lifecycleSuspended = (tree: string) => guard("EXISTS (SELECT 1 FROM family_admin WHERE tree = ? AND status = 'suspended' AND closed = 0 AND status_by = 'lifecycle')", tree);

/** The statement of reasons the console and the log read; the family's members read their own words (LifecycleBar). */
const READ_ONLY_REASON = (months: number) =>
  `Nobody visited this family for ${months} months, so this server's lifecycle for inactive families made it read-only. A steward can turn it back on.`;

// ---------- the steps ----------

type Outcome = 'done' | 'kept' | 'failed';

async function claimed(writes: Query[]): Promise<boolean> {
  try {
    await accounts().batch(writes);
    return true;
  } catch (e) {
    // Someone was active, or the family moved on, between the selection and this batch: nothing was changed.
    if (isGuardError(e)) return false;
    throw e;
  }
}

async function apply(f: Selected, s: LifecycleSettings, now: number, notify: Omit<NotifyOptions, 'name' | 'now'>, log?: (m: string) => void): Promise<Outcome> {
  const tree = f.id;
  const at = f.facts.lastActivity ?? 0;
  const r = f.facts.row;
  const tell = (kind: Parameters<typeof notifyStewards>[1], vars: Record<string, number>) =>
    notifyStewards(tree, kind, vars, { ...notify, name: f.name, now }).catch((e) => { log?.(`${tree}: the stewards could not be told: ${e instanceof Error ? e.message : String(e)}`); });
  switch (f.step) {
    case 'warn': {
      const row: LifecycleRow = { stage: 'warned', quietSince: at, warnedAt: now, readOnlyAt: null, dueAt: null, finalNoticeAt: null, claim: null };
      if (!(await claimed([
        quietSince(tree, at), activeFamily(tree), guard('NOT EXISTS (SELECT 1 FROM family_lifecycle WHERE tree = ?)', tree),
        q("INSERT INTO family_lifecycle (tree, stage, quiet_since, warned_at) VALUES (?, 'warned', ?, ?)", tree, at, now),
        audit(LIFECYCLE_ACTOR, 'lifecycle.warn', tree, { lastActivity: at }, now),
      ]))) return 'kept';
      await tell('lifecycle_warning', { count: s.warnMonths, ...plannedDates(at, row, s) });
      return 'done';
    }
    case 'clear':
      return (await claimed([
        stillAt(tree, r!),
        q('DELETE FROM family_lifecycle WHERE tree = ?', tree), withdrawNotices(tree), q('DELETE FROM steward_notice_dismissal WHERE tree = ?', tree),
        audit(LIFECYCLE_ACTOR, 'lifecycle.clear', tree, undefined, now),
      ])) ? 'done' : 'kept';
    case 'readonly': {
      if (!(await claimed([
        stillAt(tree, r!), quietSince(tree, r!.quietSince), activeFamily(tree),
        q("UPDATE family_lifecycle SET stage = 'readonly', readonly_at = ? WHERE tree = ?", now, tree),
        q(`INSERT INTO family_admin (tree, status, closed, status_reason, status_ground, status_at, status_by) VALUES (?, 'suspended', 0, ?, 'other', ?, 'lifecycle')
           ON CONFLICT(tree) DO UPDATE SET status = excluded.status, closed = 0, status_reason = excluded.status_reason, status_ground = excluded.status_ground,
           status_at = excluded.status_at, status_by = excluded.status_by`, tree, READ_ONLY_REASON(s.readOnlyMonths), now),
        audit(LIFECYCLE_ACTOR, 'lifecycle.readonly', tree, { lastActivity: at }, now),
      ]))) return 'kept';
      await tell('lifecycle_readonly', { count: s.readOnlyMonths, ...plannedDates(at, { ...r!, stage: 'readonly', readOnlyAt: now }, s) });
      return 'done';
    }
    case 'due':
    case 'final-notice': {
      const finalNow = s.autoDelete;
      const deleteAt = now + FINAL_NOTICE_DAYS * DAY;
      if (!(await claimed([
        stillAt(tree, r!), quietSince(tree, r!.quietSince), lifecycleSuspended(tree),
        ...(f.step === 'due'
          ? [q("UPDATE family_lifecycle SET stage = 'due', due_at = ?, final_notice_at = ? WHERE tree = ?", now, finalNow ? now : null, tree)]
          : [guard('EXISTS (SELECT 1 FROM family_lifecycle WHERE tree = ? AND final_notice_at IS NULL)', tree), q('UPDATE family_lifecycle SET final_notice_at = ? WHERE tree = ?', now, tree)]),
        audit(LIFECYCLE_ACTOR, f.step === 'due' ? 'lifecycle.due' : 'lifecycle.final_notice', tree, finalNow ? { deleteAt } : undefined, now),
      ]))) return 'kept';
      if (finalNow) await tell('lifecycle_final', { deleteAt });
      else await tell('lifecycle_due', { count: s.deleteMonths });
      return 'done';
    }
    case 'delete': {
      if (!r!.claim) {
        // The family that must stay (the server's last, or its default) is never claimed: reported every day instead.
        const all = await families();
        if (all.length < 2 || process.env.KINDRED_DEFAULT_TREE?.trim() === tree) {
          log?.(`${tree}: due for deletion, but it is the server's ${all.length < 2 ? 'last' : 'default'} family`);
          return 'failed';
        }
        if (!(await claimed([
          stillAt(tree, r!), quietSince(tree, r!.quietSince), lifecycleSuspended(tree),
          guard('EXISTS (SELECT 1 FROM family_lifecycle WHERE tree = ? AND final_notice_at IS NOT NULL AND final_notice_at <= ?)', tree, now - FINAL_NOTICE_DAYS * DAY),
          q('UPDATE family_lifecycle SET claim = ? WHERE tree = ? AND claim IS NULL', crypto.randomUUID(), tree),
          audit(LIFECYCLE_ACTOR, 'lifecycle.delete', tree, { name: f.name, lastActivity: r!.quietSince }, now),
        ]))) return 'kept';
      }
      // BACKUP: the family's last backup is kept as long as the backups' own retention says (docs/backups.md, once the
      // operator's backups exist); nothing else of it is.
      await deleteFamily(tree, tree);
      return 'done';
    }
  }
}

export interface RunOptions {
  /** Only reports what the job would do: nothing is changed or stored. Works while the lifecycle is off (the console's dry run). */
  dryRun?: boolean;
  log?: (message: string) => void;
  /** The push's keys and fetch (tests pass fakes); the server's own by default. */
  vapid?: NotifyOptions['vapid'];
  fetchImpl?: typeof fetch;
  /** Runs between the selection and the first step: the tests put a visit there, to show that it wins. */
  afterSelect?: () => Promise<void>;
}

const emptyCounts = (): LifecycleReport['counts'] => ({ warn: 0, clear: 0, readonly: 0, due: 0, 'final-notice': 0, delete: 0, kept: 0, failed: 0 });

/**
 * The daily run. Does nothing while the lifecycle is off (or in a demo). A dry run lists what a run would do now, with the
 * settings as saved, whether or not the lifecycle is on, and stores nothing.
 */
export async function runLifecycle(now = Date.now(), opts: RunOptions = {}): Promise<LifecycleReport | null> {
  const s = await lifecycleSettings();
  if (!opts.dryRun && (!s.on || isDemo())) return null;
  const selected = await select(now, s);
  const report: LifecycleReport = { at: now, dryRun: !!opts.dryRun, counts: emptyCounts(), families: [] };
  if (!opts.dryRun) await opts.afterSelect?.();
  for (const f of selected) {
    if (opts.dryRun) {
      report.counts[f.step]++;
      report.families.push({ id: f.id, name: f.name, step: f.step });
      continue;
    }
    let outcome: Outcome;
    try {
      outcome = await apply(f, s, now, { vapid: opts.vapid, fetchImpl: opts.fetchImpl }, opts.log);
    } catch (e) {
      outcome = 'failed';
      opts.log?.(`${f.id}: ${f.step} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (outcome === 'done') report.counts[f.step]++;
    else report.counts[outcome]++;
    report.families.push({ id: f.id, name: f.name, step: f.step, outcome });
  }
  if (!opts.dryRun) await accounts().batch([setting(REPORT_KEY, JSON.stringify(report), now, null)]);
  return report;
}

// ---------- the console ----------

/** The families in the lifecycle, by stage, with their dates. */
export async function lifecycleFamilies(): Promise<LifecycleFamily[]> {
  const [all, facts, s] = await Promise.all([families(), factsOf(), lifecycleSettings()]);
  const out: LifecycleFamily[] = [];
  for (const f of all) {
    const x = facts.get(f.id);
    const r = x?.row;
    if (!r || r.claim) continue;
    out.push({
      id: f.id, name: f.name, stage: r.stage, lastActivity: x.lastActivity, warnedAt: r.warnedAt, readOnlyAt: r.readOnlyAt, dueAt: r.dueAt, finalNoticeAt: r.finalNoticeAt,
      deleteAt: r.stage === 'due' && s.autoDelete && r.finalNoticeAt !== null ? r.finalNoticeAt + FINAL_NOTICE_DAYS * DAY : null,
    });
  }
  const order = { due: 0, readonly: 1, warned: 2 } as const;
  return out.sort((a, b) => order[a.stage] - order[b.stage] || a.name.localeCompare(b.name));
}

/**
 * The operator deletes a family that is due, after its id typed and a fresh proof (the server function asks for it). Claimed
 * like the job's: refused, with nothing changed, unless it is still due and nobody turned it back on.
 */
export async function confirmDeletion(op: AuditActor, tree: string, confirm: string, now = Date.now()): Promise<void> {
  if (confirm.trim() !== tree) throw new AuthError('invalid', translate('en', 'families.err_confirm', { id: tree }));
  const f = (await factsOf(tree)).get(tree);
  const r = f?.row;
  if (!r || r.stage !== 'due' || r.claim) throw invalid('lifecycle.err.not_due');
  const name = (await families()).find((x) => x.id === tree)?.name ?? null;
  if (!(await claimed([
    stillAt(tree, r), quietSince(tree, r.quietSince), lifecycleSuspended(tree),
    q('UPDATE family_lifecycle SET claim = ? WHERE tree = ? AND claim IS NULL', crypto.randomUUID(), tree),
    audit(op, 'lifecycle.delete_confirmed', tree, { name }, now),
  ]))) throw invalid('lifecycle.err.not_due');
  await deleteFamily(tree, confirm);
}

// ---------- the family ----------

/** What a member of `tree` is shown, or null while it is not in the lifecycle (or the lifecycle is off). */
export async function familyLifecycle(tree: string, user: string | null, steward: boolean, now = Date.now()): Promise<FamilyLifecycle | null> {
  const s = await lifecycleSettings();
  if (!s.on) return null;
  const f = (await factsOf(tree)).get(tree);
  const r = f?.row;
  if (!f || !r || r.claim || f.lastActivity === null) return null;
  const dates = plannedDates(r.quietSince, r, s);
  const dismissed = steward && user
    ? (await accounts().get<{ until: number }>("SELECT until FROM steward_notice_dismissal WHERE user = ? AND tree = ? AND kind = 'lifecycle_warning' AND until > ?", user, tree, now))?.until ?? null
    : null;
  return {
    stage: r.stage, readOnly: f.byLifecycle, months: { warn: s.warnMonths, readOnly: s.readOnlyMonths, delete: s.deleteMonths },
    warnedAt: r.warnedAt, readOnlyAt: dates.readOnlyAt, deleteAt: dates.deleteAt, autoDelete: s.autoDelete, steward, dismissedUntil: dismissed,
  };
}

/** A steward puts the warning away for DISMISS_DAYS; it returns after that while the family is still warned. */
export async function dismissWarning(user: string, tree: string, now = Date.now()): Promise<number> {
  const until = now + DISMISS_DAYS * DAY;
  await accounts().batch([
    q(`INSERT INTO steward_notice_dismissal (user, tree, kind, until) VALUES (?, ?, 'lifecycle_warning', ?)
       ON CONFLICT(user, tree, kind) DO UPDATE SET until = excluded.until`, user, tree, until),
  ]);
  return until;
}

/**
 * A steward turns a family the lifecycle made read-only back on, with one click. That is activity: the clock starts again. Only
 * the lifecycle's suspension (never the operator's), only by a steward, and not once its deletion is claimed. Logged.
 */
export async function reactivate(user: AuditActor, tree: string, now = Date.now()): Promise<void> {
  if (!(await claimed([
    lifecycleSuspended(tree),
    guard("EXISTS (SELECT 1 FROM membership WHERE user = ? AND tree = ? AND role = 'steward')", user.id, tree),
    guard('NOT EXISTS (SELECT 1 FROM family_lifecycle WHERE tree = ? AND claim IS NOT NULL)', tree),
    q(`UPDATE family_admin SET status = 'active', closed = 0, status_reason = NULL, status_ground = NULL, status_at = ?, status_by = NULL, active_at = ?
       WHERE tree = ?`, now, now, tree),
    q('DELETE FROM family_lifecycle WHERE tree = ?', tree), withdrawNotices(tree), q('DELETE FROM steward_notice_dismissal WHERE tree = ?', tree),
    audit(user, 'lifecycle.reactivate', tree, undefined, now),
  ]))) throw invalid('lifecycle.err.not_readonly');
}

/**
 * What the operator's own change of a family's status does to its lifecycle (operator.server.ts setFamilyStatus, in its batch):
 * the operator's decision replaces the lifecycle's, so its row and warnings go (a claimed deletion stays), and letting the family
 * be used again counts as activity.
 */
export const operatorStatusWrites = (tree: string, active: boolean, now: number): Query[] => [
  q('DELETE FROM family_lifecycle WHERE tree = ? AND claim IS NULL', tree),
  withdrawNotices(tree),
  ...(active ? [q('UPDATE family_admin SET active_at = ? WHERE tree = ?', now, tree)] : []),
];
