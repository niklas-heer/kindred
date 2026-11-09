// The assistant's tools. Reads return only what the reader's role may see, and only a capped number of rows. Proposals
// describe a change and are checked against the family, but nothing is written here: the card goes to the reader, and
// approving it calls the existing server function under their own role (components/assistant/apply.ts), or, for a
// family draft, applyFamilyBatch (ai/family.server.ts). Removals are proposals too (ai/edits.server.ts). Nothing here manages access or touches AI settings.
import { z } from 'zod';
import { db, graph, person } from '../db.server';
import { buildFamily, children, fullName, kinship, parents, partnersOf, siblings } from '../graph';
import { allGiven } from '../further-given';
import { matchesName } from '../search';
import type { GPerson, Graph } from '../types';
import { can, type Action, type Role } from '../roles';
import { validDate } from '../dates';
import { defaultVisibility, fieldInput, FIELD_TYPES } from '../../components/fields/model';
import { assistantAudience } from '../visibility';
import type { Key } from '../i18n/dictionary';
import { gapsOf, DEFAULT_GAPS, GAP_LABEL } from '../gaps';
import { gallery, personMedia } from '../photos.server';
import { mediaUrl, type MediaItem } from '../../components/photos/types';
import { STORY_KIND_KEY, tr, type Tr } from './labels';
import type { AiAdapter, ImagePart, ToolSpec } from './adapters';
import { isolatedLookup, privacyGuard, refusal, REFUSAL_REASON } from './lookup.server';
import { checkFamily, cleanSocial, matchesFor, profileKey, profilesInTree } from './family.server';
import { readHouseSettings } from '../houses.server';
import { proposalArgs, PROPOSAL_KINDS, NEW_REF, type AiLocale, type Proposal, type ProposalArgs, type ProposalKind, type ProposalView } from './types';
import type { ChatBlock } from './blocks';
import { ASK_TOOL, findRelatives, isBlockTool, KIN_TOOL, runBlockTool, SHOW_TOOLS } from './blocks.server';
import { EDITS, researchList, researchRead, runEdit } from './edits.server';

/** The fields area's word for each value key of a field (the same words the Edit tab shows). */
const VALUE_LABEL: Record<string, Key> = {
  number: 'input.number', address: 'input.email', street: 'input.street', postcode: 'input.postcode', city: 'input.city',
  country: 'input.country', url: 'input.url', handle: 'input.handle', name: 'input.name', date: 'input.date', note: 'input.note',
  school: 'input.school', place: 'input.place', from: 'input.from', to: 'input.to', title: 'input.title', employer: 'input.employer',
  unit: 'input.unit', rank: 'input.rank', language: 'input.language', level: 'input.level', text: 'input.text', person: 'input.person',
};

export interface Ctx {
  tree: string;
  role: Role;
  /** The reader's own person in this family, when they have chosen one (or the speaker of a family session). */
  me: string | null;
  /** The reader's account, to tell their own research from anyone else's. */
  user?: string;
  /** This reply's question and widgets (see ai/blocks.ts). The chat loop stores them with the reply. */
  blocks?: ChatBlock[];
  /** This turn is a family session: a memory with no named teller came from its speaker. */
  session?: boolean;
  /** The reader attached pictures to this message: a draft from it may hold strangers. */
  pictures?: boolean;
  locale: AiLocale;
  /** Set when the family allows web lookups: the family's budgeted adapter, and where a lookup's sources are collected. */
  search?: { adapter: AiAdapter; sources: { url: string; title?: string }[]; lookups: number };
  /** The assistant may look at pictures: the family's faces feature is on (see describe_photo). */
  faces?: boolean;
  /** The family's drawn-avatar feature is on (see propose_avatar). */
  avatar?: boolean;
  /** Pictures a tool asked the model to look at; the chat loop sends them with the next step. */
  images?: ImagePart[];
}

const RESULT_LIMIT = 6000;
const LIST_LIMIT = 15;
const idParam = { type: 'string', description: 'A person id, as the tools returned it.' };
const photoParam = { type: 'string', description: 'A photo key, as list_photos returned it.' };

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
  {
    name: 'missing_info',
    description: 'What is still missing in the tree: the facts a person has no record of (birth, parents, death, place, occupation and so on). With a person, that person and their close relatives; without one, the people with the most gaps. At most 12 people.',
    parameters: { type: 'object', properties: { person: idParam, limit: { type: 'integer', minimum: 1, maximum: 12 } } },
  },
  {
    name: 'list_research',
    description: 'The family’s research projects, with their ids. At most 30.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_research',
    description: 'One research project: its notes, documents, people, places and pictures, with ids.',
    parameters: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] },
  },
  {
    name: 'list_houses',
    description: 'The family’s houses, with each one’s motto, succession law, head, heir and country, so a steward can be offered a change. At most 30.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_photos',
    description: 'Photos in the gallery, newest first, with their date, place, caption, album and the people confirmed in them. Filter by album or person, or ask for photos missing a date, place, caption, album or people. At most 15, plus the albums (with ids).',
    parameters: {
      type: 'object',
      properties: {
        album: { type: 'string', description: 'An album id, as the tools returned it.' },
        person: idParam,
        missing: { type: 'array', items: { type: 'string', enum: ['date', 'place', 'caption', 'album', 'tags'] }, maxItems: 5 },
        limit: { type: 'integer', minimum: 1, maximum: LIST_LIMIT },
      },
    },
  },
];

/** Looking at a picture: offered only when the family's faces feature is on, and the picture then goes to the provider. */
export const LOOK_TOOL: ToolSpec = {
  name: 'describe_photo',
  description: 'Look at one photo yourself. The picture is sent with your next step, so you can say what it shows: people, place, period, objects. Use it only when the details alone are not enough.',
  parameters: { type: 'object', properties: { key: photoParam }, required: ['key'] },
};

