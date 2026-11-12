// Which schema each family last reported (accounts table `family_schema`, migration 0047), for the operator's Health tab
// (src/lib/operator/health.server.ts). A family brings its own database up to date when it is opened: on Node when the
// process first opens its file, in a Durable Object the first time it is used after a deploy. The driver reports what it
// found then, once per family per process or isolate, so the console knows which families are behind or failed without
// opening any of them.
//
// Best effort: a report that cannot be written (a demo, a "View as" preview, an accounts database without the table yet) is
// dropped and tried again the next time; it never fails the family's own request.
import type { Db, RecoveryPoint } from './db.ts';

/** What this process or isolate last reported per family, so an unchanged answer is not written again. */
const reported = new Map<string, string>();

/** A short reason from a failed migration: "migration tree/0036_x.sql failed: ...", at most 300 characters. */
export const migrationError = (e: unknown): string | null => {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /migration tree\/\S+ failed/.test(m) ? m.slice(0, 300) : null;
};

/** Records the newest migration a family holds (`migration`), or the failure (`error`). Never throws. */
export async function reportSchema(accounts: () => Db, tree: string, migration: string | null, error: string | null, now = Date.now()): Promise<void> {
  const key = `${migration ?? ''}|${error ?? ''}`;
  if (reported.get(tree) === key) return;
  try {
    await accounts().run(
      `INSERT INTO family_schema (tree, migration, error, reported_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(tree) DO UPDATE SET migration = COALESCE(excluded.migration, family_schema.migration), error = excluded.error, reported_at = excluded.reported_at`,
      tree, migration, error, now,
    );
    reported.set(tree, key);
  } catch {
    // Dropped: tried again on the next open.
  }
}

/** Forgets what was reported, so a test (or a family made again) reports afresh. */
export const forgetReports = (tree?: string) => (tree ? reported.delete(tree) : reported.clear());


/**
 * Records the recovery points a family's Durable Object took before it migrated (accounts `recovery_point`, migration 0051), for
 * the console's Backups tab. Never throws, like `reportSchema`.
 */
export async function reportRecovery(accounts: () => Db, tree: string, points: readonly RecoveryPoint[]): Promise<void> {
  try {
    await accounts().batch(points.map((p) => ({
      sql: 'INSERT INTO recovery_point (tree, bookmark, at, reason, before_migration, held_migration) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tree, bookmark) DO NOTHING',
      params: [tree, p.bookmark, p.at, p.reason, p.before, p.held],
    })));
  } catch {
    // Dropped: reported again the next time this family is first used in an isolate.
  }
}
