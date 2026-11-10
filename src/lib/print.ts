// The Print page's rules, without React or storage: what is asked for (a chart or a book, for whom, on which paper), what of
// the living goes on paper, who is in a book and in which order, where each ancestor and descendant stands on a chart, and
// how blocks of known height are laid on pages. The pages are built in the browser and printed by it (src/routes/$tree/print.tsx).
//
// Living people on paper: a printed page leaves the family's hands, so by default someone the family marks as living is on it
// by name and place in the tree only: no dates, no places, no occupation, no memories, no photos. `forPaper` does that to the
// graph the charts and the book draw from, and the server withholds the rest (print.server.ts). The reader may switch it off.
import { ancestorDepths, bloodParents, children, descendants, generations, houseMembers, nowNames, parents, sortedUnions, yearOf, type Family } from './graph.ts';
import { protectPerson, protectUnion } from './protect-living.ts';
import type { GPerson, Graph, House } from './types.ts';

export const PRODUCTS = ['ancestors', 'descendants', 'book'] as const;
export type Product = (typeof PRODUCTS)[number];
export const PAPERS = ['a4', 'letter'] as const;
export type Paper = (typeof PAPERS)[number];
export const ORIENTATIONS = ['portrait', 'landscape'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const SCOPES = ['person', 'house', 'ancestors', 'descendants', 'everyone'] as const;
export type Scope = (typeof SCOPES)[number];

/** Paper sizes in millimetres, upright. */
export const PAPER_MM: Record<Paper, { w: number; h: number }> = { a4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } };
/** CSS pixels per millimetre: a CSS inch is 96 px and 25.4 mm, on screen and on paper alike. */
export const PX_PER_MM = 96 / 25.4;