const relation = { type: 'string', enum: ['child', 'parent', 'partner', 'sibling'], description: 'The new or linked person is this to the anchor: child = their child, parent = their parent.' };
const date = { type: 'string', description: 'YYYY, YYYY-MM or YYYY-MM-DD. A leading ~ marks an approximate date (about 1938 is ~1938). Never guess a date.' };
const newRef = { type: 'string', description: 'For a person who is not in the tree yet: a temporary id such as n1, n2 (unique in this draft). Use the same id wherever that person is named.' };
const personOrRef = { type: 'string', description: 'A person id from the tree, or the temporary id (n1, n2…) of a new person in this draft.' };
const furtherSpec = { type: 'array', maxItems: 10, items: { type: 'string' }, description: 'Second name, third name and so on, in order, when the person has more than one given name. `given` is the first name only; never put a surname here.' };
const familyPersonSpec = {
  type: 'object',
  properties: {
    ref: newRef,
    given: { type: 'string' }, furtherGiven: furtherSpec, surname: { type: 'string' }, sex: { type: 'string', enum: ['m', 'f', 'x'] },
    born: date, bornPlace: { type: 'string' }, died: date, diedPlace: { type: 'string' },
    living: { type: 'boolean', description: 'True for someone who is alive.' },
    occupation: { type: 'string' },
    story: { type: 'object', description: 'A memory, note or anecdote about the person.', properties: { kind: { type: 'string', enum: ['note', 'quote', 'anecdote', 'recipe', 'memory'] }, title: { type: 'string' }, body: { type: 'string' }, teller: { type: 'string', description: 'In a family session: the id of the speaker whose line this memory came from.' } }, required: ['kind', 'body'] },
    social: { type: 'array', maxItems: 5, description: 'Social profiles the reader showed or named.', items: { type: 'object', properties: { network: { type: 'string', description: 'For example Instagram, Facebook, TikTok.' }, handle: { type: 'string', description: 'The username, without its @.' } }, required: ['network', 'handle'] } },
    details: { type: 'array', maxItems: 8, description: 'Other facts read from the picture that have no field above: phone, email, address, website, names (maiden or birth name, alias), dates (baptism, marriage, anniversary: value {date, note}), education, occupation (a further job: {title, employer}), military, religion, nationality, languages. value has that type’s keys: phone {number}, email {address}, address {street, city, postcode, country}, website {url}, names {name}, education {school, place}, military {unit, rank}, religion {name}, nationality {country}, languages {language}.', items: { type: 'object', properties: { type: { type: 'string', enum: ['phone', 'email', 'address', 'website', 'names', 'dates', 'education', 'occupation', 'military', 'religion', 'nationality', 'languages'] }, label: { type: 'string' }, value: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['type', 'value'] } },
    unsure: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'One short line for everything on this person that you could not read with certainty or that is a guess (handwriting, an old script, a smudge, a faded date, an age instead of a date), naming the field, e.g. "born: handwritten, could be 1894 or 1884".' },
  },
  required: ['ref', 'given', 'living'],
};

const photoDetail = { type: 'object', properties: { key: photoParam, taken: { type: 'string', description: 'YYYY, YYYY-MM or YYYY-MM-DD; ~ for about.' }, place: { type: 'string' }, caption: { type: 'string' }, clear: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['taken', 'place', 'caption'] }, description: 'Only what the reader asked to remove.' } }, required: ['key'] };
const partnershipSpec = { type: 'object', description: 'For a partner: what kind of union it is, and when and where it began, if known.', properties: { kind: { type: 'string', enum: ['marriage', 'partnership', 'other'] }, start: date, place: { type: 'string' } }, required: ['kind'] };

