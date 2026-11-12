// Server functions for the console's Update button and Health tab (docs/hosting-many-families.md, "Updates" and "Health").
// Every one checks `requireOperator` on the server; each that changes something refuses while nothing may be written (a demo,
// a "View as" preview), and starting an update needs a fresh passkey proof under Kindred's own sign-in. The work is in
// ./self-update.server.ts and ./health.server.ts.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Health } from './health-shared';
import type { SelfUpdate, UpdateRun } from './self-update-shared';

const guard = () => import('../auth/guard.server');
const work = () => import('./self-update.server');

async function failed(e: unknown): Promise<unknown> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('../auth/errors')]);
  return e instanceof AuthError ? fail(e) : e;
}

/** The operator, for a change: refused in a demo and in a preview, before anything is done. */
async function operatorForChange() {
  const [{ requireOperator }, { refuseReadOnly }] = await Promise.all([guard(), import('../read-only')]);
  const op = await requireOperator();
  try {
    refuseReadOnly();
  } catch (e) {
    throw await failed(e);
  }
  return op;
}

const tag = z.string().max(40);

/** How this install is updated, the stored repository (never the token) and the last update's run, asked about politely. */
export const fetchSelfUpdate = createServerFn({ method: 'GET' }).handler(async (): Promise<SelfUpdate> => {
  const { requireOperator } = await guard();
  await requireOperator();
  const w = await work();
  const state = await w.selfUpdate();
  return state.run && state.install === 'github-actions' ? { ...state, run: await w.pollRun() } : state;
});
export const selfUpdateQuery = queryOptions({ queryKey: ['operator', 'self-update'], queryFn: () => fetchSelfUpdate() });

/** The releases an update to `tag` goes through, with their flags (`manual` refuses the button). */
export const fetchUpdatePlan = createServerFn({ method: 'GET' })
  .validator(z.object({ tag }))
  .handler(async ({ data }) => {
    const { requireOperator } = await guard();
    await requireOperator();
    try {
      return await (await work()).plan(data.tag);
    } catch (e) {
      throw await failed(e);
    }
  });

/** Stores the install's repository and its token (sealed; never shown again). Logged without the token. */
export const operatorSaveUpdateToken = createServerFn({ method: 'POST' })
  .validator(z.object({ repo: z.string().max(200), token: z.string().max(400) }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await work()).saveToken({ id: op.id, name: op.name }, data.repo, data.token);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

export const operatorForgetUpdateToken = createServerFn({ method: 'POST' }).handler(async () => {
  const op = await operatorForChange();
  await (await work()).forgetToken({ id: op.id, name: op.name });
  return { ok: true as const };
});

/** Starts the update to `tag`: a fresh proof first, as for deleting a family. Logged. */
export const operatorStartUpdate = createServerFn({ method: 'POST' })
  .validator(z.object({ tag }))
  .handler(async ({ data }): Promise<UpdateRun> => {
    const op = await operatorForChange();
    const [{ authMethod }, { requireFreshProof }, { getRequest }] = await Promise.all([import('../auth/method.server'), import('../auth/proof.server'), import('@tanstack/react-start/server')]);
    try {
      if (authMethod() === 'kindred') await requireFreshProof(getRequest(), op);
      return await (await work()).startUpdate({ id: op.id, name: op.name }, data.tag);
    } catch (e) {
      throw await failed(e);
    }
  });

export const fetchHealth = createServerFn({ method: 'GET' }).handler(async (): Promise<Health> => {
  const { requireOperator } = await guard();
  await requireOperator();
  return (await import('./health.server')).readHealth();
});
export const healthQuery = queryOptions({ queryKey: ['operator', 'health'], queryFn: () => fetchHealth() });
