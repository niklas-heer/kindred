// The lifecycle of abandoned families (docs/hosting-many-families.md, "Lifecycle"): what the console, the family's bar and the
// daily job share. No server imports. The rule that decides a family's next step is here, as a plain function, so the job, the
// dry run and the tests read one rule.
import { addMonths } from '../operator/shared.ts';

/** The operator's settings. Off by default: an install that never turns it on is unchanged. */
export interface LifecycleSettings {
  on: boolean;
  /** Months without activity until its stewards are warned. */
  warnMonths: number;
  /** Months without activity until it becomes read-only (and at least this minus `warnMonths` after the warning). */
  readOnlyMonths: number;
  /** Months without activity until it is due for deletion (and at least this minus `readOnlyMonths` after read-only). */
  deleteMonths: number;
  /** true: the daily job deletes a due family after a final notice; false: the operator confirms each deletion. */
  autoDelete: boolean;
}

export const LIFECYCLE_DEFAULTS: LifecycleSettings = { on: false, warnMonths: 12, readOnlyMonths: 18, deleteMonths: 24, autoDelete: false };
/** The longest period the console accepts, in months. */
export const LIFECYCLE_MONTHS_MAX = 120;
/** Days between the final notice and an automatic deletion. */
export const FINAL_NOTICE_DAYS = 30;
/** Days a steward's "Not now" puts the warning away for. */
export const DISMISS_DAYS = 30;
const DAY = 86_400_000;

/** Whether the periods are whole months in order: warning, then read-only, then deletion. */
export const validSettings = (s: LifecycleSettings) =>
  [s.warnMonths, s.readOnlyMonths, s.deleteMonths].every((m) => Number.isInteger(m) && m >= 1 && m <= LIFECYCLE_MONTHS_MAX)
  && s.warnMonths < s.readOnlyMonths && s.readOnlyMonths < s.deleteMonths;

export const LIFECYCLE_STAGES = ['warned', 'readonly', 'due'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** A family's lifecycle row (accounts migration 0052), as the rule reads it. */
export interface LifecycleRow {
  stage: LifecycleStage;
  quietSince: number;
  warnedAt: number;
  readOnlyAt: number | null;
  dueAt: number | null;
  finalNoticeAt: number | null;
  claim: string | null;
}

/** What the rule needs to know of one family. */
export interface LifecycleFacts {
  /** The last activity: a member's visit or write, a steward's reactivation, the operator resuming it, else when it was made. */
  lastActivity: number | null;
  /** How the operator lets it be used; `byLifecycle` when the suspension is the lifecycle's own. */
  status: 'active' | 'suspended' | 'closed';
  byLifecycle: boolean;
  row: LifecycleRow | null;
}

/**
 * The next step for a family:
 *   warn          quiet for warnMonths: its stewards are told (in the app and by push)
 *   clear         warned, and someone has been active since: the warning goes
 *   readonly      warned at least (readOnly - warn) months ago and quiet for readOnlyMonths: suspended by the lifecycle
 *   due           read-only at least (delete - readOnly) months ago and quiet for deleteMonths: due for deletion
 *   final-notice  due, with automatic deletion: its stewards' last notice, FINAL_NOTICE_DAYS before
 *   delete        due, with the final notice FINAL_NOTICE_DAYS old (or a deletion claimed earlier that stopped part-way)
 * or null for nothing. Each stage waits its own interval after the one before, so turning the lifecycle on for a family that has
 * been quiet for years still warns first. A family the operator suspended or closed is the operator's, and is left alone.
 */
export type LifecycleStep = 'warn' | 'clear' | 'readonly' | 'due' | 'final-notice' | 'delete';

export function nextStep(f: LifecycleFacts, s: LifecycleSettings, now: number): LifecycleStep | null {
  const r = f.row;
  if (r?.claim) return 'delete';
  if (f.status !== 'active' && !f.byLifecycle) return null;
  if (f.lastActivity === null) return null;
  const quietFor = (months: number) => f.lastActivity! <= addMonths(now, -months);
  const since = (at: number | null, months: number) => at !== null && at <= addMonths(now, -months);
  if (!r) return f.status === 'active' && quietFor(s.warnMonths) ? 'warn' : null;
  if (r.stage === 'warned') {
    if (f.lastActivity > r.quietSince) return 'clear';
    return f.status === 'active' && quietFor(s.readOnlyMonths) && since(r.warnedAt, s.readOnlyMonths - s.warnMonths) ? 'readonly' : null;
  }
  if (!f.byLifecycle) return null;
  if (r.stage === 'readonly') return quietFor(s.deleteMonths) && since(r.readOnlyAt, s.deleteMonths - s.readOnlyMonths) ? 'due' : null;
  // Due: the operator confirms, or, with automatic deletion, a final notice and then the deletion.
  if (!s.autoDelete) return null;
  if (r.finalNoticeAt === null) return 'final-notice';
  return r.finalNoticeAt <= now - FINAL_NOTICE_DAYS * DAY ? 'delete' : null;
}

/** The dates a family's stewards are told: when it becomes read-only, and when it would be deleted, as things stand. */
export function plannedDates(lastActivity: number, row: LifecycleRow | null, s: LifecycleSettings): { readOnlyAt: number; deleteAt: number } {
  const readOnlyAt = row?.readOnlyAt ?? Math.max(addMonths(lastActivity, s.readOnlyMonths), addMonths(row?.warnedAt ?? lastActivity, s.readOnlyMonths - s.warnMonths));
  const due = row?.dueAt ?? Math.max(addMonths(lastActivity, s.deleteMonths), addMonths(readOnlyAt, s.deleteMonths - s.readOnlyMonths));
  const deleteAt = s.autoDelete ? (row?.finalNoticeAt ?? due) + FINAL_NOTICE_DAYS * DAY : due;
  return { readOnlyAt, deleteAt };
}

/** One family as the console's Lifecycle section lists it. */
export interface LifecycleFamily {
  id: string;
  name: string;
  stage: LifecycleStage;
  lastActivity: number | null;
  warnedAt: number;
  readOnlyAt: number | null;
  dueAt: number | null;
  finalNoticeAt: number | null;
  /** When it is deleted automatically (automatic deletion, final notice sent), else null. */
  deleteAt: number | null;
}

/** What the job did, or (a dry run) would do. */
export interface LifecycleReport {
  at: number;
  dryRun: boolean;
  counts: Record<LifecycleStep, number> & { kept: number; failed: number };
  /** The families and their steps (a dry run lists them; a run lists what it did). */
  families: { id: string; name: string; step: LifecycleStep; outcome?: 'done' | 'kept' | 'failed' }[];
}

/** What a family's members are shown: null while the family is not in the lifecycle. */
export interface FamilyLifecycle {
  stage: LifecycleStage;
  /** The lifecycle made it read-only (and a steward may turn it back on). */
  readOnly: boolean;
  months: { warn: number; readOnly: number; delete: number };
  warnedAt: number;
  readOnlyAt: number;
  /** When it is deleted: automatic deletion with the final notice sent, else when the operator may delete it. */
  deleteAt: number;
  autoDelete: boolean;
  /** The reader stewards it: they may turn it back on, and see the warning. */
  steward: boolean;
  /** A steward put the warning away until then. */
  dismissedUntil: number | null;
}
