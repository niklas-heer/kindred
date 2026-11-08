// The assistant's tools. Reads return only what the reader's role may see. Proposals describe a change
// and are checked against the family, but nothing is written here: the card goes to the reader, and
// approving it calls the existing server function under their own role (components/assistant/apply.ts).
import { z } from 'zod';
import { graph, person } from '../db.server';
import { buildFamily, children, fullName, kinship, parents, partnersOf, siblings } from '../graph';
import { matchesName } from '../search';
import type { GPerson } from '../types';
import { can, type Action, type Role } from '../roles';
import { validDate } from '../dates';
import { fieldInput, FIELD_TYPES } from '../../components/fields/model';
import { copyFor, fill, type Copy } from './copy';
import type { ToolSpec } from './adapters';
import { proposalArgs, PROPOSAL_KINDS, type AiLocale, type Proposal, type ProposalArgs, type ProposalKind } from './types';

export interface Ctx {
  tree: string;
  role: Role;
  /** The reader's own person in this family, when they have chosen one. */
  me: string | null;
  locale: AiLocale;
}

const RESULT_LIMIT = 6000;
const idParam = { type: 'string', description: 'A person id, as the tools returned it.' };

export const READ_TOOLS: ToolSpec[] = [
  {
    name: 'search_people',
    description: 'Find people by part of a name (given, surname or nickname). Returns up to 15 matches with ids.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 15 } }, required: ['query'] },
  },
  {
    name: 'read_person',
    description: 'Read what the tree records about one person: names, dates, places, occupation, title, stories. Bio and contact details appear only when the reader may see them.',
    parameters: { type: 'object', properties: { id: idParam }, required: ['id'] },
  },
  {
    name: 'relatives',
    description: 'Parents, children, partners and siblings of one person, and how they are related to the reader when the reader has chosen a person.',
    parameters: { type: 'object', properties: { id: idParam }, required: ['id'] },
  },
];