const PROPOSE: { spec: ToolSpec; kind: ProposalKind; action: Action; feature?: 'avatar' }[] = [
  {
    kind: 'add-person', action: 'add-person',
    spec: {
      name: 'propose_add_person',
      description: 'Propose adding one new person connected to an existing one. Use search_people first for the anchor. For several people at once, use propose_family.',
      parameters: {
        type: 'object',
        properties: {
          anchor: idParam, relation, coParent: { ...idParam, description: 'For a child: the anchor’s partner who is the other parent.' },
          given: { type: 'string' }, furtherGiven: furtherSpec, surname: { type: 'string' }, sex: { type: 'string', enum: ['m', 'f', 'x'] },
          born: date, died: date, living: { type: 'boolean' }, partnership: partnershipSpec,
        },
        required: ['anchor', 'relation', 'given', 'living'],
      },
    },
  },
  {
    kind: 'family', action: 'add-person',
    spec: {
      name: 'propose_family',
      description: 'Propose a whole draft of new people and how they connect, for the reader to approve as one card. Use it when the reader tells you about several people, or a family session ends. Each new person gets a temporary ref (n1, n2…); a link joins two people by ref or by an id from the tree. Dates the reader did not give stay out. Ask about anything uncertain in questions (for example "Which Hans?") instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          people: { type: 'array', maxItems: 40, items: familyPersonSpec },
          links: {
            type: 'array', maxItems: 80,
            items: {
              type: 'object',
              description: 'anchor is the person the relation is to: "child" means person is a child of anchor; "parent" means person is a parent of anchor; "sibling" and "partner" are between the two.',
              properties: { anchor: personOrRef, person: personOrRef, relation, coParent: { ...personOrRef, description: 'For a child: the other parent.' } },
              required: ['anchor', 'person', 'relation'],
            },
          },
          questions: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'Short questions for the reader about what is unclear.' },
        },
        required: ['people', 'links'],
      },
    },
  },
  {
    kind: 'link-relative', action: 'edit-person',
    spec: {
      name: 'propose_link_relative',
      description: 'Propose connecting two people who are already in the tree.',
      parameters: { type: 'object', properties: { anchor: idParam, person: idParam, relation, coParent: idParam, partnership: partnershipSpec }, required: ['anchor', 'person', 'relation'] },
    },
  },
  {
    kind: 'set-dates', action: 'edit-person',
    spec: {
      name: 'propose_set_dates',
      description: 'Propose a birth date, birth place, death date or death place for a person. Only the fields given change.',
      parameters: { type: 'object', properties: { person: idParam, born: date, bornPlace: { type: 'string' }, died: date, diedPlace: { type: 'string' } }, required: ['person'] },
    },
  },
  {
    kind: 'set-occupation', action: 'edit-person',
    spec: {
      name: 'propose_set_occupation',
      description: 'Propose the occupation of a person who is in the tree (the words the reader would use, e.g. "baker").',
      parameters: { type: 'object', properties: { person: idParam, occupation: { type: 'string' } }, required: ['person', 'occupation'] },
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
      description: 'Propose adding a detail to a person. The value is text keys: phone {number}, email {address}, website {url}, social {handle}, address {street, city, postcode, country}, names {name}, dates {date, note}, education {school, place, from, to, note}, occupation {title, employer, from, to, note}, military {unit, rank, from, to}, religion (faith) {name, left, leftOn}, nationality {country}, languages {language, level}, favourites {text} with label colour, food, drink, music, book, film, sport, flower, place or hobby, gifts {text}, notes {text}, related {person or name, note}, custom {text}. Dates are YYYY, YYYY-MM or YYYY-MM-DD.',
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
  {
    kind: 'photo-details', action: 'upload-photo',
    spec: {
      name: 'propose_photo_details',
      description: 'Propose a date, place or caption for one or more photos, as one card. Give only what the photo or the reader tells you; a caption may describe what the picture shows. Leave out what is unknown.',
      parameters: { type: 'object', properties: { items: { type: 'array', maxItems: 25, items: photoDetail } }, required: ['items'] },
    },
  },
  {
    kind: 'photo-album', action: 'upload-photo',
    spec: {
      name: 'propose_photo_album',
      description: 'Propose putting several photos in an album: an existing album (albumId, from list_photos) or a new one (name). One card for all of them.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'A new album’s name.' }, albumId: { type: 'string' }, keys: { type: 'array', maxItems: 40, items: photoParam } },
        required: ['keys'],
      },
    },
  },
  {
    kind: 'photo-tags', action: 'upload-photo',
    spec: {
      name: 'propose_photo_tags',
      description: 'Propose that people appear in one photo. The tag covers the whole picture unless a box (x, y, w, h from 0 to 1) is given.',
      parameters: {
        type: 'object',
        properties: {
          key: photoParam,
          people: { type: 'array', maxItems: 20, items: { type: 'object', properties: { person: idParam, box: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } } }, required: ['person'] } },
        },
        required: ['key', 'people'],
      },
    },
  },
  {
    kind: 'avatar', action: 'edit-person', feature: 'avatar',
    spec: {
      name: 'propose_avatar',
      description: 'Propose a drawn avatar for a person, made from one photo in which they are confirmed. The drawing is shown on the card before anything is kept.',
      parameters: { type: 'object', properties: { person: idParam, key: photoParam }, required: ['person', 'key'] },
    },
  },
  {
    kind: 'house-settings', action: 'edit-house',
    spec: {
      name: 'propose_house_settings',
      description: 'Propose a house’s succession law, head, heir or country (a two-letter code such as DE). Only the fields given change. Use list_houses first; a head or heir must belong to the house.',
      parameters: {
        type: 'object',
        properties: {
          house: idParam,
          law: { type: 'string', enum: ['absolute-primogeniture', 'seniority', 'elective'] },
          head: idParam, heir: idParam,
          country: { type: 'string', description: 'Two capital letters, e.g. DE.' },
        },
        required: ['house'],
      },
    },
  },
];

/** A general question answered from the web. Its query goes to the web alone (see lookup.server.ts). */
export const WEB_TOOL: ToolSpec = {
  name: 'web_lookup',
  description: 'Look up a general or historical fact on the web: a place’s history, what a word, trade or custom meant, a past event. Only the query is sent to the web, so never put a living person’s name, a nickname or any detail from this tree in it. Returns a short summary and its sources.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'A general question, in a few words.' } }, required: ['query'] },
};

export interface ToolOptions {
  /** The family allows web lookups. */
  web?: boolean;
  /** The family's faces feature is on: the assistant may look at pictures. */
  faces?: boolean;
  /** The family's avatar feature is on: the assistant may propose drawn avatars. */
  avatar?: boolean;
}

/**
 * The tools this reader may use: reads for everyone, a proposal only where their role may make that change, a feature's
 * tool only while the family has it on. Stewards alone see the house proposals; nobody is offered an access or a settings tool.
 */
export function toolsFor(role: Role, o: ToolOptions = {}): { tools: ToolSpec[]; proposals: boolean } {
  const proposing = PROPOSE.filter((p) => can(role, p.action) && (!p.feature || (p.feature === 'avatar' && o.avatar)));
  const editing = EDITS.filter((e) => can(role, e.action));
  const reads = [...READ_TOOLS, KIN_TOOL, ...(o.faces ? [LOOK_TOOL] : []), ...(o.web ? [WEB_TOOL] : []), ASK_TOOL, ...SHOW_TOOLS];
  return { tools: [...reads, ...proposing.map((p) => p.spec), ...editing.map((e) => e.spec)], proposals: proposing.length + editing.length > 0 };
}

const ACTION_OF = Object.fromEntries([...PROPOSE, ...EDITS].map((p) => [p.kind, p.action])) as Record<ProposalKind, Action>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const json = (v: unknown) => clip(JSON.stringify(v), RESULT_LIMIT);
const refused = (role: Role, action: Action) => json({ error: `this reader may not make that change (${role} cannot ${action}); say that someone with more rights must` });

