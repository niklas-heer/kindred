// The automatic backups (docs/hosting-many-families.md, "Backups"): the daily job that backs up every family and the accounts
// database in turn, the weekly restore drill, retention, and the operator's restore and rollback. The files are made and read
// by the storage driver (`store.backups`, src/lib/store/db.ts BackupStore: files on Node, the MEDIA bucket from each Durable
// Object on Workers); each one's manifest is kept in the accounts database (`family_backup`, `backup_status`,
// `recovery_point`, migration 0051), so the console and the Health tab read the accounts database only.
//
// The operator reads no family's records here: a backup is made, checked and restored as a whole, and what the console shows
// of it is its time, size, schema and row counts.
import { AuthError } from '../auth/errors.ts';
import { families } from '../auth/trees.server.ts';
import { sanitiseFailure } from '../jobs/failure.ts';
import { audit, instanceSettings, type AuditActor } from '../operator/settings.server.ts';
import { guard, isGuardError, q, store, type Query } from '../store/index.ts';
import { ACCOUNTS_SCOPE, backupName, backupSecret, deriveBackupKey, type Manifest } from './kbak.ts';
import { DEFAULT_GRACE_DAYS, GRACE_MAX_DAYS, keepIndexes, parseKeep, type Keep } from './retention.ts';
import type { BackupFamily, BackupHealth, BackupOverview, BackupRow, RestoreResult } from './shared.ts';

const accounts = () => store.accounts();
const DAY = 86_400_000;
/** A family whose last good backup is older than this is shown as a warning. */
export const STALE_MS = 2 * DAY;
/** A family backed up within this long is not due yet (a daily run that starts a little early still backs it up). */
const DUE_MS = 20 * 3600_000;
/** How long one daily run may spend making backups; the families not reached are the most stale tomorrow. */
export const BUDGET_MS = 5 * 60_000;
/** How often the drill runs: weekly. */
const DRILL_MS = 7 * DAY - 3600_000;
/** How many pictures a restore into a new id copies in one go; the console offers to copy the rest. */
export const MEDIA_STEP = 200;
/** How long the backup made just before a restore over a family or a rollback is kept, whatever the retention says. */
export const PIN_MS = 7 * DAY;
/** A family being made holds its address this long (`family_claim`); a claim older than that was left by a request that stopped. */
export const CLAIM_MS = 10 * 60_000;
/**
 * A restore holds its address this long while it writes (`family_claim.state` `restoring`); a claim older than that was left by a
 * restore that stopped, and lapses. The console lists such claims, and the operator can clear one sooner.
 */
export const RESTORE_CLAIM_MS = 60 * 60_000;
/** The SQL condition, on `family_claim`, of a claim that still holds its address at `?` (now): bind `now`, then `now` again. */
export const CLAIM_HOLDS = `(CASE WHEN what = 'restore' THEN state <> 'restoring' OR at > ? - ${RESTORE_CLAIM_MS} ELSE at > ? - ${CLAIM_MS} END)`;

const invalid = (key: string) => new AuthError('invalid', key);

// ---------- settings ----------

export interface BackupSettings { keep: Keep; graceDays: number }

export async function backupSettings(): Promise<BackupSettings> {
  const rows = await accounts().all<{ key: string; value: string }>("SELECT key, value FROM instance_setting WHERE key IN ('backup_keep', 'backup_grace_days')");
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const grace = Number(v.get('backup_grace_days'));
  return { keep: parseKeep(v.get('backup_keep')), graceDays: Number.isInteger(grace) && grace >= 0 && grace <= GRACE_MAX_DAYS ? grace : DEFAULT_GRACE_DAYS };
}

export async function saveBackupSettings(op: AuditActor, next: BackupSettings, now = Date.now()): Promise<void> {
  const keep = parseKeep(`${next.keep.daily},${next.keep.weekly},${next.keep.monthly}`);
  if (keep.daily !== next.keep.daily || keep.weekly !== next.keep.weekly || keep.monthly !== next.keep.monthly) throw invalid('backup.err.keep');
  if (!Number.isInteger(next.graceDays) || next.graceDays < 0 || next.graceDays > GRACE_MAX_DAYS) throw invalid('backup.err.grace');
  const set = (key: string, value: string) =>
    q('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', key, value, now, op.id);
  await accounts().batch([
    set('backup_keep', `${keep.daily},${keep.weekly},${keep.monthly}`),
    set('backup_grace_days', String(next.graceDays)),
    audit(op, 'backup.settings', null, { keep, graceDays: next.graceDays }, now),
  ]);
}

// ---------- the key ----------

