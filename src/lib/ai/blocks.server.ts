// Questions and widgets on the server. The model names only ids; what a reader sees in a widget is built here from the tree,
// through the same filter as the assistant's reads (assistantAudience), each time it is shown. So a widget cannot say anything
// the tree does not, and it follows the tree and the reader's role after it was first shown.
import { z } from 'zod';
import { db, graph, person } from '../db.server';
import { ancestorDepths, buildFamily, children, fullName, kinPath, kinship, parents, partnersOf, siblings, type Family, type Kinship } from '../graph';
import { gapsOf, DEFAULT_GAPS } from '../gaps';
import type { GPerson } from '../types';
import type { Role } from '../roles';
import { validDate } from '../dates';
import { assistantAudience, fieldsVisibleTo } from '../visibility';
import { accounts } from '../auth/store.server';
import type { ToolSpec } from './adapters';
import type { AnswerInput } from './blocks-input';
import { QUESTION_KINDS, WIDGET_ROWS, type ChatBlock, type DateRow, type PersonRef, type QuestionBlock, type TimelineEvent, type WidgetData, type WidgetSpec } from './blocks';

const idParam = { type: 'string', description: 'A person id, as the tools returned it.' };

export const ASK_TOOL: ToolSpec = {
  name: 'ask_reader',
  description: 'Show the reader a question card, when you cannot go on without their answer. Call it alone, once per reply, then stop: their answer comes as the next message. Kinds: single or multiple (give 2 to 6 options), person (optionally the likely people as ids), date (a partial date), text. The card always offers “something else”.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'One short question, in the reader’s language.' },
      kind: { type: 'string', enum: [...QUESTION_KINDS] },
      options: { type: 'array', maxItems: 6, items: { type: 'string' } },
      people: { type: 'array', maxItems: 8, items: idParam },
    },
    required: ['question', 'kind'],
  },
};

export const SHOW_TOOLS: ToolSpec[] = [
  { name: 'show_person', description: 'Show a card for one person: portrait, dates, and a link to their profile. Pass only the id, and do not repeat what it shows.', parameters: { type: 'object', properties: { person: idParam }, required: ['person'] } },
  { name: 'show_relationship', description: 'Show how two people are related, step by step.', parameters: { type: 'object', properties: { from: idParam, to: idParam }, required: ['from', 'to'] } },
  { name: 'show_family', description: 'Show a small family tree around one person: parents, partners, siblings, children.', parameters: { type: 'object', properties: { person: idParam }, required: ['person'] } },
  { name: 'show_timeline', description: 'Show the events of one person’s life in order.', parameters: { type: 'object', properties: { person: idParam }, required: ['person'] } },
  { name: 'show_dates', description: 'Show the coming birthdays and anniversaries of living people. days is how far ahead, default 30.', parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 366 } } } },
  { name: 'show_gaps', description: 'Show a checklist of what is still missing: for one person and their close relatives, or without a person for the family.', parameters: { type: 'object', properties: { person: idParam } } },
];
const SHOW_NAMES = new Set(SHOW_TOOLS.map((t) => t.name));
export const isBlockTool = (name: string) => name === ASK_TOOL.name || SHOW_NAMES.has(name);

/** The longest list one reply may show. */
const MAX_WIDGETS = 4;

const ref = (p: GPerson): PersonRef => ({ id: p.id, name: fullName(p), born: p.born, died: p.died, living: p.living });

function safeKin(f: Family, me: string | null, id: string, anc?: Map<string, number>): Kinship | undefined {
  if (!me || me === id || !f.byId.has(me)) return undefined;
  return kinship(f, me, id, anc);
}

const MDAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The next time a full date comes round, from `today` (UTC days). Null for a partial or approximate date. */
export function nextOccurrence(date: string | undefined, today: Date): { on: string; inDays: number; years: number } | null {
  const m = MDAY.exec(date ?? '');
  if (!m) return null;
  const y = today.getUTCFullYear();
  const start = Date.UTC(y, today.getUTCMonth(), today.getUTCDate());
  let at = Date.UTC(y, Number(m[2]) - 1, Number(m[3]));
  if (at < start) at = Date.UTC(y + 1, Number(m[2]) - 1, Number(m[3]));
  const when = new Date(at);
  return { on: when.toISOString().slice(0, 10), inDays: Math.round((at - start) / 86_400_000), years: when.getUTCFullYear() - Number(m[1]) };
}

