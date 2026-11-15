// The daily clean-up of suggestions (jobs/suggestions.ts), for one family:
// - `expireSuggestions`: a waiting suggestion older than EXPIRY_DAYS becomes `expired`, with `decided_at` the run's time (the
//   suggester's list counts its window from it), and its pending files are deleted from storage. One that is partly applied
//   (history rows name it) is left for a reviewer to close (review.server.ts `closePartlyApplied`).
// - `sweepOrphanFiles`: deleting a person or a source deletes its rows but not the objects, so objects under `suggest/` that
//   no `suggestion_file` row names, and under `source/` that no `source_file` row names, are deleted, but only once ORPHAN_DAYS
//   old (by its counted row's `media_usage.at`; an object with no usage time is kept). The wait covers an upload whose row is
//   about to be written, and a restore: a pre-restore backup, a Durable Object rollback or D1 Time Travel may bring back rows
//   that name an object deleted since.
// Both go through the counted media store, so the family's usage stays right. Neither throws for a family's trouble.
import { accounts } from '../auth/store.server.ts';
import { db, guard, media, NOT_A_RECORD, once, q } from '../db.server.ts';
import { SOURCE_FILES } from '../sources.server.ts';
import { NOT_PARTLY_APPROVED } from './suggest.server.ts';
import { EXPIRY_DAYS } from './types.ts';

const DAY_MS = 86_400_000;
export const SUGGEST_FILES = 'suggest/';
/** An unnamed object is swept only when this old, so an undone restore (backups are kept a week or more) still finds its files. */
export const ORPHAN_DAYS = 30;

/** A suggestion that is no longer waiting, or was begun, when its turn came. */
class Gone extends Error {}

/** Expires the family's old waiting suggestions. Returns how many were expired. */
export async function expireSuggestions(tree: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPIRY_DAYS * DAY_MS).toISOString();
  const old = await db(tree).all<{ id: string }>(
    `SELECT s.id FROM suggestion s WHERE s.status = 'waiting' AND s.created_at < ?
       AND NOT EXISTS (SELECT 1 FROM history h WHERE h.suggestion = s.id) ORDER BY s.created_at LIMIT 500`, cutoff);
  let expired = 0;
  for (const { id } of old) {
    try {
      await once(tree, undefined, 'expireSuggestion', async (d) => {
        // Read afresh on each attempt: one decided, withdrawn or begun meanwhile is no longer ours to expire.
        const still = await d.get<{ n: number }>(
          "SELECT count(*) AS n FROM suggestion s WHERE s.id = ? AND s.status = 'waiting' AND NOT EXISTS (SELECT 1 FROM history h WHERE h.suggestion = s.id)", id);
        if (!still?.n) throw new Gone();
        const keys = (await d.all<{ key: string }>('SELECT key FROM suggestion_file WHERE suggestion = ?', id)).map((r) => r.key);
        return {
          writes: [
            guard("EXISTS (SELECT 1 FROM suggestion WHERE id = ? AND status = 'waiting')", id),
            NOT_PARTLY_APPROVED(id),
            guard('(SELECT count(*) FROM suggestion_file WHERE suggestion = ?) = ?', id, keys.length),
            q('DELETE FROM suggestion_file WHERE suggestion = ?', id),
            q("UPDATE suggestion SET status = 'expired', decided_at = ? WHERE id = ?", now.toISOString(), id),
          ],
          history: NOT_A_RECORD,
          result: undefined,
          after: async () => {
            for (const key of keys) await media.delete(tree, key).catch((e) => console.error('suggest.err.delete_failed', key, e));
          },
        };
      });
      expired += 1;
    } catch (e) {
      // Decided, withdrawn or begun meanwhile: it is no longer ours to expire. Anything else is a failure, for the job to log.
      if (!(e instanceof Gone)) throw e;
    }
  }
  return expired;
}

/** Deletes the family's stored objects under `suggest/` and `source/` that no row names. Returns how many. */
export async function sweepOrphanFiles(tree: string, now: Date = new Date()): Promise<number> {
  const d = db(tree);
  const found = await media.list(tree, [SUGGEST_FILES, SOURCE_FILES]);
  if (!found.length) return 0;
  const named = new Set([
    ...(await d.all<{ key: string }>('SELECT key FROM suggestion_file')).map((r) => r.key),
    ...(await d.all<{ media_key: string }>('SELECT media_key FROM source_file')).map((r) => r.media_key),
  ]);
  // Old enough: a usage row older than ORPHAN_DAYS and no pending reservation. Anything else (young, or no row) stays.
  const old = new Set((await accounts().all<{ key: string }>('SELECT key FROM media_usage WHERE tree = ? AND at <= ? AND pending_at IS NULL', tree, now.getTime() - ORPHAN_DAYS * DAY_MS)).map((r) => r.key));
  let deleted = 0;
  for (const f of found) {
    if (named.has(f.key) || !old.has(f.key)) continue;
    try {
      await media.delete(tree, f.key);
      deleted += 1;
    } catch (e) {
      console.error('suggest.err.delete_failed', f.key, e);
    }
  }
  return deleted;
}