/** Which key seals the backups, without showing it: its own (KINDRED_BACKUP_KEY), the server secret's, or none. */
export async function keyStatus(): Promise<BackupHealth['key'] & { id: string | null }> {
  let source: 'own' | 'secret' | 'none' = 'none';
  let id: string | null = null;
  try {
    const { secret, own } = backupSecret((n) => process.env[n], () => store.secret());
    source = own ? 'own' : 'secret';
    id = (await deriveBackupKey(secret)).id;
  } catch {
    // No key: backups cannot be made; the Health tab says so.
  }
  // On Node, a server secret from data/secret sits in the same folder as the backups (unless they are kept elsewhere).
  const besideBackups = store.backups.where === 'files' && source === 'secret' && !process.env.KINDRED_SECRET?.trim() && !process.env.KINDRED_BACKUP_DIR?.trim();
  const other = id ? Number((await accounts().get<{ n: number }>('SELECT count(*) AS n FROM family_backup WHERE key_id <> ?', id))?.n ?? 0) : 0;
  return { source, besideBackups, other, id };
}

// ---------- making backups ----------

const sanitise = async (e: unknown) => sanitiseFailure(e instanceof Error ? e.message : String(e), await store.treeIds().catch(() => []));

/** Backs one scope up now and records it. Throws (after recording the failure) when it cannot be made. */
export async function backUp(scope: string, at = new Date()): Promise<Manifest> {
  const now = at.getTime();
  // Who stewards the family now, and which family holds the id (its making time): what a restore into a new id may hand on.
  const [stewards, made] = scope === ACCOUNTS_SCOPE ? [[], []] : (await accounts().readBatch([
    q("SELECT user FROM membership WHERE tree = ? AND role = 'steward' ORDER BY user", scope),
    q('SELECT created_at FROM family_admin WHERE tree = ?', scope),
  ])) as unknown as [{ user: string }[], { created_at: number | null }[]];
  let m: Manifest, bytes: number;
  try {
    ({ manifest: m, bytes } = await store.backups.take(scope, backupName(at)));
  } catch (e) {
    await accounts().run(
      `INSERT INTO backup_status (family, tried_at, error) VALUES (?, ?, ?)
       ON CONFLICT(family) DO UPDATE SET tried_at = excluded.tried_at, error = excluded.error`, scope, now, await sanitise(e)).catch(() => {});
    throw e;
  }
  await accounts().batch([
    q(`INSERT INTO family_backup (family, name, created_at, bytes, format, schema, counts, sha256, key_id, stewards, family_created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(family, name) DO NOTHING`, scope, m.name, Date.parse(m.created) || now, bytes, m.format, m.schema, JSON.stringify(m.counts), m.sha256, m.keyId,
      scope === ACCOUNTS_SCOPE ? null : JSON.stringify(stewards.map((s) => s.user)), made[0]?.created_at ?? null),
    q(`INSERT INTO backup_status (family, tried_at, ok_at, error) VALUES (?, ?, ?, NULL)
       ON CONFLICT(family) DO UPDATE SET tried_at = excluded.tried_at, ok_at = excluded.ok_at, error = NULL`, scope, now, now),
  ]);
  return m;
}

/**
 * Deletes a living scope's backups beyond the retention, counted back from `now`: their files, then their rows. Its newest backup
 * and a backup pinned until after `now` (the one made before a restore over the family or a rollback) stay. Returns how many went.
 */
export async function prune(scope: string, keep: Keep, now = Date.now()): Promise<number> {
  const rows = await accounts().all<{ name: string; created_at: number; pinned_until: number }>('SELECT name, created_at, pinned_until FROM family_backup WHERE family = ? AND gone_at IS NULL ORDER BY created_at', scope);
  const kept = keepIndexes(rows.map((r) => r.created_at), keep, now);
  let removed = 0;
  for (const [i, r] of rows.entries()) {
    if (kept.has(i) || r.pinned_until > now) continue;
    await store.backups.remove(scope, r.name);
    await accounts().run('DELETE FROM family_backup WHERE family = ? AND name = ?', scope, r.name);
    removed += 1;
  }
  return removed;
}

/** Marks the backups of a deleted family: they are deleted once the grace period has passed. */
export const markGone = (tree: string, at = Date.now()): Query => q('UPDATE family_backup SET gone_at = ? WHERE family = ? AND gone_at IS NULL', at, tree);

/**
 * Deletes the backups of families deleted longer ago than the grace period. Returns how many went. A pin (`pinned_until`, the
 * backup made before a restore over the family or a rollback) does not keep them: it protects a living family's backup from the
 * retention, and once the family is deleted the grace period alone says how long anything of it is kept.
 */
