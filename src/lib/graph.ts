// The in-browser family graph: lookups, kinship, and date helpers. Built once per Graph payload.
import { useSyncExternalStore } from 'react';
import type { GPerson, GUnion, Graph, House } from './types';
import { allGiven } from './further-given.ts';
import { locales, translate, type Locale } from './i18n/dictionary.ts';

export interface Family {
  graph: Graph;
  byId: Map<string, GPerson>;
  house: Map<string, House>;
  parentsOf: Map<string, string[]>;
  childrenOf: Map<string, string[]>;
  unionsOf: Map<string, GUnion[]>;
  disputed: Set<string>; // "child>parent" keys
  linkKind: Map<string, string>; // "child>parent" -> kind when not biological
}

export function buildFamily(graph: Graph): Family {
  const byId = new Map(graph.people.map((p) => [p.id, p]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const disputed = new Set<string>();
  const linkKind = new Map<string, string>();
  for (const r of graph.parents) {
    if (!byId.has(r.child) || !byId.has(r.parent)) continue;
    push(parentsOf, r.child, r.parent);
    push(childrenOf, r.parent, r.child);
    if (r.confidence !== 'certain') disputed.add(`${r.child}>${r.parent}`);
    if (r.kind !== 'biological') linkKind.set(`${r.child}>${r.parent}`, r.kind);
  }
  const unionsOf = new Map<string, GUnion[]>();
  for (const u of graph.unions) {
    push(unionsOf, u.a, u);
    push(unionsOf, u.b, u);
  }
  // Fathers first, then mothers; children oldest first.
  for (const ps of parentsOf.values()) ps.sort((a, b) => sexRank(byId.get(a)) - sexRank(byId.get(b)));
  for (const cs of childrenOf.values()) cs.sort((a, b) => yearOf(byId.get(a)?.born) - yearOf(byId.get(b)?.born));
  return { graph, byId, house: new Map(graph.houses.map((h) => [h.id, h])), parentsOf, childrenOf, unionsOf, disputed, linkKind };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}
const sexRank = (p?: GPerson) => (p?.sex === 'm' ? 0 : p?.sex === 'f' ? 1 : 2);

export const partnersOf = (f: Family, id: string) => (f.unionsOf.get(id) ?? []).map((u) => (u.a === id ? u.b : u.a));
/** A person's unions in the order their partners are shown: earliest first, undated last, then by id. */
export function sortedUnions(f: Family, id: string): GUnion[] {
  const key = (u: GUnion) => u.start?.replace(/^~/, '') ?? '9999';
  return [...(f.unionsOf.get(id) ?? [])].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}
/**
 * The members of a house: the people recorded as belonging to it. This is the one definition every count of a
 * house uses (its page, the houses list, the tree's banner and house menu). A wife or husband from another house
 * is drawn in the house's dynasty tree but is not a member of it.
 */
export const houseMembers = (f: Family, house: string) => f.graph.people.filter((p) => p.house === house);
export const parents = (f: Family, id: string) => f.parentsOf.get(id) ?? [];
export const children = (f: Family, id: string) => f.childrenOf.get(id) ?? [];
/** Same two recorded parents (a full sibling of whoever it is compared with). */
export function sameParents(f: Family, a: string, b: string): boolean {
  const pa = new Set(parents(f, a)), pb = parents(f, b);
  return pa.size === pb.length && pb.every((p) => pa.has(p));
}
export function siblings(f: Family, id: string): string[] {
  const out = new Set<string>();
  for (const p of parents(f, id)) for (const c of children(f, p)) if (c !== id) out.add(c);
  return [...out].sort((a, b) => yearOf(f.byId.get(a)?.born) - yearOf(f.byId.get(b)?.born));
}

// ---------- names and dates ----------

/**
 * The name a person goes by now: their current name where one is recorded, else the birth name. A null
 * current name means "same as birth", so it follows the birth name when that changes.
 */
export const nowNames = (p: GPerson): GPerson =>
  p.currentGiven === undefined && p.currentSurname === undefined ? p : { ...p, given: p.currentGiven ?? p.given, surname: p.currentSurname ?? p.surname };

/**
 * The whole name: every given name, then the surname. The further given names belong to the birth name, so they are
 * left out once a current given name is recorded. The tree card and the short forms (displayName) stay short.
 */
export const fullName = (p: GPerson) => {
  const n = nowNames(p);
  const given = p.currentGiven === undefined ? allGiven(n.given, p.furtherGiven) : n.given;
  return [given, n.surname].filter(Boolean).join(' ');
};
export function displayName(p: GPerson, f?: Family): string {
  const n = nowNames(p);
  if (n.title && /^(King|Queen|Duke|Duchess|Count|Countess|Prince|Princess|Bishop|Abbess|Abbot|Sir|Lady)\b/.test(n.title)) {
    const rank = n.title.split(' ')[0];
    return `${rank} ${n.given}${n.epithet ? ` ${n.epithet}` : ''}`;
  }
  const house = n.house && f?.house.get(n.house);
  const surname = n.surname ?? (house && !house.name.startsWith('House') ? house.name : undefined);
  return [n.given, surname].filter(Boolean).join(' ') + (n.epithet ? ` ${n.epithet}` : '');
}

/** Per-tree display preference shared by tree cards and the panel subtitle. */
export type NameMode = 'nickname' | 'first' | 'full';
export const nameModeKey = (tree: string) => `kindred:${tree}:names`;
/** React subscription for consumers such as the panel. Same-tab changes use kindred:names. */
export function useNameMode(tree: string): NameMode {
  return useSyncExternalStore(
    (notify) => {
      addEventListener('storage', notify);
      addEventListener('kindred:names', notify);
      return () => { removeEventListener('storage', notify); removeEventListener('kindred:names', notify); };
    },
    () => {
      try {
        const mode = localStorage.getItem(nameModeKey(tree));
        return mode === 'first' || mode === 'nickname' ? mode : 'full';
      } catch { return 'full'; }
    },
    () => 'full',
  );
}

/** The name shown for a person in the reader's chosen mode, always from their current name. */
export function personDisplayName(p: GPerson, mode: NameMode = 'full', f?: Family): string {
  const n = nowNames(p);
  if (mode === 'nickname') return n.nickname?.trim() || n.given;
  if (mode === 'first') return n.given;
  return displayName(p, f);
}

/**
 * Compact age, with partial or approximate dates explicitly marked as uncertain. A living person needs the
 * reader's `now`; without it there is no age yet (the server has no reader's day, see src/lib/clock.ts).
 */
export function cardAge(p: GPerson, now?: Date, locale: Locale = 'en'): string | undefined {
  const b = yearOf(p.born), end = p.living ? (now?.getFullYear() ?? NaN) : yearOf(p.died);
  if (!Number.isFinite(b) || !Number.isFinite(end)) return undefined;
  const exactBirth = /^\d{4}-\d{2}-\d{2}$/.test(p.born ?? '');
  const exactEnd = p.living || /^\d{4}-\d{2}-\d{2}$/.test(p.died ?? '');
  const uncertain = !exactBirth || !exactEnd || approx(p.born) || approx(p.died);
  let years = end - b;
  if (exactBirth && exactEnd) {
    const at = p.living ? now : new Date(`${p.died}T12:00:00`);
    years = ageAt(p.born, at) ?? years;
  }
  if (years < 0) return undefined;
  return `${p.living ? '' : '†'}${uncertain ? translate(locale, 'life.circa') : ''}${years}`;
}

/**
 * How many steps each person is from `id`, walking through parents, children and partners: 1 for a parent, a child
 * or a spouse, 2 for a grandparent, a sibling or a parent-in-law. People with no tie to `id` are absent. This is the
 * closeness that orders a list "nearest to you first".
 */
export function stepsFrom(f: Family, id: string): Map<string, number> {
  const d = new Map<string, number>([[id, 0]]);
  const q = [id];
  for (let i = 0; i < q.length; i++) {
    const x = q[i];
    for (const y of [...parents(f, x), ...children(f, x), ...partnersOf(f, x)]) if (!d.has(y)) { d.set(y, d.get(x)! + 1); q.push(y); }
  }
  return d;
}

/** Year from a partial date: "~1153-06" -> 1153. NaN when unknown. */
export const yearOf = (d?: string) => (d ? parseInt(d.replace(/^~/, ''), 10) : NaN);
export const approx = (d?: string) => !!d && d.startsWith('~');

/** The life years shown on a card: "1890–1960", or "geb. 1890" for someone living. */
export function lifespan(p: GPerson, locale: Locale): string {
  const b = yearOf(p.born);
  const d = yearOf(p.died);
  const bs = isNaN(b) ? '?' : `${approx(p.born) ? translate(locale, 'life.circa') : ''}${b}`;
  if (p.living) return isNaN(b) ? '' : translate(locale, 'life.born', { year: bs });
  return `${bs}–${isNaN(d) ? (p.living ? '' : '?') : d}`;
}

export function ageAt(born?: string, at: Date = new Date()): number | undefined {
  if (!born || approx(born)) return undefined;
  const [y, m = 1, d = 1] = born.split('-').map(Number);
  let age = at.getFullYear() - y;
  if (at.getMonth() + 1 < m || (at.getMonth() + 1 === m && at.getDate() < d)) age--;
  return age;
}

/** A person's age, or their age at death. A living person's age needs the reader's `today` (see src/lib/clock.ts). */
export function age(p: GPerson, today?: Date): number | undefined {
  if (p.living) return today ? ageAt(p.born, today) : undefined;
  if (!p.born || !p.died) return undefined;
  const b = yearOf(p.born), d = yearOf(p.died);
  return isNaN(b) || isNaN(d) ? undefined : d - b;
}

export const fmtDate = (d?: string, locale: Locale = 'en') => {
  if (!d) return undefined;
  const a = approx(d);
  const intl = locales[locale];
  const [y, m, day] = d.replace(/^~/, '').split('-').map(Number);
  const s = day
    ? new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(intl, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : m
      ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : String(y);
  return a ? translate(locale, 'date.circa', { date: s }) : s;
};

// ---------- generations ----------

/** Generation number per person (0 = earliest ancestors), by longest path from a root. */
export function generations(f: Family): Map<string, number> {
  const gen = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    const known = gen.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    let g = 0;
    for (const p of parents(f, id)) g = Math.max(g, visit(p, stack) + 1);
    // Partners without parents sit beside their spouse.
    stack.delete(id);
    gen.set(id, g);
    return g;
  };
  for (const p of f.graph.people) visit(p.id, new Set());
  // Married-in people without parents: pull to their partner's generation.
  for (const p of f.graph.people) {
    if (parents(f, p.id).length) continue;
    const ps = partnersOf(f, p.id).map((x) => gen.get(x) ?? 0);
    if (ps.length) gen.set(p.id, Math.max(gen.get(p.id) ?? 0, ...ps));
  }
  return gen;
}

// ---------- kinship ----------

/**
 * Links that make kin by descent. Biological and adoptive links do, as for succession (houses.tsx); a step or
 * foster link ties a household, not a line, so it is named as such and never read as blood.
 */
const NOT_BLOOD = new Set(['step', 'foster']);
const kindOf = (f: Family, child: string, parent: string) => f.linkKind.get(`${child}>${parent}`) ?? 'biological';
/** A person's parents by descent: biological and adoptive links only. */
export const bloodParents = (f: Family, id: string) => parents(f, id).filter((p) => !NOT_BLOOD.has(kindOf(f, id, p)));

/**
 * Ancestors of id with their distance (1 = parent). Keeps the shortest distance per ancestor. Every link counts unless
 * `blood` is set, then only biological and adoptive ones (what kinship walks).
 */
export function ancestorDepths(f: Family, id: string, blood = false): Map<string, number> {
  const up = blood ? bloodParents : parents;
  const out = new Map<string, number>([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const x = queue.shift()!;
    const d = out.get(x)!;
    for (const p of up(f, x)) {
      if (!out.has(p)) {
        out.set(p, d + 1);
        queue.push(p);
      }
    }
  }
  return out;
}

export function descendants(f: Family, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) for (const c of children(f, stack.pop()!)) if (!out.has(c)) { out.add(c); stack.push(c); }
  return out;
}

const ordinal = (n: number) => ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n] ?? `${n}th`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const greats = (n: number) => (n <= 0 ? '' : n === 1 ? 'great-' : `${n}× great-`);

function gendered(p: GPerson | undefined, m: string, w: string, x: string) {
  return p?.sex === 'm' ? m : p?.sex === 'f' ? w : x;
}

export interface Kinship {
  label: string; // "great-aunt", "second cousin once removed", "husband", "stepmother", "wife's cousin"
  /** The common ancestor(s) the relationship goes through. */
  via: string[];
  /** For a tie through a marriage or a step or foster link: the people from the first person to the second. */
  path?: string[];
  /**
   * What the English word "cousin" leaves open and other languages say: the cousin's sex, and how many generations
   * above (positive) or below (negative) the first person they stand ("Onkel 2. Grades", "Neffe 2. Grades"). In a tie
   * through a marriage it describes the cousin in the label ("wife's cousin", "cousin's husband").
   */
  cousin?: { sex?: 'm' | 'f'; up: number };
  /** The sex of the first person's partner an "-in-law" tie runs through ("Onkel deiner Frau"). */
  spouse?: 'm' | 'f';
  /** The second person's sex, where the English word leaves it open and other languages do not ("relative by marriage"). */
  sex?: 'm' | 'f';
}

/**
 * The label for two people tied through marriages (or a parent's partner) further than a specific word reaches: a spouse's
 * cousin's spouse's sibling, a sibling's in-law's in-law. Never a guess at a closer word.
 */
export const BY_MARRIAGE = 'relative by marriage';

const knownSex = (p: GPerson | undefined) => (p?.sex === 'm' || p?.sex === 'f' ? p.sex : undefined);

/** Whether a family has any step or foster link, so depths over every link may differ from depths over blood. */
const householdLinks = new WeakMap<Family, boolean>();
function hasHouseholdLinks(f: Family): boolean {
  let has = householdLinks.get(f);
  if (has === undefined) householdLinks.set(f, (has = [...f.linkKind.values()].some((k) => NOT_BLOOD.has(k))));
  return has;
}
/**
 * Blood ancestor depths for kinship. Callers pass `ancestorDepths(f, me)` as a cache; it is the same over blood links
 * unless the family has a step or foster link, and then it is worked out again.
 */
const bloodDepths = (f: Family, id: string, given?: Map<string, number>) => (given && !hasHouseholdLinks(f) ? given : ancestorDepths(f, id, true));

/** The child of `anc` on the blood line from `start` up to it: the person whose parent is `anc`. */
export function childOnLine(f: Family, start: string, anc: string): string | undefined {
  const prev = new Map<string, string | null>([[start, null]]);
  const q = [start];
  while (q.length) {
    const x = q.shift()!;
    if (x === anc) break;
    for (const p of bloodParents(f, x)) if (!prev.has(p)) { prev.set(p, x); q.push(p); }
  }
  return prev.get(anc) ?? undefined;
}
/** Same parents by descent: a full sibling of whoever it is compared with. */
function sameBloodParents(f: Family, a: string, b: string): boolean {
  const pa = new Set(bloodParents(f, a)), pb = bloodParents(f, b);
  return pa.size === pb.length && pb.every((p) => pa.has(p));
}

/** A relation by descent through the closest common ancestor, or none. */
function bloodKinship(f: Family, me: string, other: string, myAnc: Map<string, number>): Kinship | undefined {
  const p = f.byId.get(other);
  const theirs = ancestorDepths(f, other, true);
  let best: { a: number; b: number; via: string[] } | undefined;
  for (const [anc, a] of myAnc) {
    const b = theirs.get(anc);
    if (b === undefined) continue;
    if (!best || a + b < best.a + best.b) best = { a, b, via: [anc] };
    else if (a + b === best.a + best.b && a === best.a) best.via.push(anc);
  }
  if (!best) return undefined;
  const { a, b } = best; // a: steps from me up to the ancestor, b: steps from them up
  // Half: the lines reach the shared ancestor through children of different unions (their parents differ).
  let half = '';
  if (best.via.length === 1 && a > 0 && b > 0) {
    const c1 = childOnLine(f, me, best.via[0]), c2 = childOnLine(f, other, best.via[0]);
    if (c1 && c2 && !sameBloodParents(f, c1, c2)) half = 'half-';
  }
  let label: string;
  // A parent or child by adoption is named so; further out an adoptive line reads as any other.
  if (b === 0 && a === 1) label = `${kindOf(f, me, other) === 'adoptive' ? 'adoptive ' : ''}${gendered(p, 'father', 'mother', 'parent')}`;
  else if (a === 0 && b === 1) label = `${kindOf(f, other, me) === 'adoptive' ? 'adopted ' : ''}${gendered(p, 'son', 'daughter', 'child')}`;
  else if (b === 0) label = `${greats(a - 2)}grand${gendered(p, 'father', 'mother', 'parent')}`;
  else if (a === 0) label = `${greats(b - 2)}grand${gendered(p, 'son', 'daughter', 'child')}`;
  else if (a === 1 && b === 1) label = `${half}${gendered(p, 'brother', 'sister', 'sibling')}`;
  else if (a === 1) label = `${greats(b - 2)}${half}${gendered(p, 'nephew', 'niece', 'nibling')}`;
  else if (b === 1) label = `${greats(a - 2)}${half}${gendered(p, 'uncle', 'aunt', 'pibling')}`;
  else {
    const degree = Math.min(a, b) - 1;
    const removed = Math.abs(a - b);
    const nth = half && degree === 1 ? '' : `${ordinal(degree)} `;
    label = `${half}${nth}cousin${removed ? ` ${times(removed)} removed` : ''}`;
    return { label, via: best.via, cousin: { sex: knownSex(p), up: a - b } };
  }
  return { label, via: best.via };
}

/** A partial date ("1953", "1953-08-08", "~1953") as year, month and day, the month and day when known. */
const dateParts = (d?: string) => {
  const m = d?.match(/^(~?)(\d{3,4})(?:-(\d\d)(?:-(\d\d))?)?$/);
  return m ? { about: !!m[1], y: Number(m[2]), m: m[3] ? Number(m[3]) : undefined, d: m[4] ? Number(m[4]) : undefined } : undefined;
};
/** Whether `a` is surely before `b`: false when either is unknown or they cannot be told apart. An "about" year counts a year either way. */
function surelyBefore(a?: string, b?: string): boolean {
  const x = dateParts(a), y = dateParts(b);
  if (!x || !y) return false;
  if (x.about || y.about) return x.y + 1 < y.y;
  if (x.y !== y.y) return x.y < y.y;
  if (x.m === undefined || y.m === undefined) return false;
  if (x.m !== y.m) return x.m < y.m;
  return x.d !== undefined && y.d !== undefined && x.d < y.d;
}
/**
 * Whether every partnership of `a` and `b` had ended before `child` was born, by the dates on record: then the partner was
 * never a step-parent or step-grandparent on that line (a grandfather's first wife, divorced before the father's birth).
 * False when a date is missing, so the step word stays where nothing says otherwise.
 */
function partedBefore(f: Family, a: string, b: string, child: string | undefined): boolean {
  const born = child ? f.byId.get(child)?.born : undefined;
  const between = (f.unionsOf.get(a) ?? []).filter((u) => u.a === b || u.b === b);
  return !!born && between.length > 0 && between.every((u) => surelyBefore(u.end, born));
}

interface HouseholdParent { id: string; path: string[]; foster: boolean; former?: { parent: string } }
/**
 * The people who raise or raised `id` without being their parent by descent: a step or foster parent on record, and
 * a parent's partner who is not their parent. Each with the way to them and whether the tie is fostering. With `former`,
 * also a parent's partner from before: one whose every partnership with the parent ended before `id` was born, marked
 * with that parent (never a step-parent, but "father's wife" and her relatives are named through it).
 */
function householdParents(f: Family, id: string, former = false): HouseholdParent[] {
  const out: HouseholdParent[] = [];
  const blood = bloodParents(f, id);
  for (const p of parents(f, id)) if (!blood.includes(p)) out.push({ id: p, path: [id, p], foster: kindOf(f, id, p) === 'foster' });
  for (const bp of blood) {
    for (const sp of partnersOf(f, bp)) {
      if (sp === id || parents(f, id).includes(sp) || out.some((o) => o.id === sp)) continue;
      const before = partedBefore(f, bp, sp, id);
      if (!before || former) out.push({ id: sp, path: [id, bp, sp], foster: false, ...(before && { former: { parent: bp } }) });
    }
  }
  return out;
}

/** A step or foster parent, child or sibling: a household tie that is not one of descent. */
function householdKinship(f: Family, me: string, other: string): Kinship | undefined {
  const p = f.byId.get(other);
  const word = (foster: boolean, m: string, w: string, x: string) => `${foster ? 'foster ' : 'step'}${gendered(p, m, w, x)}`;
  const mine = householdParents(f, me);
  const up = mine.find((h) => h.id === other);
  if (up) return { label: word(up.foster, 'father', 'mother', 'parent'), via: [], path: up.path };
  const down = householdParents(f, other).find((h) => h.id === me);
  if (down) return { label: word(down.foster, 'son', 'daughter', 'child'), via: [], path: [...down.path].reverse() };
  // Siblings: someone who raises or raised one of them is a parent (by descent or not) of the other.
  const figures = (id: string) => [
    ...bloodParents(f, id).map((bp) => ({ id: bp, path: [id, bp], foster: false, blood: true })),
    ...householdParents(f, id).map((h) => ({ ...h, blood: false })),
  ];
  const theirs = figures(other);
  for (const m of figures(me)) {
    const t = theirs.find((x) => x.id === m.id && !(x.blood && m.blood));
    if (t) return { label: word(m.foster || t.foster, 'brother', 'sister', 'sibling'), via: [], path: [...m.path, ...[...t.path].reverse().slice(1)] };
  }
  return undefined;
}

/** The chain of people from `from` up to the common ancestor `anc` and down to `to`, by descent. */
function bloodPath(f: Family, from: string, to: string, anc: string): string[] {
  const up = (start: string): string[] => {
    // BFS upward, then walk back.
    const prev = new Map<string, string | null>([[start, null]]);
    const q = [start];
    while (q.length) {
      const x = q.shift()!;
      if (x === anc) break;
      for (const p of bloodParents(f, x)) if (!prev.has(p)) { prev.set(p, x); q.push(p); }
    }
    const path: string[] = [];
    for (let x: string | null | undefined = anc; x; x = prev.get(x)) path.push(x);
    return path.reverse();
  };
  return [...up(from), ...up(to).reverse().slice(1)];
}

/** How far up `anc` stands from `id` by descent (1 = parent), or undefined when it is not an ancestor. */
const depthUp = (f: Family, id: string, anc: string) => ancestorDepths(f, id, true).get(anc);
/** "step-grandfather", "step-great-granddaughter": a grandparent or grandchild `d` generations away, tied through a marriage. */
const stepGrand = (p: GPerson | undefined, d: number, up: boolean) =>
  `step-${greats(d - 2)}grand${up ? gendered(p, 'father', 'mother', 'parent') : gendered(p, 'son', 'daughter', 'child')}`;
const spouseWord = (p: GPerson | undefined) => gendered(p, 'husband', 'wife', 'partner');
const siblingLabel = (label: string) => /^(half-)?(brother|sister|sibling)$/.test(label);

/**
 * The people tied to each other at all: through parents by descent or by step link, and through partnerships (a foster
 * link ties a household, not a family). A number per person, the same for everyone in one group. Worked out once per family.
 */
const tieGroups = new WeakMap<Family, Map<string, number>>();
function tieGroup(f: Family): Map<string, number> {
  let groups = tieGroups.get(f);
  if (groups) return groups;
  groups = new Map();
  let n = 0;
  for (const start of f.byId.keys()) {
    if (groups.has(start)) continue;
    groups.set(start, ++n);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const y of tieNeighbours(f, queue[i])) if (!groups.has(y)) { groups.set(y, n); queue.push(y); }
    }
  }
  tieGroups.set(f, groups);
  return groups;
}
function tieNeighbours(f: Family, x: string): string[] {
  return [
    ...parents(f, x).filter((p) => kindOf(f, x, p) !== 'foster'),
    ...children(f, x).filter((c) => kindOf(f, c, x) !== 'foster'),
    ...partnersOf(f, x),
  ];
}
/** The shortest chain of ties between two people (see tieGroup), or none. */
function tiePath(f: Family, from: string, to: string): string[] {
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !prev.has(to); i++) {
    for (const y of tieNeighbours(f, queue[i])) if (!prev.has(y)) { prev.set(y, queue[i]); queue.push(y); }
  }
  if (!prev.has(to)) return [];
  const path: string[] = [];
  for (let x: string | null | undefined = to; x; x = prev.get(x)) path.push(x);
  return path.reverse();
}

