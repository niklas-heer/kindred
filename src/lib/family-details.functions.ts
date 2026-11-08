// Server function for the family's name and tagline (the Access page). Stewards only: `requireCan` comes first.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export const updateFamilyDetails = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree: z.string().regex(/^[a-z0-9-]{1,64}$/),
      opKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
      name: z.string().max(400),
      tagline: z.string().max(400),
    }),
  )
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireCan(data.tree, 'manage-access');
    const { tree, opKey, ...details } = data;
    return (await import('./family-details.server')).renameFamily(tree, details, { key: opKey, user: m.user.id, payload: details });
  });