/**
 * Builds what a widget shows, for one reader, from the tree as it is now. Null when the people it named are no longer there
 * (or this reader's view no longer holds them).
 */
export async function buildWidget(tree: string, role: Role, me: string | null, spec: WidgetSpec, now: Date = new Date()): Promise<WidgetData | null> {
  const audience = assistantAudience(role);
  const g = await graph(tree, audience);
  const f = buildFamily(g);
  const of = (id: string) => f.byId.get(id);
  const refs = (ids: string[]) => ids.flatMap((id) => (of(id) ? [ref(of(id)!)] : []));

  if (spec.kind === 'person') {
    const p = of(spec.person);
    if (!p) return null;
    const house = p.house ? f.house.get(p.house)?.name : undefined;
    return { kind: 'person', person: ref(p), occupation: p.occupation, bornPlace: p.bornPlace, diedPlace: p.diedPlace, title: p.title, house, kin: safeKin(f, me, p.id) };
  }
  if (spec.kind === 'path') {
    const from = of(spec.from), to = of(spec.to);
    if (!from || !to) return null;
    let steps: string[] = [];
    try {
      steps = kinPath(f, from.id, to.id);
    } catch {
      steps = [];
    }
    return { kind: 'path', from: ref(from), to: ref(to), steps: refs(steps), kin: safeKin(f, from.id, to.id) };
  }
  if (spec.kind === 'tree') {
    const p = of(spec.person);
    if (!p) return null;
    return { kind: 'tree', person: ref(p), parents: refs(parents(f, p.id)), partners: refs(partnersOf(f, p.id)), siblings: refs(siblings(f, p.id)).slice(0, WIDGET_ROWS), children: refs(children(f, p.id)).slice(0, WIDGET_ROWS) };
  }
  if (spec.kind === 'timeline') {
    const p = of(spec.person);
    if (!p) return null;
    const events: TimelineEvent[] = [];
    if (p.born) events.push({ date: p.born, kind: 'born', place: p.bornPlace });
    for (const u of f.unionsOf.get(p.id) ?? []) {
      const other = of(u.a === p.id ? u.b : u.a);
      if (u.start) events.push({ date: u.start, kind: u.kind === 'marriage' ? 'married' : 'partnered', place: u.place, other: other && ref(other) });
      if (u.end) events.push({ date: u.end, kind: 'ended', other: other && ref(other) });
    }
    for (const id of children(f, p.id)) {
      const child = of(id);
      if (child?.born) events.push({ date: child.born, kind: 'child', other: ref(child) });
    }
    const detail = await person(tree, p.id, audience);
    for (const x of detail.fields) {
      const from = x.value.from;
      if (!from) continue;
      if (x.type === 'occupation') events.push({ date: from, kind: 'job', text: [x.value.title, x.value.employer].filter(Boolean).join(', ') });
      else if (x.type === 'education') events.push({ date: from, kind: 'school', text: x.value.school, place: x.value.place || undefined });
      else if (x.type === 'military') events.push({ date: from, kind: 'service', text: [x.value.unit, x.value.rank].filter(Boolean).join(', ') });
    }
    if (p.died) events.push({ date: p.died, kind: 'died', place: p.diedPlace });
    const sortKey = (d: string) => d.replace(/^~/, '');
    events.sort((a, b) => (sortKey(a.date) < sortKey(b.date) ? -1 : sortKey(a.date) > sortKey(b.date) ? 1 : 0));
    return { kind: 'timeline', person: ref(p), events: events.slice(0, WIDGET_ROWS * 2) };
  }
  if (spec.kind === 'dates') {
    const rows: DateRow[] = [];
    const seen = fieldsVisibleTo(audience);
    for (const p of g.people) {
      if (!p.living || p.died) continue;
      const n = nextOccurrence(p.born, now);
      if (n && n.inDays <= spec.days) rows.push({ on: n.on, inDays: n.inDays, kind: 'birthday', who: ref(p), years: n.years });
    }
    for (const u of g.unions) {
      const a = of(u.a), b = of(u.b);
      if (!a || !b || u.end || !a.living || !b.living) continue;
      const n = nextOccurrence(u.start, now);
      if (n && n.inDays <= spec.days) rows.push({ on: n.on, inDays: n.inDays, kind: 'anniversary', who: ref(a), other: ref(b), years: n.years });
    }
    // An anniversary kept as a detail on one person, at the level this reader may see.
    const noted = await db(tree).all<{ person: string; value: string }>(`SELECT person, value FROM person_field WHERE type = 'dates' AND label = 'anniversary' AND ${seen.sql}`, ...seen.params);
    for (const r of noted) {
      const p = of(r.person);
      if (!p || !p.living) continue;
      const n = nextOccurrence((JSON.parse(r.value) as { date?: string }).date, now);
      if (n && n.inDays <= spec.days) rows.push({ on: n.on, inDays: n.inDays, kind: 'anniversary', who: ref(p), years: n.years });
    }
    rows.sort((x, y) => x.inDays - y.inDays || x.who.name.localeCompare(y.who.name));
    return { kind: 'dates', days: spec.days, rows: rows.slice(0, WIDGET_ROWS), more: Math.max(0, rows.length - WIDGET_ROWS) };
  }
  // gaps
  const wanted = new Set(DEFAULT_GAPS);
  if (spec.person) {
    if (!of(spec.person)) return null;
    const near = [...new Set([spec.person, ...parents(f, spec.person), ...children(f, spec.person), ...partnersOf(f, spec.person), ...siblings(f, spec.person)])];
    const rows = near.flatMap((id) => {
      const p = of(id);
      const gaps = p ? gapsOf(f, p, wanted) : [];
      return p && gaps.length ? [{ who: ref(p), gaps }] : [];
    });
    return { kind: 'gaps', rows: rows.slice(0, WIDGET_ROWS), more: Math.max(0, rows.length - WIDGET_ROWS) };
  }
  const rows = g.people
    .map((p) => ({ who: ref(p), gaps: gapsOf(f, p, wanted) }))
    .filter((r) => r.gaps.length)
    .sort((a, b) => b.gaps.length - a.gaps.length || a.who.name.localeCompare(b.who.name));
  return { kind: 'gaps', rows: rows.slice(0, WIDGET_ROWS), more: Math.max(0, rows.length - WIDGET_ROWS) };
}