/**
 * Ties through a parent's partner or a step link that reach past the household: a step-parent's relatives
 * ("step-grandmother", "stepfather's brother") and, the other way round, a relative's stepchildren ("step-grandson",
 * "sister's stepson").
 */
function stepKinship(f: Family, me: string, other: string, mine: Map<string, number>): Kinship | undefined {
  const p = f.byId.get(other);
  const word = (h: { id: string; foster: boolean }, m: string, w: string, x: string) => `${h.foster ? 'foster ' : 'step'}${gendered(f.byId.get(h.id), m, w, x)}`;
  for (const h of householdParents(f, me, true)) {
    const k = bloodKinship(f, h.id, other, ancestorDepths(f, h.id, true));
    if (!k) continue;
    const path = [...h.path, ...bloodPath(f, h.id, other, k.via[0]).slice(1)];
    // A parent's partner from before I was born is no step-parent: "father's wife's brother", not "stepmother's brother".
    if (h.former) {
      const label = `${gendered(f.byId.get(h.former.parent), 'father', 'mother', 'parent')}'s ${spouseWord(f.byId.get(h.id))}'s ${k.label}`;
      return { label, via: k.via, path, ...(k.cousin && { cousin: k.cousin }) };
    }
    const d = depthUp(f, h.id, other);
    if (d !== undefined && !h.foster) return { label: stepGrand(p, d + 1, true), via: [], path };
    return { label: `${word(h, 'father', 'mother', 'parent')}'s ${k.label}`, via: k.via, path, ...(k.cousin && { cousin: k.cousin }) };
  }
  for (const h of householdParents(f, other, true)) {
    const k = bloodKinship(f, me, h.id, mine);
    if (!k) continue;
    const path = [...bloodPath(f, me, h.id, k.via[0]), ...[...h.path].reverse().slice(1)];
    // The child of my relative's partner, born after they parted: "sister's husband's son".
    if (h.former) {
      const label = `${k.label}'s ${spouseWord(f.byId.get(h.former.parent))}'s ${gendered(p, 'son', 'daughter', 'child')}`;
      return { label, via: k.via, path, ...(k.cousin && { cousin: k.cousin }) };
    }
    const d = depthUp(f, h.id, me);
    if (d !== undefined && !h.foster) return { label: stepGrand(p, d + 1, false), via: [], path };
    const child = `${h.foster ? 'foster ' : 'step'}${gendered(p, 'son', 'daughter', 'child')}`;
    return { label: `${k.label}'s ${child}`, via: k.via, path, ...(k.cousin && { cousin: k.cousin }) };
  }
  return undefined;
}