/** Base64 for a picture, in chunks, so a large one does not overflow the stack or need Node's Buffer. */
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Runs one read tool, or checks one proposal. Returns the text the model sees. */
export async function runTool(ctx: Ctx, name: string, input: unknown, out: Proposal[]): Promise<string> {
  const g = await graph(ctx.tree, assistantAudience(ctx.role));
  const byId = new Map(g.people.map((p) => [p.id, p]));
  const houses = new Map(g.houses.map((h) => [h.id, h.name]));
  const c = tr(ctx.locale);
  const name_ = (id: string) => (byId.get(id) ? fullName(byId.get(id)!) : id);
  try {
    if (name === 'search_people') {
      const a = z.object({ query: z.string().min(1).max(80), limit: z.number().int().min(1).max(15).optional() }).parse(input);
      // Birth and current names both match; the birth name is shown too when it differs from the name now.
      const hits = g.people
        .filter((p) => matchesName(p, a.query))
        .slice(0, a.limit ?? 15)
        .map((p) => {
          const birth = [allGiven(p.given, p.furtherGiven), p.surname].filter(Boolean).join(' ');
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
      const partnerships = (f.unionsOf.get(id) ?? []).map((u) => ({ id: u.id, with: name_(u.a === id ? u.b : u.a), kind: u.kind, start: u.start, end: u.end, endReason: u.endReason, place: u.place }));
      return json({ parents: names(parents(f, id)), children: names(children(f, id)), partners: names(partnersOf(f, id)), siblings: names(siblings(f, id)), partnerships, relatedToReader: kin });
    }
    if (name === 'find_relatives') return json(findRelatives(buildFamily(g), ctx.me, input));
    if (name === 'list_research') return json(await researchList(ctx));
    if (name === 'read_research') {
      const { project } = z.object({ project: z.string().min(1).max(120) }).parse(input);
      return json(await researchRead(ctx, byId, project));
    }
    if (isBlockTool(name)) return await runBlockTool({ tree: ctx.tree, role: ctx.role, me: ctx.me, blocks: (ctx.blocks ??= []), byId }, name, input);
    if (name === 'missing_info') return json(missingInfo(c, g, byId, input));
    if (name === 'list_houses') {
      const settings = await readHouseSettings(ctx.tree);
      return json({
        houses: g.houses.slice(0, 30).map((h) => {
          const s = settings[h.id];
          return { id: h.id, name: h.name, motto: h.motto ?? null, law: s?.law ?? null, head: s?.head ? name_(s.head) : null, heir: s?.heir ? name_(s.heir) : null, country: s?.country ?? null };
        }),
        count: g.houses.length,
      });
    }
    if (name === 'list_photos') return json(await listPhotos(ctx, byId, input));
    if (name === 'describe_photo') return await describePhoto(ctx, input);
    if (name === 'web_lookup') {
      const a = z.object({ query: z.string().trim().min(2).max(160) }).parse(input);
      if (!ctx.search) return json({ error: 'web lookups are off for this family' });
      // One lookup per reply. A second call is not run, and a refused first one counts too: a reply cannot keep rewording a name.
      if (ctx.search.lookups++ >= 1) return json({ error: 'Only one web lookup is allowed per reply, and this one was not run. Answer with what you have.' });
      // The guard runs before anything is sent. It checks only what this reader may see. A refusal says why, not what the detail was.
      const why = refusal(await privacyGuard(ctx.tree, g.people, can(ctx.role, 'edit-person')), a.query);
      if (why) return json({ refused: true, reason: REFUSAL_REASON[why], note: 'Not sent to the web. Ask a general question instead, without names or private details.' });
      const r = await isolatedLookup(ctx.search.adapter, a.query);
      for (const s of r.sources) if (!ctx.search.sources.some((x) => x.url === s.url)) ctx.search.sources.push(s);
      return json({ summary: r.text, sources: r.sources, searches: r.searches });
    }
    const edit = EDITS.find((x) => x.spec.name === name);
    if (edit) {
      if (!can(ctx.role, edit.action)) return refused(ctx.role, edit.action);
      return await runEdit({ ctx, c, g, byId }, edit, input, out);
    }
    const p = PROPOSE.find((x) => x.spec.name === name);
    if (p) {
      if (!can(ctx.role, p.action)) return refused(ctx.role, p.action);
      if (p.kind === 'family' || p.kind === 'photo-details' || p.kind === 'photo-album' || p.kind === 'photo-tags' || p.kind === 'avatar' || p.kind === 'set-occupation' || p.kind === 'house-settings') {
        return await proposeNew(ctx, c, g, byId, p.kind, input, out);
      }
      return await propose(ctx, c, byId, p.kind, input, out);
    }
    return json({ error: `no tool ${name}` });
  } catch (e) {
    if (e instanceof z.ZodError) return json({ error: 'the arguments did not fit the tool: ' + e.issues.map((i) => i.path.join('.') || 'input').join(', ') });
    throw e;
  }
}

async function readPerson(ctx: Ctx, p: GPerson, houses: Map<string, string>) {
  // The family's own rule (lib/visibility.ts): editors' fields only for editors and stewards, and no personal field ever,
  // not even the reader's own, because this goes to the provider.
  const d = await person(ctx.tree, p.id, assistantAudience(ctx.role));
  return {
    id: p.id,
    name: fullName(p),
    given: p.given,
    furtherGiven: p.furtherGiven,
    surname: p.surname,
    currentGiven: p.currentGiven,
    currentSurname: p.currentSurname,
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
    fields: d.fields.slice(0, 40).map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, private: f.visibility !== 'family' })),
    stories: d.stories.slice(0, 8).map((s) => ({ id: s.id, kind: s.kind, title: s.title, body: clip(s.body, 800), author: s.author, at: s.at.slice(0, 10) })),
  };
}

