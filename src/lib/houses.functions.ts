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

// ---------- making houses and their members (stewards: `edit-house`, checked first) ----------

const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

/** The surnames that could make a house: people with no house yet, and whether a house already has the name. */
export const getSurnameGroups = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await import('./auth/guard.server')).requireCan(data.tree, 'edit-house');
    return (await import('./houses.server')).surnameGroups(data.tree);
  });

export const surnameGroupsQuery = (tree: string) =>
  queryOptions({ queryKey: ['surname-houses', tree], queryFn: () => getSurnameGroups({ data: { tree } }), staleTime: 0 });

export const createHouseFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      opKey,
      name: z.string().trim().min(1, 'A house needs a name').max(80),
      motto: z.string().trim().max(160).nullable(),
      country: z.string().regex(/^[A-Z]{2}$/).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireCan(data.tree, 'edit-house');
    const { tree: t, opKey: key, ...input } = data;
    const clean = { name: input.name, motto: input.motto || null, country: input.country };
    return (await import('./houses.server')).createHouse(t, clean, { key, user: m.user.id, payload: clean });
  });

export const createHousesFromSurnamesFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, opKey, surnames: z.array(z.string().trim().min(1).max(80)).min(1).max(200) }))
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireCan(data.tree, 'edit-house');
    const { tree: t, opKey: key, surnames } = data;
    return (await import('./houses.server')).createHousesFromSurnames(t, surnames, { key, user: m.user.id, payload: { surnames } });
  });

export const setHouseMembersFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tree,
      opKey,
      id: id,
      add: z.array(id).max(500),
      remove: z.array(id).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireCan(data.tree, 'edit-house');
    const { tree: t, opKey: key, id: house, add, remove } = data;
    return (await import('./houses.server')).setHouseMembers(t, house, { add, remove }, { key, user: m.user.id, payload: { house, add, remove } });
  });
