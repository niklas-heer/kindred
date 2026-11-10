// The assistant's proposals for life events, sources and citations. Like the others in edits.server.ts, each checks the change
// against the family as this reader may see it and describes it for a card; nothing is written here. Approving a card sends it
// to the same server functions the Edit tab and the Sources page use (events.functions.ts, sources.functions.ts), under the
// reader's own role, so validation, the change history and the retry key behave as for the forms (components/assistant/apply.ts).
//
// All of it needs `edit-person`, as the forms do. A source is cited by its id, or by the title of a source a card of the same
// reply adds: "she emigrated in 1952, according to the passenger list" is a source card and an event card that cites it. The
// event card is approved after the source card; until then it says so and writes nothing (lib/ai/life-apply.ts).
import { db } from '../db.server';
import { AFTER_DEATH, EVENT_LABEL, EVENT_TYPES, QUALITIES, QUALITY_LABEL, type EventType, type Fact, type LifeEvent, type Quality, type Source } from '../events';
import { eventOf, personEvents } from '../events.server';
import { listSources } from '../sources.server';
import { z } from 'zod';
import type { Proposal } from './types';
import type { Tr } from './labels';
import { check, clip, coupleOf, findUnion, named, no, none, object, removedRow, who, type Edit, type EditEnv, type Made } from './edits.server';

const idText = z.string().min(1).max(120);
/** A text the model may pass; an empty one clears that field on a change. */
const optional = (max: number) => z.string().trim().max(max).optional();
const dateText = z.string().trim().max(11).optional();
const date = { type: 'string', description: 'YYYY, YYYY-MM or YYYY-MM-DD, with a leading ~ for about. Never guess a date. An empty string removes it on a change.' };
const citeSpec = {
  type: 'object',
  description: 'Where this comes from, when the reader named a source or the tree records one. Never invent a source.',
  properties: {
    source: { type: 'string', description: 'A source id from list_sources or read_person.' },
    sourceTitle: { type: 'string', description: 'Instead of source: the exact title of a source you propose with propose_source in this same reply.' },
    page: { type: 'string', description: 'The page, entry or row within the source, if the reader said it.' },
    quality: { type: 'string', enum: [...QUALITIES], description: 'original: the record itself; derivative: a copy, an index or a transcription; unsure.' },
    transcription: { type: 'string', description: 'What the source says, in a line or two, only as the reader gave it.' },
  },
};
const citeInput = z.object({ source: idText.optional(), sourceTitle: z.string().trim().min(1).max(300).optional(), page: optional(300), quality: z.enum(QUALITIES).optional(), transcription: optional(4000) });

/** The reader as the event and source reads take them. The assistant answers members only, so an account is there. */
function reader(env: EditEnv) {
  if (!env.ctx.user) no('sources are for the family’s members');
  return { id: env.ctx.user!, name: '', role: env.ctx.role };
}
const sources = (env: EditEnv) => listSources(env.ctx.tree, reader(env));

/** An event's name in the reader's language: its type, and what exactly it was. */
export function eventName(c: Tr, e: { type: EventType; label: string | null }): string {
  const type = c(EVENT_LABEL[e.type]);
  return e.type === 'custom' ? e.label ?? type : e.label ? `${type} (${e.label})` : type;
}
const eventLine = (c: Tr, e: Pick<LifeEvent, 'type' | 'label' | 'date' | 'place'>) => [eventName(c, e), e.date, e.place].filter(Boolean).join(', ');
/** "Emigration of Ada Quill (1952)": an event as the fact a citation is about. */
const eventFact = (c: Tr, e: Pick<LifeEvent, 'type' | 'label' | 'date'>, name: string) => `${c('ailife.fact.event', { event: eventName(c, e), name })}${e.date ? ` (${e.date})` : ''}`;
const qualityName = (c: Tr, q: Quality | null | undefined) => (q ? c(QUALITY_LABEL[q]) : c('sources.quality.unknown'));