/** What is still missing: one person and their close relatives, or the people with the most gaps. Capped. */
function missingInfo(c: Tr, g: Graph, byId: Map<string, GPerson>, input: unknown) {
  const a = z.object({ person: z.string().min(1).max(120).optional(), limit: z.number().int().min(1).max(12).optional() }).parse(input);
  const f = buildFamily(g);
  const gapNames = (p: GPerson) => gapsOf(f, p, new Set(DEFAULT_GAPS)).map((k) => c(GAP_LABEL[k]));
  if (a.person) {
    const root = byId.get(a.person);
    if (!root) return { error: 'not in this tree' };
    const ids = [...new Set([a.person, ...parents(f, a.person), ...children(f, a.person), ...partnersOf(f, a.person), ...siblings(f, a.person)])].slice(0, a.limit ?? 12);
    return { people: ids.map((id) => ({ id, name: fullName(byId.get(id)!), missing: gapNames(byId.get(id)!) })) };
  }
  const rows = g.people
    .map((p) => ({ id: p.id, name: fullName(p), missing: gapNames(p) }))
    .filter((r) => r.missing.length)
    .sort((x, y) => y.missing.length - x.missing.length || x.name.localeCompare(y.name));
  return { count: rows.length, people: rows.slice(0, a.limit ?? 12) };
}

/** Photos that match the filters, newest first, with the album names and the people confirmed in them. At most 15. */
async function listPhotos(ctx: Ctx, byId: Map<string, GPerson>, input: unknown) {
  const a = z.object({
    album: z.string().max(64).optional(),
    person: z.string().min(1).max(120).optional(),
    missing: z.array(z.enum(['date', 'place', 'caption', 'album', 'tags'])).max(5).optional(),
    limit: z.number().int().min(1).max(LIST_LIMIT).optional(),
  }).parse(input);
  const gal = await gallery(ctx.tree);
  const albumName = new Map(gal.albums.map((x) => [x.id, x.name]));
  let items: MediaItem[] = a.person ? await personMedia(ctx.tree, a.person) : gal.media;
  if (a.album) items = items.filter((p) => p.album === a.album);
  const missing = new Set(a.missing ?? []);
  if (missing.has('date')) items = items.filter((p) => !p.taken);
  if (missing.has('place')) items = items.filter((p) => !p.place);
  if (missing.has('caption')) items = items.filter((p) => !p.caption);
  if (missing.has('album')) items = items.filter((p) => !p.album);
  if (missing.has('tags')) items = items.filter((p) => !p.tags.some((t) => t.confirmed));
  const limit = a.limit ?? LIST_LIMIT;
  return {
    total: items.length,
    albums: gal.albums.slice(0, 30).map((x) => ({ id: x.id, name: x.name, count: x.count })),
    photos: items.slice(0, limit).map((p) => ({
      key: p.key,
      album: p.album ? albumName.get(p.album) ?? null : null,
      taken: p.taken,
      place: p.place,
      caption: p.caption ? clip(p.caption, 160) : null,
      people: p.tags.filter((t) => t.confirmed).map((t) => (byId.get(t.person) ? fullName(byId.get(t.person)!) : t.person)),
    })),
  };
}

/** A picture the model may look at, when the family's faces feature is on. Otherwise the reader's details only. */
async function describePhoto(ctx: Ctx, input: unknown): Promise<string> {
  const { key } = z.object({ key: z.string().min(3).max(200) }).parse(input);
  const row = await db(ctx.tree).get<{ key: string; mime: string }>('SELECT key, mime FROM media WHERE key = ?', key);
  if (!row) return json({ error: 'not a photo in this family' });
  if (!ctx.faces || !ctx.images) return json({ note: 'Looking at pictures is off for this family, so work from the details alone.' });
  if (ctx.images.length >= 2) return json({ error: 'Only two pictures can be looked at in one reply.' });
  const { media } = await import('../db.server');
  const obj = await media.get(ctx.tree, key);
  if (!obj) return json({ error: 'the picture is missing from storage' });
  const body = obj.body instanceof Uint8Array ? obj.body : new Uint8Array(await new Response(obj.body).arrayBuffer());
  ctx.images.push({ mime: row.mime, base64: base64(body) });
  return json({ shown: true, note: 'The picture is attached to your next step. Describe only what you can see.' });
}

