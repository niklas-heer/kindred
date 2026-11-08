// Server functions for house succession and country. Reads need membership; the write needs the
// steward's `edit-house` action, checked before anything else (see guard.server.ts).
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const id = z.string().min(1).max(100);

export const getHouseSettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await import('./auth/guard.server')).requireMember(data.tree);
    return (await import('./houses.server')).readHouseSettings(data.tree);
  });

export const houseSettingsQuery = (tree: string) =>
  queryOptions({ queryKey: ['house-settings', tree], queryFn: () => getHouseSettings({ data: { tree } }) });

export const updateHouseSettings = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    id,
    opKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    law: z.enum(['absolute-primogeniture', 'seniority', 'elective']),
    head: id.nullable(),
    heir: id.nullable(),
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  }))
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireCan(data.tree, 'edit-house');
    const { tree: t, id: house, opKey: key, ...settings } = data;
    // The retry key is bound to this steward and to exactly what they sent (see `once`).
    return (await import('./houses.server')).saveHouseSettings(t, house, settings, { key, user: m.user.id, payload: settings });
  });