const json = (v: unknown) => JSON.stringify(v);
const askInput = z.object({
  question: z.string().trim().min(3).max(240),
  kind: z.enum(QUESTION_KINDS),
  options: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  people: z.array(z.string().min(1).max(120)).max(8).optional(),
});

/** Adds a question or a widget to this reply. Returns the text the model sees. */
export async function runBlockTool(o: { tree: string; role: Role; me: string | null; blocks: ChatBlock[]; byId: Map<string, GPerson> }, name: string, input: unknown): Promise<string> {
  const known = (id: string) => o.byId.has(id);
  const missing = (id: string) => json({ error: `${id} is not a person in this tree; search for them first` });
  if (name === ASK_TOOL.name) {
    const a = askInput.parse(input);
    if (o.blocks.some((b) => b.type === 'question')) return json({ error: 'Only one question per reply. Wait for the answer.' });
    if ((a.kind === 'single' || a.kind === 'multiple') && new Set(a.options ?? []).size < 2) return json({ error: 'a choice needs at least two different options' });
    const unknown = (a.people ?? []).find((id) => !known(id));
    if (unknown) return missing(unknown);
    const block: QuestionBlock = {
      type: 'question', id: crypto.randomUUID(), kind: a.kind, question: a.question,
      ...((a.kind === 'single' || a.kind === 'multiple') && { options: [...new Set(a.options)] }),
      ...(a.kind === 'person' && a.people?.length && { people: a.people.map((id) => ({ id, name: fullName(o.byId.get(id)!) })) }),
    };
    o.blocks.push(block);
    return json({ asked: true, note: 'The card is shown. End your reply with at most one short sentence; their answer comes as the next message.' });
  }
  if (o.blocks.filter((b) => b.type === 'widget').length >= MAX_WIDGETS) return json({ error: `At most ${MAX_WIDGETS} widgets per reply.` });
  let spec: WidgetSpec;
  if (name === 'show_person') {
    spec = { kind: 'person', person: z.object({ person: z.string().min(1).max(120) }).parse(input).person };
    if (!known(spec.person)) return missing(spec.person);
  } else if (name === 'show_relationship') {
    const a = z.object({ from: z.string().min(1).max(120), to: z.string().min(1).max(120) }).parse(input);
    if (!known(a.from)) return missing(a.from);
    if (!known(a.to)) return missing(a.to);
    spec = { kind: 'path', from: a.from, to: a.to };
  } else if (name === 'show_family' || name === 'show_timeline') {
    const id = z.object({ person: z.string().min(1).max(120) }).parse(input).person;
    if (!known(id)) return missing(id);
    spec = { kind: name === 'show_family' ? 'tree' : 'timeline', person: id };
  } else if (name === 'show_dates') {
    spec = { kind: 'dates', days: z.object({ days: z.number().int().min(1).max(366).optional() }).parse(input).days ?? 30 };
  } else {
    const id = z.object({ person: z.string().min(1).max(120).optional() }).parse(input).person;
    if (id && !known(id)) return missing(id);
    spec = id ? { kind: 'gaps', person: id } : { kind: 'gaps' };
  }
  const same = JSON.stringify(spec);
  if (!o.blocks.some((b) => b.type === 'widget' && JSON.stringify(b.spec) === same)) o.blocks.push({ type: 'widget', id: crypto.randomUUID(), spec });
  return json({ shown: true, note: 'The reader sees this as a widget built from the tree. Add at most one short sentence, and do not repeat its contents.' });
}

