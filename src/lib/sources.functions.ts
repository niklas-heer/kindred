// Server functions for sources and citations. Each handler starts with the role check (src/lib/auth/guard.server.ts), then
// calls sources.server.ts, which checks again and keeps the data true.
//   member (viewer and up, never a guest): the sources, what cites them, and a person's citations
//   edit-person (editor): add, change and remove sources and citations, and the Needed page's "born, no source"
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Member } from './auth/guard.server';
import { validDate } from './dates';
import { QUALITIES } from './events.ts';
import { readerOf } from './events.functions';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const id = z.string().min(1).max(120);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const partialDate = z.string().max(11).refine((s) => s === '' || validDate(s), 'events.err.not_a_date').transform((s) => s || null).nullable();
const text = (max: number) => z.string().trim().max(max).nullable();
const server = () => import('./sources.server');
const guard = () => import('./auth/guard.server');

function opOf<D extends { opKey?: string }>(m: Member, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user: m.user.id, payload };
}

export const getSources = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await server()).listSources(data.tree, readerOf(m));
  });
export const sourcesQuery = (t: string) => queryOptions({ queryKey: ['sources', t, 'list'], queryFn: () => getSources({ data: { tree: t } }) });

export const getSourceCitations = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, source: id }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await server()).sourceCitations(data.tree, data.source, readerOf(m));
  });
export const sourceCitationsQuery = (t: string, source: string) =>
  queryOptions({ queryKey: ['sources', t, 'source', source], queryFn: () => getSourceCitations({ data: { tree: t, source } }) });

export const getPersonCitations = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person: id }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await server()).personCitations(data.tree, data.person, readerOf(m));
  });
export const personCitationsQuery = (t: string, person: string) =>
  queryOptions({ queryKey: ['sources', t, 'person', person], queryFn: () => getPersonCitations({ data: { tree: t, person } }) });

export const getUnsourcedBirths = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).unsourcedBirths(data.tree, readerOf(m));
  });
export const unsourcedBirthsQuery = (t: string) => queryOptions({ queryKey: ['sources', t, 'unsourced'], queryFn: () => getUnsourcedBirths({ data: { tree: t } }) });

const source = z.object({
  id: id.optional(),
  title: z.string().trim().min(1, 'sources.err.title_required').max(300),
  author: text(200),
  publication: text(300),
  reference: text(500),
  date: partialDate,
  note: z.string().max(4000),
  document: id.nullable(),
  media: z.string().max(200).nullable(),
});

export const saveSource = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, source, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).saveSource(data.tree, readerOf(m), data.source, opOf(m, data));
  });

export const removeSource = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, citations: z.number().int().min(0), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).removeSource(data.tree, readerOf(m), data.id, data.citations, opOf(m, data));
  });

const fact = z.discriminatedUnion('fact', [
  z.object({ fact: z.enum(['birth', 'death', 'name']), person: id }),
  z.object({ fact: z.literal('event'), event: id }),
  z.object({ fact: z.literal('partnership'), partnership: id }),
  z.object({ fact: z.literal('parent'), child: id, parent: id }),
]);

const citation = z.object({
  id: id.optional(),
  source: id,
  target: fact,
  page: text(300),
  quality: z.enum(QUALITIES).nullable(),
  transcription: z.string().max(4000),
});

export const saveCitation = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, citation, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).saveCitation(data.tree, readerOf(m), data.citation, opOf(m, data));
  });

export const removeCitation = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    return (await server()).removeCitation(data.tree, readerOf(m), data.id, opOf(m, data));
  });