/**
 * How `other` is related to `me`, in English: "your great-aunt". In this order:
 *
 * 1. by descent (biological and adoptive links), through the closest common ancestor;
 * 2. step and foster parents, children and siblings, by a recorded link or a parent's partner;
 * 3. one marriage at either end of a blood line: a spouse, a spouse's blood relative ("father-in-law", "wife's cousin",
 *    "step-grandson" for a spouse's grandchild), a blood relative's spouse ("sister-in-law", "uncle's wife",
 *    "step-grandmother" for a grandfather's wife);
 * 4. a step-parent's relatives and a relative's stepchildren ("step-grandfather", "stepmother's brother", "sister's stepson");
 * 5. a marriage at both ends ("wife's sister's husband"), and a sibling's spouse's sibling ("brother's wife's sister");
 * 6. anyone else tied through partnerships and parents is a "relative by marriage" (BY_MARRIAGE), never a closer word.
 *
 * Someone with no tie at all has none. `inLaws` false asks for blood alone.
 */
export function kinship(f: Family, me: string, other: string, myAnc?: Map<string, number>, inLaws = true): Kinship | undefined {
  if (me === other) return { label: 'you', via: [] };
  const mine = bloodDepths(f, me, myAnc);
  const blood = bloodKinship(f, me, other, mine);
  if (blood || !inLaws) return blood;
  const household = householdKinship(f, me, other);
  if (household) return household;
  if (!f.byId.has(me) || !f.byId.has(other) || tieGroup(f).get(me) !== tieGroup(f).get(other)) return undefined;
  const p = f.byId.get(other);
  if (partnersOf(f, me).includes(other)) return { label: spouseWord(p), via: [], path: [me, other] };
  // A blood relative of my partner: the close ones are "-in-law", the rest "wife's cousin"; their grandchildren are mine by marriage.
  const spouseAnc = new Map(partnersOf(f, me).map((sp) => [sp, ancestorDepths(f, sp, true)]));
  for (const sp of partnersOf(f, me)) {
    const k = bloodKinship(f, sp, other, spouseAnc.get(sp)!);
    if (!k) continue;
    const path = [me, ...bloodPath(f, sp, other, k.via[0])];
    const down = depthUp(f, other, sp);
    // My partner's child or grandchild on a line that began after we parted is theirs, not mine: "husband's son".
    if (down !== undefined && partedBefore(f, me, sp, childOnLine(f, other, sp))) return { label: `${spouseWord(f.byId.get(sp))}'s ${k.label}`, via: k.via, path };
    if (down !== undefined && down >= 2) return { label: stepGrand(p, down, false), via: [], path };
    const spouse = knownSex(f.byId.get(sp));
    if (!/cousin|great|adopt/.test(k.label)) return { label: `${k.label}-in-law`, via: k.via, path, ...(spouse && { spouse }) };
    return { label: `${spouseWord(f.byId.get(sp))}'s ${k.label}`, via: k.via, path, ...(k.cousin && { cousin: k.cousin }) };
  }
  // The partner of a blood relative of mine: "sister-in-law", "son-in-law", "great-uncle's wife"; a grandparent's is a step-grandparent.
  for (const sp of partnersOf(f, other)) {
    const k = bloodKinship(f, me, sp, mine);
    if (!k) continue;
    const path = [...bloodPath(f, me, sp, k.via[0]), other];
    const up = depthUp(f, me, sp);
    // A grandparent's partner from before the line's child was born is no step-grandparent: "grandfather's wife".
    if (up !== undefined && up >= 2 && !partedBefore(f, sp, other, childOnLine(f, me, sp))) return { label: stepGrand(p, up, true), via: [], path };
    const base = k.label.replace(/^(half-|adopted |adoptive )?/, '');
    if (/^(brother|sister|sibling)$/.test(base)) return { label: `${gendered(p, 'brother', 'sister', 'sibling')}-in-law`, via: k.via, path };
    if (/^(son|daughter|child)$/.test(base)) return { label: `${gendered(p, 'son', 'daughter', 'child')}-in-law`, via: k.via, path };
    return { label: `${k.label}'s ${spouseWord(p)}`, via: k.via, path, ...(k.cousin && { cousin: k.cousin }) };
  }
  const step = stepKinship(f, me, other, mine);
  if (step) return step;
  // A marriage at both ends: my partner's blood relative's partner ("wife's sister's husband", "husband's cousin's wife").
  for (const sp of partnersOf(f, me)) {
    for (const x of partnersOf(f, other)) {
      if (x === me || x === sp) continue;
      const k = bloodKinship(f, sp, x, spouseAnc.get(sp)!);
      if (!k) continue;
      return {
        label: `${spouseWord(f.byId.get(sp))}'s ${k.label}'s ${spouseWord(p)}`,
        via: k.via,
        path: [me, ...bloodPath(f, sp, x, k.via[0]), other],
        ...(k.cousin && { cousin: k.cousin }),
      };
    }
  }
  // A sibling's partner's sibling ("brother's wife's sister"): the one tie with a marriage in the middle that has a word of its own.
  for (const x of siblings(f, me)) {
    const kx = bloodKinship(f, me, x, mine);
    if (!kx || !siblingLabel(kx.label)) continue;
    for (const y of partnersOf(f, x)) {
      if (y === me) continue;
      const ky = bloodKinship(f, y, other, ancestorDepths(f, y, true));
      if (!ky || !siblingLabel(ky.label)) continue;
      return {
        label: `${kx.label}'s ${spouseWord(f.byId.get(y))}'s ${ky.label}`,
        via: [],
        path: [...bloodPath(f, me, x, kx.via[0]), ...bloodPath(f, y, other, ky.via[0])],
      };
    }
  }
  const sex = knownSex(p);
  return { label: BY_MARRIAGE, via: [], ...(sex && { sex }) };
}

/** The chain of people between two relatives: through their closest common ancestor, or through the marriage or household that ties them. */
export function kinPath(f: Family, from: string, to: string): string[] {
  const k = kinship(f, from, to);
  if (k?.path) return k.path;
  if (k?.label === BY_MARRIAGE) return tiePath(f, from, to);
  if (!k?.via.length) return [];
  return bloodPath(f, from, to, k.via[0]);
}