const relation = { type: 'string', enum: ['child', 'parent', 'partner', 'sibling'], description: 'The new or linked person is this to the anchor: child = their child, parent = their parent.' };
const date = { type: 'string', description: 'YYYY, YYYY-MM or YYYY-MM-DD. A leading ~ marks an approximate date.' };
const PROPOSE: { spec: ToolSpec; kind: ProposalKind; action: Action }[] = [
  {
    kind: 'add-person', action: 'add-person',
    spec: {
      name: 'propose_add_person',
      description: 'Propose adding a new person connected to an existing one. Use search_people first for the anchor.',
      parameters: {
        type: 'object',
        properties: {
          anchor: idParam, relation, coParent: { ...idParam, description: 'For a child: the anchor’s partner who is the other parent.' },
          given: { type: 'string' }, surname: { type: 'string' }, sex: { type: 'string', enum: ['m', 'f', 'x'] },
          born: date, died: date, living: { type: 'boolean' },
        },
        required: ['anchor', 'relation', 'given', 'living'],
      },
    },
  },
  {
    kind: 'link-relative', action: 'edit-person',
    spec: {
      name: 'propose_link_relative',
      description: 'Propose connecting two people who are already in the tree.',
      parameters: { type: 'object', properties: { anchor: idParam, person: idParam, relation, coParent: idParam }, required: ['anchor', 'person', 'relation'] },
    },
  },
  {
    kind: 'set-dates', action: 'edit-person',
    spec: {
      name: 'propose_set_dates',
      description: 'Propose a birth date, birth place or death date for a person. Only the fields given change.',
      parameters: { type: 'object', properties: { person: idParam, born: date, bornPlace: { type: 'string' }, died: date }, required: ['person'] },
    },
  },
  {
    kind: 'add-story', action: 'add-story',
    spec: {
      name: 'propose_add_story',
      description: 'Propose adding a story (a memory, note, quote, anecdote or recipe) to a person.',
      parameters: {
        type: 'object',
        properties: { person: idParam, kind: { type: 'string', enum: ['note', 'quote', 'anecdote', 'recipe', 'memory'] }, title: { type: 'string' }, body: { type: 'string' } },
        required: ['person', 'kind', 'body'],
      },
    },
  },
  {
    kind: 'add-field', action: 'edit-person',
    spec: {
      name: 'propose_add_field',
      description: 'Propose adding a detail to a person: a phone, email, address, occupation, education, favourites, notes and so on. The value is text keys: phone {number}, email {address}, occupation {title, employer, from, to, note}, address {street, city, postcode, country}, favourites {food, drink, music, film, hobby, other}. Dates are YYYY, YYYY-MM or YYYY-MM-DD.',
      parameters: {
        type: 'object',
        properties: {
          person: idParam,
          type: { type: 'string', enum: [...FIELD_TYPES] },
          label: { type: 'string', description: 'Optional, e.g. “work” or “mobile”.' },
          value: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['person', 'type', 'value'],
      },
    },
  },
];

/** The tools this reader may use: reads for everyone, a proposal only where their role may make that change. */
export function toolsFor(role: Role): { tools: ToolSpec[]; proposals: boolean } {
  const proposing = PROPOSE.filter((p) => can(role, p.action));
  return { tools: [...READ_TOOLS, ...proposing.map((p) => p.spec)], proposals: proposing.length > 0 };
}

const ACTION_OF = Object.fromEntries(PROPOSE.map((p) => [p.kind, p.action])) as Record<ProposalKind, Action>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const json = (v: unknown) => clip(JSON.stringify(v), RESULT_LIMIT);

/** Runs one read tool, or checks one proposal. Returns the text the model sees. */
export async function runTool(ctx: Ctx, name: string, input: unknown, out: Proposal[]): Promise<string> {
  const g = await graph(ctx.tree);
  const byId = new Map(g.people.map((p) => [p.id, p]));
  const houses = new Map(g.houses.map((h) => [h.id, h.name]));
  const c = copyFor(ctx.locale);
  const name_ = (id: string) => (byId.get(id) ? fullName(byId.get(id)!) : id);
  try {
    if (name === 'search_people') {
      const a = z.object({ query: z.string().min(1).max(80), limit: z.number().int().min(1).max(15).optional() }).parse(input);
      // Birth and current names both match; the birth name is shown too when it differs from the name now.
      const hits = g.people
        .filter((p) => matchesName(p, a.query))
        .slice(0, a.limit ?? 15)
        .map((p) => {
          const birth = [p.given, p.surname].filter(Boolean).join(' ');
          return { id: p.id, name: fullName(p), ...(birth !== fullName(p) && { birthName: birth }), born: p.born, died: p.died, living: p.living, house: p.house ? houses.get(p.house) : undefined };
        });
      return json({ people: hits, count: hits.length });
    }
    if (name === 'read_person') {
      const { id } = z.object({ id: z.string().min(1) }).parse(input);
      const p = byId.get(id);
      if (!p) return json({ error: 'not in this tree' });
      return json(await readPerson(ctx, p, houses));
    }
    if (name === 'relatives') {
      const { id } = z.object({ id: z.string().min(1) }).parse(input);
      if (!byId.has(id)) return json({ error: 'not in this tree' });
      const f = buildFamily(g);
      const names = (ids: string[]) => ids.map((x) => ({ id: x, name: name_(x) }));
      const kin = ctx.me && ctx.me !== id && byId.has(ctx.me) ? kinship(f, ctx.me, id)?.label ?? null : null;
      return json({ parents: names(parents(f, id)), children: names(children(f, id)), partners: names(partnersOf(f, id)), siblings: names(siblings(f, id)), relatedToReader: kin });
    }
    const p = PROPOSE.find((x) => x.spec.name === name);
    if (p) return await propose(ctx, c, byId, p.kind, input, out);
    return json({ error: `no tool ${name}` });
  } catch (e) {
    if (e instanceof z.ZodError) return json({ error: 'the arguments did not fit the tool: ' + e.issues.map((i) => i.path.join('.') || 'input').join(', ') });
    throw e;
  }
}

async function readPerson(ctx: Ctx, p: GPerson, houses: Map<string, string>) {
  // The family's own rule (person() and components/fields/model.ts): private fields are for editors and stewards only.
  const d = await person(ctx.tree, p.id, can(ctx.role, 'edit-person'));
  return {
    id: p.id,
    name: fullName(p),
    nickname: p.nickname,
    sex: p.sex,
    born: p.born,
    bornPlace: p.bornPlace,
    died: p.died,
    diedPlace: p.diedPlace,
    living: p.living,
    title: p.title,
    epithet: p.epithet,
    occupation: p.occupation,
    house: p.house ? houses.get(p.house) : undefined,
    bio: d.bio ? clip(d.bio, 1500) : undefined,
    fields: d.fields.slice(0, 40).map((f) => ({ type: f.type, label: f.label, value: f.value, private: f.private })),
    stories: d.stories.slice(0, 8).map((s) => ({ kind: s.kind, title: s.title, body: clip(s.body, 800), author: s.author, at: s.at.slice(0, 10) })),
  };
}

/** Checks a proposed change against the tree and describes it for the card. */
async function propose(ctx: Ctx, c: Copy, byId: Map<string, GPerson>, kind: ProposalKind, input: unknown, out: Proposal[]): Promise<string> {
  if (!PROPOSAL_KINDS.includes(kind)) return json({ error: 'unknown kind' });
  if (!can(ctx.role, ACTION_OF[kind])) return json({ error: 'this reader may not make that change; say a contributor or editor must' });
  const parsed = proposalArgs[kind].safeParse(input);
  if (!parsed.success) return json({ error: 'the arguments did not fit the tool: ' + parsed.error.issues.map((i) => i.path.join('.') || 'input').join(', ') });
  const args = parsed.data as ProposalArgs;
  for (const k of ['born', 'died'] as const) {
    if (typeof args[k] === 'string' && !validDate(args[k] as string)) return json({ error: `${k} is not a real date; use YYYY, YYYY-MM or YYYY-MM-DD` });
  }
  for (const k of ['anchor', 'person', 'coParent'] as const) {
    if (typeof args[k] === 'string' && !byId.has(args[k] as string)) return json({ error: `${k} is not a person in this tree; search for them first` });
  }
  const name = (id: string) => fullName(byId.get(id)!);
  const rel = (r: string) => (r === 'child' ? c.relChild : r === 'parent' ? c.relParent : r === 'partner' ? c.relPartner : c.relSibling);
  const storyKind = (k: string) => (c as unknown as Record<string, string>)[`storyKind${k[0].toUpperCase()}${k.slice(1)}`] ?? k;
  const show = (v: unknown) => (v === undefined || v === null || v === '' ? c.fieldNone : String(v));
  const diff: Proposal['diff'] = [];
  let summary: string;
  let editable: string[] = [];

  if (kind === 'add-person') {
    const a = args as z.infer<typeof proposalArgs['add-person']>;
    const who = [a.given, a.surname].filter(Boolean).join(' ');
    summary = fill(c.summaryAddPerson, { name: who, rel: rel(a.relation), anchor: name(a.anchor) });
    diff.push({ label: c.fieldName, to: who }, { label: c.fieldRelation, to: `${rel(a.relation)} ${name(a.anchor)}` });
    if (a.born) diff.push({ label: c.fieldBorn, to: a.born });
    if (a.died) diff.push({ label: c.fieldDied, to: a.died });
    editable = ['given', 'surname', 'born', 'died'];
  } else if (kind === 'link-relative') {
    const a = args as { anchor: string; person: string; relation: string };
    summary = fill(c.summaryLink, { name: name(a.person), rel: rel(a.relation), anchor: name(a.anchor) });
    diff.push({ label: c.fieldRelation, to: `${name(a.person)}: ${rel(a.relation)} ${name(a.anchor)}` });
  } else if (kind === 'set-dates') {
    const a = args as { person: string } & Record<string, string | undefined>;
    const cur = byId.get(a.person)!;
    summary = fill(c.summaryDates, { name: name(a.person) });
    const rows: [string, 'born' | 'bornPlace' | 'died', string | undefined][] = [
      [c.fieldBorn, 'born', cur.born], [c.fieldBornPlace, 'bornPlace', cur.bornPlace], [c.fieldDied, 'died', cur.died],
    ];
    for (const [label, k, was] of rows) if (a[k] !== undefined) diff.push({ label, from: show(was), to: String(a[k]) });
    editable = ['born', 'bornPlace', 'died'];
  } else if (kind === 'add-story') {
    const a = args as { person: string; kind: string; title?: string; body: string };
    summary = fill(c.summaryStory, { kind: storyKind(a.kind), name: name(a.person) });
    if (a.title) diff.push({ label: c.fieldName, to: a.title });
    diff.push({ label: c.fieldStory, to: clip(a.body, 240) });
    editable = ['title', 'body'];
  } else {
    const a = args as { person: string; type: string; label?: string; value: Record<string, string> };
    const checked = fieldInput.safeParse({ type: a.type, label: a.label ?? '', value: a.value, private: false });
    if (!checked.success) return json({ error: 'that detail does not fit its type: ' + (checked.error.issues[0]?.message ?? 'check the keys') });
    summary = fill(c.summaryField, { field: a.label ? `${a.type} (${a.label})` : a.type, name: name(a.person) });
    diff.push({ label: a.type, to: Object.entries(a.value).map(([k, v]) => `${k}: ${v}`).join(', ') });
    editable = ['label'];
  }
  // Only the fields the change sets can be edited: an empty date input would otherwise be sent as a change.
  const present = editable.filter((k) => (args as Record<string, unknown>)[k] !== undefined);
  const proposal: Proposal = { id: crypto.randomUUID(), kind, summary, diff, args, editable: present, status: 'open' };
  out.push(proposal);
  return json({ proposed: true, kind, note: 'Shown to the reader for approval. Nothing is saved yet.' });
}
