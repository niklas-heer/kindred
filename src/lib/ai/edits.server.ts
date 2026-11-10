// The proposals for everything else a reader can change by hand: names, details, relations, marriages, removals, houses,
// albums, pins, research and the family's title. Like the older ones in tools.server.ts, each only checks the change against
// the tree as this reader may see it and describes it for a card. Approving it calls the same server function as the form
// (components/assistant/apply.ts), under the reader's own role.
//
// Personal-level fields can never be named here: they are not in the reader's list as the assistant sees it, so an id of one
// is refused as a field that does not exist. Accounts, roles, passkeys, AI keys, share links and budgets have no tool on
// purpose. The prompt tells the model to say where they are.
import { z } from 'zod';
import { person, searchPlaces } from '../db.server';
import { fullName } from '../graph';
import type { GPerson, GUnion, Graph } from '../types';
import { can, type Action } from '../roles';
import { validDate } from '../dates';
import { fieldInput, isContactType } from '../../components/fields/model';
import { mediaUrl, type MediaItem } from '../../components/photos/types';
import { assistantAudience } from '../visibility';
import type { Key } from '../i18n/dictionary';
import { gallery } from '../photos.server';
import { listProjects, projectView, type Who } from '../research.server';
import { mayChangeResearch, seesPrivateResearch } from '../research';
import { readMeanings } from '../house-meaning.server';
import { cleanFamilyDetails } from '../family-details.server';
import type { ToolSpec } from './adapters';
import type { Tr } from './labels';
import { type Clearable, type Proposal, type ProposalArgs, type ProposalKind } from './types';
import type { Ctx } from './tools.server';

export interface EditEnv { ctx: Ctx; c: Tr; g: Graph; byId: Map<string, GPerson> }
export type Made = Omit<Proposal, 'id' | 'status'>;

/** A refusal the model reads and can act on. */
class Refused extends Error {}
const no = (message: string): never => { throw new Refused(message); };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const idText = z.string().min(1).max(120);
const nameText = z.string().trim().min(1).max(120);
const idParam = { type: 'string', description: 'A person id, as the tools returned it.' };
const photoParam = { type: 'string', description: 'A photo key, as list_photos returned it.' };
const date = { type: 'string', description: 'YYYY, YYYY-MM or YYYY-MM-DD, with a leading ~ for about. Never guess a date.' };
const object = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required });
const clearOf = (keys: readonly string[]) => ({ type: 'array', items: { type: 'string', enum: [...keys] }, maxItems: keys.length, description: 'Only what the reader asked to remove.' });

const NAME_KEYS = ['furtherGiven', 'surname', 'currentGiven', 'currentSurname', 'nickname', 'title', 'epithet'] as const satisfies readonly Clearable[];
const FACT_KEYS = ['sex', 'bio', 'born', 'bornPlace', 'died', 'diedPlace', 'occupation'] as const satisfies readonly Clearable[];

const LABEL: Record<string, Key> = {
  given: 'chat.field.given', furtherGiven: 'chat.field.furtherGiven', surname: 'chat.field.surname', currentGiven: 'chat.field.currentGiven',
  currentSurname: 'chat.field.currentSurname', nickname: 'chat.field.nickname', title: 'chat.field.title', epithet: 'chat.field.epithet',
  sex: 'chat.field.sex', living: 'chat.field.living', bio: 'chat.field.bio', born: 'ai.fieldBorn', bornPlace: 'ai.fieldBornPlace', died: 'ai.fieldDied',
  diedPlace: 'ai.fieldDiedPlace', occupation: 'ai.fieldOccupation',
};

const who = (env: EditEnv, id: string): GPerson => env.byId.get(id) ?? no(`${id} is not a person in this tree; search for them first`);
const named = (env: EditEnv, id: string) => fullName(who(env, id));
const showValue = (v: Record<string, string>) => Object.values(v).filter(Boolean).join(', ');
const none = (c: Tr, v: unknown) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? c('ai.fieldNone') : Array.isArray(v) ? v.join(' ') : String(v));
const removedRow = (c: Tr, label: string, from: string) => ({ label, from, to: c('chat.removed'), removed: true });
const check = (d: string | null | undefined, what: string) => { if (d && !validDate(d)) no(`${what} is not a real date; use YYYY, YYYY-MM or YYYY-MM-DD, with ~ for about`); };

/** The stored value of a details key, as it is on the record. */
function storedOf(p: GPerson, bio: string | null | undefined, key: string): unknown {
  if (key === 'bio') return bio ?? null;
  const v = (p as unknown as Record<string, unknown>)[key];
  return v === undefined ? (key === 'furtherGiven' ? [] : null) : v;
}

function sexLabel(c: Tr, v: unknown): string {
  return v === 'm' ? c('chat.sex.m') : v === 'f' ? c('chat.sex.f') : v === 'x' ? c('chat.sex.x') : c('ai.fieldNone');
}

