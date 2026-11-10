// Server functions for the Families page (src/routes/families.tsx): the overview, making a family, changing its details,
// deleting it. The rules are in ./families.server.ts; every one is checked here on the server, never by the page.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { FamiliesOverview } from './families.server';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const details = { name: z.string().max(400), tagline: z.string().max(400), theme: z.enum(['codex', 'modern']) };

const guard = () => import('./auth/guard.server');
const server = () => import('./families.server');
/** A refusal written for the reader gets its HTTP status (400, 403); anything else is left to the error middleware. */
async function failed(e: unknown): Promise<unknown> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('./auth/errors')]);
  return e instanceof AuthError ? fail(e) : e;
}

/** The reader's families, the empty databases a family can be made in, and whether they may make one. Signed-in members only. */
export const fetchFamilies = createServerFn({ method: 'GET' }).handler(async (): Promise<FamiliesOverview> => {
  const [{ requireUser, myMemberships }, s] = await Promise.all([guard(), server()]);
  const user = await requireUser();
  return s.overview(user, await myMemberships());
});
export const familiesQuery = queryOptions({ queryKey: ['families', 'admin'], queryFn: () => fetchFamilies() });

/** Makes a family (or finishes one a failed attempt left half-made); the reader becomes its steward. */
export const createFamily = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().max(80), ...details }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const [{ requireUser, myMemberships }, s, { refuseInDemo }] = await Promise.all([guard(), server(), import('./demo')]);
    const user = await requireUser();
    try {
      refuseInDemo();
      if (!(await s.mayCreate(user, await myMemberships()))) throw s.notAllowed();
      return { id: await s.createFamily(user, data) };
    } catch (e) {
      throw await failed(e);
    }
  });

/** Changes a family's name, tagline and theme. Its stewards only. */
export const editFamily = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, opKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/), ...details }))
  .handler(async ({ data }) => {
    const { requireCan } = await guard();
    const m = await requireCan(data.tree, 'manage-access');
    const { tree: id, opKey, ...input } = data;
    try {
      return await (await server()).editFamily(id, input, { key: opKey, user: m.user.id, payload: input });
    } catch (e) {
      throw await failed(e);
    }
  });

/**
 * Deletes a family with everything that belongs to it. Its stewards only, with the family's id typed as `confirm`, and (under
 * Kindred's own sign-in) a fresh passkey proof on this session, as for the other steps that cannot be undone.
 */
export const deleteFamily = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, confirm: z.string().max(80) }))
  .handler(async ({ data }) => {
    const [{ requireCan }, { authMethod }, { requireFreshProof }, { getRequest }, s] = await Promise.all([
      guard(), import('./auth/method.server'), import('./auth/proof.server'), import('@tanstack/react-start/server'), server(),
    ]);
    const m = await requireCan(data.tree, 'manage-access');
    try {
      if (authMethod() === 'kindred') await requireFreshProof(getRequest(), m.user);
      await s.deleteFamily(data.tree, data.confirm);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });
