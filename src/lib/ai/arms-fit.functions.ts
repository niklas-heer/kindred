// The steward's "check the arms against the name": one server function, which the browser calls after a steward saves the
// research and from "Check again". Stewards only (edit-house, checked first); the arms feature and the budget are checked in
// adapterForFeature. There is no call on a page view, so a page cannot spend the budget by itself.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { toAiLocale } from './types';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const guard = () => import('../auth/guard.server');

export const checkArmsFit = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    house: z.string().min(1).max(100),
    opKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    locale: z.string().max(8).optional(),
    force: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-house');
    const force = data.force === true;
    return (await import('./arms-fit.server')).checkArms({
      tree: data.tree,
      house: data.house,
      locale: toAiLocale(data.locale),
      force,
      by: m.user.id,
      // The retry key is bound to this steward, the house and whether they asked to force it (see `once`).
      op: { key: data.opKey, user: m.user.id, payload: { house: data.house, force } },
    });
  });
