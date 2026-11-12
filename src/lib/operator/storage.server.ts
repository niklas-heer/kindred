// How much media storage each family uses, and its cap (docs/hosting-many-families.md, "Storage caps"). Pictures, videos and
// documents are the only real cost of a family, so they are what is counted.
//
// Every upload path stores its files through `media` in src/lib/db.server.ts, which is `countedMedia` below: one place,
// so a path added later is counted without knowing about it. Storing a file first reserves its bytes in `media_usage`
// (accounts, migration 0034), in one batch whose guard refuses when the family would go over its cap; only then is the
// file written, and its row taken back if writing fails. Deleting a file deletes its row. The family's usage is the sum of
// its rows, so no running number can drift from them; what can drift is the rows against the storage itself (files from
// before migration 0034, a deletion that stopped half-way), and `recount` rebuilds a family's rows from its storage.
// A reservation stays `pending` (its time in `pending_at`, accounts migration 0036) until its file is written, so a recount
// that runs while an upload is on its way keeps that upload's row.
import { translate } from '../i18n/dictionary.ts';
import { AuthError } from '../auth/errors.ts';
import { guard, isGuardError, q, store, type MediaStore, type Query } from '../store/index.ts';
import { formatBytes } from './shared.ts';

const accounts = () => store.accounts();

export interface StorageUse { usedBytes: number; capBytes: number | null }

export async function storageOf(tree: string): Promise<StorageUse> {
  const [[used], [admin]] = (await accounts().readBatch([
    q('SELECT coalesce(sum(bytes), 0) AS n FROM media_usage WHERE tree = ?', tree),
    q('SELECT cap_bytes FROM family_admin WHERE tree = ?', tree),
  ])) as unknown as [[{ n: number }], [{ cap_bytes: number | null } | undefined]];
  return { usedBytes: Number(used?.n ?? 0), capBytes: admin?.cap_bytes ?? null };
}

/** What a member who uploads into a full family is told, with what is used: one English sentence the browser translates. */
export const storageFull = (use: StorageUse) =>
  new AuthError('forbidden', translate('en', 'operator.err_storage_full', { used: formatBytes(use.usedBytes), cap: formatBytes(use.capBytes ?? 0) }));

/** The batch that reserves `bytes` for `key`, refused (by its guard) when the family would go over its cap. */
export const reserve = (tree: string, key: string, bytes: number, at = Date.now()): Query[] => [
  guard(`(SELECT cap_bytes FROM family_admin WHERE tree = ?) IS NULL
    OR (SELECT coalesce(sum(bytes), 0) FROM media_usage WHERE tree = ? AND key <> ?) + ? <= (SELECT cap_bytes FROM family_admin WHERE tree = ?)`, tree, tree, key, bytes, tree),
  q(`INSERT INTO media_usage (tree, key, bytes, at, pending_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tree, key) DO UPDATE SET bytes = excluded.bytes, at = excluded.at, pending_at = excluded.pending_at`, tree, key, bytes, at, at),
];

/**
 * The media store every upload goes through: `put` counts the file against the family's cap (refusing with `storageFull`),
 * `delete` and `deleteTree` forget what they remove. Reads pass straight through.
 */
export function countedMedia(raw: MediaStore): MediaStore {
  return {
    async put(tree, key, bytes, mime) {
      try {
        await accounts().batch(reserve(tree, key, bytes.byteLength));
      } catch (e) {
        if (isGuardError(e)) throw storageFull(await storageOf(tree));
        throw e;
      }
      try {
        await raw.put(tree, key, bytes, mime);
      } catch (e) {
        await accounts().run('DELETE FROM media_usage WHERE tree = ? AND key = ?', tree, key).catch(() => {});
        throw e;
      }
      // Written now: a recount that began before this (and may have listed the storage without the file) keeps the row.
      await accounts().run('UPDATE media_usage SET pending_at = NULL, at = ? WHERE tree = ? AND key = ?', Date.now(), tree, key);
    },
    get: (tree, key) => raw.get(tree, key),
    async delete(tree, key) {
      await raw.delete(tree, key);
      await accounts().run('DELETE FROM media_usage WHERE tree = ? AND key = ?', tree, key);
    },
    async deleteTree(tree) {
      await raw.deleteTree(tree);
      await accounts().run('DELETE FROM media_usage WHERE tree = ?', tree);
    },
    list: (tree) => raw.list(tree),
  };
}

/** How long an upload may be on its way: a reservation still pending after this is one whose upload never finished. */
export const PENDING_MS = 3600_000;

/**
 * Rebuilds a family's `media_usage` from its storage: every file stored under the family, with its size as the storage lists
 * it (one listing, no file is opened), whether a record names it or not, since a file nobody points at still costs. Nothing
 * of the family's records is read. Rows written since the recount began (an upload reserved or finished meanwhile) are kept
 * as they are, never replaced by the listing's older view, and so are pending reservations younger than PENDING_MS, whose file
 * is still being written; rows for files that are gone are dropped. Returns the new total.
 */
export async function recount(tree: string, raw: MediaStore = store.media, started = Date.now()): Promise<number> {
  const found = await raw.list(tree);
  const writes = found.map(({ key, size }) =>
    q(`INSERT INTO media_usage (tree, key, bytes, at, pending_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(tree, key) DO UPDATE SET bytes = excluded.bytes, at = excluded.at, pending_at = NULL
       WHERE media_usage.at < ? AND (media_usage.pending_at IS NULL OR media_usage.pending_at < ?)`, tree, key, size, started, started, started - PENDING_MS));
  for (let i = 0; i < writes.length; i += 50) await accounts().batch(writes.slice(i, i + 50));
  await accounts().batch([
    q('DELETE FROM media_usage WHERE tree = ? AND at < ? AND (pending_at IS NULL OR pending_at < ?)', tree, started, started - PENDING_MS),
    q('INSERT INTO family_admin (tree, counted_at) VALUES (?, ?) ON CONFLICT(tree) DO UPDATE SET counted_at = excluded.counted_at', tree, Date.now()),
  ]);
  return (await storageOf(tree)).usedBytes;
}

/** The families whose storage was never counted, or not for a month: the daily job recounts a few of them each day. */
export async function dueForRecount(trees: string[], limit = 5, now = Date.now()): Promise<string[]> {
  const rows = await accounts().all<{ tree: string; counted_at: number | null }>('SELECT tree, counted_at FROM family_admin');
  const counted = new Map(rows.map((r) => [r.tree, r.counted_at]));
  return trees.filter((t) => (counted.get(t) ?? 0) < now - 30 * 86_400_000).slice(0, limit);
}
