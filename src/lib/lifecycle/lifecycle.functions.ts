// Server functions of the lifecycle of abandoned families (./lifecycle.server.ts, docs/hosting-many-families.md "Lifecycle"):
// the console's section (operators only), and what a family's members see and its stewards may do (members only; a guest is
// told nothing). Every change refuses while nothing may be written (a demo, a "View as" preview).
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { LIFECYCLE_MONTHS_MAX, type FamilyLifecycle, type LifecycleFamily, type LifecycleReport, type LifecycleSettings } from './shared';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const months = z.number().int().min(1).max(LIFECYCLE_MONTHS_MAX);
const guard = () => import('../auth/guard.server');
const work = () => import('./lifecycle.server');

async function failed(e: unknown): Promise<unknown> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('../auth/errors')]);
  return e instanceof AuthError ? fail(e) : e;
}

async function operator(change = false) {
  const op = await (await guard()).requireOperator();
  if (change) {
    try {
      (await import('../read-only')).refuseReadOnly();
    } catch (e) {
      throw await failed(e);
    }
  }
  return op;
}

/**
 * The reader's membership of `tree` as the guard sees it (a preview answers as the previewed reader), without the suspended
 * family's read-only mark: a steward must be able to turn the family back on in this request. Null for a guest or a non-member.
 */
async function memberOf(t: string) {
  const g = await guard();
  const session = await g.currentSession();
  if (!session.user || session.guest?.tree === t) return null;
  const m = (await g.myMemberships()).find((x) => x.tree === t);
  return m && !m.closed ? { user: session.user, role: m.role } : null;
}

// ---------- the console ----------

export interface LifecycleConsole { settings: LifecycleSettings; families: LifecycleFamily[]; dryRun: LifecycleReport; last: LifecycleReport | null; now: number }

export const fetchLifecycleConsole = createServerFn({ method: 'GET' }).handler(async (): Promise<LifecycleConsole> => {
  await operator();
  const w = await work();
  const now = Date.now();
  const [settings, families, dryRun, last] = await Promise.all([w.lifecycleSettings(), w.lifecycleFamilies(), w.runLifecycle(now, { dryRun: true }), w.lastLifecycleReport()]);
  return { settings, families, dryRun: dryRun!, last, now };
});
export const lifecycleConsoleQuery = queryOptions({ queryKey: ['operator', 'lifecycle'], queryFn: () => fetchLifecycleConsole() });

export const operatorSaveLifecycle = createServerFn({ method: 'POST' })
  .validator(z.object({ on: z.boolean(), warnMonths: months, readOnlyMonths: months, deleteMonths: months, autoDelete: z.boolean() }))
  .handler(async ({ data }) => {
    const op = await operator(true);
    try {
      await (await work()).saveLifecycleSettings(op, data);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

/** The operator deletes a family that is due, with its id typed and a fresh proof. */
export const operatorDeleteDue = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, confirm: z.string().max(80) }))
  .handler(async ({ data }) => {
    const op = await operator(true);
    const [{ authMethod }, { requireFreshProof }, { getRequest }] = await Promise.all([import('../auth/method.server'), import('../auth/proof.server'), import('@tanstack/react-start/server')]);
    try {
      if (authMethod() === 'kindred') await requireFreshProof(getRequest(), op);
      await (await work()).confirmDeletion(op, data.tree, data.confirm);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

// ---------- the family ----------

/** Where the family stands in the lifecycle, for its members' bar and its stewards' warning; null when it is not in it. */
export const fetchFamilyLifecycle = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<FamilyLifecycle | null> => {
    const m = await memberOf(data.tree);
    if (!m) return null;
    return (await work()).familyLifecycle(data.tree, m.user.id, m.role === 'steward');
  });
export const familyLifecycleQuery = (t: string) => queryOptions({ queryKey: ['family-lifecycle', t], queryFn: () => fetchFamilyLifecycle({ data: { tree: t } }), staleTime: 10 * 60_000 });

async function stewardForChange(t: string) {
  const [{ fail, requireUser }, errors] = await Promise.all([guard(), import('../auth/errors')]);
  // Signed out, or a guest (who has no account): refused as signed out, as every change a member makes.
  await requireUser();
  const m = await memberOf(t);
  if (!m) throw fail(errors.notMember());
  if (m.role !== 'steward') throw fail(errors.forbidden('manage-access', 'steward'));
  try {
    (await import('../read-only')).refuseReadOnly();
  } catch (e) {
    throw await failed(e);
  }
  return m.user;
}

/** A steward puts the warning away for 30 days. */
export const dismissLifecycleWarning = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const user = await stewardForChange(data.tree);
    return { until: await (await work()).dismissWarning(user.id, data.tree) };
  });

/** A steward turns the family the lifecycle made read-only back on. */
export const reactivateFamily = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const user = await stewardForChange(data.tree);
    try {
      await (await work()).reactivate({ id: user.id, name: user.name }, data.tree);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });
