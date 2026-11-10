// The daily quiz, "Do you know your family?": one question a day, made from the family's own records. Pure and seeded:
// the same family, day and recent history always give the same question, on the server and in a test.
//
// What it promises:
// - It reads only the graph it is given. The server gives it the graph a viewer may read (PLAIN_MEMBER), so nothing an
//   editor or steward alone may see can become a question or a wrong answer.
// - A question never carries its answer: `question` is what a reader is sent, `answer` stays on the server until they
//   have answered. A portrait is asked without the person's id (the picture comes from its own address).
// - Nothing is asked about how or why somebody died, and no question is built from a lifespan.
// - A small family gets the kinds its records can carry, and null when they can carry none.
import { rng } from '../campaign/rng.ts';
import type { GPerson, Graph, House } from '../types.ts';

export const QUIZ_KINDS = ['shield', 'portrait', 'parents', 'birthplace', 'grandchild', 'order'] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

/** One choice: people (one, or a couple), a house, or a place as the family wrote it. */
export interface QuizOption { people?: string[]; house?: string; place?: string }

/** What a reader is shown. Never the answer. */
export interface QuizQuestion {
  kind: QuizKind;
  /** The person the question names: whose parents, whose birthplace, whose grandchild. */
  subject?: string;
  /** The shield to recognise. */
  arms?: House['arms'];
  /** True when the question shows a picture, fetched from the day's own address. */
  picture?: true;
  options: QuizOption[];
}

export interface DrawnQuiz {
  kind: QuizKind;
  /** The person or house the question is about: kept from being asked again soon, and linked from the answer. */
  about: string;
  question: QuizQuestion;
  /** The right choice: an option's number, or for `order` the options' numbers from the eldest to the youngest ("2,0,1"). */
  answer: string;
}

export interface QuizInput {
  graph: Graph;
  /** The family's id: the seed. */
  tree: string;
  /** The UTC day, "2026-11-10". */
  day: string;
  /** What the last days' questions were about, the latest first: not asked again while there is anyone else. */
  recent?: readonly string[];
  /** The kinds of the last days' questions, the latest first: yesterday's kind is tried last. */
  recentKinds?: readonly string[];
}

/** How many days a person or house rests after a question about them. */
export const REST_DAYS = 21;

const yearOf = (d?: string) => {
  const y = d ? parseInt(d.replace(/^~/, ''), 10) : NaN;
  return Number.isFinite(y) ? y : undefined;
};
const named = (p: GPerson) => p.given.trim().length > 0;
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