/** One event in this family, on a person this reader may see. */
async function eventById(env: EditEnv, id: string): Promise<LifeEvent> {
  const row = await db(env.ctx.tree).get<Parameters<typeof eventOf>[0]>('SELECT * FROM life_event WHERE id = ?', id);
  if (!row || !env.byId.has(row.person)) return no('that event is not in this family; read_person lists the event ids');
  return eventOf(row);
}

/** What a citation is about, in words: "Birth of Ida Fern", "Emigration of Olav Fern". */
async function factText(env: EditEnv, f: Fact): Promise<string> {
  const { c } = env;
  switch (f.fact) {
    case 'birth': case 'death': case 'name':
      return c(`ailife.fact.${f.fact}`, { name: named(env, f.person) });
    case 'event': {
      const e = await eventById(env, f.event);
      return eventFact(c, e, named(env, e.person));
    }
    case 'partnership':
      return c('ailife.fact.partnership', { couple: coupleOf(env, findUnion(env, f.partnership)) });
    case 'parent':
      if (!env.g.parents.some((e) => e.child === f.child && e.parent === f.parent)) no('that parent link is not recorded');
      return c('ailife.fact.parent', { child: named(env, f.child), parent: named(env, f.parent) });
  }
}

/**
 * The source a card cites: an existing one by id or by its exact title, or one a source card of this same reply adds. Returns
 * what the card's args keep and what it shows, and the card of the new source, if there is one.
 */
async function citedSource(env: EditEnv, a: { source?: string; sourceTitle?: string }): Promise<{ arg: { source: string } | { sourceTitle: string }; shown: string; card?: Proposal }> {
  if (a.source && a.sourceTitle) no('give either source or sourceTitle, not both');
  const list = await sources(env);
  if (a.source) {
    const s = list.find((x) => x.id === a.source) ?? no('that source is not in this family; list_sources gives the ids. Never invent a source.');
    return { arg: { source: s.id }, shown: s.title };
  }
  const title = (a.sourceTitle ?? '').trim();
  if (!title) return no('say which source: a source id, or the sourceTitle of a source you propose in this reply');
  const same = (t: unknown) => String(t).trim().toLowerCase() === title.toLowerCase();
  const existing = list.filter((x) => same(x.title));
  if (existing.length > 1) no('several sources have that title; pass the source id from list_sources');
  if (existing.length === 1) return { arg: { source: existing[0].id }, shown: existing[0].title };
  const card = env.out?.find((p) => p.kind === 'source' && !p.args.id && same(p.args.title));
  if (!card) return no('no source has that title. Call propose_source first in this same reply for a source the reader named, or cite one from list_sources. Never invent a source.');
  return { arg: { sourceTitle: String(card.args.title) }, shown: env.c('ailife.new_source', { title: String(card.args.title) }), card };
}

/** The rows a citation adds to a card: the source, and the page, quality and words when there are any. */
function citeRows(c: Tr, shown: string, x: { page?: string | null; quality?: Quality | null; transcription?: string }): Proposal['diff'] {
  return [
    { label: c('chat.field.source'), to: shown },
    ...(x.page ? [{ label: c('sources.field.page'), to: x.page }] : []),
    ...(x.quality ? [{ label: c('ailife.field.quality'), to: qualityName(c, x.quality) }] : []),
    ...(x.transcription ? [{ label: c('sources.field.transcription'), to: clip(x.transcription, 240) }] : []),
  ];
}

/** A new source card shows what it will be cited for, so the reader sees the two cards belong together. */
function noteCitedFor(env: EditEnv, card: Proposal | undefined, fact: string) {
  if (card) card.diff.push({ label: env.c('ailife.field.cited_for'), to: fact });
}

/** Text that a change sets: absent keeps what is there, an empty string clears it. */
const next = (given: string | undefined, was: string | null): string | null => (given === undefined ? was : given.trim() ? given.trim() : null);

const SOURCE_FIELDS = ['title', 'author', 'publication', 'reference', 'date', 'note'] as const;
const SOURCE_LABEL = { title: 'sources.field.title', author: 'sources.field.author', publication: 'sources.field.publication', reference: 'sources.field.reference', date: 'sources.field.date', note: 'sources.field.note' } as const;