/** What the model reads back about a reply's blocks in later turns: it is not told a widget's contents again. */
export function blocksNote(blocks: ChatBlock[] | undefined): string {
  const lines = (blocks ?? []).map((b) => {
    if (b.type === 'widget') return `[You showed a ${b.spec.kind} widget${'person' in b.spec && b.spec.person ? ` for ${b.spec.person}` : ''}.]`;
    return b.answer ? `[You asked: “${b.question}”. Answered: “${b.answer.text}”${b.answer.person ? ` (person id: ${b.answer.person})` : ''}.]` : `[You asked: “${b.question}”. Not answered yet.]`;
  });
  return lines.join('\n');
}

interface Row { id: string; role: string; conv: string; body: string; at: number }

/**
 * Records the reader's answer to a question card, once. The answer's words are returned for the browser to send as the next
 * message; the conditional write means two tabs, or a double tap, cannot both answer. An answer not in the card's choices
 * counts only as "something else" text, and a person must be one this reader's tree holds.
 */
export async function answerQuestion(o: { tree: string; user: string; role: Role; conv?: string; itemId: string; questionId: string; answer: AnswerInput; mayRead: (body: never, role: Role) => boolean }): Promise<{ text: string }> {
  const row = await accounts().get<Row>('SELECT id, role, conv, body, at FROM ai_chat WHERE id = ? AND tree = ? AND user = ?', o.itemId, o.tree, o.user);
  if (!row || (o.conv && row.conv !== o.conv)) throw new Error('chat.err.questionGone');
  const body = JSON.parse(row.body) as { blocks?: ChatBlock[] };
  if (!o.mayRead(body as never, o.role)) throw new Error('chat.err.questionGone');
  const blocks = body.blocks ?? [];
  const i = blocks.findIndex((b) => b.type === 'question' && b.id === o.questionId);
  if (i < 0) throw new Error('chat.err.questionGone');
  const q = blocks[i] as QuestionBlock;
  if (q.answer) throw new Error('chat.err.questionAnswered');
  const later = await accounts().get<{ id: string }>("SELECT id FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? AND role = 'user' AND rowid > (SELECT rowid FROM ai_chat WHERE id = ?) LIMIT 1", o.tree, o.user, row.conv, row.id);
  if (later) throw new Error('chat.err.questionStale');

  const a = o.answer;
  let text: string | undefined;
  let personId: string | undefined;
  if (a.text) text = a.text;
  else if (q.kind === 'single' || q.kind === 'multiple') {
    const picked = [...new Set(a.choices ?? [])];
    if (!picked.length || !picked.every((c) => q.options?.includes(c)) || (q.kind === 'single' && picked.length > 1)) throw new Error('chat.err.questionBad');
    text = picked.join(', ');
  } else if (q.kind === 'person') {
    if (!a.person) throw new Error('chat.err.questionBad');
    const g = await graph(o.tree, assistantAudience(o.role));
    const p = g.people.find((x) => x.id === a.person);
    if (!p) throw new Error('chat.err.questionBad');
    text = fullName(p);
    personId = p.id;
  } else if (q.kind === 'date') {
    if (!a.date || !validDate(a.date)) throw new Error('chat.err.questionBad');
    text = a.date;
  }
  if (!text) throw new Error('chat.err.questionBad');

  const at = `$.blocks[${i}].answer`;
  const done = await accounts().run(
    `UPDATE ai_chat SET body = json_set(body, '${at}', json(?)) WHERE id = ? AND json_extract(body, '${at}') IS NULL`,
    JSON.stringify({ text, at: Date.now(), ...(personId && { person: personId }) }), row.id,
  );
  if (done.changes !== 1) throw new Error('chat.err.questionAnswered');
  return { text };
}

