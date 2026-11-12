// The operator console's Health tab (src/lib/operator/health.server.ts): the shape it reads. No server imports.

export interface JobHealth {
  /** The daily job's name, as in the logs ("reminders", "archive"). */
  job: string;
  startedAt: number;
  finishedAt: number;
  /** Whether its last run ended without failing, the short reason when it failed, and when it last did not fail. */
  ok: boolean;
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
  /** The nightly archive is this install's automatic backup when configured. */
  backup: { configured: boolean; lastOkAt: number | null; failing: boolean };
  check: { enabled: boolean; checkedAt: number | null; latest: string | null; error: string | null; updateAvailable: boolean };
}