export const LIFE_EDITS: Edit[] = [
  {
    kind: 'life-event', action: 'edit-person',
    spec: {
      name: 'propose_life_event',
      description: 'Propose adding a life event to a person (baptism, schooling, military service, a job, a move, emigration, burial…), or changing one (pass its id from read_person; only what you pass changes, an empty string removes a text). To say where it comes from, add cite. Use custom with a label for anything the list lacks.',
      parameters: object({
        person: { type: 'string', description: 'A person id, as the tools returned it.' },
        id: { type: 'string', description: 'An event id from read_person, to change that event.' },
        type: { type: 'string', enum: [...EVENT_TYPES] },
        label: { type: 'string', description: 'What exactly: a school, a regiment, a ship, a job. Required for custom.' },
        date, endDate: { ...date, description: `For something that lasted (schooling, service, a home): when it ended. ${date.description}` },
        place: { type: 'string', description: 'The place as the reader named it.' },
        note: { type: 'string' },
        cite: citeSpec,
      }, ['person']),
    },
    run: async (env, input): Promise<Made> => {
      const { c } = env;
      const a = z.object({
        person: idText, id: idText.optional(), type: z.enum(EVENT_TYPES).optional(), label: optional(200), date: dateText, endDate: dateText, place: optional(200), note: optional(4000), cite: citeInput.optional(),
      }).parse(input);
      const p = who(env, a.person);
      check(a.date, 'date');
      check(a.endDate, 'endDate');
      const events = await personEvents(env.ctx.tree, p.id, reader(env));
      const cur = a.id ? events.find((e) => e.id === a.id) ?? no('that event is not on this person; read_person lists the event ids') : null;
      if (!cur && !a.type) no('a new event needs a type');
      const ev = {
        type: (a.type ?? cur!.type) as EventType,
        label: next(a.label, cur?.label ?? null), date: next(a.date, cur?.date ?? null), endDate: next(a.endDate, cur?.endDate ?? null),
        place: next(a.place, cur?.place ?? null), note: next(a.note, cur?.note || null) ?? '',
      };
      if (ev.type === 'custom' && !ev.label) no('a custom event needs a label saying what it was');
      if (AFTER_DEATH.has(ev.type) && p.living) no(`a burial or cremation is only for someone who has died, and ${named(env, p.id)} is recorded as living`);
      if (ev.date && ev.endDate && ev.endDate.replace(/^~/, '') < ev.date.replace(/^~/, '')) no('the end date is before the start');
      if (!cur && events.length >= 200) no('this person already has the most events Kindred keeps');
      const diff: Proposal['diff'] = [];
      const rows: [string, string | null, string | null][] = [
        [c('ailife.field.event'), cur ? eventName(c, { type: cur.type, label: null }) : null, eventName(c, { type: ev.type, label: null })],
        [c('ailife.field.details'), cur?.label ?? null, ev.label],
        [c('chat.field.date'), cur?.date ?? null, ev.date],
        [c('ailife.field.until'), cur?.endDate ?? null, ev.endDate],
        [c('ai.fieldPlace'), cur?.place ?? null, ev.place],
        [c('sources.field.note'), cur?.note || null, ev.note || null],
      ];
      for (const [label, was, to] of rows) {
        if (!cur) { if (to) diff.push({ label, to: clip(to, 240) }); continue; }
        if (was === to) continue;
        diff.push(to === null ? removedRow(c, label, clip(String(was), 160)) : { label, from: none(c, was && clip(was, 160)), to: clip(to, 240) });
      }
      const cite = a.cite ? { ...(await citedSource(env, a.cite)), page: a.cite.page || null, quality: a.cite.quality ?? null, transcription: a.cite.transcription ?? '' } : null;
      if (cur && !diff.length && !cite) no('that is already recorded; nothing would change');
      if (cite) {
        diff.push(...citeRows(c, cite.shown, cite));
        noteCitedFor(env, cite.card, eventFact(c, ev, named(env, p.id)));
      }
      return {
        kind: 'life-event', editable: [],
        summary: c(cur ? 'ailife.sum.event_edit' : 'ailife.sum.event_new', { name: named(env, p.id) }),
        diff,
        args: {
          ...(cur && { id: cur.id }), person: p.id, type: ev.type, ...(ev.label && { label: ev.label }), date: ev.date, endDate: ev.endDate, place: ev.place, note: ev.note,
          ...(cur && { before: { type: cur.type, label: cur.label, date: cur.date, endDate: cur.endDate, place: cur.place, note: cur.note } }),
          ...(cite && { cite: { ...cite.arg, page: cite.page, quality: cite.quality, transcription: cite.transcription } }),
        },
      };
    },
  },
  {
    kind: 'source', action: 'edit-person',
    spec: {
      name: 'propose_source',
      description: 'Propose adding a source to the family’s list (a register, a passenger list, a certificate, a letter, a book, a web page), or changing one (pass its id from list_sources; only what you pass changes, an empty string removes a text). Only a source the reader named or showed: never invent a title, author or reference. To tie it to a fact, use cite on propose_life_event or propose_citation in the same reply, with this title as sourceTitle.',
      parameters: object({
        id: { type: 'string', description: 'A source id from list_sources, to change that source.' },
        title: { type: 'string', description: 'What the source is, as the reader named it, e.g. “Passenger list of the Gannet, 1952”.' },
        author: { type: 'string', description: 'Who made it, if the reader said.' },
        publication: { type: 'string', description: 'The archive that holds it or where it was published, if the reader said.' },
        reference: { type: 'string', description: 'A call number or a web address, if the reader gave one.' },
        date, note: { type: 'string' },
      }, []),
    },
    run: async (env, input): Promise<Made> => {
      const { c } = env;
      const a = z.object({ id: idText.optional(), title: optional(300), author: optional(200), publication: optional(300), reference: optional(500), date: dateText, note: optional(4000) }).parse(input);
      check(a.date, 'date');
      const list = await sources(env);
      const cur: Source | null = a.id ? list.find((s) => s.id === a.id) ?? no('that source is not in this family; list_sources gives the ids') : null;
      const title = next(a.title, cur?.title ?? null);
      if (!title) return no(cur ? 'a source cannot lose its title' : 'a new source needs a title');
      const clash = list.find((s) => s.id !== cur?.id && s.title.trim().toLowerCase() === title.toLowerCase());
      if (clash) no(`the family already has a source with that title (id ${clash.id}); cite that one, or give this one a title that tells them apart`);
      const was = { title: cur?.title ?? null, author: cur?.author ?? null, publication: cur?.publication ?? null, reference: cur?.reference ?? null, date: cur?.date ?? null, note: cur?.note || null };
      const now = { title, author: next(a.author, was.author), publication: next(a.publication, was.publication), reference: next(a.reference, was.reference), date: next(a.date, was.date), note: next(a.note, was.note) };
      const diff: Proposal['diff'] = [];
      for (const k of SOURCE_FIELDS) {
        const label = c(SOURCE_LABEL[k]);
        if (!cur) { if (now[k]) diff.push({ label, to: clip(now[k]!, 240) }); continue; }
        if (was[k] === now[k]) continue;
        diff.push(now[k] === null ? removedRow(c, label, clip(String(was[k]), 160)) : { label, from: none(c, was[k] && clip(was[k]!, 160)), to: clip(now[k]!, 240) });
      }
      if (cur && !diff.length) no('that is already recorded; nothing would change');
      return {
        kind: 'source', editable: [],
        summary: c(cur ? 'ailife.sum.source_edit' : 'ailife.sum.source_new', { title: cur?.title ?? title }),
        diff,
        args: {
          ...(cur && { id: cur.id }), ...now, note: now.note ?? '',
          ...(cur && { before: { title: cur.title, author: cur.author, publication: cur.publication, reference: cur.reference, date: cur.date, note: cur.note } }),
        },
      };
    },
  },
  {
    kind: 'citation', action: 'edit-person',
    spec: {
      name: 'propose_citation',
      description: 'Propose citing a source for a fact: a person’s birth, death or name (give person), a life event (event id from read_person), a partnership (partnership id from relatives) or a parent link (person is the child, parent the parent). Or change a citation (its id from read_person or read_source; then only source, page, quality and transcription change). Never invent a source.',
      parameters: object({
        id: { type: 'string', description: 'A citation id, to change that citation.' },
        source: citeSpec.properties.source, sourceTitle: citeSpec.properties.sourceTitle,
        fact: { type: 'string', enum: ['birth', 'death', 'name', 'event', 'partnership', 'parent'] },
        person: { type: 'string', description: 'For birth, death or name: the person. For parent: the child.' },
        parent: { type: 'string', description: 'For parent: the parent.' },
        event: { type: 'string', description: 'For event: the event id.' },
        partnership: { type: 'string', description: 'For partnership: the partnership id.' },
        page: citeSpec.properties.page, quality: citeSpec.properties.quality, transcription: citeSpec.properties.transcription,
      }, []),
    },
    run: async (env, input): Promise<Made> => {
      const { c } = env;
      const a = z.object({
        id: idText.optional(), source: idText.optional(), sourceTitle: z.string().trim().min(1).max(300).optional(),
        fact: z.enum(['birth', 'death', 'name', 'event', 'partnership', 'parent']).optional(), person: idText.optional(), parent: idText.optional(), event: idText.optional(), partnership: idText.optional(),
        page: optional(300), quality: z.enum(QUALITIES).optional(), transcription: optional(4000),
      }).parse(input);
      if (a.id) {
        const cur = await citationById(env, a.id);
        const src = a.source || a.sourceTitle ? await citedSource(env, a) : { arg: { source: cur.source }, shown: cur.title };
        const now = { page: next(a.page, cur.page), quality: a.quality ?? cur.quality, transcription: next(a.transcription, cur.transcription || null) ?? '' };
        const diff: Proposal['diff'] = [];
        if (!('source' in src.arg) || src.arg.source !== cur.source) diff.push({ label: c('chat.field.source'), from: cur.title, to: src.shown });
        if (now.page !== cur.page) diff.push(now.page === null ? removedRow(c, c('sources.field.page'), String(cur.page)) : { label: c('sources.field.page'), from: none(c, cur.page), to: now.page });
        if (now.quality !== cur.quality) diff.push({ label: c('ailife.field.quality'), from: qualityName(c, cur.quality), to: qualityName(c, now.quality) });
        if (now.transcription !== cur.transcription) diff.push(now.transcription ? { label: c('sources.field.transcription'), from: none(c, cur.transcription && clip(cur.transcription, 160)), to: clip(now.transcription, 240) } : removedRow(c, c('sources.field.transcription'), clip(cur.transcription, 160)));
        if (!diff.length) no('that is already recorded; nothing would change');
        const fact = await factText(env, cur.target);
        noteCitedFor(env, src.card, fact);
        return {
          kind: 'citation', editable: [], summary: c('ailife.sum.citation_edit', { title: cur.title }),
          diff: [{ label: c('ailife.field.fact'), to: fact }, ...diff],
          args: { id: cur.id, ...src.arg, target: cur.target, ...now, before: { source: cur.source, page: cur.page, quality: cur.quality, transcription: cur.transcription } },
        };
      }
      if (!a.fact) return no('say which fact the source is for');
      const target: Fact = a.fact === 'event' ? { fact: 'event', event: a.event ?? no('give the event id') }
        : a.fact === 'partnership' ? { fact: 'partnership', partnership: a.partnership ?? no('give the partnership id') }
        : a.fact === 'parent' ? { fact: 'parent', child: who(env, a.person ?? no('give the child as person')).id, parent: who(env, a.parent ?? no('give the parent')).id }
        : { fact: a.fact, person: who(env, a.person ?? no('give the person')).id };
      const fact = await factText(env, target);
      if (!a.source && !a.sourceTitle) no('say which source: a source id, or the sourceTitle of a source you propose in this reply');
      const src = await citedSource(env, a);
      if ('source' in src.arg) {
        const sourceId = src.arg.source;
        const already = await db(env.ctx.tree).get('SELECT id FROM citation WHERE source = ? AND fact = ? AND coalesce(person, \'\') = ? AND coalesce(parent, \'\') = ? AND coalesce(event, \'\') = ? AND coalesce(partnership, \'\') = ?',
          sourceId, target.fact, 'person' in target ? target.person : 'child' in target ? target.child : '', 'parent' in target ? target.parent : '', 'event' in target ? target.event : '', 'partnership' in target ? target.partnership : '');
        if (already) no('that source is already cited for that fact; change that citation instead');
      }
      const x = { page: a.page || null, quality: a.quality ?? null, transcription: a.transcription ?? '' };
      noteCitedFor(env, src.card, fact);
      return {
        kind: 'citation', editable: [], summary: c('ailife.sum.citation_new', { title: 'source' in src.arg ? src.shown : String(src.arg.sourceTitle) }),
        diff: [{ label: c('ailife.field.fact'), to: fact }, ...citeRows(c, src.shown, x)],
        args: { ...src.arg, target, ...x },
      };
    },
  },
  {
    kind: 'life-remove', action: 'edit-person',
    spec: {
      name: 'propose_remove_life_record',
      description: 'Propose removing a life event (the citations of it go with it), a source (with every citation of it) or one citation (the source stays). Ids from read_person, list_sources and read_source. Only when the reader asked for that removal.',
      parameters: object({ what: { type: 'string', enum: ['event', 'source', 'citation'] }, id: { type: 'string' } }, ['what', 'id']),
    },
    run: async (env, input): Promise<Made> => {
      const { c } = env;
      const a = z.object({ what: z.enum(['event', 'source', 'citation']), id: idText }).parse(input);
      const base = { kind: 'life-remove' as const, removal: true, editable: [] };
      if (a.what === 'event') {
        const e = await eventById(env, a.id);
        const n = (await db(env.ctx.tree).get<{ n: number }>('SELECT count(*) AS n FROM citation WHERE event = ?', e.id))?.n ?? 0;
        return {
          ...base, summary: c('ailife.sum.remove_event', { name: named(env, e.person) }), args: { what: 'event', id: e.id, person: e.person },
          diff: [removedRow(c, c('ailife.field.event'), eventLine(c, e)), ...(n ? [{ label: c('ailife.field.goes_with'), to: c('ailife.citations', { count: n }), removed: true }] : [])],
        };
      }
      if (a.what === 'source') {
        const s = (await sources(env)).find((x) => x.id === a.id) ?? no('that source is not in this family; list_sources gives the ids');
        return {
          ...base, summary: c('ailife.sum.remove_source', { title: s.title }), args: { what: 'source', id: s.id, citations: s.citations },
          diff: [removedRow(c, c('sources.field.title'), s.title), ...(s.citations ? [{ label: c('ailife.field.goes_with'), to: c('ailife.citations', { count: s.citations }), removed: true }] : [])],
        };
      }
      const cur = await citationById(env, a.id);
      return {
        ...base, summary: c('ailife.sum.remove_citation', { title: cur.title }), args: { what: 'citation', id: cur.id },
        diff: [removedRow(c, c('ailife.field.fact'), await factText(env, cur.target))],
      };
    },
  },
];

interface CitationRow { id: string; source: string; title: string; fact: Fact['fact']; person: string | null; parent: string | null; event: string | null; partnership: string | null; page: string | null; quality: Quality | null; transcription: string }

/** One citation in this family, about facts this reader may see. */
async function citationById(env: EditEnv, id: string) {
  const r = await db(env.ctx.tree).get<CitationRow>('SELECT c.*, s.title FROM citation c JOIN source s ON s.id = c.source WHERE c.id = ?', id);
  if (!r) return no('that citation is not in this family; read_person and read_source list the citation ids');
  const target: Fact = r.fact === 'event' ? { fact: 'event', event: r.event! } : r.fact === 'partnership' ? { fact: 'partnership', partnership: r.partnership! }
    : r.fact === 'parent' ? { fact: 'parent', child: r.person!, parent: r.parent! } : { fact: r.fact, person: r.person! };
  await factText(env, target); // refuses a fact about someone this reader may not see
  return { id: r.id, source: r.source, title: r.title, target, page: r.page, quality: r.quality, transcription: r.transcription };
}