/** Reads the widget stored on one of this reader's turns and builds it for them now. Null when it is gone or not theirs to read. */
export async function widgetFor(o: { tree: string; user: string; role: Role; me: string | null; conv?: string; itemId: string; blockId: string; mayRead: (body: never, role: Role) => boolean }): Promise<WidgetData | null> {
  const row = await accounts().get<Row>('SELECT id, role, conv, body, at FROM ai_chat WHERE id = ? AND tree = ? AND user = ?', o.itemId, o.tree, o.user);
  if (!row || (o.conv && row.conv !== o.conv)) return null;
  const body = JSON.parse(row.body) as { blocks?: ChatBlock[] };
  if (!o.mayRead(body as never, o.role)) return null;
  const block = body.blocks?.find((b) => b.id === o.blockId);
  if (!block || block.type !== 'widget') return null;
  return buildWidget(o.tree, o.role, o.me, block.spec);
}

/** Who "my aunt" is. Relations are stated from one person, by the same reckoning as the tree's kinship line. */
export const KIN_RELATIONS = ['parent', 'child', 'sibling', 'partner', 'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew', 'cousin', 'in_law', 'ancestor', 'descendant'] as const;
export type KinRelation = (typeof KIN_RELATIONS)[number];
const KIN_MATCH: Record<KinRelation, RegExp> = {
  parent: /^(adoptive )?(father|mother|parent)$/,
  child: /^(adopted )?(son|daughter|child)$/,
  sibling: /^(half-)?(brother|sister|sibling)$/,
  partner: /^(husband|wife|partner)$/,
  grandparent: /^grand(father|mother|parent)$/,
  grandchild: /^grand(son|daughter|child)$/,
  aunt_uncle: /^(half-)?(aunt|uncle|pibling)$|^(great-|\d+× great-)(half-)?(aunt|uncle|pibling)$/,
  niece_nephew: /^(half-)?(niece|nephew|nibling)$|^(great-|\d+× great-)(half-)?(niece|nephew|nibling)$/,
  // Anchored, so a tie through a marriage ("wife's first cousin") is an in-law, not a cousin or an ancestor.
  cousin: /^[^']*cousin[^']*$/,
  // Ties by marriage, step-grandparents and the far ones ("relative by marriage") included; a step-grandparent is no ancestor.
  in_law: /-in-law$|'s |^step-|^relative by marriage$/,
  ancestor: /^(?!step-)[^']*grand(father|mother|parent)$|^(adoptive )?(father|mother|parent)$/,
  descendant: /^(?!step-)[^']*grand(son|daughter|child)$|^(adopted )?(son|daughter|child)$/,
};

export const KIN_TOOL: ToolSpec = {
  name: 'find_relatives',
  description: 'Who someone’s relatives are by kind (aunt_uncle for “my aunt”, “Onkel”…). Without person it means the reader. Returns each with their id and exact relationship. At most 30.',
  parameters: { type: 'object', properties: { person: idParam, relation: { type: 'string', enum: [...KIN_RELATIONS] } }, required: ['relation'] },
};

export function findRelatives(f: Family, me: string | null, input: unknown) {
  const a = z.object({ person: z.string().min(1).max(120).optional(), relation: z.enum(KIN_RELATIONS) }).parse(input);
  const from = a.person ?? me;
  if (!from) return { error: 'The reader has not said who they are in this tree. Ask who is meant, or name a person.' };
  if (!f.byId.has(from)) return { error: 'not in this tree' };
  const anc = ancestorDepths(f, from);
  const match = KIN_MATCH[a.relation];
  const hits = f.graph.people.flatMap((p) => {
    const k = safeKin(f, from, p.id, anc);
    return k && match.test(k.label) ? [{ id: p.id, name: fullName(p), relation: k.label, born: p.born, died: p.died, living: p.living }] : [];
  });
  return { of: fullName(f.byId.get(from)!), relation: a.relation, people: hits.slice(0, 30), count: hits.length };
}