interface Ctx {
  people: GPerson[];
  byId: Map<string, GPerson>;
  parentsOf: Map<string, string[]>;
  childrenOf: Map<string, string[]>;
  partnersOf: Map<string, string[]>;
  houses: House[];
  random: () => number;
  rested: (id: string) => boolean;
  /** The first pass asks only about the rested; when no kind of question can, the second pass asks anyone. */
  strict: boolean;
  /** People the living still knew, or the far ancestors: which of the two today prefers. */
  near: (p: GPerson) => boolean;
  preferNear: boolean;
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}
function shuffled<T>(random: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Who a question is about, from those it could be about: someone who has rested, and on a "near" day someone the
 * living knew, on a "far" day an ancestor. The second wish gives way when it would leave nobody; the first only on
 * the second pass, when no kind of question found anyone rested.
 */
function subjectFrom<T>(c: Ctx, candidates: readonly T[], idOf: (t: T) => string, personOf?: (t: T) => GPerson | undefined): T | undefined {
  if (!candidates.length) return undefined;
  let pool = candidates.filter((t) => c.rested(idOf(t)));
  if (!pool.length) {
    if (c.strict) return undefined;
    pool = [...candidates];
  }
  if (personOf) {
    const wanted = pool.filter((t) => {
      const p = personOf(t);
      return !!p && c.near(p) === c.preferNear;
    });
    if (wanted.length) pool = wanted;
  }
  return pick(c.random, pool);
}

/** The `count` of `others` born nearest to `year`, then a seeded few of them: wrong answers that could be right. */
function nearest(c: Ctx, others: GPerson[], year: number | undefined, count: number): GPerson[] {
  const mixed = shuffled(c.random, others);
  if (year === undefined) return mixed.slice(0, count);
  const close = mixed
    .map((p) => ({ p, gap: Math.abs((yearOf(p.born) ?? year + 60) - year) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, Math.max(count * 3, 6))
    .map((x) => x.p);
  return shuffled(c.random, close).slice(0, count);
}

/** Puts the right option among the wrong ones, and says where it landed. */
function withOptions(c: Ctx, right: QuizOption, wrong: QuizOption[]): { options: QuizOption[]; answer: string } {
  const options = shuffled(c.random, [right, ...wrong]);
  return { options, answer: String(options.indexOf(right)) };
}

const MIN_WRONG = 2;
const MAX_WRONG = 3;

function shield(c: Ctx): DrawnQuiz | null {
  // A house told apart by its shield: two houses with the same arms are never offered together.
  const seen = new Set<string>();
  const distinct = c.houses.filter((h) => {
    const key = JSON.stringify(h.arms);
    if (!h.arms || !h.name.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (distinct.length < MIN_WRONG + 1) return null;
  const subject = subjectFrom(c, distinct, (h) => h.id);
  if (!subject) return null;
  const wrong = shuffled(c.random, distinct.filter((h) => h.id !== subject.id)).slice(0, MAX_WRONG);
  const { options, answer } = withOptions(c, { house: subject.id }, wrong.map((h) => ({ house: h.id })));
  return { kind: 'shield', about: subject.id, question: { kind: 'shield', arms: subject.arms, options }, answer };
}

/** Whose face may be asked: a photo the family shows its members, or the drawn portrait of someone who has died. */
export const facePictured = (p: GPerson) => !!p.photo && !p.preferAvatar;
const faceAskable = (p: GPerson) => named(p) && (facePictured(p) || !p.living);

function portrait(c: Ctx): DrawnQuiz | null {
  let faces = c.people.filter(faceAskable);
  // A family with photographs is asked about those: a drawing is only a stand-in.
  const photos = faces.filter(facePictured);
  if (photos.length >= MIN_WRONG + 2) faces = photos;
  const subject = subjectFrom(c, faces, (p) => p.id, (p) => p);
  if (!subject) return null;
  const alike = c.people.filter((p) => p.id !== subject.id && named(p) && (!subject.sex || !p.sex || p.sex === subject.sex));
  const wrong = nearest(c, alike, yearOf(subject.born), MAX_WRONG);
  if (wrong.length < MIN_WRONG) return null;
  const { options, answer } = withOptions(c, { people: [subject.id] }, wrong.map((p) => ({ people: [p.id] })));
  return { kind: 'portrait', about: subject.id, question: { kind: 'portrait', picture: true, options }, answer };
}

const coupleKey = (pair: readonly string[]) => [...pair].sort().join('\u0000');

function parents(c: Ctx): DrawnQuiz | null {
  const couples = new Map<string, string[]>();
  const withTwo: GPerson[] = [];
  for (const p of c.people) {
    const ps = (c.parentsOf.get(p.id) ?? []).filter((id) => c.byId.has(id) && named(c.byId.get(id)!));
    if (ps.length !== 2) continue;
    couples.set(coupleKey(ps), ps);
    if (named(p)) withTwo.push(p);
  }
  const subject = subjectFrom(c, withTwo, (p) => p.id, (p) => p);
  if (!subject) return null;
  const right = c.parentsOf.get(subject.id)!.filter((id) => c.byId.has(id));
  const year = yearOf(c.byId.get(right[0]!)?.born) ?? yearOf(c.byId.get(right[1]!)?.born);
  // Other couples of the family, with nobody in common with the right one and not the person themself.
  const others = [...couples.values()].filter((pair) => !pair.some((id) => right.includes(id) || id === subject.id));
  const gap = (pair: string[]) => (year === undefined ? 0 : Math.abs((yearOf(c.byId.get(pair[0]!)?.born) ?? yearOf(c.byId.get(pair[1]!)?.born) ?? year + 60) - year));
  const close = shuffled(c.random, others).sort((a, b) => gap(a) - gap(b)).slice(0, 8);
  const wrong = shuffled(c.random, close).slice(0, MAX_WRONG);
  if (wrong.length < MIN_WRONG) return null;
  const { options, answer } = withOptions(c, { people: right }, wrong.map((pair) => ({ people: pair })));
  return { kind: 'parents', about: subject.id, question: { kind: 'parents', subject: subject.id, options }, answer };
}

function birthplace(c: Ctx): DrawnQuiz | null {
  const placed = c.people.filter((p) => named(p) && !!p.bornPlace?.trim());
  const subject = subjectFrom(c, placed, (p) => p.id, (p) => p);
  if (!subject) return null;
  const right = subject.bornPlace!.trim();
  const rightKey = fold(right);
  // Other birthplaces of the family, none of them another way of writing the right one ("Kassel" and "Kassel, Hesse").
  const seen = new Set<string>([rightKey]);
  const places: string[] = [];
  for (const p of shuffled(c.random, placed)) {
    const place = p.bornPlace!.trim();
    const key = fold(place);
    if (!key || seen.has(key) || key.includes(rightKey) || rightKey.includes(key) || [...seen].some((s) => s !== rightKey && (s.includes(key) || key.includes(s)))) continue;
    seen.add(key);
    places.push(place);
  }
  const wrong = places.slice(0, MAX_WRONG);
  if (wrong.length < MIN_WRONG) return null;
  const { options, answer } = withOptions(c, { place: right }, wrong.map((place) => ({ place })));
  return { kind: 'birthplace', about: subject.id, question: { kind: 'birthplace', subject: subject.id, options }, answer };
}

function descendantsOf(c: Ctx, id: string): Set<string> {
  const out = new Set<string>();
  const todo = [id];
  while (todo.length) for (const child of c.childrenOf.get(todo.pop()!) ?? []) if (!out.has(child)) { out.add(child); todo.push(child); }
  return out;
}

function grandchild(c: Ctx): DrawnQuiz | null {
  const grandchildrenOf = (id: string) => [...new Set((c.childrenOf.get(id) ?? []).flatMap((child) => c.childrenOf.get(child) ?? []))].filter((g) => c.byId.has(g) && named(c.byId.get(g)!));
  const grandparents = c.people.filter((p) => named(p) && grandchildrenOf(p.id).length > 0);
  const subject = subjectFrom(c, grandparents, (p) => p.id, (p) => p);
  if (!subject) return null;
  const right = c.byId.get(pick(c.random, grandchildrenOf(subject.id)))!;
  // Not a descendant, not married to one, not the grandparent or their partner: nobody the answer could be argued for.
  const family = descendantsOf(c, subject.id);
  const barred = new Set<string>([subject.id, ...(c.partnersOf.get(subject.id) ?? []), ...family]);
  for (const id of family) for (const partner of c.partnersOf.get(id) ?? []) barred.add(partner);
  const wrong = nearest(c, c.people.filter((p) => named(p) && !barred.has(p.id)), yearOf(right.born), MAX_WRONG);
  if (wrong.length < MIN_WRONG) return null;
  const { options, answer } = withOptions(c, { people: [right.id] }, wrong.map((p) => ({ people: [p.id] })));
  return { kind: 'grandchild', about: subject.id, question: { kind: 'grandchild', subject: subject.id, options }, answer };
}

function order(c: Ctx): DrawnQuiz | null {
  // A birth year the family is sure of: an approximate one ("~1840") could make the right order the wrong one.
  const dated = c.people.filter((p) => named(p) && !!p.born && !p.born.startsWith('~') && yearOf(p.born) !== undefined);
  const first = subjectFrom(c, dated, (p) => p.id, (p) => p);
  if (!first) return null;
  const year = yearOf(first.born)!;
  const chosen = [first];
  const years = new Set([year]);
  // Two more, each born in a year of their own, within a lifetime of the first so that the order takes knowing.
  const others = shuffled(c.random, dated.filter((p) => p.id !== first.id));
  const within = (span: number) => {
    for (const p of others) {
      if (chosen.length === 3) return;
      const y = yearOf(p.born)!;
      if (years.has(y) || Math.abs(y - year) > span) continue;
      chosen.push(p);
      years.add(y);
    }
  };
  within(45);
  within(Infinity);
  if (chosen.length < 3) return null;
  const options = shuffled(c.random, chosen).map((p): QuizOption => ({ people: [p.id] }));
  const eldestFirst = options
    .map((o, i) => ({ i, born: c.byId.get(o.people![0]!)!.born! }))
    .sort((a, b) => yearOf(a.born)! - yearOf(b.born)!)
    .map((x) => x.i);
  return { kind: 'order', about: first.id, question: { kind: 'order', options }, answer: eldestFirst.join(',') };
}

const MAKERS: Record<QuizKind, (c: Ctx) => DrawnQuiz | null> = { shield, portrait, parents, birthplace, grandchild, order };

/** The day's question for a family, or null when its records cannot carry one yet. */
export function drawQuiz({ graph, tree, day, recent = [], recentKinds = [] }: QuizInput): DrawnQuiz | null {
  const random = rng(`${tree}:quiz:${day}`);
  const byId = new Map(graph.people.map((p) => [p.id, p]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const link of graph.parents) {
    // Step and foster parents are family, and not what "who were her parents?" asks.
    if (link.kind === 'step' || link.kind === 'foster' || !byId.has(link.child) || !byId.has(link.parent)) continue;
    parentsOf.set(link.child, [...(parentsOf.get(link.child) ?? []), link.parent]);
    childrenOf.set(link.parent, [...(childrenOf.get(link.parent) ?? []), link.child]);
  }
  const partnersOf = new Map<string, string[]>();
  for (const u of graph.unions) {
    partnersOf.set(u.a, [...(partnersOf.get(u.a) ?? []), u.b]);
    partnersOf.set(u.b, [...(partnersOf.get(u.b) ?? []), u.a]);
  }
  const thisYear = Number(day.slice(0, 4));
  const resting = new Set(recent.slice(0, REST_DAYS));
  // Sorted, so the draw does not depend on the order the database happened to return its rows in.
  const people = [...graph.people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const c: Ctx = {
    people,
    byId,
    parentsOf,
    childrenOf,
    partnersOf,
    houses: [...graph.houses].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    random,
    rested: (id) => !resting.has(id),
    strict: true,
    // Someone the living may have known: alive, born within a century, or gone within the last fifty years.
    near: (p) => p.living || (yearOf(p.born) ?? -Infinity) >= thisYear - 100 || (yearOf(p.died) ?? -Infinity) >= thisYear - 50,
    preferNear: random() < 0.5,
  };
  // A different kind from day to day: yesterday's is tried last, the day before's second to last.
  const lately = recentKinds.slice(0, 2);
  const kinds = shuffled(random, QUIZ_KINDS).sort((a, b) => rank(lately, a) - rank(lately, b));
  for (const strict of [true, false]) {
    c.strict = strict;
    for (const kind of kinds) {
      const drawn = MAKERS[kind](c);
      if (drawn) return drawn;
    }
  }
  return null;
}

/** 0 for a kind not asked lately, more for the more recent. */
const rank = (lately: readonly string[], kind: string) => {
  const at = lately.indexOf(kind);
  return at < 0 ? 0 : lately.length - at;
};

/** Whether a choice is one the question could have: an option's number, or for `order` each option once. */
export function validChoice(question: QuizQuestion, choice: string): boolean {
  const n = question.options.length;
  if (question.kind !== 'order') return /^\d$/.test(choice) && Number(choice) < n;
  const parts = choice.split(',');
  return parts.length === n && parts.every((p) => /^\d$/.test(p) && Number(p) < n) && new Set(parts).size === n;
}