/** Checks a proposed change against the tree and describes it for the card. */
async function propose(ctx: Ctx, c: Tr, byId: Map<string, GPerson>, kind: ProposalKind, input: unknown, out: Proposal[]): Promise<string> {
  if (!PROPOSAL_KINDS.includes(kind)) return json({ error: 'unknown kind' });
  if (!can(ctx.role, ACTION_OF[kind])) return json({ error: 'this reader may not make that change; say a contributor or editor must' });
  const parsed = (proposalArgs as unknown as Record<string, z.ZodTypeAny>)[kind].safeParse(input);
  if (!parsed.success) return json({ error: 'the arguments did not fit the tool: ' + parsed.error.issues.map((i) => i.path.join('.') || 'input').join(', ') });
  const args = parsed.data as ProposalArgs;
  for (const k of ['born', 'died'] as const) {
    if (typeof args[k] === 'string' && !validDate(args[k] as string)) return json({ error: `${k} is not a real date; use YYYY, YYYY-MM or YYYY-MM-DD` });
  }
  const union = args.partnership as { start?: string } | undefined;
  if (union?.start && !validDate(union.start)) return json({ error: 'the start of the partnership is not a real date; use YYYY, YYYY-MM or YYYY-MM-DD' });
  for (const k of ['anchor', 'person', 'coParent'] as const) {
    if (typeof args[k] === 'string' && !byId.has(args[k] as string)) return json({ error: `${k} is not a person in this tree; search for them first` });
  }
  const name = (id: string) => fullName(byId.get(id)!);
  const rel = (r: string) => (r === 'child' ? c('ai.relChild') : r === 'parent' ? c('ai.relParent') : r === 'partner' ? c('ai.relPartner') : c('ai.relSibling'));
  const storyKind = (k: string) => (STORY_KIND_KEY[k] ? c(STORY_KIND_KEY[k]) : k);
  const show = (v: unknown) => (v === undefined || v === null || v === '' ? c('ai.fieldNone') : String(v));
  const diff: Proposal['diff'] = [];
  let summary: string;
  let editable: string[] = [];

  if (kind === 'add-person') {
    const a = args as z.infer<typeof proposalArgs['add-person']>;
    const who = [allGiven(a.given, a.furtherGiven), a.surname].filter(Boolean).join(' ');
    summary = c('ai.summaryAddPerson', { name: who, rel: rel(a.relation), anchor: name(a.anchor) });
    diff.push({ label: c('ai.fieldName'), to: who }, { label: c('ai.fieldRelation'), to: `${rel(a.relation)} ${name(a.anchor)}` });
    if (a.born) diff.push({ label: c('ai.fieldBorn'), to: a.born });
    if (a.died) diff.push({ label: c('ai.fieldDied'), to: a.died });
    if (a.partnership?.start) diff.push({ label: c('chat.field.unionStart'), to: a.partnership.start });
    if (a.partnership?.place) diff.push({ label: c('ai.fieldPlace'), to: a.partnership.place });
    editable = ['given', 'surname', 'born', 'died'];
  } else if (kind === 'link-relative') {
    const a = args as { anchor: string; person: string; relation: string; partnership?: { start?: string; place?: string } };
    summary = c('ai.summaryLink', { name: name(a.person), rel: rel(a.relation), anchor: name(a.anchor) });
    diff.push({ label: c('ai.fieldRelation'), to: `${name(a.person)}: ${rel(a.relation)} ${name(a.anchor)}` });
    if (a.partnership?.start) diff.push({ label: c('chat.field.unionStart'), to: a.partnership.start });
    if (a.partnership?.place) diff.push({ label: c('ai.fieldPlace'), to: a.partnership.place });
  } else if (kind === 'set-dates') {
    const a = args as { person: string } & Record<string, string | undefined>;
    const cur = byId.get(a.person)!;
    summary = c('ai.summaryDates', { name: name(a.person) });
    const rows: [string, 'born' | 'bornPlace' | 'died' | 'diedPlace', string | undefined][] = [
      [c('ai.fieldBorn'), 'born', cur.born], [c('ai.fieldBornPlace'), 'bornPlace', cur.bornPlace], [c('ai.fieldDied'), 'died', cur.died],
      [c('ai.fieldDiedPlace'), 'diedPlace', cur.diedPlace],
    ];
    for (const [label, k, was] of rows) if (a[k] !== undefined) diff.push({ label, from: show(was), to: String(a[k]) });
    editable = ['born', 'bornPlace', 'died', 'diedPlace'];
  } else if (kind === 'add-story') {
    const a = args as { person: string; kind: string; title?: string; body: string };
    summary = c('ai.summaryStory', { kind: storyKind(a.kind), name: name(a.person) });
    if (a.title) diff.push({ label: c('ai.fieldName'), to: a.title });
    diff.push({ label: c('ai.fieldStory'), to: clip(a.body, 240) });
    editable = ['title', 'body'];
  } else {
    const a = args as { person: string; type: string; label?: string; value: Record<string, string> };
    const checked = fieldInput.safeParse({ type: a.type, label: a.label ?? '', value: a.value, visibility: 'family' });
    if (!checked.success) return json({ error: 'that detail does not fit its type: ' + (checked.error.issues[0]?.message ?? 'check the keys') });
    // Set by the family's rule, not by the model: a health detail starts at the editors' level. The approver can change it on the card.
    delete args.private;
    args.visibility = defaultVisibility(a.type);
    const typeName = c(`type.${a.type}` as Key);
    const valueName = (k: string) => (VALUE_LABEL[k] ? c(VALUE_LABEL[k]) : k);
    summary = c('ai.summaryField', { field: a.label ? `${typeName} (${a.label})` : typeName, name: name(a.person) });
    diff.push({ label: typeName, to: Object.entries(a.value).map(([k, v]) => `${valueName(k)}: ${v}`).join(', ') });
    editable = ['label'];
  }
  // Only the fields the change sets can be edited: an empty date input would otherwise be sent as a change.
  const present = editable.filter((k) => (args as Record<string, unknown>)[k] !== undefined);
  const proposal: Proposal = { id: crypto.randomUUID(), kind, summary, diff, args, editable: present, status: 'open' };
  out.push(proposal);
  return json({ proposed: true, kind, note: 'Shown to the reader for approval. Nothing is saved yet.' });
}