export function sheetSize(paper: Paper, orientation: Orientation): { w: number; h: number } {
  const { w, h } = PAPER_MM[paper];
  return orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

/** How many generations a chart may show, the first person counted. */
export const GENERATIONS: Record<'ancestors' | 'descendants', { min: number; max: number; initial: number }> = {
  ancestors: { min: 4, max: 6, initial: 5 },
  descendants: { min: 2, max: 6, initial: 4 },
};
export const clampGenerations = (product: 'ancestors' | 'descendants', n: number | undefined) => {
  const g = GENERATIONS[product];
  return Number.isFinite(n) ? Math.min(g.max, Math.max(g.min, Math.round(n!))) : g.initial;
};

// ---------- the living, and photos ----------

/** A living person as paper gets them by default: their names, sex and house. No face from a photo either. */
export function namesOnly(p: GPerson): GPerson {
  if (!p.living) return p;
  const { photo: _photo, portrait: _portrait, preferPortrait: _prefer, ...rest } = protectPerson(p);
  return rest;
}

/**
 * The family as the paper shows it. Without `living`, the living keep their names and their place in the tree, and a
 * partnership with a living partner keeps who and what it is but no date or place. Without `photos`, every face is drawn.
 */
export function forPaper(g: Graph, o: { living: boolean; photos: boolean }): Graph {
  if (o.living && o.photos) return g;
  const livingIds = new Set(g.people.filter((p) => p.living).map((p) => p.id));
  const people = g.people.map((p) => {
    const q = o.living ? p : namesOnly(p);
    if (o.photos || (!q.photo && !q.portrait)) return q;
    const { photo: _photo, portrait: _portrait, preferPortrait: _prefer, ...rest } = q;
    return rest;
  });
  const unions = o.living ? g.unions : g.unions.map((u) => protectUnion(u, (id) => livingIds.has(id)));
  return { ...g, people, unions };
}

/** The family's arms, as the app's own header shows them: the house of the person the tree opens on, else the largest house. */
export function familyCrest(f: Family): House | undefined {
  const own = f.house.get(f.byId.get(f.graph.tree.focus)?.house ?? '');
  if (own) return own;
  const n = new Map<string, number>();
  for (const p of f.graph.people) if (p.house) n.set(p.house, (n.get(p.house) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? f.house.get(top) : undefined;
}

/** Whether this person is on paper by name only. */
export const isNamesOnly = (p: GPerson, includeLiving: boolean) => p.living && !includeLiving;

// ---------- the ancestor chart ----------

/**
 * A person's two parents for a pedigree: father's place first, mother's second. Parents by descent come before step and
 * foster parents; with one parent known, a mother stands in the second place and the first stays open.
 */
export function pedigreeParents(f: Family, id: string): [string | undefined, string | undefined] {
  const blood = bloodParents(f, id);
  const all = [...blood, ...parents(f, id).filter((p) => !blood.includes(p))].slice(0, 2);
  if (all.length === 2) return [all[0], all[1]];
  if (all.length === 1) return f.byId.get(all[0])?.sex === 'f' ? [undefined, all[0]] : [all[0], undefined];
  return [undefined, undefined];
}

/**
 * The pedigree of `root` over `gens` generations: one list per generation, with 2^g places in generation g (the root is
 * generation 0). A place nobody is known for is undefined. Someone who is an ancestor twice stands in both places.
 */
export function ancestorSlots(f: Family, root: string, gens: number): (string | undefined)[][] {
  const out: (string | undefined)[][] = [[f.byId.has(root) ? root : undefined]];
  for (let g = 1; g < gens; g++) {
    const row: (string | undefined)[] = [];
    for (const id of out[g - 1]) row.push(...(id ? pedigreeParents(f, id) : [undefined, undefined]));
    out.push(row);
  }
  return out;
}

// ---------- the descendant chart ----------

export interface DescendantNode {
  /** Unique on the chart: the person's id, or with a suffix where they stand a second time. */
  key: string;
  id: string;
  depth: number;
  partners: string[];
  /** They stand higher up already (cousins who married): their children are listed there, not again. */
  repeat: boolean;
  children: DescendantNode[];
}

/** The descendants of `root` as a tree, `gens` generations deep (the root is the first), children oldest first. */
export function descendantTree(f: Family, root: string, gens: number): DescendantNode | undefined {
  if (!f.byId.has(root)) return undefined;
  const seen = new Set<string>();
  let n = 0;
  const walk = (id: string, depth: number): DescendantNode => {
    const repeat = seen.has(id);
    seen.add(id);
    const node: DescendantNode = {
      key: repeat ? `${id}#${++n}` : id,
      id,
      depth,
      partners: sortedUnions(f, id).map((u) => (u.a === id ? u.b : u.a)).filter((x) => f.byId.has(x)),
      repeat,
      children: [],
    };
    if (!repeat && depth + 1 < gens) node.children = children(f, id).map((c) => walk(c, depth + 1));
    return node;
  };
  return walk(root, 0);
}

export interface PlacedNode { node: DescendantNode; row: number; parent?: string }

/**
 * A descendant tree laid out sideways, one column per generation. As a `tree`, a parent stands level with the middle of
 * their children and only the youngest generation takes rows of its own, so the chart is as tall as it has leaves. As an
 * `outline`, everyone has a row of their own under their parent, which runs over as many pages as it needs.
 */
export function placeDescendants(root: DescendantNode, mode: 'tree' | 'outline'): { placed: PlacedNode[]; rows: number } {
  const placed: PlacedNode[] = [];
  let next = 0;
  const walk = (node: DescendantNode, parent?: string): number => {
    if (mode === 'outline') {
      const row = next++;
      placed.push({ node, row, parent });
      for (const c of node.children) walk(c, node.key);
      return row;
    }
    if (!node.children.length) {
      const row = next++;
      placed.push({ node, row, parent });
      return row;
    }
    const at = placed.length;
    placed.push({ node, row: 0, parent });
    const rows = node.children.map((c) => walk(c, node.key));
    placed[at].row = (rows[0] + rows[rows.length - 1]) / 2;
    return placed[at].row;
  };
  walk(root);
  return { placed, rows: next };
}

export const countNodes = (n: DescendantNode): number => 1 + n.children.reduce((s, c) => s + countNodes(c), 0);

// ---------- the book: who is in it ----------

export interface BookSection {
  /** A house id, or '' for the people no house is recorded for. */
  house: string;
  people: string[];
}

/** The people a scope names. A book of someone's descendants holds their partners too: they are the other half of each family. */
export function scopePeople(f: Family, scope: Scope, o: { person?: string; house?: string }): string[] {
  const has = (id?: string): id is string => !!id && f.byId.has(id);
  switch (scope) {
    case 'everyone': return f.graph.people.map((p) => p.id);
    case 'house': return o.house ? houseMembers(f, o.house).map((p) => p.id) : [];
    case 'person': return has(o.person) ? [o.person] : [];
    case 'ancestors': return has(o.person) ? [...ancestorDepths(f, o.person).keys()] : [];
    case 'descendants': {
      if (!has(o.person)) return [];
      const out = new Set<string>([o.person, ...descendants(f, o.person)]);
      for (const id of [...out]) for (const u of f.unionsOf.get(id) ?? []) out.add(u.a === id ? u.b : u.a);
      return [...out].filter((id) => f.byId.has(id));
    }
  }
}

/**
 * The book's sections: one per house that has someone in it, in the family's order of houses, then the people without a
 * house. Within a section the oldest generation comes first, then the earlier born, then the name.
 */
export function bookSections(f: Family, ids: readonly string[], gen: ReadonlyMap<string, number> = generations(f)): BookSection[] {
  const by = new Map<string, string[]>();
  for (const id of ids) {
    const p = f.byId.get(id);
    if (!p) continue;
    const house = p.house && f.house.has(p.house) ? p.house : '';
    const list = by.get(house);
    if (list) list.push(id);
    else by.set(house, [id]);
  }
  const year = (id: string) => { const y = yearOf(f.byId.get(id)?.born); return Number.isFinite(y) ? y : Number.POSITIVE_INFINITY; };
  const name = (id: string) => { const p = nowNames(f.byId.get(id)!); return `${p.surname ?? ''} ${p.given}`; };
  const order = (a: string, b: string) => (gen.get(a) ?? 0) - (gen.get(b) ?? 0) || (year(a) === year(b) ? 0 : year(a) - year(b)) || name(a).localeCompare(name(b)) || a.localeCompare(b);
  const out: BookSection[] = [];
  for (const h of f.graph.houses) if (by.has(h.id)) out.push({ house: h.id, people: by.get(h.id)!.sort(order) });
  if (by.has('')) out.push({ house: '', people: by.get('')!.sort(order) });
  return out;
}

/**
 * About how many pages a book of these people comes to, before it is laid out: a cover, the contents, an opening per house,
 * the people (someone with memories or photos takes more room than a name and two dates), and the register. Good to one
 * significant figure, which is what "about 400 pages" promises.
 */
export function estimatePages(f: Family, sections: readonly BookSection[], o: { living: boolean; photos: boolean }): number {
  let pages = 2;
  let people = 0;
  for (const s of sections) {
    pages += 0.3;
    for (const id of s.people) {
      const p = f.byId.get(id);
      if (!p) continue;
      people++;
      if (isNamesOnly(p, o.living)) { pages += 0.2; continue; }
      const kin = (f.parentsOf.get(id)?.length ?? 0) + (f.unionsOf.get(id)?.length ?? 0) + (f.childrenOf.get(id)?.length ?? 0);
      pages += 0.36 + kin * 0.03 + p.stories * 0.2;
    }
  }
  pages += Math.ceil(people / 150) + 1;
  return Math.max(3, Math.round(pages));
}

/** A count rounded the way an estimate is said: 37 stays 37, 412 is "about 410", 1,873 "about 1,900". */
export function roundEstimate(n: number): number {
  if (n < 50) return n;
  const step = n < 200 ? 5 : n < 1000 ? 10 : 100;
  return Math.round(n / step) * step;
}

// ---------- the book: blocks on pages ----------

/** One block of a book, measured: it is never cut in two. */
export interface Block {
  key: string;
  /** Its height in CSS pixels, spacing included. */
  h: number;
  /** Stays on the same page as the block after it (a heading with its first line). */
  keep?: boolean;
}

export interface BookPage {
  keys: string[];
  used: number;
  /** The section this page belongs to, for its running head. */
  section: string;
}

/**
 * Lays groups of blocks on pages of one height, one group at a time. A group is one person's entry (or a house's opening,
 * the sources, the colophon). The rules a reader would expect of a printed book:
 *   a group that fits what is left of the page goes there whole;
 *   one that does not moves whole to a fresh page when little of this page is left; otherwise it starts here and breaks
 *   between blocks, never inside one, with a `keep` block (a person's head and family) held to the block after it;
 *   a section starts on a new page.
 */
/** A group may be split over two pages only when at least this share of the page is still free; with less it moves whole. */
const SPLIT_ROOM = 0.3;

export class Paginator {
  readonly pages: BookPage[] = [];
  private section = '';
  private readonly pageH: number;
  constructor(pageH: number, firstSection = '') {
    this.pageH = pageH;
    this.section = firstSection;
  }

  private get last(): BookPage | undefined { return this.pages[this.pages.length - 1]; }
  private fresh(): BookPage {
    const page: BookPage = { keys: [], used: 0, section: this.section };
    this.pages.push(page);
    return page;
  }
  private room(): number { return this.last ? this.pageH - this.last.used : 0; }
  private put(page: BookPage, blocks: readonly Block[]) {
    for (const b of blocks) { page.keys.push(b.key); page.used += b.h; }
  }

  /** Starts a section on a new page; the pages from here on carry its name. */
  startSection(section: string) {
    this.section = section;
    if (!this.last || this.last.keys.length) this.fresh();
    else this.last.section = section;
  }

  /** Adds one group, and returns the index of the page its first block is on. */
  add(group: readonly Block[]): number {
    if (!group.length) return Math.max(0, this.pages.length - 1);
    const total = group.reduce((s, b) => s + b.h, 0);
    let page = this.last ?? this.fresh();
    if (total <= this.room()) { this.put(page, group); return this.pages.length - 1; }
    // It does not fit what is left. With little left it starts on a fresh page, and then stays whole if it can.
    if (page.keys.length && this.room() < this.pageH * SPLIT_ROOM) page = this.fresh();
    if (total <= this.room()) { this.put(page, group); return this.pages.length - 1; }
    // Break between blocks, a `keep` block staying with the one after it.
    let first = -1;
    for (let i = 0; i < group.length;) {
      let j = i;
      while (group[j].keep && j + 1 < group.length) j++;
      let run = group.slice(i, j + 1);
      // A run taller than a page cannot be held together: its blocks go one by one.
      if (run.reduce((s, b) => s + b.h, 0) > this.pageH) run = [group[i]];
      const h = run.reduce((s, b) => s + b.h, 0);
      if (h > this.room() && page.keys.length) page = this.fresh();
      this.put(page, run);
      if (first < 0) first = this.pages.length - 1;
      i += run.length;
    }
    return first;
  }
}

// ---------- the register of names ----------

export interface RegisterLine { kind: 'letter' | 'name'; text: string; id?: string }

/** How a person is filed in the register: "Alder, Ada", by the name they go by now. */
export function registerName(p: GPerson): string {
  const n = nowNames(p);
  return n.surname ? `${n.surname}, ${n.given}` : n.given;
}

/** The register's lines: every person by surname then given name, under the first letter of what they are filed by. */
export function registerLines(f: Family, ids: readonly string[], compare: (a: string, b: string) => number): RegisterLine[] {
  const rows = ids.map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p).map((p) => ({ id: p.id, text: registerName(p), born: yearOf(p.born) }));
  rows.sort((a, b) => compare(a.text, b.text) || (Number.isFinite(a.born) ? a.born : 1e9) - (Number.isFinite(b.born) ? b.born : 1e9) || a.id.localeCompare(b.id));
  const out: RegisterLine[] = [];
  let letter = '';
  for (const r of rows) {
    const l = (r.text.normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '#').toUpperCase();
    if (l !== letter) { letter = l; out.push({ kind: 'letter', text: l }); }
    out.push({ kind: 'name', text: r.text, id: r.id });
  }
  return out;
}

/**
 * The register's lines in columns on pages: `perColumn` lines to a column (`firstPage` on the first page), `columns` to a
 * page. A letter is never the last line of a column (it would stand apart from its names), so it moves to the next one.
 */
export function registerPages(lines: readonly RegisterLine[], perColumn: number, columns: number, firstPage = perColumn): RegisterLine[][][] {
  const pages: RegisterLine[][][] = [];
  let column: RegisterLine[] = [];
  // The first page has a heading above its columns, so they are shorter.
  const room = () => (pages.length === 0 || (pages.length === 1 && pages[0].length < columns) ? firstPage : perColumn);
  const close = () => {
    if (!column.length) return;
    const page = pages[pages.length - 1];
    if (page && page.length < columns) page.push(column);
    else pages.push([column]);
    column = [];
  };
  for (const line of lines) {
    if (column.length >= room() || (line.kind === 'letter' && column.length >= room() - 1)) close();
    column.push(line);
  }
  close();
  return pages;
}
