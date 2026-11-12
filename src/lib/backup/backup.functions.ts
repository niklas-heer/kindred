// Server functions for the operator console's Backups tab (src/components/operator/OperatorBackups.tsx; the work is in
// ./backup.server.ts). Every one checks `requireOperator` on the server; every one that changes something refuses while
// nothing may be written (a demo, a "View as" preview), and a restore over a family or a rollback also asks for a fresh proof
// under Kindred's own sign-in, as deleting a family does.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { GRACE_MAX_DAYS, KEEP_MAX } from './retention';
import type { BackupOverview, RestoreResult } from './shared';

const scope = z.string().regex(/^(?:[a-z0-9-]{1,64}|_accounts)$/);
const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const name = z.string().regex(/^\d{8}T\d{9}Z$/);

const guard = () => import('../auth/guard.server');
const work = () => import('./backup.server');

async function failed(e: unknown): Promise<unknown> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('../auth/errors')]);
  return e instanceof AuthError ? fail(e) : e;
}

/** The operator, for a change: refused in a demo and in a preview, before anything is done; with a fresh proof when `proof`. */
async function operatorForChange(proof = false) {
  const [{ requireOperator }, { refuseReadOnly }] = await Promise.all([guard(), import('../read-only')]);
  const op = await requireOperator();
  try {
    refuseReadOnly();
    if (proof) {
      const [{ authMethod }, { requireFreshProof }, { getRequest }] = await Promise.all([import('../auth/method.server'), import('../auth/proof.server'), import('@tanstack/react-start/server')]);
      if (authMethod() === 'kindred') await requireFreshProof(getRequest(), op);
    }
  } catch (e) {
    throw await failed(e);
  }
  return { id: op.id, name: op.name };
}

/** Runs `fn` as the operator's change, with a refusal written for the reader turned into its HTTP status. */
async function change<T>(fn: (op: { id: string; name: string }) => Promise<T>, proof = false): Promise<T> {
  const op = await operatorForChange(proof);
  try {
    return await fn(op);
  } catch (e) {
    throw await failed(e);
  }
}

export const fetchBackups = createServerFn({ method: 'GET' }).handler(async (): Promise<BackupOverview> => {
  const { requireOperator } = await guard();
  await requireOperator();
  return (await work()).backupOverview();
});
export const backupsQuery = queryOptions({ queryKey: ['operator', 'backups'], queryFn: () => fetchBackups() });

export const operatorBackupSettings = createServerFn({ method: 'POST' })
  .validator(z.object({
    keep: z.object({ daily: z.number().int().min(1).max(KEEP_MAX.daily), weekly: z.number().int().min(1).max(KEEP_MAX.weekly), monthly: z.number().int().min(1).max(KEEP_MAX.monthly) }),
    graceDays: z.number().int().min(0).max(GRACE_MAX_DAYS),
  }))
  .handler(async ({ data }) => {
    await change(async (op) => (await work()).saveBackupSettings(op, data));
    return { ok: true as const };
  });

export const operatorBackUpNow = createServerFn({ method: 'POST' })
  .validator(z.object({ scope }))
  .handler(async ({ data }) => change(async (op) => (await work()).backUpNow(op, data.scope)));

export const operatorDrillNow = createServerFn({ method: 'POST' })
  .validator(z.object({ scope }))
  .handler(async ({ data }) => change(async (op) => (await work()).drillNow(op, data.scope)));

/** A restore into a new id needs no proof (nothing is replaced); over the family it does, with the id typed. */
export const operatorRestoreBackup = createServerFn({ method: 'POST' })
  .validator(z.object({ scope: tree, name, mode: z.enum(['new', 'over']), into: tree.optional(), confirm: z.string().max(80).optional() }))
  .handler(async ({ data }): Promise<RestoreResult> => change(async (op) => (await work()).restoreBackup(op, data), data.mode === 'over'));

/** Copies more pictures into a family a restore made, from the family that restore recorded as its source, and nowhere else. */
export const operatorCopyMedia = createServerFn({ method: 'POST' })
  .validator(z.object({ into: tree }))
  .handler(async ({ data }) => change(async (op) => (await work()).copyMediaNow(op, data.into)));

/** Clears the claim of a restore that stopped, so its address is free again. */
export const operatorClearRestoreClaim = createServerFn({ method: 'POST' })
  .validator(z.object({ into: tree }))
  .handler(async ({ data }) => {
    await change(async (op) => (await work()).clearRestoreClaim(op, data.into));
    return { ok: true as const };
  });

export const operatorRollback = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, point: z.number().int().positive(), confirm: z.string().max(80) }))
  .handler(async ({ data }) => change(async (op) => (await work()).rollbackFamily(op, data.tree, data.point, data.confirm), true));