/** The proposals that cover many changes, or a photo, a drawn avatar, an occupation or a house. Each one is checked before it is shown. */
async function proposeNew(ctx: Ctx, c: Tr, g: Graph, byId: Map<string, GPerson>, kind: ProposalKind, input: unknown, out: Proposal[]): Promise<string> {
  const done = (proposal: Omit<Proposal, 'id' | 'status'> & { view?: ProposalView }) => {
    out.push({ id: crypto.randomUUID(), status: 'open', ...proposal });
    return json({ proposed: true, kind, note: 'Shown to the reader for approval. Nothing is saved yet.' });
  };
  const bad = (msg: string) => json({ error: msg });
  const gal = async () => gallery(ctx.tree);
  const photoOf = (media: MediaItem[], key: string) => media.find((m) => m.key === key);

  if (kind === 'family') {
    const parsed = proposalArgs.family.extend({ questions: z.array(z.string().trim().min(1).max(240)).max(8).optional() }).safeParse(input);
    if (!parsed.success) return bad('the arguments did not fit the tool: ' + parsed.error.issues.map((i) => i.path.join('.') || 'input').join(', '));
    const { questions } = parsed.data;
    let { links } = parsed.data;
    // A memory is told by the speaker the model named, or else the session's speaker. An id that is not in the tree is dropped, never shown.
    let people = parsed.data.people.map((p) => {
      // A handle a network could not have is left off: it was misread, and a card should not offer it.
      const social = p.social?.flatMap((s) => cleanSocial(s) ?? []);
      // A detail that does not fit its type (a misread email, say) is not offered; the card says it could not be read.
      const unsure = [...(p.unsure ?? [])];
      const details = p.details?.filter((d) => {
        const ok = fieldInput.safeParse({ type: d.type, label: d.label ?? d.type, value: d.value, visibility: defaultVisibility(d.type) }).success;
        if (!ok) unsure.push(`${d.type}: not readable as a ${d.type}`);
        return ok;
      });
      const row = { ...p, ...(p.social ? { social } : {}), ...(details ? { details } : {}), ...(unsure.length ? { unsure: unsure.slice(0, 8) } : {}) };
      if (!p.story) return row;
      const named = p.story.teller && byId.has(p.story.teller) ? p.story.teller : undefined;
      const speaker = ctx.session && ctx.me && byId.has(ctx.me) ? ctx.me : undefined;
      return { ...row, story: { ...p.story, teller: named ?? speaker } };
    });
    const refs = new Set<string>();
    for (const p of people) {
      if (refs.has(p.ref)) return bad(`ref ${p.ref} is used twice; give each new person its own`);
      if (byId.has(p.ref)) return bad(`ref ${p.ref} is a tree id; choose another`);
      refs.add(p.ref);
      for (const k of ['born', 'died'] as const) if (p[k] && !validDate(p[k]!)) return bad(`${k} of ${p.given} is not a real date; use YYYY, YYYY-MM or YYYY-MM-DD, with ~ for about`);
    }
    const known = (x: string) => refs.has(x) || byId.has(x);
    for (const l of links) {
      for (const x of [l.anchor, l.person, l.coParent].filter((v): v is string => !!v)) {
        if (NEW_REF.test(x) && !refs.has(x)) return bad(`${x} is not a new person in this draft`);
        if (!NEW_REF.test(x) && !known(x)) return bad(`${x} is not a person in this tree; search for them first`);
      }
      if (l.anchor === l.person) return bad('a link cannot join a person to themselves');
    }
    // Someone the tree already has with every one of these profiles is not offered again. Links to them go to the person in the tree.
    const profiles = await profilesInTree(ctx.tree);
    const inTree: NonNullable<ProposalView['known']> = [];
    people = people.filter((p) => {
      const owners = new Set((p.social ?? []).map((s) => profiles.get(profileKey(s.network, s.handle))));
      const [owner] = owners;
      if (!owner || owners.size !== 1 || !byId.has(owner)) return true;
      inTree.push({ name: name(byId, owner), handle: p.social![0].handle });
      links = links.map((l) => {
        const to = (x: string) => (x === p.ref ? owner : x);
        return { ...l, anchor: to(l.anchor), person: to(l.person), ...(l.coParent ? { coParent: to(l.coParent) } : {}) };
      }).filter((l) => l.anchor !== l.person);
      return false;
    });
    if (!people.length && inTree.length) return json({ proposed: false, note: `Everyone in this draft is already in the tree with these profiles: ${inTree.map((k) => k.name).join(', ')}. Tell the reader; there is nothing to add.` });
    // A list read from a picture may hold strangers, so the reader ticks who is added and sees who may already be in the tree.
    const pick = !!ctx.pictures || people.some((p) => p.social?.length);
    const matches = pick ? Object.fromEntries(people.flatMap((p) => {
      const found = matchesFor(g, p, profiles);
      return found.length ? [[p.ref, found]] : [];
    })) : undefined;
    const checks = checkFamily(g, people, links);
    const names: Record<string, string> = {};
    for (const x of new Set(links.flatMap((l) => [l.anchor, l.person, l.coParent]).filter((v): v is string => !!v && byId.has(v)))) names[x] = name(byId, x);
    for (const d of checks.duplicates) names[d.id] = d.name;
    for (const p of people) if (p.story?.teller) names[p.story.teller] = name(byId, p.story.teller);
    const view: ProposalView = { names, duplicates: checks.duplicates, loops: checks.loops, questions, ...(pick && { pick, matches }), ...(inTree.length && { known: inTree }) };
    return done({
      kind, args: { people, links }, editable: [],
      summary: c('ai.summaryFamily', { count: people.length, links: links.length - checks.loops.length }),
      diff: [], view,
    });
  }

  if (kind === 'photo-details') {
    const a = z.object({ items: z.array(z.object({ key: z.string(), taken: z.string().max(10).optional(), place: z.string().trim().max(200).optional(), caption: z.string().trim().max(1000).optional(), clear: z.array(z.enum(['taken', 'place', 'caption'])).max(3).optional() })).min(1).max(25) }).parse(input);
    const media = (await gal()).media;
    const before: NonNullable<ProposalView['before']> = {};
    const items = [];
    for (const it of a.items) {
      const cur = photoOf(media, it.key);
      if (!cur) return bad(`${it.key} is not a photo in this family`);
      if (it.taken && !validDate(it.taken)) return bad(`${it.taken} is not a real date; use YYYY, YYYY-MM or YYYY-MM-DD, with ~ for about`);
      before[it.key] = { taken: cur.taken, place: cur.place, caption: cur.caption, album: cur.album };
      // The gallery saves all four details at once, so the card keeps what is not being changed.
      const gone = new Set(it.clear ?? []);
      items.push({ key: it.key, taken: gone.has('taken') ? null : it.taken ?? cur.taken ?? null, place: gone.has('place') ? null : it.place ?? cur.place ?? null, caption: gone.has('caption') ? null : it.caption ?? cur.caption ?? null, album: cur.album ?? null });
    }
    const parsed = proposalArgs['photo-details'].safeParse({ items });
    if (!parsed.success) return bad('the arguments did not fit the tool');
    return done({
      kind, args: parsed.data as ProposalArgs, editable: [],
      summary: c('ai.summaryPhotos', { count: items.length }),
      diff: [],
      view: { thumbs: thumbsFor(ctx.tree, items.map((i) => i.key)), before },
    });
  }

  if (kind === 'photo-album') {
    const a = z.object({ name: z.string().trim().min(1).max(80).optional(), albumId: z.string().max(64).optional(), keys: z.array(z.string()).min(1).max(40) }).parse(input);
    const { media, albums } = await gal();
    if (a.albumId && !albums.some((x) => x.id === a.albumId)) return bad('that album is not in this family; list the albums first');
    if (!a.albumId && !a.name) return bad('name the new album, or pick an existing one');
    const items = [];
    for (const key of a.keys) {
      const cur = photoOf(media, key);
      if (!cur) return bad(`${key} is not a photo in this family`);
      items.push({ key, taken: cur.taken ?? null, place: cur.place ?? null, caption: cur.caption ?? null, album: cur.album ?? null });
    }
    const albumName = a.albumId ? albums.find((x) => x.id === a.albumId)!.name : a.name!;
    const args: ProposalArgs = { items, ...(a.name && !a.albumId ? { name: a.name } : { albumId: a.albumId! }) };
    return done({
      kind, args, editable: [],
      summary: c('ai.summaryAlbum', { count: items.length, name: albumName }),
      diff: [],
      view: { thumbs: thumbsFor(ctx.tree, a.keys), names: {} },
    });
  }

  if (kind === 'photo-tags') {
    const a = z.object({ key: z.string(), people: z.array(z.object({ person: z.string().min(1), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional() })).min(1).max(20) }).parse(input);
    const media = (await gal()).media;
    if (!photoOf(media, a.key)) return bad(`${a.key} is not a photo in this family`);
    for (const p of a.people) if (!byId.has(p.person)) return bad(`${p.person} is not a person in this tree; search for them first`);
    const people = a.people.map((p) => ({ person: p.person, box: p.box ?? { x: 0, y: 0, w: 1, h: 1 } }));
    const names = Object.fromEntries(people.map((p) => [p.person, name(byId, p.person)]));
    return done({
      kind, args: { key: a.key, people }, editable: [],
      summary: c('ai.summaryTags', { count: people.length }),
      diff: [],
      view: { thumbs: thumbsFor(ctx.tree, [a.key]), names },
    });
  }

  if (kind === 'avatar') {
    if (!ctx.avatar) return bad('drawn avatars are off for this family');
    const a = z.object({ person: z.string().min(1), key: z.string() }).parse(input);
    if (!byId.has(a.person)) return bad(`${a.person} is not a person in this tree; search for them first`);
    const media = (await gal()).media;
    const photo = photoOf(media, a.key);
    if (!photo || !photo.tags.some((t) => t.confirmed && t.person === a.person)) return bad('that photo is not one where this person is confirmed; tag them in it first');
    const { avatarFromPhoto } = await import('./vision.server');
    const { AiError } = await import('./adapters');
    let look;
    try {
      look = await avatarFromPhoto({ tree: ctx.tree, personId: a.person, mediaKey: a.key, locale: ctx.locale });
    } catch (e) {
      if (e instanceof AiError) return bad(e.message);
      throw e;
    }
    const parsed = proposalArgs.avatar.safeParse({ person: a.person, look });
    if (!parsed.success) return bad('the drawing did not come out in a form the portrait can show');
    return done({
      kind, args: parsed.data as ProposalArgs, editable: [],
      summary: c('ai.summaryAvatar', { name: name(byId, a.person) }),
      diff: [],
      view: { thumbs: thumbsFor(ctx.tree, [a.key]), names: { [a.person]: name(byId, a.person) }, personName: name(byId, a.person) },
    });
  }

  if (kind === 'set-occupation') {
    const a = z.object({ person: z.string().min(1), occupation: z.string().trim().min(1).max(200) }).parse(input);
    const cur = byId.get(a.person);
    if (!cur) return bad(`${a.person} is not a person in this tree; search for them first`);
    return done({
      kind, args: { person: a.person, occupation: a.occupation }, editable: [],
      summary: c('ai.summaryOccupation', { name: fullName(cur), occupation: a.occupation }),
      diff: [{ label: c('ai.fieldOccupation'), from: cur.occupation ?? c('ai.fieldNone'), to: a.occupation }],
    });
  }

  // house-settings: stewards only (the server checks it again on approval). Unchanged fields keep their stored value.
  const a = z.object({
    house: z.string().min(1), law: z.enum(['absolute-primogeniture', 'seniority', 'elective']).optional(),
    head: z.string().min(1).optional(), heir: z.string().min(1).optional(), country: z.string().regex(/^[A-Z]{2}$/).optional(),
  }).parse(input);
  const house = g.houses.find((h) => h.id === a.house);
  if (!house) return bad('that house is not in this family; list the houses first');
  const cur = (await readHouseSettings(ctx.tree))[house.id];
  const next = { house: house.id, law: a.law ?? cur?.law ?? 'absolute-primogeniture', head: a.head ?? cur?.head ?? null, heir: a.heir ?? cur?.heir ?? null, country: a.country ?? cur?.country ?? null };
  for (const who of [next.head, next.heir]) if (who && !(byId.get(who)?.house === house.id)) return bad(`${who} is not a member of ${house.name}`);
  const parsed = proposalArgs['house-settings'].safeParse(next);
  if (!parsed.success) return bad('the arguments did not fit the tool');
  const show2 = (v: unknown) => (v === null || v === undefined || v === '' ? c('ai.fieldNone') : String(v));
  return done({
    kind, args: parsed.data as ProposalArgs, editable: [],
    summary: c('ai.summaryHouse', { house: house.name }),
    diff: [
      { label: c('ai.fieldLaw'), from: show2(cur?.law), to: next.law },
      { label: c('ai.fieldCountry'), from: show2(cur?.country), to: show2(next.country) },
      { label: c('ai.fieldHead'), from: show2(cur?.head ? name(byId, cur.head) : null), to: show2(next.head ? name(byId, next.head) : null) },
      { label: c('ai.fieldHeir'), from: show2(cur?.heir ? name(byId, cur.heir) : null), to: show2(next.heir ? name(byId, next.heir) : null) },
    ],
  });
}

const name = (byId: Map<string, GPerson>, id: string) => (byId.get(id) ? fullName(byId.get(id)!) : id);
const thumbsFor = (tree: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, mediaUrl(tree, k)]));
