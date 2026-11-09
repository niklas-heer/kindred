// The Research page's server functions. Each one checks the reader's role first (requireMember for reads, requireCan for
// changes), then calls research.server.ts, which keeps the data true and checks whose work is whose.
//   member (viewer and up): read what the role may see
//   add-research (contributor): add projects, documents, notes and links, and change their own
//   edit-research (editor): change or remove anyone's, and mark anything private
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Member, Reader } from './auth/guard.server';
import { validDate } from './dates';
import { checkDocument } from './research.ts';
import type { Who } from './research.server';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const server = () => import('./research.server');
const guard = () => import('./auth/guard.server');
const requireMember = async (t: string) => (await guard()).requireMember(t);
const requireReader = async (t: string) => (await guard()).requireReader(t);
const requireCan = async (t: string, action: 'add-research') => (await guard()).requireCan(t, action);

const id = z.string().min(1).max(120);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
/** A partial date ("1985", "1985-06", "1985-06-14", "~1985") or nothing. */
const partialDate = z.string().max(11).refine((s) => s === '' || validDate(s), 'research.err.not_a_date').transform((s) => s || null);
const text = (max: number) => z.string().trim().max(max);
const title = z.string().trim().min(1, 'research.err.title_required').max(200);

const whoOf = (m: Member | Reader): Who => ({ id: m.user?.id ?? '', name: m.user?.name ?? '', role: m.role });

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(m: Member, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user: m.user.id, payload };
}

// ---------- reads ----------

export const getResearchProjects = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await requireReader(data.tree);
    return (await server()).listProjects(data.tree, whoOf(m));
  });
export const researchProjectsQuery = (t: string) => queryOptions({ queryKey: ['research', t, 'list'], queryFn: () => getResearchProjects({ data: { tree: t } }) });

export const getResearchProject = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id }))
  .handler(async ({ data }) => {
    const m = await requireReader(data.tree);
    return ((await server()).projectView(data.tree, data.id, whoOf(m))).then((v) => v ?? null);
  });
export const researchProjectQuery = (t: string, p: string) => queryOptions({ queryKey: ['research', t, 'project', p], queryFn: () => getResearchProject({ data: { tree: t, id: p } }) });

export const getPersonResearch = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person: id }))
  .handler(async ({ data }) => {
    const m = await requireReader(data.tree);
    return (await server()).personResearch(data.tree, data.person, whoOf(m));
  });
export const personResearchQuery = (t: string, person: string) => queryOptions({ queryKey: ['research', t, 'person', person], queryFn: () => getPersonResearch({ data: { tree: t, person } }) });

// ---------- projects ----------

export const saveResearchProject = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: id.optional(), title, summary: text(2000), private: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    const { tree: t, opKey: _k, ...p } = data;
    const saved = await (await server()).saveProject(t, whoOf(m), p, opOf(m, data));
    if (!data.id) await (await import('./stats/store.server')).countFeature(t, m.user.id, 'research.added');
    return saved;
  });

export const removeResearchProject = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    return (await server()).removeProject(data.tree, whoOf(m), data.id, opOf(m, data));
  });

// ---------- documents ----------

const field = (d: FormData, name: string) => {
  const v = d.get(name);
  return typeof v === 'string' ? v : '';
};
const dim = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 20000 ? n : 0;
};

/** Adds a document from a form. The bytes decide what it is; the name and declared type are only checked against them. */
export const addResearchDocument = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('expected form data');
    return {
      tree: tree.parse(d.get('tree')),
      project: id.parse(d.get('project')),
      form: d,
      width: dim(d.get('width')),
      height: dim(d.get('height')),
      title: title.parse(field(d, 'title')),
      date: partialDate.parse(field(d, 'date')),
      source: text(300).parse(field(d, 'source')) || null,
      notes: text(4000).parse(field(d, 'notes')),
      private: field(d, 'private') === 'true',
      opKey: opKey.parse(field(d, 'opKey') || undefined),
    };
  })
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    const { form, tree: t, project, opKey: k, width, height, ...details } = data;
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('research.err.file_type');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = await checkDocument(bytes, file.type);
    if ('refused' in checked) throw new Error(checked.refused);
    const op = k ? { key: k, user: m.user.id, payload: { tree: t, project, file, width, height, ...details } } : undefined;
    const added = await (await server()).addDocument(t, whoOf(m), project, bytes, checked.mime, { width, height }, details, op);
    await (await import('./stats/store.server')).countFeature(t, m.user.id, 'research.added');
    return added;
  });

export const saveResearchDocument = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, title, date: partialDate, source: text(300).transform((s) => s || null), notes: text(4000), private: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    const { tree: t, id: doc, opKey: _k, ...details } = data;
    return (await server()).editDocument(t, whoOf(m), doc, details, opOf(m, data));
  });

export const removeResearchDocument = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    return (await server()).removeDocument(data.tree, whoOf(m), data.id, opOf(m, data));
  });

// ---------- notes ----------

export const saveResearchNote = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: id.optional(), project: id, title, body: z.string().trim().min(1, 'research.err.body_required').max(20000), date: partialDate, private: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    const { tree: t, opKey: _k, ...n } = data;
    return (await server()).saveNote(t, whoOf(m), n, opOf(m, data));
  });

export const removeResearchNote = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, project: id, id, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    return (await server()).removeNote(data.tree, whoOf(m), data.project, data.id, opOf(m, data));
  });

// ---------- links ----------

const link = z.enum(['picture', 'person', 'place']);

export const addResearchLink = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, project: id, kind: link, target: z.string().min(1).max(250), private: z.boolean().optional(), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    return (await server()).addLink(data.tree, whoOf(m), data.project, data.kind, data.target, data.private ?? false, opOf(m, data));
  });

export const removeResearchLink = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, project: id, kind: link, target: z.string().min(1).max(250), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'add-research');
    return (await server()).removeLink(data.tree, whoOf(m), data.project, data.kind, data.target, opOf(m, data));
  });