/** One card for a person's details, from either of the two tools that edit them. Only the keys given change. */
async function editPerson(env: EditEnv, a: { person: string; clear?: Clearable[] } & Record<string, unknown>): Promise<Made> {
  const { c, ctx } = env;
  const p = who(env, a.person);
  const { person: _p, clear: rawClear, ...sets } = a;
  const clear = [...new Set(rawClear ?? [])];
  const keys = Object.keys(sets).filter((k) => sets[k] !== undefined);
  if (!keys.length && !clear.length) no('say what should change');
  const overlap = keys.find((k) => clear.includes(k as Clearable));
  if (overlap) no(`${overlap} cannot be set and removed at once`);
  const detail = await person(ctx.tree, p.id, assistantAudience(ctx.role));
  const before: Record<string, unknown> = {};
  const diff: Proposal['diff'] = [];
  const say = (key: string, v: unknown) => (key === 'sex' ? sexLabel(c, v) : key === 'living' ? (v ? c('chat.yes') : c('chat.no')) : key === 'bio' && typeof v === 'string' ? clip(v, 240) : none(c, v));
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const changing: string[] = [];
  for (const key of keys) {
    const was = storedOf(p, detail.bio, key);
    if (same(was, sets[key])) continue;
    before[key] = was as never;
    changing.push(key);
    diff.push({ label: c(LABEL[key]), from: say(key, was), to: say(key, sets[key]) });
  }
  for (const key of clear) {
    const was = storedOf(p, detail.bio, key);
    if (was === null || (Array.isArray(was) && !was.length)) continue;
    before[key] = was as never;
    diff.push(removedRow(c, c(LABEL[key]), say(key, was)));
  }
  if (!diff.length) no(`${fullName(p)} already has those details; nothing would change`);
  const kept = Object.fromEntries(changing.map((k) => [k, sets[k]]));
  const emptied = clear.filter((k) => k in before);
  return {
    kind: 'edit-person',
    summary: c('chat.sum.editPerson', { name: fullName(p) }),
    diff,
    args: { person: p.id, ...kept, ...(emptied.length && { clear: emptied }), before } as ProposalArgs,
    editable: changing.filter((k) => ['given', 'surname', 'currentGiven', 'currentSurname', 'nickname', 'title', 'epithet', 'bio'].includes(k)),
    ...(!changing.length && { removal: true }),
  };
}

const fieldsOf = async (env: EditEnv, id: string) => (await person(env.ctx.tree, id, assistantAudience(env.ctx.role))).fields;

function findUnion(env: EditEnv, id: string): GUnion {
  return env.g.unions.find((u) => u.id === id && env.byId.has(u.a) && env.byId.has(u.b)) ?? no('that partnership is not in this family; relatives lists the ids');
}
const coupleOf = (env: EditEnv, u: GUnion) => `${named(env, u.a)} & ${named(env, u.b)}`;
const unionKind = (c: Tr, k: string) => (k === 'marriage' ? c('chat.union.marriage') : k === 'other' ? c('chat.union.other') : k === 'betrothal' ? c('chat.union.betrothal') : c('chat.union.partnership'));

function findHouse(env: EditEnv, id: string) {
  return env.g.houses.find((h) => h.id === id) ?? no('that house is not in this family; list the houses first');
}

const whoAmI = (ctx: Ctx): Who => ({ id: ctx.user ?? '', name: '', role: ctx.role });

async function photoOf(env: EditEnv, key: string): Promise<MediaItem> {
  return (await gallery(env.ctx.tree)).media.find((m) => m.key === key) ?? no(`${key} is not a photo in this family`);
}
const thumb = (env: EditEnv, key: string) => ({ thumbs: { [key]: mediaUrl(env.ctx.tree, key, 'thumb') } });

async function projectFor(env: EditEnv, id: string) {
  return (await projectView(env.ctx.tree, id, whoAmI(env.ctx))) ?? no('that research project is not in this family; list_research gives the ids');
}
function mayChange(env: EditEnv, thing: { mine: boolean }) {
  if (!mayChangeResearch(env.ctx.role, thing.mine)) no('this reader may only change their own research; say that an editor must');
}
function mayBePrivate(env: EditEnv, wanted: boolean | undefined) {
  if (wanted && !seesPrivateResearch(env.ctx.role)) no('only an editor can mark research private');
}

interface Edit { kind: ProposalKind; action: Action; spec: ToolSpec; run: (env: EditEnv, input: unknown) => Promise<Made> | Made }