async function expire(now: number, graceDays: number): Promise<number> {
  const rows = await accounts().all<{ family: string; name: string }>('SELECT family, name FROM family_backup WHERE gone_at IS NOT NULL AND gone_at <= ?', now - graceDays * DAY);
  for (const r of rows) {
    await store.backups.remove(r.family, r.name);
    await accounts().run('DELETE FROM family_backup WHERE family = ? AND name = ?', r.family, r.name);
  }
  await accounts().run('DELETE FROM backup_status WHERE family <> ? AND family NOT IN (SELECT family FROM family_backup) AND family NOT IN (SELECT value FROM json_each(?))', ACCOUNTS_SCOPE, JSON.stringify(await store.treeIds()));
  return rows.length;
}

export interface BackupRun { made: number; failed: number; pruned: number; expired: number; left: number }

/**
 * The daily run: marks the backups of deleted families, deletes those past the grace period, then backs up every scope that
 * is due, the most stale first, until the time budget is spent. Each backup is followed by its scope's retention.
 */
export async function runBackups(opts: { trees: string[]; now: Date; log: (m: string) => void; budgetMs?: number; clock?: () => number }): Promise<BackupRun> {
  const clock = opts.clock ?? Date.now;
  const start = clock();
  const now = opts.now.getTime();
  const { keep, graceDays } = await backupSettings();
  const live = new Set([...opts.trees, ACCOUNTS_SCOPE]);
  for (const r of await accounts().all<{ family: string }>('SELECT DISTINCT family FROM family_backup WHERE gone_at IS NULL')) {
    if (!live.has(r.family)) await accounts().batch([markGone(r.family, now)]);
  }
  const expired = await expire(now, graceDays);
  const status = new Map((await accounts().all<{ family: string; ok_at: number | null }>('SELECT family, ok_at FROM backup_status')).map((r) => [r.family, r.ok_at ?? 0]));
  const due = [ACCOUNTS_SCOPE, ...opts.trees]
    .filter((s) => store.backups.covers(s) === 'backup' && now - (status.get(s) ?? 0) >= DUE_MS)
    .sort((a, b) => (status.get(a) ?? 0) - (status.get(b) ?? 0));
  let made = 0, failed = 0, pruned = 0, i = 0;
  for (; i < due.length && clock() - start < (opts.budgetMs ?? BUDGET_MS); i++) {
    const scope = due[i]!;
    try {
      await backUp(scope, new Date(Math.max(now, clock())));
      made += 1;
      pruned += await prune(scope, keep, now);
    } catch (e) {
      failed += 1;
      opts.log(`${scope === ACCOUNTS_SCOPE ? 'accounts' : `family ${scope}`}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  return { made, failed, pruned, expired, left: due.length - i };
}

// ---------- the drill ----------

/** Restores a scope's newest backup into a scratch database, checks it, and records the result. Null when it has none. */
export async function drill(scope: string, now = Date.now()): Promise<{ name: string; ok: boolean; problem: string | null } | null> {
  const newest = await accounts().get<{ name: string }>('SELECT name FROM family_backup WHERE family = ? AND gone_at IS NULL ORDER BY created_at DESC LIMIT 1', scope);
  if (!newest) return null;
  let r: { ok: boolean; problem: string | null };
  try {
    r = await store.backups.drill(scope, newest.name);
  } catch (e) {
    r = { ok: false, problem: e instanceof Error ? e.message : String(e) };
  }
  const ok = r.ok && !r.problem;
  const problem = ok ? null : sanitiseFailure(r.problem ?? 'failed', [scope, ...(await store.treeIds().catch(() => []))]);
  await accounts().run(
    `INSERT INTO backup_status (family, drill_at, drill_backup, drill_ok, drill_problem) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(family) DO UPDATE SET drill_at = excluded.drill_at, drill_backup = excluded.drill_backup, drill_ok = excluded.drill_ok, drill_problem = excluded.drill_problem`,
    scope, now, newest.name, ok ? 1 : 0, problem);
  return { name: newest.name, ok, problem };
}

/**
 * The weekly drill: the accounts database and one family, the one drilled longest ago (rotating), each from its newest backup.
 * Does nothing within a week of the last one, unless `force`.
 */
export async function runDrill(opts: { trees: string[]; now: Date; log: (m: string) => void; force?: boolean }): Promise<{ drilled: string[]; failed: number }> {
  const now = opts.now.getTime();
  const rows = await accounts().all<{ family: string; drill_at: number | null }>('SELECT family, drill_at FROM backup_status WHERE family IN (SELECT family FROM family_backup WHERE gone_at IS NULL)');
  const last = Math.max(0, ...rows.map((r) => r.drill_at ?? 0));
  if (!opts.force && now - last < DRILL_MS) return { drilled: [], failed: 0 };
  const at = new Map(rows.map((r) => [r.family, r.drill_at ?? 0]));
  const family = opts.trees.filter((t) => at.has(t)).sort((a, b) => at.get(a)! - at.get(b)! || a.localeCompare(b))[0];
  const drilled: string[] = [];
  let failed = 0;
  for (const scope of [ACCOUNTS_SCOPE, ...(family ? [family] : [])]) {
    if (!at.has(scope)) continue;
    const r = await drill(scope, now);
    if (!r) continue;
    drilled.push(scope);
    if (!r.ok) {
      failed += 1;
      opts.log(`${scope === ACCOUNTS_SCOPE ? 'accounts' : `family ${scope}`}: the drill failed: ${r.problem}`);
    }
  }
  return { drilled, failed };
}

// ---------- the console ----------

const rowOf = (r: { family: string; name: string; created_at: number; bytes: number; format: string; schema: string | null; counts: string; key_id: string; gone_at: number | null }, drillOf: Map<string, { name: string | null; ok: number | null; problem: string | null }>): BackupRow => {
  const d = drillOf.get(r.family);
  let rows = 0;
  try {
    rows = Object.values(JSON.parse(r.counts) as Record<string, number>).reduce((a, b) => a + b, 0);
  } catch {}
  return {
    name: r.name, created: r.created_at, bytes: r.bytes, format: r.format === 'dump' ? 'dump' : 'sqlite', schema: r.schema, rows, keyId: r.key_id,
    drill: d && d.name === r.name ? (d.ok === 1 ? 'ok' : 'failed') : null,
  };
};

/** The Backups tab: every family's backups (newest first) and status, the accounts', deleted families' waiting ones, the settings. */
export async function backupOverview(now = Date.now()): Promise<BackupOverview> {
  const [all, settings, key, rows, status, points, claims] = await Promise.all([
    families(),
    backupSettings(),
    keyStatus(),
    accounts().all<{ family: string; name: string; created_at: number; bytes: number; format: string; schema: string | null; counts: string; key_id: string; gone_at: number | null }>(
      'SELECT family, name, created_at, bytes, format, schema, counts, key_id, gone_at FROM family_backup ORDER BY created_at DESC'),
    accounts().all<{ family: string; ok_at: number | null; error: string | null; drill_at: number | null; drill_backup: string | null; drill_ok: number | null; drill_problem: string | null }>(
      'SELECT family, ok_at, error, drill_at, drill_backup, drill_ok, drill_problem FROM backup_status'),
    accounts().all<{ id: number; tree: string; bookmark: string; at: number; reason: string; before_migration: string | null; held_migration: string | null }>(
      'SELECT id, tree, bookmark, at, reason, before_migration, held_migration FROM recovery_point WHERE at > ? ORDER BY at DESC', now - 30 * DAY),
    accounts().all<{ tree: string; at: number; source: string | null }>("SELECT tree, at, source FROM family_claim WHERE what = 'restore' AND state = 'restoring' ORDER BY tree"),
  ]);
  const st = new Map(status.map((s) => [s.family, s]));
  const drillOf = new Map(status.map((s) => [s.family, { name: s.drill_backup, ok: s.drill_ok, problem: s.drill_problem }]));
  const { graceDays } = settings;
  const familyOf = (scope: string, name: string | null): BackupFamily => {
    const s = st.get(scope);
    const mine = rows.filter((r) => r.family === scope && r.gone_at === null);
    return {
      scope, name,
      covers: store.backups.covers(scope),
      lastOkAt: s?.ok_at ?? null,
      error: s?.error ?? null,
      drill: s?.drill_at ? { at: s.drill_at, ok: s.drill_ok === 1, problem: s.drill_problem, backup: s.drill_backup } : null,
      backups: mine.map((r) => rowOf(r, drillOf)),
      recovery: points.filter((p) => p.tree === scope).map((p) => ({ id: p.id, at: p.at, reason: p.reason === 'rollback' ? 'rollback' : 'migration', before: p.before_migration, held: p.held_migration })),
      goneAt: null, deleteAt: null,
    };
  };
  const gone = [...new Set(rows.filter((r) => r.gone_at !== null).map((r) => r.family))].map((scope) => {
    const mine = rows.filter((r) => r.family === scope && r.gone_at !== null);
    const goneAt = Math.min(...mine.map((r) => r.gone_at!));
    return { ...familyOf(scope, null), backups: mine.map((r) => rowOf(r, drillOf)), goneAt, deleteAt: goneAt + graceDays * DAY };
  });
  return {
    where: store.backups.where,
    settings,
    key: { source: key.source, besideBackups: key.besideBackups, other: key.other },
    accounts: familyOf(ACCOUNTS_SCOPE, null),
    families: all.map((f) => familyOf(f.id, f.name)),
    gone,
    pitr: !!store.backups.recovery,
    stopped: claims.map((c) => ({ into: c.tree, from: c.source, at: c.at, lapsesAt: c.at + RESTORE_CLAIM_MS })),
    now,
  };
}

/** The operator backs a family (or the accounts) up now. Logged. */
export async function backUpNow(op: AuditActor, scope: string): Promise<{ name: string }> {
  await knownScope(scope);
  if (store.backups.covers(scope) !== 'backup') throw invalid('backup.err.d1');
  let m: Manifest;
  try {
    m = await backUp(scope);
  } catch {
    throw invalid('backup.err.failed');
  }
  await prune(scope, (await backupSettings()).keep);
  await accounts().batch([audit(op, 'backup.now', scope === ACCOUNTS_SCOPE ? null : scope, { name: m.name })]);
  return { name: m.name };
}

/** The operator runs the drill of one scope's newest backup now. Logged. */
export async function drillNow(op: AuditActor, scope: string): Promise<{ ok: boolean; problem: string | null }> {
  const r = await drill(scope);
  if (!r) throw invalid('backup.err.no_backup');
  await accounts().batch([audit(op, 'backup.drill', scope === ACCOUNTS_SCOPE ? null : scope, { name: r.name, ok: r.ok })]);
  return { ok: r.ok, problem: r.problem };
}

async function knownScope(scope: string) {
  if (scope !== ACCOUNTS_SCOPE && !(await families()).some((f) => f.id === scope)) throw invalid('backup.err.no_family');
}

/** Pins a backup: kept until `until`, whatever the retention says. */
const pin = (scope: string, name: string, until: number): Query => q('UPDATE family_backup SET pinned_until = ? WHERE family = ? AND name = ?', until, scope, name);

/** The recorded stewards of a backup that still have an account. Null (from before 0055) and an empty list record none. */
async function recordedStewards(stewards: string | null): Promise<string[]> {
  let ids: unknown;
  try {
    ids = JSON.parse(stewards ?? 'null');
  } catch {
    return [];
  }
  if (!Array.isArray(ids) || !ids.length) return [];
  return (await accounts().all<{ id: string }>('SELECT id FROM user WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id', JSON.stringify(ids.filter((x) => typeof x === 'string')))).map((r) => r.id);
}

/** When the family now at `tree` was made (`family_admin.created_at`), or undefined when there is no such family. */
async function madeAt(tree: string): Promise<number | null | undefined> {
  if (!(await families()).some((f) => f.id === tree)) return undefined;
  return (await accounts().get<{ created_at: number | null }>('SELECT created_at FROM family_admin WHERE tree = ?', tree))?.created_at ?? null;
}

/**
 * Restores a backup. `new` (the default): into a new family id that is free, claimed for the restore first (`family_claim`, which
 * making a family respects too), whose stewards are the stewards the backup recorded who still have an account, and nobody else:
 * with none left the restore is refused, and nobody (the operator least of all) is handed a link instead. The pictures are copied
 * only while the backup's family still holds its id (not of a deleted family, nor of another family made at its address since)
 * and every one of those stewards still stewards it; otherwise the records are restored without them (`mediaWithheld`).
 * `over`: over the family itself, after a fresh backup of it (kept for a week), with its id typed as `confirm`; the server
 * function asked for a fresh proof. Logged before and after. The accounts database is restored by hand (docs).
 */
export async function restoreBackup(
  op: AuditActor, input: { scope: string; name: string; mode: 'new' | 'over'; into?: string; confirm?: string }, now = Date.now(), mediaStep = MEDIA_STEP,
): Promise<RestoreResult> {
  const { scope, name, mode } = input;
  if (scope === ACCOUNTS_SCOPE) throw invalid('backup.err.accounts_by_hand');
  const row = await accounts().get<{ gone_at: number | null; created_at: number; schema: string | null; stewards: string | null; family_created: number | null }>(
    'SELECT gone_at, created_at, schema, stewards, family_created FROM family_backup WHERE family = ? AND name = ?', scope, name);
  if (!row) throw invalid('backup.err.no_backup');
  if (mode === 'over') {
    if (row.gone_at !== null) throw invalid('backup.err.gone');
    await knownScope(scope);
    // The family at the address is the one backed up, not another made there since (whether or not its backups were marked).
    if ((await madeAt(scope)) !== (row.family_created ?? null)) throw invalid('backup.err.other_family');
    if ((input.confirm ?? '').trim() !== scope) throw invalid('backup.err.confirm');
    if (store.backups.covers(scope) !== 'backup') throw invalid('backup.err.d1');
    let fresh: Manifest;
    try {
      fresh = await backUp(scope, new Date(now));
    } catch {
      throw invalid('backup.err.fresh_failed');
    }
    await accounts().batch([
      pin(scope, fresh.name, now + PIN_MS),
      audit(op, 'backup.restore_over', scope, { name, created: row.created_at, schema: row.schema, fresh: fresh.name }),
    ]);
    await store.backups.restore(scope, name, scope, { over: true });
    return { into: scope, fresh: fresh.name, stewards: null, media: null, mediaWithheld: false };
  }

  const into = (input.into ?? '').trim();
  const { idProblem } = await import('../families.server.ts');
  const problem = idProblem(into);
  if (problem) throw problem;
  if (store.backups.covers(into) !== 'backup') throw invalid('backup.err.d1');
  const stewards = await recordedStewards(row.stewards);
  if (!stewards.length) throw invalid('backup.err.no_stewards');
  // The same family still holds the id: not deleted (its pictures went with it), and not made again by someone else since.
  const current = await madeAt(scope);
  const same = row.gone_at === null && current !== undefined && current === (row.family_created ?? null);
  // The family's pictures are as they are now, not as they were then: a steward removed since the backup would receive what
  // was added after their removal. So they are copied only while every steward the restore hands the family still stewards it.
  const mediaWithheld = same && !(await stewardsStill(scope, stewards));
  const withMedia = same && !mediaWithheld;

  // The address, claimed in one batch with the checks that it is free: a parallel restore or a family made there meanwhile loses.
  const free = `NOT EXISTS (SELECT 1 FROM membership WHERE tree = ?) AND NOT EXISTS (SELECT 1 FROM family_admin WHERE tree = ?)
    AND NOT EXISTS (SELECT 1 FROM invite WHERE tree = ? AND used_at IS NULL AND revoked_at IS NULL)`;
  try {
    await accounts().batch([
      guard(`NOT EXISTS (SELECT 1 FROM family_claim WHERE tree = ? AND ${CLAIM_HOLDS})`, into, now, now),
      guard(free, into, into, into),
      q(`INSERT INTO family_claim (tree, what, at, by, source, backup, source_created, state, media) VALUES (?, 'restore', ?, ?, ?, ?, ?, 'restoring', 0)
         ON CONFLICT(tree) DO UPDATE SET what = excluded.what, at = excluded.at, by = excluded.by, source = excluded.source, backup = excluded.backup,
           source_created = excluded.source_created, state = excluded.state, media = excluded.media`, into, now, op.id, scope, name, row.family_created ?? null),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw invalid('backup.err.taken');
    throw e;
  }
  // Only this restore's claim: one that lapsed may have been taken by another restore since.
  const release = () => accounts().run("DELETE FROM family_claim WHERE tree = ? AND what = 'restore' AND state = 'restoring' AND at = ? AND by = ?", into, now, op.id).catch(() => {});
  if ((await store.treeIds()).includes(into)) {
    await release();
    throw invalid('backup.err.taken');
  }
  await accounts().batch([audit(op, 'backup.restore_new', into, { from: scope, name, schema: row.schema, gone: row.gone_at !== null })]);
  let register: Query | null;
  try {
    // The driver writes only where no family is (a file, or a Durable Object that holds one, is never replaced here).
    register = await store.backups.restore(scope, name, into, { over: false });
    // The family's own id in its details, so it opens as the new family (src/lib/families.server.ts checks it).
    await store.tree(into).run("UPDATE meta SET value = ? WHERE key = 'id'", into);
  } catch (e) {
    await release();
    throw e;
  }
  const cap = same
    ? (await accounts().get<{ cap_bytes: number | null }>('SELECT cap_bytes FROM family_admin WHERE tree = ?', scope))?.cap_bytes ?? null
    : (await instanceSettings()).defaultCapBytes ?? null;
  const { upsertMembership } = await import('../auth/store.server.ts');
  // Published only while the claim is still this restore's own: a restore that outlived its claim (an hour) and lost the
  // address to another one publishes nothing, so it can never hand someone else's family to these stewards.
  try {
    await accounts().batch([
      guard("EXISTS (SELECT 1 FROM family_claim WHERE tree = ? AND what = 'restore' AND state = 'restoring' AND at = ? AND by = ?)", into, now, op.id),
      ...(register ? [register] : []),
      q('INSERT INTO family_admin (tree, cap_bytes, created_at, created_by) VALUES (?, ?, ?, ?) ON CONFLICT(tree) DO NOTHING', into, cap, now, op.id),
      ...stewards.map((id) => upsertMembership(id, into, 'steward')),
      q("UPDATE family_claim SET state = 'restored', media = ? WHERE tree = ? AND what = 'restore' AND at = ? AND by = ?", withMedia ? 1 : 0, into, now, op.id),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw invalid('backup.err.taken');
    throw e;
  }
  let media: RestoreResult['media'] = null;
  if (withMedia) {
    media = await copyMedia(scope, into, mediaStep);
    if (!media.left) await accounts().run("UPDATE family_claim SET media = 0 WHERE tree = ? AND what = 'restore'", into);
  }
  await accounts().batch([audit(op, 'backup.restore_new', into, { from: scope, name, stewards: stewards.length, media, mediaWithheld })]);
  return { into, fresh: null, stewards: stewards.length, media, mediaWithheld };
}

/** Whether every one of `users` stewards `tree` now. */
async function stewardsStill(tree: string, users: readonly string[]): Promise<boolean> {
  const now = new Set((await accounts().all<{ user: string }>("SELECT user FROM membership WHERE tree = ? AND role = 'steward'", tree)).map((r) => r.user));
  return users.every((u) => now.has(u));
}

/**
 * Copies the pictures and documents of `from` that `into` does not have yet, at most `limit` at a time (a restore into a new id;
 * pictures are not in a backup). Returns how many were copied and how many are left. The family's storage is counted again.
 * Only restoreBackup and copyMediaNow call it, with the pair a restore recorded.
 */
async function copyMedia(from: string, into: string, limit = MEDIA_STEP): Promise<{ copied: number; left: number }> {
  const [source, have] = await Promise.all([store.media.list(from).catch(() => []), store.media.list(into)]);
  const known = new Set(have.map((f) => f.key));
  const todo = source.filter((f) => !known.has(f.key));
  let copied = 0;
  for (const f of todo.slice(0, limit)) {
    const o = await store.media.get(from, f.key);
    if (!o) continue;
    const bytes = o.body instanceof Uint8Array ? o.body : new Uint8Array(await new Response(o.body).arrayBuffer());
    await store.media.put(into, f.key, bytes, o.mime ?? 'application/octet-stream');
    copied += 1;
  }
  if (copied) await (await import('../operator/storage.server.ts')).recount(into);
  return { copied, left: Math.max(0, todo.length - limit) };
}

/**
 * The console's "copy the rest of the pictures" after a restore into a new id: only from the source that restore recorded into
 * the family it made, while that family is still the one the restore left (its claim goes with it), the source is still the same
 * family, every steward of the restored family still stewards the source, and pictures are left to copy. Logged.
 */
export async function copyMediaNow(op: AuditActor, into: string, limit = MEDIA_STEP): Promise<{ copied: number; left: number }> {
  const c = await accounts().get<{ source: string | null; source_created: number | null; state: string; media: number }>(
    "SELECT source, source_created, state, media FROM family_claim WHERE tree = ? AND what = 'restore'", into);
  if (!c?.source || c.state !== 'restored' || c.media !== 1 || !(await families()).some((f) => f.id === into)) throw invalid('backup.err.no_media');
  // The same family still holds the source's id, and every steward of the restored family stewards it: no picture reaches someone
  // removed from the source since, nor a steward added to the restored family who has no part in the source.
  const stewards = (await accounts().all<{ user: string }>("SELECT user FROM membership WHERE tree = ? AND role = 'steward'", into)).map((r) => r.user);
  if ((await madeAt(c.source)) !== (c.source_created ?? null) || !(await stewardsStill(c.source, stewards))) {
    await accounts().run("UPDATE family_claim SET media = 0 WHERE tree = ? AND what = 'restore'", into);
    throw invalid('backup.err.no_media');
  }
  const r = await copyMedia(c.source, into, limit);
  await accounts().batch([
    ...(r.left ? [] : [q("UPDATE family_claim SET media = 0 WHERE tree = ? AND what = 'restore'", into)]),
    audit(op, 'backup.copy_media', into, { from: c.source, copied: r.copied }),
  ]);
  return r;
}

/**
 * Rolls a family in a Durable Object back to a recovery point taken before an update: after a fresh backup, with its id typed as
 * `confirm`; the server function asked for a fresh proof. Every change since that point is undone; the point it leaves is kept
 * as a new recovery point, so the rollback can be undone too. Logged.
 */
export async function rollbackFamily(op: AuditActor, tree: string, point: number, confirm: string, now = Date.now()): Promise<{ fresh: string }> {
  const r = store.backups.recovery;
  if (!r) throw invalid('backup.err.no_pitr');
  await knownScope(tree);
  const p = await accounts().get<{ bookmark: string; at: number }>('SELECT bookmark, at FROM recovery_point WHERE id = ? AND tree = ?', point, tree);
  if (!p) throw invalid('backup.err.no_point');
  if (confirm.trim() !== tree) throw invalid('backup.err.confirm');
  let fresh: Manifest;
  try {
    fresh = await backUp(tree, new Date(now));
  } catch {
    throw invalid('backup.err.fresh_failed');
  }
  await accounts().batch([pin(tree, fresh.name, now + PIN_MS), audit(op, 'backup.rollback', tree, { at: p.at, fresh: fresh.name })]);
  let undo: string;
  try {
    undo = await r.rollback(tree, p.bookmark);
  } catch (e) {
    if (e instanceof Error && e.message.includes('kindred:no-pitr')) throw invalid('backup.err.no_pitr');
    throw e;
  }
  await accounts().run('INSERT INTO recovery_point (tree, bookmark, at, reason) VALUES (?, ?, ?, ?) ON CONFLICT(tree, bookmark) DO NOTHING', tree, undo, now, 'rollback');
  return { fresh: fresh.name };
}

/** The operator clears the claim of a restore that stopped (still `restoring`), so its address is free again. Logged. */
export async function clearRestoreClaim(op: AuditActor, into: string): Promise<void> {
  const c = await accounts().get<{ at: number; source: string | null; backup: string | null }>(
    "SELECT at, source, backup FROM family_claim WHERE tree = ? AND what = 'restore' AND state = 'restoring'", into);
  if (!c) throw invalid('backup.err.no_claim');
  await accounts().batch([
    q("DELETE FROM family_claim WHERE tree = ? AND what = 'restore' AND state = 'restoring' AND at = ?", into, c.at),
    audit(op, 'backup.clear_claim', into, { from: c.source, name: c.backup, at: c.at }),
  ]);
}

// ---------- health ----------

/** What the Health tab shows of the backups (src/lib/operator/health.server.ts). */
export async function backupHealth(trees: readonly string[], now = Date.now()): Promise<BackupHealth> {
  const [key, totals, status, points] = await Promise.all([
    keyStatus(),
    accounts().get<{ n: number; bytes: number | null }>('SELECT count(*) AS n, sum(bytes) AS bytes FROM family_backup'),
    accounts().all<{ family: string; ok_at: number | null; error: string | null; drill_at: number | null; drill_ok: number | null; drill_problem: string | null }>(
      'SELECT family, ok_at, error, drill_at, drill_ok, drill_problem FROM backup_status'),
    accounts().get<{ n: number }>('SELECT count(*) AS n FROM recovery_point WHERE at > ?', now - 30 * DAY),
  ]);
  const st = new Map(status.map((s) => [s.family, s]));
  const scopes = [ACCOUNTS_SCOPE, ...trees];
  const covered = scopes.filter((s) => store.backups.covers(s) === 'backup');
  const list = covered.map((scope) => {
    const s = st.get(scope);
    const lastOkAt = s?.ok_at ?? null;
    return { scope, lastOkAt, error: s?.error ?? null, stale: lastOkAt === null || now - lastOkAt > STALE_MS };
  }).sort((a, b) => Number(b.stale) - Number(a.stale) || (a.lastOkAt ?? 0) - (b.lastOkAt ?? 0));
  const drills = status.filter((s) => s.drill_at).sort((a, b) => b.drill_at! - a.drill_at!);
  const gone = await accounts().get<{ n: number }>('SELECT count(DISTINCT family) AS n FROM family_backup WHERE gone_at IS NOT NULL');
  return {
    where: store.backups.where,
    key: { source: key.source, besideBackups: key.besideBackups, other: key.other },
    total: { count: Number(totals?.n ?? 0), bytes: Number(totals?.bytes ?? 0) },
    families: list.slice(0, 50),
    stale: list.filter((f) => f.stale).length,
    covered: covered.length,
    d1: scopes.filter((s) => store.backups.covers(s) === 'd1'),
    drills: drills.slice(0, 5).map((d) => ({ scope: d.family, at: d.drill_at!, ok: d.drill_ok === 1, problem: d.drill_problem })),
    recovery: Number(points?.n ?? 0),
    gone: Number(gone?.n ?? 0),
  };
}

