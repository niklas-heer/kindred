// Server functions for the operator console's Statistics and Updates tabs (docs/hosting-many-families.md). Every one checks
// `requireOperator` on the server; the one that changes something refuses while nothing may be written. The work is in
// ./stats.server.ts and ./updates.server.ts.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { OperatorStatistics } from './stats-shared';
import type { UpdateStatus } from './updates-shared';

const guard = () => import('../auth/guard.server');

export const fetchOperatorStatistics = createServerFn({ method: 'GET' }).handler(async (): Promise<OperatorStatistics> => {
  const { requireOperator } = await guard();
  await requireOperator();
  return (await import('./stats.server')).readStatistics();
});
export const operatorStatisticsQuery = queryOptions({ queryKey: ['operator', 'statistics'], queryFn: () => fetchOperatorStatistics(), staleTime: 5 * 60_000 });

/**
 * The running version and what the last check found. Opening the tab asks GitHub when the last answer is a day old (once
 * agreed), so an install whose daily jobs never ran still learns of a release.
 */
export const fetchUpdateStatus = createServerFn({ method: 'GET' }).handler(async (): Promise<UpdateStatus> => {
  const [{ requireOperator }, { readOnly }] = await Promise.all([guard(), import('../read-only')]);
  await requireOperator();
  const u = await import('./updates.server');
  if (!readOnly()) await u.checkForUpdate();
  return u.updateStatus();
});
export const updateStatusQuery = queryOptions({ queryKey: ['operator', 'updates'], queryFn: () => fetchUpdateStatus(), staleTime: 10 * 60_000 });

/** Only whether an update is known, from the cache: the dot on the console's link in the account menu. */
export const fetchUpdateDot = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean> => {
  const { currentSession } = await guard();
  const s = await currentSession();
  if (!s.user || s.user.operator !== 1 || s.via === 'demo') return false;
  return (await import('./updates.server')).updateAvailable();
});
export const updateDotQuery = queryOptions({ queryKey: ['operator', 'update-dot'], queryFn: () => fetchUpdateDot(), staleTime: 60 * 60_000 });

/** The operator agrees to the daily check (or turns it off). Logged. */
export const operatorSetUpdateCheck = createServerFn({ method: 'POST' })
  .validator(z.object({ on: z.boolean() }))
  .handler(async ({ data }) => {
    const [{ requireOperator, fail }, { refuseReadOnly }, { AuthError }] = await Promise.all([guard(), import('../read-only'), import('../auth/errors')]);
    const op = await requireOperator();
    try {
      refuseReadOnly();
    } catch (e) {
      throw e instanceof AuthError ? fail(e) : e;
    }
    const [{ setAgreed }, { audit }, { store }] = await Promise.all([import('./updates.server'), import('./settings.server'), import('../store/index')]);
    await store.accounts().batch([setAgreed(data.on, op.id), audit({ id: op.id, name: op.name }, data.on ? 'updates.on' : 'updates.off', null)]);
    return { ok: true as const };
  });
