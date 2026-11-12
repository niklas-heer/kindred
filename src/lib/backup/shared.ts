// The shapes the console's Backups tab and the Health tab read (./backup.server.ts). No server imports.
import type { Keep } from './retention.ts';

/** One backup as the console lists it: never its contents, only what it is. */
export interface BackupRow {
  name: string;
  created: number;
  bytes: number;
  format: 'sqlite' | 'dump';
  schema: string | null;
  /** Rows in all its tables. */
  rows: number;
  keyId: string;
  /** The last drill of this scope, when it was this backup. */
  drill: 'ok' | 'failed' | null;
}

export interface BackupFamily {
  /** A family id, or `_accounts`. */
  scope: string;
  /** The family's name; null for the accounts and a deleted family. */
  name: string | null;
  covers: 'backup' | 'd1' | 'none';
  lastOkAt: number | null;
  error: string | null;
  drill: { at: number; ok: boolean; problem: string | null; backup: string | null } | null;
  backups: BackupRow[];
  /** Recovery points of its Durable Object from the last 30 days, newest first. */
  recovery: { id: number; at: number; reason: 'migration' | 'rollback'; before: string | null; held: string | null }[];
  /** A deleted family: when, and when its backups are deleted. */
  goneAt: number | null;
  deleteAt: number | null;
}

export interface BackupOverview {
  where: 'files' | 'r2';
  settings: { keep: Keep; graceDays: number };
  key: KeyStatus;
  accounts: BackupFamily;
  families: BackupFamily[];
  gone: BackupFamily[];
  /** Whether families can be rolled back to a recovery point (Durable Objects). */
  pitr: boolean;
  now: number;
}

export interface KeyStatus {
  /** `own`: KINDRED_BACKUP_KEY. `secret`: derived from KINDRED_SECRET. `none`: backups cannot be made. */
  source: 'own' | 'secret' | 'none';
  /** Node: the key comes from data/secret, in the same folder as the backups. */
  besideBackups: boolean;
  /** Backups another key sealed (they cannot be read with this one). */
  other: number;
}

export interface BackupHealth {
  where: 'files' | 'r2';
  key: KeyStatus;
  total: { count: number; bytes: number };
  /** The scopes backed up here (the accounts as `_accounts`), stale first: at most 50. */
  families: { scope: string; lastOkAt: number | null; error: string | null; stale: boolean }[];
  /** How many have no good backup in the last two days. */
  stale: number;
  covered: number;
  /** The scopes D1 Time Travel covers instead. */
  d1: string[];
  /** The last drills, newest first. */
  drills: { scope: string; at: number; ok: boolean; problem: string | null }[];
  /** Recovery points recorded in the last 30 days. */
  recovery: number;
  /** Deleted families whose backups wait for the grace period. */
  gone: number;
}

export interface RestoreResult {
  into: string;
  /** A restore over the family: the backup taken just before. */
  fresh: string | null;
  /** A restore into a new id whose original has no stewards left: the one-time link for its first steward. */
  token: string | null;
  expires: number | null;
  /** A restore into a new id: the pictures copied from the original, and how many are left to copy. */
  media: { copied: number; left: number } | null;
}
