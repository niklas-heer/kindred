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
import { audit, type AuditActor } from '../operator/settings.server.ts';
import { q, store, type Query } from '../store/index.ts';
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
    q(`INSERT INTO family_backup (family, name, created_at, bytes, format, schema, counts, sha256, key_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(family, name) DO NOTHING`, scope, m.name, Date.parse(m.created) || now, bytes, m.format, m.schema, JSON.stringify(m.counts), m.sha256, m.keyId),
    q(`INSERT INTO backup_status (family, tried_at, ok_at, error) VALUES (?, ?, ?, NULL)
       ON CONFLICT(family) DO UPDATE SET tried_at = excluded.tried_at, ok_at = excluded.ok_at, error = NULL`, scope, now, now),
  ]);
  return m;
}

/** Deletes a scope's backups beyond the retention: its files, then their rows. Returns how many went. */
export async function prune(scope: string, keep: Keep): Promise<number> {
  const rows = await accounts().all<{ name: string; created_at: number }>('SELECT name, created_at FROM family_backup WHERE family = ? AND gone_at IS NULL ORDER BY created_at', scope);
  const kept = keepIndexes(rows.map((r) => r.created_at), keep);
  let removed = 0;
  for (const [i, r] of rows.entries()) {
    if (kept.has(i)) continue;
    await store.backups.remove(scope, r.name);
    await accounts().run('DELETE FROM family_backup WHERE family = ? AND name = ?', scope, r.name);
    removed += 1;
  }
  return removed;
}

/** Marks the backups of a deleted family: they are deleted once the grace period has passed. */
export const markGone = (tree: string, at = Date.now()): Query => q('UPDATE family_backup SET gone_at = ? WHERE family = ? AND gone_at IS NULL', at, tree);

/** Deletes the backups of families deleted longer ago than the grace period. Returns how many went. */
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
      pruned += await prune(scope, keep);
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
  const [all, settings, key, rows, status, points] = await Promise.all([
    families(),
    backupSettings(),
    keyStatus(),
    accounts().all<{ family: string; name: string; created_at: number; bytes: number; format: string; schema: string | null; counts: string; key_id: string; gone_at: number | null }>(
      'SELECT family, name, created_at, bytes, format, schema, counts, key_id, gone_at FROM family_backup ORDER BY created_at DESC'),
    accounts().all<{ family: string; ok_at: number | null; error: string | null; drill_at: number | null; drill_backup: string | null; drill_ok: number | null; drill_problem: string | null }>(
      'SELECT family, ok_at, error, drill_at, drill_backup, drill_ok, drill_problem FROM backup_status'),
    accounts().all<{ id: number; tree: string; bookmark: string; at: number; reason: string; before_migration: string | null; held_migration: string | null }>(
      'SELECT id, tree, bookmark, at, reason, before_migration, held_migration FROM recovery_point WHERE at > ? ORDER BY at DESC', now - 30 * DAY),
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

/**
 * Restores a backup. `new` (the default): into a new family id that is free, whose stewards are the original family's (or, when
 * it has none left, a one-time link makes its first steward), and copies the pictures the original still has. `over`: over the
 * family itself, after a fresh backup of it, with its id typed as `confirm`; the server function asked for a fresh proof.
 * Logged before and after. The accounts database is restored by hand (docs).
 */
export async function restoreBackup(op: AuditActor, input: { scope: string; name: string; mode: 'new' | 'over'; into?: string; confirm?: string }, now = Date.now()): Promise<RestoreResult> {
  const { scope, name, mode } = input;
  if (scope === ACCOUNTS_SCOPE) throw invalid('backup.err.accounts_by_hand');
  const row = await accounts().get<{ gone_at: number | null }>('SELECT gone_at FROM family_backup WHERE family = ? AND name = ?', scope, name);
  if (!row) throw invalid('backup.err.no_backup');
  if (mode === 'over') {
    if (row.gone_at !== null) throw invalid('backup.err.gone');
    await knownScope(scope);
    if ((input.confirm ?? '').trim() !== scope) throw invalid('backup.err.confirm');
    if (store.backups.covers(scope) !== 'backup') throw invalid('backup.err.d1');
    let fresh: Manifest;
    try {
      fresh = await backUp(scope, new Date(now));
    } catch {
      throw invalid('backup.err.fresh_failed');
    }
    await accounts().batch([audit(op, 'backup.restore_over', scope, { name, fresh: fresh.name })]);
    await store.backups.restore(scope, name, scope);
    return { into: scope, fresh: fresh.name, token: null, expires: null, media: null };
  }

  const into = (input.into ?? '').trim();
  const { idProblem } = await import('../families.server.ts');
  const problem = idProblem(into);
  if (problem) throw problem;
  if (store.backups.covers(into) !== 'backup') throw invalid('backup.err.d1');
  const [[taken]] = (await accounts().readBatch([
    q(`SELECT (SELECT count(*) FROM membership WHERE tree = ?) + (SELECT count(*) FROM family_admin WHERE tree = ?)
       + (SELECT count(*) FROM invite WHERE tree = ? AND used_at IS NULL AND revoked_at IS NULL) AS n`, into, into, into),
  ])) as unknown as [[{ n: number }]];
  if ((await store.treeIds()).includes(into) || taken!.n > 0) throw invalid('backup.err.taken');
  await accounts().batch([audit(op, 'backup.restore_new', into, { from: scope, name })]);
  const register = await store.backups.restore(scope, name, into);
  // The family's own id in its details, so it opens as the new family (src/lib/families.server.ts checks it).
  await store.tree(into).run("UPDATE meta SET value = ? WHERE key = 'id'", into);
  const [stewards, admin] = (await accounts().readBatch([
    q("SELECT user FROM membership WHERE tree = ? AND role = 'steward'", scope),
    q('SELECT cap_bytes FROM family_admin WHERE tree = ?', scope),
  ])) as unknown as [{ user: string }[], { cap_bytes: number | null }[]];
  const { upsertMembership, createInvite } = await import('../auth/store.server.ts');
  await accounts().batch([
    ...(register ? [register] : []),
    q('INSERT INTO family_admin (tree, cap_bytes, created_at, created_by) VALUES (?, ?, ?, ?) ON CONFLICT(tree) DO NOTHING', into, admin[0]?.cap_bytes ?? null, now, op.id),
    ...stewards.map((s) => upsertMembership(s.user, into, 'steward')),
  ]);
  let token: string | null = null, expires: number | null = null;
  if (!stewards.length) {
    const made = await createInvite({ tree: into, role: 'steward', email: null, createdBy: op.id, byOperator: true });
    token = made.token;
    expires = made.invite.expires;
  }
  const media = await copyMedia(scope, into);
  return { into, fresh: null, token, expires, media };
}

/**
 * Copies the pictures and documents of `from` that `into` does not have yet, at most MEDIA_STEP at a time (a restore into a new
 * id; pictures are not in a backup). Returns how many were copied and how many are left. The family's storage is counted again.
 */
export async function copyMedia(from: string, into: string, limit = MEDIA_STEP): Promise<{ copied: number; left: number }> {
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

/** The console's "copy the rest of the pictures" after a restore into a new id. Logged. */
export async function copyMediaNow(op: AuditActor, from: string, into: string): Promise<{ copied: number; left: number }> {
  if (!(await families()).some((f) => f.id === into)) throw invalid('backup.err.no_family');
  const r = await copyMedia(from, into);
  await accounts().batch([audit(op, 'backup.copy_media', into, { from, copied: r.copied })]);
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
  await accounts().batch([audit(op, 'backup.rollback', tree, { at: p.at, fresh: fresh.name })]);
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