export const EDITS: Edit[] = [
  {
    kind: 'edit-person', action: 'edit-person',
    spec: {
      name: 'propose_edit_names',
      description: 'Propose changing a person’s names or styling: given name (the first name only), further given names in order, birth surname, the given name or surname they go by now, nickname, title, epithet. Only what you pass changes; clear removes.',
      parameters: object({
        person: idParam, given: { type: 'string' }, furtherGiven: { type: 'array', items: { type: 'string' }, maxItems: 10 }, surname: { type: 'string', description: 'The birth surname.' },
        currentGiven: { type: 'string' }, currentSurname: { type: 'string', description: 'The surname they use now, e.g. after marriage.' }, nickname: { type: 'string' }, title: { type: 'string' }, epithet: { type: 'string' },
        clear: clearOf(NAME_KEYS),
      }, ['person']),
    },
    run: (env, input) => editPerson(env, z.object({
      person: idText, given: nameText.optional(), furtherGiven: z.array(nameText).max(10).optional(), surname: nameText.optional(), currentGiven: nameText.optional(), currentSurname: nameText.optional(),
      nickname: nameText.optional(), title: z.string().trim().min(1).max(200).optional(), epithet: nameText.optional(), clear: z.array(z.enum(NAME_KEYS)).optional(),
    }).parse(input)),
  },
  {
    kind: 'edit-person', action: 'edit-person',
    spec: {
      name: 'propose_edit_facts',
      description: 'Propose a person’s sex, whether they are living, or their biography, or remove a date, place or occupation with clear. Only what you pass changes. To set a date or place use propose_set_dates.',
      parameters: object({ person: idParam, sex: { type: 'string', enum: ['m', 'f', 'x'] }, living: { type: 'boolean' }, bio: { type: 'string', description: 'The whole new biography, in Markdown.' }, clear: clearOf(FACT_KEYS) }, ['person']),
    },
    run: (env, input) => editPerson(env, z.object({ person: idText, sex: z.enum(['m', 'f', 'x']).optional(), living: z.boolean().optional(), bio: z.string().trim().min(1).max(20_000).optional(), clear: z.array(z.enum(FACT_KEYS)).optional() }).parse(input)),
  },
  {
    kind: 'update-field', action: 'edit-person',
    spec: {
      name: 'propose_update_field',
      description: 'Propose changing one detail already on a person (faith, a favourite, a phone number and so on). Use the field id from read_person. value holds only the keys that change; an empty string empties that key.',
      parameters: object({ person: idParam, field: { type: 'string', description: 'A field id from read_person.' }, label: { type: 'string' }, value: { type: 'object', additionalProperties: { type: 'string' } }, visibility: { type: 'string', enum: ['family', 'editors'] } }, ['person', 'field']),
    },
    run: async (env, input) => {
      const { c, ctx } = env;
      const a = z.object({ person: idText, field: idText, label: z.string().trim().max(60).optional(), value: z.record(z.string(), z.string().max(5000)).optional(), visibility: z.enum(['family', 'editors']).optional() }).parse(input);
      const p = who(env, a.person);
      const cur = (await fieldsOf(env, p.id)).find((f) => f.id === a.field) ?? no('that detail is not on this person; read_person lists the ids');
      if (isContactType(cur.type) && !can(ctx.role, 'edit-contact')) no('this reader may not change contact details');
      const next = { type: cur.type, label: a.label ?? cur.label, value: { ...cur.value, ...a.value }, visibility: a.visibility ?? (cur.visibility as 'family' | 'editors') };
      const parsed = fieldInput.safeParse(next);
      if (!parsed.success) no(`that detail does not fit its type: ${parsed.error.issues[0]?.message ?? 'check the keys'}`);
      const typeName = c(`type.${cur.type}` as Key);
      const diff: Proposal['diff'] = [];
      if (showValue(cur.value) !== showValue(next.value)) diff.push({ label: typeName, from: showValue(cur.value), to: showValue(next.value) });
      if (cur.label !== next.label) diff.push({ label: c('ai.fieldLabel'), from: none(c, cur.label), to: none(c, next.label) });
      if (cur.visibility !== next.visibility) diff.push({ label: c('chat.field.visibility'), from: c(`chat.vis.${cur.visibility as 'family' | 'editors'}`), to: c(`chat.vis.${next.visibility}`) });
      if (!diff.length) no('that detail already says this; nothing would change');
      return {
        kind: 'update-field', summary: c('chat.sum.updateField', { field: typeName, name: fullName(p) }), diff, editable: [],
        args: { person: p.id, field: cur.id, type: cur.type, label: next.label, value: next.value, visibility: next.visibility, before: { label: cur.label, value: cur.value, visibility: cur.visibility } },
      };
    },
  },
  {
    kind: 'remove-field', action: 'edit-person',
    spec: { name: 'propose_remove_field', description: 'Propose removing one detail from a person. Use the field id from read_person.', parameters: object({ person: idParam, field: { type: 'string' } }, ['person', 'field']) },
    run: async (env, input) => {
      const { c, ctx } = env;
      const a = z.object({ person: idText, field: idText }).parse(input);
      const p = who(env, a.person);
      const cur = (await fieldsOf(env, p.id)).find((f) => f.id === a.field) ?? no('that detail is not on this person; read_person lists the ids');
      if (isContactType(cur.type) && !can(ctx.role, 'edit-contact')) no('this reader may not change contact details');
      const typeName = c(`type.${cur.type}` as Key);
      return { kind: 'remove-field', removal: true, summary: c('chat.sum.removeField', { field: typeName, name: fullName(p) }), editable: [], diff: [removedRow(c, typeName, showValue(cur.value))], args: { person: p.id, field: cur.id } };
    },
  },
  {
    kind: 'remove-story', action: 'edit-person',
    spec: { name: 'propose_remove_story', description: 'Propose removing one story from a person. Use the story id from read_person.', parameters: object({ person: idParam, story: { type: 'string' } }, ['person', 'story']) },
    run: async (env, input) => {
      const { c, ctx } = env;
      const a = z.object({ person: idText, story: idText }).parse(input);
      const p = who(env, a.person);
      const story = (await person(ctx.tree, p.id, assistantAudience(ctx.role))).stories.find((s) => s.id === a.story) ?? no('that story is not on this person; read_person lists the ids');
      return { kind: 'remove-story', removal: true, summary: c('chat.sum.removeStory', { name: fullName(p) }), editable: [], diff: [removedRow(c, c('ai.fieldStory'), clip(story.title || story.body, 160))], args: { person: p.id, story: story.id } };
    },
  },
  {
    kind: 'unlink', action: 'edit-person',
    spec: {
      name: 'propose_unlink',
      description: 'Propose removing a link between two people: relative is this to person (parent, child or partner). Both people stay in the tree. A sibling link is not stored, so unlink the shared parent instead.',
      parameters: object({ person: idParam, relative: idParam, relation: { type: 'string', enum: ['parent', 'child', 'partner'] } }, ['person', 'relative', 'relation']),
    },
    run: (env, input) => {
      const { c, g } = env;
      const a = z.object({ person: idText, relative: idText, relation: z.enum(['parent', 'child', 'partner']) }).parse(input);
      who(env, a.person);
      who(env, a.relative);
      const label = c(a.relation === 'parent' ? 'ai.relParent' : a.relation === 'child' ? 'ai.relChild' : 'ai.relPartner');
      const text = `${named(env, a.relative)}: ${label} ${named(env, a.person)}`;
      const base = { kind: 'unlink' as const, removal: true, editable: [], summary: c('chat.sum.unlink', { a: named(env, a.person), b: named(env, a.relative) }), diff: [removedRow(c, c('ai.fieldRelation'), text)] };
      if (a.relation === 'partner') {
        const u = g.unions.find((x) => (x.a === a.person && x.b === a.relative) || (x.b === a.person && x.a === a.relative)) ?? no('those two are not recorded as partners');
        return { ...base, args: { person: a.person, relative: a.relative, relation: a.relation, parents: [], partnership: u.id } };
      }
      const edge = a.relation === 'parent' ? { child: a.person, parent: a.relative } : { child: a.relative, parent: a.person };
      if (!g.parents.some((e) => e.child === edge.child && e.parent === edge.parent)) no('that parent link is not recorded');
      return { ...base, args: { person: a.person, relative: a.relative, relation: a.relation, parents: [edge] } as ProposalArgs };
    },
  },
  {
    kind: 'partnership', action: 'edit-person',
    spec: {
      name: 'propose_partnership',
      description: 'Propose the kind, start date or place of a couple already linked. Use the partnership id from relatives. To end a marriage use propose_partnership_end.',
      parameters: object({ partnership: { type: 'string' }, kind: { type: 'string', enum: ['marriage', 'partnership', 'other'] }, start: date, place: { type: 'string' }, clear: clearOf(['start', 'place']) }, ['partnership']),
    },
    run: (env, input) => {
      const { c } = env;
      const a = z.object({ partnership: idText, kind: z.enum(['marriage', 'partnership', 'other']).optional(), start: z.string().trim().max(11).optional(), place: z.string().trim().min(1).max(200).optional(), clear: z.array(z.enum(['start', 'place'])).optional() }).parse(input);
      const u = findUnion(env, a.partnership);
      check(a.start, 'start');
      const clearing = new Set(a.clear ?? []);
      const next = { kind: a.kind ?? u.kind, start: clearing.has('start') ? null : a.start ?? u.start ?? null, place: clearing.has('place') ? null : a.place ?? u.place ?? null };
      const diff: Proposal['diff'] = [];
      if (next.kind !== u.kind) diff.push({ label: c('chat.field.unionKind'), from: unionKind(c, u.kind), to: unionKind(c, next.kind) });
      for (const [key, label] of [['start', c('chat.field.unionStart')], ['place', c('ai.fieldPlace')]] as const) {
        const was = u[key] ?? null;
        if (was === next[key]) continue;
        diff.push(next[key] === null ? removedRow(c, label, String(was)) : { label, from: none(c, was), to: String(next[key]) });
      }
      if (!diff.length) no('that is already recorded; nothing would change');
      return { kind: 'partnership', summary: c('chat.sum.partnership', { couple: coupleOf(env, u) }), diff, editable: [], args: { partnership: u.id, ...next } };
    },
  },
  {
    kind: 'partnership-end', action: 'edit-person',
    spec: {
      name: 'propose_partnership_end',
      description: 'Propose when and why a couple ended, or reopen it with clear. Use the partnership id from relatives. Both people stay linked.',
      parameters: object({ partnership: { type: 'string' }, end: date, reason: { type: 'string', enum: ['divorce', 'death', 'other'] }, clear: { type: 'boolean', description: 'True removes the end date and its reason.' } }, ['partnership']),
    },
    run: (env, input) => {
      const { c } = env;
      const a = z.object({ partnership: idText, end: z.string().trim().max(11).optional(), reason: z.enum(['divorce', 'death', 'other']).optional(), clear: z.boolean().optional() }).parse(input);
      const u = findUnion(env, a.partnership);
      check(a.end, 'end');
      if (!a.clear && !a.end && !u.end) no('give the date it ended; without one the reason cannot be kept');
      if (a.clear && !u.end) no('that partnership has no end recorded');
      const end = a.clear ? null : a.end ?? u.end ?? null;
      const endReason = end ? a.reason ?? (u.endReason as 'divorce' | 'death' | 'other' | undefined) ?? null : null;
      const reasonName = (r: string | null | undefined) => (r === 'divorce' ? c('chat.end.divorce') : r === 'death' ? c('chat.end.death') : r === 'other' ? c('chat.end.other') : c('ai.fieldNone'));
      const diff: Proposal['diff'] = end === null
        ? [removedRow(c, c('chat.field.unionEnd'), String(u.end))]
        : [{ label: c('chat.field.unionEnd'), from: none(c, u.end), to: end }, { label: c('chat.field.endReason'), from: reasonName(u.endReason), to: reasonName(endReason) }];
      return { kind: 'partnership-end', summary: c('chat.sum.partnershipEnd', { couple: coupleOf(env, u) }), diff, editable: [], args: { partnership: u.id, end, endReason }, ...(end === null && { removal: true }) };
    },
  },
  {
    kind: 'remove-person', action: 'remove-person',
    spec: { name: 'propose_remove_person', description: 'Propose taking someone out of the tree, with their links, stories and details. It cannot be undone. Only when the reader clearly asks for it and you are sure who is meant.', parameters: object({ person: idParam }, ['person']) },
    run: (env, input) => {
      const { c, g } = env;
      const a = z.object({ person: idText }).parse(input);
      const p = who(env, a.person);
      if (g.people.length <= 1) no('the last person cannot be removed');
      const links = g.parents.filter((e) => e.child === p.id || e.parent === p.id).length + g.unions.filter((u) => u.a === p.id || u.b === p.id).length;
      return {
        kind: 'remove-person', removal: true, editable: [], args: { person: p.id },
        summary: c('chat.sum.removePerson', { name: fullName(p) }),
        diff: [removedRow(c, c('ai.fieldName'), fullName(p)), { label: c('chat.field.goesWith'), to: c('chat.removeCounts', { links, stories: p.stories }), removed: true }],
      };
    },
  },
  {
    kind: 'house-details', action: 'edit-house',
    spec: { name: 'propose_house_details', description: 'Propose a house’s name or motto (the words on its arms). Only stewards. Use list_houses first. The drawing of the arms itself is made in the arms designer.', parameters: object({ house: idParam, name: { type: 'string' }, motto: { type: 'string' }, clearMotto: { type: 'boolean' } }, ['house']) },
    run: (env, input) => {
      const { c } = env;
      const a = z.object({ house: idText, name: z.string().trim().min(1).max(80).optional(), motto: z.string().trim().min(1).max(160).optional(), clearMotto: z.boolean().optional() }).parse(input);
      const h = findHouse(env, a.house);
      const name = a.name ?? h.name;
      const motto = a.clearMotto ? null : a.motto ?? h.motto ?? null;
      const diff: Proposal['diff'] = [];
      if (name !== h.name) diff.push({ label: c('ai.fieldName'), from: h.name, to: name });
      if (motto !== (h.motto ?? null)) diff.push(motto === null ? removedRow(c, c('chat.field.motto'), String(h.motto)) : { label: c('chat.field.motto'), from: none(c, h.motto), to: motto });
      if (!diff.length) no('that is already recorded; nothing would change');
      return { kind: 'house-details', summary: c('chat.sum.houseDetails', { house: h.name }), diff, editable: [], args: { house: h.id, name, motto, before: { name: h.name, motto: h.motto ?? null } } };
    },
  },
  {
    kind: 'house-words', action: 'edit-house',
    spec: { name: 'propose_house_words', description: 'Propose the family’s own words about what a house’s name means, shown with its arms. Needs a saved meaning on the house.', parameters: object({ house: idParam, words: { type: 'string', description: 'At most 200 characters. Empty removes them.' } }, ['house', 'words']) },
    run: async (env, input) => {
      const { c, ctx } = env;
      const a = z.object({ house: idText, words: z.string().trim().max(200) }).parse(input);
      const h = findHouse(env, a.house);
      const saved = (await readMeanings(ctx.tree))[h.id] ?? no('this house has no saved name meaning yet; the steward starts that on the house page');
      if (saved.familyWords === a.words) no('that is already recorded; nothing would change');
      return {
        kind: 'house-words', summary: c('chat.sum.houseWords', { house: h.name }), editable: [], args: { house: h.id, familyWords: a.words },
        diff: [a.words ? { label: c('chat.field.familyWords'), from: none(c, saved.familyWords), to: a.words } : removedRow(c, c('chat.field.familyWords'), saved.familyWords)],
        ...(!a.words && { removal: true }),
      };
    },
  },
  {
    kind: 'house-create', action: 'edit-house',
    spec: { name: 'propose_house_create', description: 'Propose a new house with a name, and optionally a motto and a two-letter country code.', parameters: object({ name: { type: 'string' }, motto: { type: 'string' }, country: { type: 'string', description: 'Two capital letters, e.g. DE.' } }, ['name']) },
    run: (env, input) => {
      const { c, g } = env;
      const a = z.object({ name: z.string().trim().min(1).max(80), motto: z.string().trim().max(160).optional(), country: z.string().regex(/^[A-Z]{2}$/).optional() }).parse(input);
      if (g.houses.some((h) => h.name.toLowerCase() === a.name.toLowerCase())) no(`${a.name} is already a house here`);
      const diff: Proposal['diff'] = [{ label: c('ai.fieldName'), to: a.name }];
      if (a.motto) diff.push({ label: c('chat.field.motto'), to: a.motto });
      if (a.country) diff.push({ label: c('ai.fieldCountry'), to: a.country });
      return { kind: 'house-create', summary: c('chat.sum.houseCreate', { house: a.name }), diff, editable: [], args: { name: a.name, motto: a.motto || null, country: a.country ?? null } };
    },
  },
  {
    kind: 'house-members', action: 'edit-house',
    spec: { name: 'propose_house_members', description: 'Propose who joins or leaves a house.', parameters: object({ house: idParam, add: { type: 'array', maxItems: 40, items: idParam }, remove: { type: 'array', maxItems: 40, items: idParam } }, ['house']) },
    run: (env, input) => {
      const { c } = env;
      const a = z.object({ house: idText, add: z.array(idText).max(40).default([]), remove: z.array(idText).max(40).default([]) }).parse(input);
      const h = findHouse(env, a.house);
      if (!a.add.length && !a.remove.length) no('say who joins or leaves');
      for (const id of a.add) if (who(env, id).house === h.id) no(`${named(env, id)} is already in ${h.name}`);
      for (const id of a.remove) if (who(env, id).house !== h.id) no(`${named(env, id)} is not in ${h.name}`);
      const diff: Proposal['diff'] = [
        ...(a.add.length ? [{ label: c('chat.field.joins'), to: a.add.map((x) => named(env, x)).join(', ') }] : []),
        ...(a.remove.length ? [removedRow(c, c('chat.field.leaves'), a.remove.map((x) => named(env, x)).join(', '))] : []),
      ];
      return { kind: 'house-members', summary: c('chat.sum.houseMembers', { house: h.name }), diff, editable: [], args: { house: h.id, add: a.add, remove: a.remove }, ...(!a.add.length && { removal: true }) };
    },
  },
  {
    kind: 'album-rename', action: 'upload-photo',
    spec: { name: 'propose_album_rename', description: 'Propose a new name for an album. Album ids come from list_photos.', parameters: object({ album: { type: 'string' }, name: { type: 'string' } }, ['album', 'name']) },
    run: async (env, input) => {
      const { c, ctx } = env;
      const a = z.object({ album: idText, name: z.string().trim().min(1).max(80) }).parse(input);
      const cur = (await gallery(ctx.tree)).albums.find((x) => x.id === a.album) ?? no('that album is not in this family; list the albums first');
      if (cur.name === a.name) no('the album already has that name');
      return { kind: 'album-rename', summary: c('chat.sum.albumRename', { name: cur.name }), diff: [{ label: c('ai.fieldName'), from: cur.name, to: a.name }], editable: ['name'], args: { album: cur.id, name: a.name } };
    },
  },
  {
    kind: 'album-delete', action: 'delete-album',
    spec: { name: 'propose_album_delete', description: 'Propose deleting an album. Its photos stay, without an album. Only stewards.', parameters: object({ album: { type: 'string' } }, ['album']) },
    run: async (env, input) => {
      const { c, ctx } = env;
      const a = z.object({ album: idText }).parse(input);
      const cur = (await gallery(ctx.tree)).albums.find((x) => x.id === a.album) ?? no('that album is not in this family; list the albums first');
      return { kind: 'album-delete', removal: true, summary: c('chat.sum.albumDelete', { name: cur.name }), editable: [], diff: [removedRow(c, c('ai.fieldName'), cur.name)], args: { album: cur.id } };
    },
  },
  {
    kind: 'photo-remove', action: 'edit-person',
    spec: { name: 'propose_remove_photo', description: 'Propose removing a photo from the gallery. It cannot be undone.', parameters: object({ key: photoParam }, ['key']) },
    run: async (env, input) => {
      const { c } = env;
      const { key } = z.object({ key: z.string().min(3).max(200) }).parse(input);
      const cur = await photoOf(env, key);
      return { kind: 'photo-remove', removal: true, summary: c('chat.sum.photoRemove'), editable: [], diff: [removedRow(c, c('ai.fieldCaption'), none(c, cur.caption))], args: { key }, view: thumb(env, key) };
    },
  },
  {
    kind: 'photo-untag', action: 'upload-photo',
    spec: { name: 'propose_photo_untag', description: 'Propose taking a person’s tag off one photo.', parameters: object({ key: photoParam, person: idParam }, ['key', 'person']) },
    run: async (env, input) => {
      const { c } = env;
      const a = z.object({ key: z.string().min(3).max(200), person: idText }).parse(input);
      const cur = await photoOf(env, a.key);
      const tag = cur.tags.find((t) => t.person === a.person) ?? no('that person is not tagged in this photo');
      return { kind: 'photo-untag', removal: true, summary: c('chat.sum.photoUntag', { name: named(env, a.person) }), editable: [], diff: [removedRow(c, c('chat.field.tag'), named(env, a.person))], args: { key: a.key, tag: tag.id, person: a.person }, view: thumb(env, a.key) };
    },
  },
  {
    kind: 'person-display', action: 'edit-person',
    spec: { name: 'propose_person_display', description: 'Propose which face a person shows: their drawing, their photo, or their accepted painted portrait.', parameters: object({ person: idParam, display: { type: 'string', enum: ['drawing', 'photo', 'portrait'] } }, ['person', 'display']) },
    run: (env, input) => {
      const { c } = env;
      const a = z.object({ person: idText, display: z.enum(['drawing', 'photo', 'portrait']) }).parse(input);
      const p = who(env, a.person);
      if (a.display === 'portrait' && !p.portrait) no('this person has no accepted painted portrait');
      if (a.display === 'photo' && !p.photo) no('this person has no photo');
      const nowShown = p.preferAvatar ? 'drawing' : p.preferPortrait ? 'portrait' : 'photo';
      const name = (d: string) => c(d === 'drawing' ? 'chat.display.drawing' : d === 'portrait' ? 'chat.display.portrait' : 'chat.display.photo');
      return { kind: 'person-display', summary: c('chat.sum.personDisplay', { name: fullName(p) }), diff: [{ label: c('chat.field.display'), from: name(nowShown), to: name(a.display) }], editable: [], args: { person: p.id, display: a.display } };
    },
  },
  {
    kind: 'place-pin', action: 'edit-place',
    spec: { name: 'propose_place_pin', description: 'Propose putting a place on the family’s map. Kindred finds the coordinates from the place’s name; give lat and lng only if the reader stated them.', parameters: object({ name: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, ['name']) },
    run: async (env, input) => {
      const { c, ctx, g } = env;
      const a = z.object({ name: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }).parse(input);
      const given = a.lat !== undefined && a.lng !== undefined ? { lat: a.lat, lng: a.lng, country: undefined as string | undefined } : undefined;
      const hit = given ?? (await searchPlaces(ctx.tree, a.name, 8)).find((h) => h.lat !== undefined && h.lng !== undefined);
      if (!hit || hit.lat === undefined || hit.lng === undefined) return no('Kindred cannot find that place on its map; ask the reader to drop the pin in the Atlas');
      const had = g.places.find((p) => p.name === a.name);
      const at = (lat: number, lng: number) => `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
      return {
        kind: 'place-pin', summary: c('chat.sum.placePin', { name: a.name }), editable: [],
        diff: [{ label: c('ai.fieldPlace'), ...(had && { from: at(had.lat, had.lng) }), to: at(hit.lat, hit.lng) }],
        args: { name: a.name, lat: hit.lat, lng: hit.lng, ...(hit.country && { country: hit.country }), move: !!had },
      };
    },
  },
  {
    kind: 'research-project', action: 'add-research',
    spec: { name: 'propose_research_project', description: 'Propose a new research project, or a change to one (pass id from list_research). Only what you pass changes.', parameters: object({ id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, private: { type: 'boolean' } }, []) },
    run: async (env, input) => {
      const { c } = env;
      const a = z.object({ id: idText.optional(), title: z.string().trim().min(1).max(200).optional(), summary: z.string().trim().max(2000).optional(), private: z.boolean().optional() }).parse(input);
      mayBePrivate(env, a.private);
      if (!a.id) {
        if (!a.title) no('a new project needs a title');
        return { kind: 'research-project', summary: c('chat.sum.researchNew', { title: a.title! }), diff: [{ label: c('chat.field.researchTitle'), to: a.title! }, ...(a.summary ? [{ label: c('chat.field.summary'), to: clip(a.summary, 240) }] : [])], editable: ['title', 'summary'].filter((k) => (a as Record<string, unknown>)[k] !== undefined), args: { title: a.title!, summary: a.summary ?? '', private: a.private ?? false } };
      }
      const cur = await projectFor(env, a.id);
      mayChange(env, cur);
      const next = { title: a.title ?? cur.title, summary: a.summary ?? cur.summary, private: a.private ?? cur.private };
      const diff: Proposal['diff'] = [];
      if (next.title !== cur.title) diff.push({ label: c('chat.field.researchTitle'), from: cur.title, to: next.title });
      if (next.summary !== cur.summary) diff.push({ label: c('chat.field.summary'), from: none(c, clip(cur.summary, 160)), to: clip(next.summary, 240) });
      if (next.private !== cur.private) diff.push({ label: c('chat.field.private'), from: cur.private ? c('chat.yes') : c('chat.no'), to: next.private ? c('chat.yes') : c('chat.no') });
      if (!diff.length) no('that is already recorded; nothing would change');
      return { kind: 'research-project', summary: c('chat.sum.researchEdit', { title: cur.title }), diff, editable: [], args: { id: cur.id, ...next } };
    },
  },
  {
    kind: 'research-note', action: 'add-research',
    spec: { name: 'propose_research_note', description: 'Propose a new note on a research project, or a change to one (pass id from read_research). Only what you pass changes.', parameters: object({ project: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, date, private: { type: 'boolean' } }, ['project']) },
    run: async (env, input) => {
      const { c } = env;
      const a = z.object({ project: idText, id: idText.optional(), title: z.string().trim().min(1).max(200).optional(), body: z.string().trim().min(1).max(20_000).optional(), date: z.string().trim().max(11).optional(), private: z.boolean().optional() }).parse(input);
      check(a.date, 'date');
      mayBePrivate(env, a.private);
      const project = await projectFor(env, a.project);
      if (!a.id) {
        if (!a.title || !a.body) no('a new note needs a title and a body');
        return { kind: 'research-note', summary: c('chat.sum.noteNew', { title: project.title }), diff: [{ label: c('chat.field.researchTitle'), to: a.title! }, { label: c('chat.field.noteBody'), to: clip(a.body!, 240) }], editable: ['title', 'body'], args: { project: project.id, title: a.title!, body: a.body!, date: a.date ?? null, private: a.private ?? false } };
      }
      const cur = project.notes.find((n) => n.id === a.id) ?? no('that note is not on this project; read_research lists the ids');
      mayChange(env, cur);
      const next = { title: a.title ?? cur.title, body: a.body ?? cur.body, date: a.date ?? cur.date, private: a.private ?? cur.private };
      const diff: Proposal['diff'] = [];
      if (next.title !== cur.title) diff.push({ label: c('chat.field.researchTitle'), from: cur.title, to: next.title });
      if (next.body !== cur.body) diff.push({ label: c('chat.field.noteBody'), from: clip(cur.body, 160), to: clip(next.body, 240) });
      if (next.date !== cur.date) diff.push({ label: c('chat.field.date'), from: none(c, cur.date), to: none(c, next.date) });
      if (next.private !== cur.private) diff.push({ label: c('chat.field.private'), from: cur.private ? c('chat.yes') : c('chat.no'), to: next.private ? c('chat.yes') : c('chat.no') });
      if (!diff.length) no('that is already recorded; nothing would change');
      return { kind: 'research-note', summary: c('chat.sum.noteEdit', { title: cur.title }), diff, editable: [], args: { id: cur.id, project: project.id, ...next } };
    },
  },
  {
    kind: 'research-document', action: 'add-research',
    spec: { name: 'propose_research_document', description: 'Propose new details for a document on a research project: its title, date, source, notes. The file itself is uploaded on the research page.', parameters: object({ project: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, date, source: { type: 'string' }, notes: { type: 'string' }, private: { type: 'boolean' } }, ['project', 'id']) },
    run: async (env, input) => {
      const { c } = env;
      const a = z.object({ project: idText, id: idText, title: z.string().trim().min(1).max(200).optional(), date: z.string().trim().max(11).optional(), source: z.string().trim().max(300).optional(), notes: z.string().trim().max(4000).optional(), private: z.boolean().optional() }).parse(input);
      check(a.date, 'date');
      mayBePrivate(env, a.private);
      const project = await projectFor(env, a.project);
      const cur = project.documents.find((d) => d.id === a.id) ?? no('that document is not on this project; read_research lists the ids');
      mayChange(env, cur);
      const next = { title: a.title ?? cur.title, date: a.date ?? cur.date, source: a.source ?? cur.source, notes: a.notes ?? cur.notes, private: a.private ?? cur.private };
      const diff: Proposal['diff'] = [];
      const row = (label: string, was: unknown, to: unknown) => { if (was !== to) diff.push({ label, from: none(c, was), to: none(c, to) }); };
      row(c('chat.field.researchTitle'), cur.title, next.title);
      row(c('chat.field.date'), cur.date, next.date);
      row(c('chat.field.source'), cur.source, next.source);
      row(c('chat.field.noteBody'), cur.notes, next.notes);
      if (next.private !== cur.private) diff.push({ label: c('chat.field.private'), from: cur.private ? c('chat.yes') : c('chat.no'), to: next.private ? c('chat.yes') : c('chat.no') });
      if (!diff.length) no('that is already recorded; nothing would change');
      return { kind: 'research-document', summary: c('chat.sum.documentEdit', { title: cur.title }), diff, editable: [], args: { id: cur.id, ...next } };
    },
  },
  {
    kind: 'research-link', action: 'add-research',
    spec: { name: 'propose_research_link', description: 'Propose linking a person, place or photo to a research project, or removing that link with remove. target is a person id, a place name or a photo key.', parameters: object({ project: { type: 'string' }, kind: { type: 'string', enum: ['person', 'place', 'picture'] }, target: { type: 'string' }, remove: { type: 'boolean' } }, ['project', 'kind', 'target']) },
    run: async (env, input) => {
      const { c } = env;
      const a = z.object({ project: idText, kind: z.enum(['person', 'place', 'picture']), target: z.string().min(1).max(250), remove: z.boolean().optional() }).parse(input);
      const project = await projectFor(env, a.project);
      if (a.kind === 'person') who(env, a.target);
      if (a.kind === 'picture') await photoOf(env, a.target);
      if (a.kind === 'place' && !a.remove && !env.g.places.some((p) => p.name === a.target)) no('that place has no pin on the map yet; propose_place_pin comes first');
      const shown = a.kind === 'person' ? named(env, a.target) : a.target;
      const has = a.kind === 'person' ? project.people.some((p) => p.person === a.target) : a.kind === 'place' ? project.places.some((p) => p.place === a.target) : project.pictures.some((p) => p.key === a.target);
      if (a.remove && !has) no('that link is not on this project');
      if (!a.remove && has) no('that link is already on this project');
      const label = c(a.kind === 'person' ? 'ai.fieldName' : a.kind === 'place' ? 'ai.fieldPlace' : 'chat.field.picture');
      return {
        kind: 'research-link', editable: [], args: { project: project.id, kind: a.kind, target: a.target, remove: !!a.remove },
        summary: c(a.remove ? 'chat.sum.linkRemove' : 'chat.sum.linkAdd', { title: project.title }),
        diff: [a.remove ? removedRow(c, label, shown) : { label, to: shown }],
        ...(a.remove && { removal: true }),
        ...(a.kind === 'picture' && { view: thumb(env, a.target) }),
      };
    },
  },
  {
    kind: 'research-remove', action: 'add-research',
    spec: { name: 'propose_remove_research', description: 'Propose removing a research project, or a note or document on one. Ids come from list_research and read_research.', parameters: object({ what: { type: 'string', enum: ['project', 'note', 'document'] }, project: { type: 'string' }, id: { type: 'string', description: 'The note or document id; leave out for a project.' } }, ['what', 'project']) },
    run: async (env, input) => {
      const { c } = env;
      const a = z.object({ what: z.enum(['project', 'note', 'document']), project: idText, id: idText.optional() }).parse(input);
      const project = await projectFor(env, a.project);
      const thing = a.what === 'project' ? project : a.what === 'note' ? project.notes.find((n) => n.id === a.id) : project.documents.find((d) => d.id === a.id);
      if (!thing) return no('that is not on this project; read_research lists the ids');
      mayChange(env, thing);
      return {
        kind: 'research-remove', removal: true, editable: [],
        args: { what: a.what, id: thing.id, ...(a.what === 'note' && { project: project.id }) },
        summary: c(a.what === 'project' ? 'chat.sum.removeProject' : a.what === 'note' ? 'chat.sum.removeNote' : 'chat.sum.removeDocument', { title: project.title }),
        diff: [removedRow(c, c('chat.field.researchTitle'), thing.title)],
      };
    },
  },
  {
    kind: 'family-details', action: 'manage-access',
    spec: { name: 'propose_family_details', description: 'Propose the family’s name or tagline, as the whole app shows them. Only stewards.', parameters: object({ name: { type: 'string' }, tagline: { type: 'string', description: 'One line. Empty removes it.' } }, []) },
    run: (env, input) => {
      const { c, g } = env;
      const a = z.object({ name: z.string().max(400).optional(), tagline: z.string().max(400).optional() }).parse(input);
      let clean: { name: string; tagline: string };
      try {
        clean = cleanFamilyDetails({ name: a.name ?? g.tree.name, tagline: a.tagline ?? g.tree.tagline ?? '' });
      } catch {
        return no('that name or tagline is empty or too long');
      }
      const diff: Proposal['diff'] = [];
      if (clean.name !== g.tree.name) diff.push({ label: c('ai.fieldName'), from: g.tree.name, to: clean.name });
      const was = g.tree.tagline ?? '';
      if (clean.tagline !== was) diff.push(clean.tagline ? { label: c('chat.field.tagline'), from: none(c, was), to: clean.tagline } : removedRow(c, c('chat.field.tagline'), was));
      if (!diff.length) no('that is already recorded; nothing would change');
      return { kind: 'family-details', summary: c('chat.sum.familyDetails'), diff, editable: ['name', 'tagline'].filter((k) => (a as Record<string, unknown>)[k] !== undefined), args: clean };
    },
  },
];

const refusedText = (e: Refused) => JSON.stringify({ error: e.message });

/** Runs one edit tool: checks it and adds its card. Returns the text the model sees. */
export async function runEdit(env: EditEnv, edit: Edit, input: unknown, out: Proposal[]): Promise<string> {
  try {
    out.push({ id: crypto.randomUUID(), status: 'open', ...(await edit.run(env, input)) });
    return JSON.stringify({ proposed: true, kind: edit.kind, note: 'Shown to the reader for approval. Nothing is saved yet.' });
  } catch (e) {
    if (e instanceof Refused) return refusedText(e);
    throw e;
  }
}

/** Research the model may read: the family's projects as this reader may see them. */
export async function researchList(ctx: Ctx) {
  const list = await listProjects(ctx.tree, whoAmI(ctx));
  return { projects: list.slice(0, 30).map((p) => ({ id: p.id, title: p.title, summary: clip(p.summary, 240), private: p.private, mine: p.mine, counts: p.counts })), count: list.length };
}

/** One project, with the ids its notes, documents and links need. */
export async function researchRead(ctx: Ctx, byId: Map<string, GPerson>, id: string) {
  const v = await projectView(ctx.tree, id, whoAmI(ctx));
  if (!v) return { error: 'not a research project in this family' };
  return {
    id: v.id, title: v.title, summary: clip(v.summary, 800), private: v.private, mine: v.mine,
    notes: v.notes.slice(0, 20).map((n) => ({ id: n.id, title: n.title, body: clip(n.body, 500), date: n.date, private: n.private, mine: n.mine })),
    documents: v.documents.slice(0, 20).map((d) => ({ id: d.id, title: d.title, date: d.date, source: d.source, notes: clip(d.notes, 300), private: d.private, mine: d.mine })),
    people: v.people.slice(0, 30).map((p) => ({ id: p.person, name: byId.get(p.person) ? fullName(byId.get(p.person)!) : p.person })),
    places: v.places.slice(0, 30).map((p) => p.place),
    pictures: v.pictures.slice(0, 20).map((p) => ({ key: p.key, taken: p.taken, caption: p.caption })),
  };
}
