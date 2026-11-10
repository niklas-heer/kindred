// Server functions for life events. Each handler starts with the role check (src/lib/auth/guard.server.ts), then calls
// events.server.ts, which checks the role again and keeps the data true.
//   reader (a guest too): a person's events and the events on the Atlas, with "Protect living people" applied
//   edit-person (editor): add, change, reorder and remove events
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Member, Reader } from './auth/guard.server';
import { validDate } from './dates';
import { EVENT_TYPES, MAX_EVENTS } from './events.ts';
import type { LifeReader } from './events.server';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const id = z.string().min(1).max(120);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const partialDate = z.string().max(11).refine((s) => s === '' || validDate(s), 'events.err.not_a_date').transform((s) => s || null).nullable();
const server = () => import('./events.server');
const guard = () => import('./auth/guard.server');

export const readerOf = (m: Member | Reader): LifeReader => ({
  id: m.user?.id ?? '', name: m.user?.name ?? '', role: m.role, guest: 'guest' in m && m.guest, protectLiving: 'protectLiving' in m && m.protectLiving,
});

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(m: Member, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user: m.user.id, payload };
}

export const getPersonEvents = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person: id }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireReader(data.tree);
    return (await server()).personEvents(data.tree, data.person, readerOf(m));
  });
export const personEventsQuery = (t: string, person: string) =>
  queryOptions({ queryKey: ['events', t, 'person', person], queryFn: () => getPersonEvents({ data: { tree: t, person } }) });

export const getEventPlaces = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireReader(data.tree);
    return (await server()).familyEventPlaces(data.tree, readerOf(m));
  });
export const eventPlacesQuery = (t: string) => queryOptions({ queryKey: ['events', t, 'places'], queryFn: () => getEventPlaces({ data: { tree: t } }) });

const event = z.object({
  id: id.optional(),
  person: id,
  type: z.enum(EVENT_TYPES),
  label: z.string().trim().max(200).nullable(),
  date: partialDate,
  endDate: partialDate,
  place: z.string().trim().max(200).nullable(),
  note: z.string().max(4000),
});

export const saveLifeEvent = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, event, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).saveEvent(data.tree, readerOf(m), data.event, opOf(m, data));
  });

export const removeLifeEvent = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).removeEvent(data.tree, readerOf(m), data.id, opOf(m, data));
  });

export const reorderLifeEvents = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, person: id, ids: z.array(id).max(MAX_EVENTS), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).reorderEvents(data.tree, readerOf(m), data.person, data.ids, opOf(m, data));
  });
