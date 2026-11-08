// Server functions for a person's details and fields (the Edit tab, the Everyday tab's contacts). Each
// handler starts with the role check (src/lib/auth/guard.server.ts), then calls the change in person.server.ts.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { fieldInput, isContactType, MAX_FIELDS } from '../components/fields/model';
import { MAX_FURTHER, MAX_FURTHER_LENGTH } from './further-given';
import { audienceOf } from './visibility';
import { validDate } from './dates';
import { sanitizeLook } from '../components/portrait/look';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const personId = z.string().min(1).max(120);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const date = z.string().refine((d) => d.trim() === '' || validDate(d.trim()), 'Not a real date').nullable();
const guard = () => import('./auth/guard.server');

/** The retry key for a change, bound to who sends it and to everything else they sent (see `once`). */
const opOf = (user: { id: string }, data: { opKey: string }) => {
  const { opKey: key, ...payload } = data;
  return { key, user: user.id, payload };
};

/** A person's details: their biography, stories and the fields this reader may see (src/lib/visibility.ts). */
export const getPersonDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: personId }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireReader(data.tree);
    return (await import('./db.server')).person(data.tree, data.id, audienceOf(m));
  });

export const personDetailQuery = (t: string, id: string) =>
  queryOptions({ queryKey: ['person', t, id], queryFn: () => getPersonDetail({ data: { tree: t, id } }) });

/**
 * The Edit tab's data as one consistent snapshot: the scalars, places, biography, fields and revision (see
 * `editSnapshot` in person.server.ts). Only the fields this reader may see, as `getPersonDetail`.
 */
export const getEditSnapshot = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: personId }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await import('./person.server')).editSnapshot(data.tree, data.id, audienceOf(m));
  });

const details = z.object({
  given: z.string().trim().min(1, 'A given name is needed').max(120),
  furtherGiven: z.array(z.string().trim().min(1).max(MAX_FURTHER_LENGTH)).max(MAX_FURTHER).optional(),
  surname: z.string().trim().max(120).nullable(),
  currentGiven: z.string().trim().min(1).max(120).nullable(),
  currentSurname: z.string().trim().max(120).nullable(),
  nickname: z.string().trim().max(120).nullable(),
  sex: z.enum(['m', 'f', 'x']).nullable(),
  born: date,
  bornPlace: z.string().trim().max(200).nullable(),
  died: date,
  diedPlace: z.string().trim().max(200).nullable(),
  living: z.boolean(),
  title: z.string().trim().max(200).nullable(),
  epithet: z.string().trim().max(120).nullable(),
  occupation: z.string().trim().max(200).nullable(),
  occupationCode: z.string().max(80).nullish(),
  bio: z.string().max(20_000).nullable(),
});

/**
 * Saves the Edit tab: the details and the whole list of fields, in one change. Editing contact details
 * needs `edit-contact` as well as `edit-person`; both are the editor's role, so the editor may do both.
 */
export const savePersonEdit = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: personId, details, fields: z.array(fieldInput).max(MAX_FIELDS), revision: z.number().int().min(0), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    if (data.fields.some((f) => isContactType(f.type))) await (await guard()).requireCan(data.tree, 'edit-contact');
    return (await import('./person.server')).savePersonEdit(data.tree, data.id, data.details, data.fields, data.revision, opOf(m.user, data), m.user.name, audienceOf(m));
  });

/** The first-run step after setup: the steward adds themselves to the new family, with their given name and surname apart. Returns their person id. */
export const addSelfToFamily = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, given: z.string().trim().min(1, 'A name is needed').max(120), surname: z.string().trim().max(120), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await import('./person.server')).addFirstPerson(data.tree, { given: data.given, surname: data.surname }, opOf(m.user, data));
  });

/** Adds one field to the end of the list: a contact from the Everyday tab. */
export const addPersonField = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, person: personId, field: fieldInput, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    if (isContactType(data.field.type)) await (await guard()).requireCan(data.tree, 'edit-contact');
    return (await import('./person.server')).addPersonField(data.tree, data.person, data.field, opOf(m.user, data), m.user.name, audienceOf(m));
  });

/**
 * Removes one field. Contact fields need `edit-contact`, which the editor also has. A member may always remove their own
 * personal field, whatever their role is now. Anyone else's personal field answers like a field that is not there.
 */
export const deletePersonField = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), opKey }))
  .handler(async ({ data }) => {
    const { requireCan, requireMember } = await guard();
    const m = await requireMember(data.tree);
    const row = await (await import('./db.server')).db(data.tree).get<{ type: string; visibility: string; owner: string | null }>('SELECT type, visibility, owner FROM person_field WHERE id = ?', data.id);
    const own = row?.visibility === 'personal' && row.owner === m.user.id;
    if (!own) {
      await requireCan(data.tree, 'edit-person');
      if (row && row.visibility !== 'personal' && isContactType(row.type)) await requireCan(data.tree, 'edit-contact');
    }
    return (await import('./person.server')).deletePersonField(data.tree, data.id, opOf(m.user, data), audienceOf(m));
  });

/** The portrait's look, from the Appearance dialog. The server cleans it: unknown parts are dropped. */
export const setLook = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: personId, look: z.unknown(), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    const clean = sanitizeLook(data.look);
    if (!clean) throw new Error('That look has no parts a portrait can show.');
    return (await import('./person.server')).setPersonLook(data.tree, data.id, clean, opOf(m.user, data));
  });

/** Death place on its own: the one fact `patchPerson` (api.ts) does not cover, so the assistant can set it. */
export const setDiedPlace = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: personId, place: z.string().trim().max(200).nullable(), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await import('./person.server')).setPersonDiedPlace(data.tree, data.id, data.place, opOf(m.user, data));
  });
