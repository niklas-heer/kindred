// The in-browser family graph: lookups, kinship, and date helpers. Built once per Graph payload.
import { useSyncExternalStore } from 'react';
import type { GPerson, GUnion, Graph, House } from './types';

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
export const parents = (f: Family, id: string) => f.parentsOf.get(id) ?? [];
export const children = (f: Family, id: string) => f.childrenOf.get(id) ?? [];
export function siblings(f: Family, id: string): string[] {
  const out = new Set<string>();
  for (const p of parents(f, id)) for (const c of children(f, p)) if (c !== id) out.add(c);
  return [...out].sort((a, b) => yearOf(f.byId.get(a)?.born) - yearOf(f.byId.get(b)?.born));
}

// ---------- names and dates ----------

export const fullName = (p: GPerson) => [p.given, p.surname].filter(Boolean).join(' ');
export function displayName(p: GPerson, f?: Family): string {
  if (p.title && /^(King|Queen|Duke|Duchess|Count|Countess|Prince|Princess|Bishop|Abbess|Abbot|Sir|Lady)\b/.test(p.title)) {
    const rank = p.title.split(' ')[0];
    return `${rank} ${p.given}${p.epithet ? ` ${p.epithet}` : ''}`;
  }
  const house = p.house && f?.house.get(p.house);
  const surname = p.surname ?? (house && !house.name.startsWith('House') ? house.name : undefined);
  return [p.given, surname].filter(Boolean).join(' ') + (p.epithet ? ` ${p.epithet}` : '');
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

export function personDisplayName(p: GPerson, mode: NameMode = 'full', f?: Family): string {
  if (mode === 'nickname') return p.nickname?.trim() || p.given;
  if (mode === 'first') return p.given;
  return displayName(p, f);
}

/** Compact age, with partial or approximate dates explicitly marked as uncertain. */
export function cardAge(p: GPerson, now = new Date()): string | undefined {
  const b = yearOf(p.born), end = p.living ? now.getFullYear() : yearOf(p.died);
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
  return `${p.living ? '' : '†'}${uncertain ? 'c. ' : ''}${years}`;
}

/** Year from a partial date: "~1153-06" -> 1153. NaN when unknown. */
export const yearOf = (d?: string) => (d ? parseInt(d.replace(/^~/, ''), 10) : NaN);
export const approx = (d?: string) => !!d && d.startsWith('~');

export function lifespan(p: GPerson): string {
  const b = yearOf(p.born);
  const d = yearOf(p.died);
  const bs = isNaN(b) ? '?' : `${approx(p.born) ? 'c. ' : ''}${b}`;
  if (p.living) return isNaN(b) ? '' : `b. ${bs}`;
  return `${bs}–${isNaN(d) ? (p.living ? '' : '?') : d}`;
}

export function ageAt(born?: string, at: Date = new Date()): number | undefined {
  if (!born || approx(born)) return undefined;
  const [y, m = 1, d = 1] = born.split('-').map(Number);
  let age = at.getFullYear() - y;
  if (at.getMonth() + 1 < m || (at.getMonth() + 1 === m && at.getDate() < d)) age--;
  return age;
}

export function age(p: GPerson): number | undefined {
  if (p.living) return ageAt(p.born);
  if (!p.born || !p.died) return undefined;
  const b = yearOf(p.born), d = yearOf(p.died);
  return isNaN(b) || isNaN(d) ? undefined : d - b;
}

export const fmtDate = (d?: string, locale = 'en-GB') => {
  if (!d) return undefined;
  const a = approx(d);
  const [y, m, day] = d.replace(/^~/, '').split('-').map(Number);
  const s = day
    ? new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : m
      ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : String(y);
  return a ? `c. ${s}` : s;
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

/** Ancestors of id with their distance (1 = parent). Keeps the shortest distance per ancestor. */
export function ancestorDepths(f: Family, id: string): Map<string, number> {
  const out = new Map<string, number>([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const x = queue.shift()!;
    const d = out.get(x)!;
    for (const p of parents(f, x)) {
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
  label: string; // "great-aunt", "second cousin once removed", "husband"
  /** The common ancestor(s) the relationship goes through. */
  via: string[];
}

/**
 * How `other` is related to `me`, in English: "your great-aunt". Blood relationships go through the
 * closest common ancestor; otherwise spouses and in-laws one step out.
 */
export function kinship(f: Family, me: string, other: string, myAnc = ancestorDepths(f, me), inLaws = true): Kinship | undefined {
  if (me === other) return { label: 'you', via: [] };
  const p = f.byId.get(other);
  const theirs = ancestorDepths(f, other);
  let best: { a: number; b: number; via: string[] } | undefined;
  for (const [anc, a] of myAnc) {
    const b = theirs.get(anc);
    if (b === undefined) continue;
    if (!best || a + b < best.a + best.b) best = { a, b, via: [anc] };
    else if (a + b === best.a + best.b && a === best.a) best.via.push(anc);
  }
  if (best) {
    const { a, b } = best; // a: steps from me up to the ancestor, b: steps from them up
    // One shared ancestor who had several partners: the lines come from different marriages.
    const half = best.via.length === 1 && a > 0 && b > 0 && partnersOf(f, best.via[0]).length > 1 ? 'half-' : '';
    let label: string;
    if (b === 0) label = a === 1 ? gendered(p, 'father', 'mother', 'parent') : `${greats(a - 2)}grand${gendered(p, 'father', 'mother', 'parent')}`;
    else if (a === 0) label = b === 1 ? gendered(p, 'son', 'daughter', 'child') : `${greats(b - 2)}grand${gendered(p, 'son', 'daughter', 'child')}`;
    else if (a === 1 && b === 1) label = `${half}${gendered(p, 'brother', 'sister', 'sibling')}`;
    else if (a === 1) label = `${greats(b - 2)}${half}${gendered(p, 'nephew', 'niece', 'nibling')}`;
    else if (b === 1) label = `${greats(a - 2)}${half}${gendered(p, 'uncle', 'aunt', 'pibling')}`;
    else {
      const degree = Math.min(a, b) - 1;
      const removed = Math.abs(a - b);
      const nth = half && degree === 1 ? '' : `${ordinal(degree)} `;
      label = `${half}${nth}cousin${removed ? ` ${times(removed)} removed` : ''}`;
    }
    return { label, via: best.via };
  }
  // Spouse and in-laws: one step through a marriage, never more (that way lies recursion).
  if (!inLaws) return undefined;
  if (partnersOf(f, me).includes(other)) return { label: gendered(p, 'husband', 'wife', 'partner'), via: [] };
  for (const sp of partnersOf(f, me)) {
    const k = kinship(f, sp, other, undefined, false);
    if (k && k.via.length && !/cousin|great/.test(k.label)) return { label: `${k.label}-in-law`, via: k.via };
  }
  for (const sp of partnersOf(f, other)) {
    const k = kinship(f, me, sp, myAnc, false);
    if (k && k.via.length && !/cousin|great/.test(k.label)) {
      const base = k.label.replace(/^(half-)?/, '');
      if (/brother|sister|sibling/.test(base)) return { label: `${gendered(p, 'brother', 'sister', 'sibling')}-in-law`, via: k.via };
      if (/son|daughter|child/.test(base) && !base.startsWith('grand')) return { label: `${gendered(p, 'son', 'daughter', 'child')}-in-law`, via: k.via };
      return { label: `${base}'s ${gendered(p, 'husband', 'wife', 'partner')}`, via: k.via };
    }
  }
  return undefined;
}

/** The chain of people between two relatives, through their closest common ancestor. */
export function kinPath(f: Family, from: string, to: string): string[] {
  const k = kinship(f, from, to);
  if (!k?.via.length) {
    if (partnersOf(f, from).includes(to)) return [from, to];
    return [];
  }
  const up = (start: string, target: string): string[] => {
    // BFS upward, then walk back.
    const prev = new Map<string, string | null>([[start, null]]);
    const q = [start];
    while (q.length) {
      const x = q.shift()!;
      if (x === target) break;
      for (const p of parents(f, x)) if (!prev.has(p)) { prev.set(p, x); q.push(p); }
    }
    const path: string[] = [];
    for (let x: string | null | undefined = target; x; x = prev.get(x)) path.push(x);
    return path.reverse();
  };
  const a = up(from, k.via[0]);
  const b = up(to, k.via[0]);
  return [...a, ...b.reverse().slice(1)];
}
