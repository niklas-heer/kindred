// The operator console's Health tab (src/lib/operator/health.server.ts): the shape it reads. No server imports.
import type { BackupHealth } from '../backup/shared.ts';

export interface JobHealth {
  /** The daily job's name, as in the logs ("reminders", "archive"). */
  job: string;
  startedAt: number;
  finishedAt: number;
  /**
   * Whether its last run ended without failing; when it failed, its operational code (`network`, `timeout`, `database`,
   * `config`, an error's own code, else `error`) and a sanitised message (no family, address or quoted text); and when it last
   * did not fail.
   */
  ok: boolean;
  code: string | null;
  error: string | null;
  lastOkAt: number | null;
}

export interface FamilySchema {
  tree: string;
  /** The newest family migration it reported, or the one that failed. */
  migration: string | null;
  error: string | null;
  at: number;
}

/** A family and model (`provider:model`) whose operator-funded AI waits for the operator to acknowledge an overage. */
export interface PausedAi { family: string; model: string; calls: number; micros: number; since: number }

export interface Health {
  version: string | null;
  commit: string | null;
  /** When the daily jobs last started, or null when this install has no record of a run yet. */
  lastDailyRun: number | null;
  jobs: JobHealth[];
  families: {
    total: number;
    /** The newest migration any family reported: this deploy's. */
    newest: string | null;
    failed: { count: number; list: FamilySchema[] };
    /** Families not opened since the newest schema arrived: they catch up the next time they are used. */
    behind: { count: number; list: FamilySchema[] };
    /** Families that never reported (not opened since this record began). */
    unreported: number;
  };
  /** The nightly archive to GitHub (docs/exchange.md), when configured: a readable copy beside the backups. */
  backup: { configured: boolean; lastOkAt: number | null; failing: boolean };
  /** The automatic backups (src/lib/backup/): each family's last good one, the key, the drills, the recovery points. */
  backups: BackupHealth;
  /**
   * Operator-funded AI calls the provider billed above their reservation this UTC month (booked in full), and each family and
   * model the operator's AI is paused for until the operator acknowledges its overage; null for neither.
   */
  aiOverage: { month: string; calls: number; micros: number; paused: PausedAi[] } | null;
  check: { enabled: boolean; checkedAt: number | null; latest: string | null; error: string | null; updateAvailable: boolean };
}
