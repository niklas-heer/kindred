// Tree layouts. Every view is a rooted tree drawn with a contour-packing tidy layout (subtrees slide
// as close as their outlines allow), so 300 dynasty members stay compact.
//
//  dynasty   — descendants of a root, optionally only those in the root's house (CK3's dynasty tree)
//  family    — hourglass around the focus: ancestors above, descendants below, siblings and partners beside.
//              Every partner of every person shown is drawn beside them (and their partners beside those), in
//              marriage order. A child hangs from the marriage it was born of, so a half-sibling or half-aunt
//              hangs from the other parent's union.
//  ancestors — the pedigree of the focus, deeper, with an empty slot for every unknown parent. Parents only:
//              other partners are not drawn here.
import { children, parents, sameParents, siblings, sortedUnions, yearOf, type Family } from './graph.ts';
import type { GUnion } from './types.ts';

export const CARD_W = 148;
export const CARD_H = 196;
export const GAP_X = 44;
export const ROW_H = CARD_H + 120;
/** Centre to centre of two people married to each other: the marriage line fills the space between the cards. */
const PAIR_W = CARD_W + 124;
/** Centre to centre of one marriage unit and the next one beside it. */
const UNIT_W = PAIR_W + CARD_W + GAP_X;

export type View = 'dynasty' | 'family' | 'ancestors';

export interface LNode {
  key: string; // unique per placement (a person can appear twice through cousin marriages)
  id: string;
  x: number; // centre
  y: number; // top
  row: number;
  role: 'main' | 'sibling' | 'partner' | 'kin' | 'dup' | 'ghost';
  /** Empty ancestor slot: whose parent is missing, and which one. */
  ghost?: { child: string; as: 'father' | 'mother' };
  /** Hidden descendants (collapsed) or children outside the house. */
  folded?: number;
  outOfHouse?: number;
  hasMore?: boolean; // there is more above/below than this view shows
}

export interface LEdge {
  key: string;
  d: string; // SVG path
  kind: 'line' | 'marriage';
  label?: { x: number; y: number; text: string; status?: string };
  dashed?: boolean; // disputed or not biological
  ids: string[]; // people this edge connects, for highlighting
}

export interface Layout {
  nodes: LNode[];
  edges: LEdge[];
  bounds: { x: number; y: number; w: number; h: number };
  rows: { row: number; y: number; year?: number }[];
  root: string;
}

export interface LayoutOptions {
  view: View;
  focus: string;
  root?: string;
  line: 'house' | 'all';
  up: number;
  down: number;
  collapsed: ReadonlySet<string>;
}

// ---------- marriages in a row ----------

/**
 * One marriage in a row of cards: `host` (the person, or a repeat of them) beside `partner`. The units of a person
 * are their own marriages, then each partner's other marriages, depth first, so every partner has a place.
 */
interface Unit { union: GUnion; host: string; partner: string }

function unitsOf(f: Family, id: string, avoidUnions: ReadonlySet<string> = new Set(), avoidPeople: ReadonlySet<string> = new Set()): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<string>(avoidUnions);
  const walk = (host: string) => {
    for (const u of sortedUnions(f, host)) {
      const partner = u.a === host ? u.b : u.a;
      if (seen.has(u.id) || !f.byId.has(partner) || avoidPeople.has(partner)) continue;
      seen.add(u.id);
      out.push({ union: u, host, partner });
      walk(partner);
    }
  };
  walk(id);
  return out;
}

// ---------- contour tidy tree ----------

interface Item { id: string; dx: number; depth: number; dup: boolean; parent: number; idx: number }
interface Sub {
  items: Item[];
  left: number[];
  right: number[];
}
/** A node's reach on its own row, relative to its centre. `idx` is its place among its parent's children. */
type Extent = (id: string, parent: string | undefined, idx: number, dup: boolean) => [number, number];

function tidy(rootId: string, kids: (id: string) => string[], maxDepth: number, extent: Extent = () => [-CARD_W / 2, CARD_W / 2]): Sub {
  const seen = new Set<string>();
  const build = (id: string, depth: number, parent: string | undefined, idx: number): Sub => {
    const dup = seen.has(id);
    seen.add(id);
    const [leftEdge, rightEdge] = extent(id, parent, idx, dup);
    const cs = dup || depth >= maxDepth ? [] : kids(id);
    if (!cs.length) return { items: [{ id, dx: 0, depth: 0, dup, parent: -1, idx }], left: [leftEdge], right: [rightEdge] };
    const subs = cs.map((c, i) => build(c, depth + 1, id, i));
    const offsets = [0];
    let right = [...subs[0].right];
    for (let i = 1; i < subs.length; i++) {
      const s = subs[i];
      let shift = -Infinity;
      for (let d = 0; d < Math.min(right.length, s.left.length); d++) shift = Math.max(shift, right[d] - s.left[d] + GAP_X);
      offsets.push(shift);
      const merged = [...right];
      s.right.forEach((r, d) => (merged[d] = Math.max(merged[d] ?? -Infinity, r + shift)));
      right = merged;
    }
    const centre = (offsets[0] + offsets[offsets.length - 1]) / 2;
    const items: Item[] = [{ id, dx: 0, depth: 0, dup, parent: -1, idx }];
    const left: number[] = [leftEdge];
    const rightC: number[] = [rightEdge];
    subs.forEach((s, i) => {
      const o = offsets[i] - centre;
      const base = items.length;
      for (const it of s.items) items.push({ ...it, dx: it.dx + o, depth: it.depth + 1, parent: it.parent < 0 ? 0 : it.parent + base });
      s.left.forEach((l, d) => (left[d + 1] = Math.min(left[d + 1] ?? Infinity, l + o)));
      s.right.forEach((r, d) => (rightC[d + 1] = Math.max(rightC[d + 1] ?? -Infinity, r + o)));
    });
    return { items, left, right: rightC };
  };
  return build(rootId, 0, undefined, 0);
}

/** Placed children per placed parent, by index into the tidy items. */
function childIndex(items: Item[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  items.forEach((it, i) => it.parent >= 0 && (m.get(it.parent) ?? m.set(it.parent, []).get(it.parent)!).push(i));
  return m;
}

// ---------- edges ----------

/** Orthogonal connector from one person to their children, CK3 style: down, across, down. */
function forkDown(key: string, from: { x: number; y: number }, kids: { x: number; y: number; id: string; dashed?: boolean }[], fromId: string, lane?: number): LEdge[] {
  if (!kids.length) return [];
  const y0 = from.y + CARD_H;
  const mid = lane ?? kids[0].y - (ROW_H - CARD_H) / 2;
  const xs = kids.map((k) => k.x);
  const lo = Math.min(from.x, ...xs), hi = Math.max(from.x, ...xs);
  const solid = kids.filter((k) => !k.dashed);
  const edges: LEdge[] = [
    {
      key: `${key}:trunk`,
      kind: 'line',
      d: `M${from.x},${y0}V${mid}M${lo},${mid}H${hi}` + solid.map((k) => `M${k.x},${mid}V${k.y}`).join(''),
      ids: [fromId, ...kids.map((k) => k.id)],
    },
  ];
  for (const k of kids.filter((k) => k.dashed)) edges.push({ key: `${key}:${k.id}`, kind: 'line', dashed: true, d: `M${k.x},${mid}V${k.y}`, ids: [fromId, k.id] });
  return edges;
}

/** Connector from a person up to their parents (pedigree, drawn upside down). */
function forkUp(key: string, from: { x: number; y: number }, ps: { x: number; y: number; id: string; dashed?: boolean }[], fromId: string): LEdge[] {
  if (!ps.length) return [];
  const mid = from.y - (ROW_H - CARD_H) / 2;
  const xs = ps.map((p) => p.x);
  const lo = Math.min(from.x, ...xs), hi = Math.max(from.x, ...xs);
  const edges: LEdge[] = [
    {
      key: `${key}:up`,
      kind: 'line',
      d: `M${from.x},${from.y}V${mid}M${lo},${mid}H${hi}` + ps.filter((p) => !p.dashed).map((p) => `M${p.x},${mid}V${p.y + CARD_H}`).join(''),
      ids: [fromId, ...ps.map((p) => p.id)],
    },
  ];
  for (const p of ps.filter((p) => p.dashed)) edges.push({ key: `${key}:up:${p.id}`, kind: 'line', dashed: true, d: `M${p.x},${mid}V${p.y + CARD_H}`, ids: [fromId, p.id] });
  return edges;
}

/** How far apart the lines of a couple who married more than once are stacked: clear of a two-line plate (41 tall). */
const REMARRIED_STEP = 48;

/** The marriage line between two cards on one row, labelled with the years it lasted. `lift` raises a repeat union. */
function marriageEdge(key: string, u: GUnion, lx: number, rx: number, y: number, ids: string[], lift = 0): LEdge {
  const start = yearOf(u.start), end = yearOf(u.end);
  const cy = y + CARD_H * 0.42 - lift;
  return {
    key: `${key}:marriage:${u.id}`,
    kind: 'marriage',
    ids,
    dashed: !!u.end,
    d: `M${lx + CARD_W / 2},${cy}H${rx - CARD_W / 2}`,
    label: {
      x: (lx + rx) / 2,
      y: cy - 9,
      text: `${u.kind === 'marriage' ? '⚭' : '◇'}${Number.isFinite(start) ? ` ${start}` : ''}${Number.isFinite(end) ? `–${end}` : ''}`,
      status: u.endReason === 'death' ? 'widowed' : u.endReason === 'divorce' ? 'divorced' : u.endReason ? 'ended' : undefined,
    },
  };
}

// ---------- views ----------

export function rootFor(f: Family, focus: string, line: 'house' | 'all'): string {
  if (line === 'house') {
    // Climb towards the oldest ancestor, staying in the focus's house.
    const house = f.byId.get(focus)?.house;
    let id = focus;
    for (let i = 0; i < 60; i++) {
      const ps = parents(f, id).filter((p) => f.byId.get(p)?.house === house);
      if (!ps.length) break;
      id = ps[0];
    }
    return id;
  }
  // Every line: the topmost ancestor with the biggest family below them.
  const seen = new Set<string>([focus]);
  const stack = [focus];
  const tops: string[] = [];
  while (stack.length) {
    const x = stack.pop()!;
    const ps = parents(f, x);
    if (!ps.length) tops.push(x);
    for (const p of ps) if (!seen.has(p)) { seen.add(p); stack.push(p); }
  }
  let best = focus, size = -1;
  for (const t of tops) {
    const n = countDesc(f, t, () => true);
    if (n > size) { best = t; size = n; }
  }
  return best;
}

export function layout(f: Family, o: LayoutOptions): Layout {
  if (!f.byId.has(o.focus)) o = { ...o, focus: f.graph.tree.focus };
  if (o.view === 'dynasty') return dynasty(f, o);
  if (o.view === 'ancestors') {
    const p = pedigree(f, o.focus, Math.max(o.up, 6), { slots: true });
    return finish(p.nodes, p.edges, f, o.focus);
  }
  return hourglass(f, o);
}

function finish(nodes: LNode[], edges: LEdge[], f: Family, root: string): Layout {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const byRow = new Map<number, number[]>();
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - CARD_W / 2);
    x1 = Math.max(x1, n.x + CARD_W / 2);
    y0 = Math.min(y0, n.y);
    y1 = Math.max(y1, n.y + CARD_H);
    const y = yearOf(f.byId.get(n.id)?.born);
    if (!isNaN(y) && n.role !== 'dup') (byRow.get(n.row) ?? byRow.set(n.row, []).get(n.row)!).push(y);
  }
  const rows = [...new Set(nodes.map((n) => n.row))].sort((a, b) => a - b).map((row) => {
    const ys = (byRow.get(row) ?? []).sort((a, b) => a - b);
    return { row, y: row * ROW_H, year: ys.length ? ys[Math.floor(ys.length / 2)] : undefined };
  });
  return { nodes, edges, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rows, root };
}

function dynasty(f: Family, o: LayoutOptions): Layout {
  const root = o.root && f.byId.has(o.root) ? o.root : rootFor(f, o.focus, o.line);
  const house = f.byId.get(root)?.house;
  const inLine = (id: string) => o.line === 'all' || f.byId.get(id)?.house === house;
  const kids = (id: string) => (o.collapsed.has(id) ? [] : children(f, id).filter(inLine));
  const { nodes, edges } = familyUnits(f, root, kids, 99, o.collapsed);
  for (const n of nodes.filter((n) => n.role === 'main')) {
    if (o.collapsed.has(n.id)) n.folded = countDesc(f, n.id, inLine);
    n.outOfHouse = children(f, n.id).filter((c) => !inLine(c)).length || undefined;
    n.hasMore = n.row === 0 && parents(f, n.id).length > 0;
  }
  return finish(nodes, edges, f, root);
}

function countDesc(f: Family, id: string, inLine: (id: string) => boolean): number {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) for (const c of children(f, stack.pop()!)) if (inLine(c) && !seen.has(c)) { seen.add(c); stack.push(c); }
  return seen.size;
}

const GHOST = '?';
export const isGhost = (id: string) => id.startsWith(GHOST);

/** Father and mother slots; an unknown one becomes a ghost id when `slots` is on. */
function parentSlots(f: Family, id: string, slots: boolean): string[] {
  const ps = parents(f, id);
  if (!slots || isGhost(id)) return ps;
  let father = ps.find((p) => f.byId.get(p)?.sex === 'm');
  let mother = ps.find((p) => f.byId.get(p)?.sex === 'f');
  for (const p of ps) {
    if (p === father || p === mother) continue;
    if (!father) father = p;
    else if (!mother) mother = p;
  }
  // Recorded parents beyond the two slots (a step-parent, say) still show, after them.
  const rest = ps.filter((p) => p !== father && p !== mother);
  return [father ?? `${GHOST}${id}:father`, mother ?? `${GHOST}${id}:mother`, ...rest];
}

/** Every union between two people, oldest first (a couple can marry, part and marry again). */
const unionsBetween = (f: Family, a: string, b: string) => sortedUnions(f, a).filter((u) => u.a === b || u.b === b);

/** A node's place in the drawn tree: where its unions are, and what each union joins. */
interface Joined { a: string; b: string; x: number; row: number }

interface Top {
  nodes: LNode[];
  edges: LEdge[];
  /** Every union drawn in this tree: its two cards' middle, and its row. Children of a union hang from here. */
  unions: Map<string, Joined>;
  /** The people drawn in the tree (not repeats). */
  ids: Set<string>;
}

/**
 * The pedigree of `focus` up to `up` generations. With `partners`, each ancestor's other partners are drawn
 * beside them, outward of the line (the family view); without it, only the parent slots are drawn (ancestors).
 */
function pedigree(f: Family, focus: string, up: number, opts: { slots?: boolean; partners?: boolean } = {}): Top {
  const slots = !!opts.slots;
  const withPartners = !!opts.partners;
  const others = (id: string, spouse: string | undefined) =>
    unitsOf(f, id, new Set(spouse ? unionsBetween(f, id, spouse).map((u) => u.id) : []), new Set([focus, ...(spouse ? [spouse] : [])]));
  // Which half of the tree each ancestor is on: their other marriages should open away from the middle.
  const half = new Map<string, -1 | 1>();
  if (withPartners) {
    const walk = (id: string, side: -1 | 1) => {
      if (half.has(id)) return;
      half.set(id, side);
      for (const p of parents(f, id)) walk(p, side);
    };
    parents(f, focus).forEach((p, i) => walk(p, i === 0 ? -1 : 1));
  }
  // A couple's other marriages open sideways from each spouse, so the spouse with others takes the outer place:
  // the connector to those children then runs outward and never crosses this couple's own line of descent.
  const ordered = new Map<string, string[]>();
  const parentsOf = (id: string): string[] => {
    let ps = ordered.get(id);
    if (ps) return ps;
    ps = parentSlots(f, id, slots);
    const side = half.get(id);
    if (withPartners && side && ps.length >= 2) {
      const [inner, outer] = side < 0 ? [ps[1], ps[0]] : [ps[0], ps[1]];
      if (others(inner, outer).length && !others(outer, inner).length) ps = [ps[1], ps[0], ...ps.slice(2)];
    }
    ordered.set(id, ps);
    return ps;
  };
  // The marriage an ancestor has with the other parent of their child stays on the line; the rest go outward.
  const spouseOnLine = (parent: string, idx: number) => (idx < 2 ? parentsOf(parent)[1 - idx] : undefined);
  const outward = (id: string, parent: string | undefined, idx: number): Unit[] => {
    if (!withPartners || parent === undefined || isGhost(id)) return [];
    const spouse = spouseOnLine(parent, idx);
    const own = others(id, spouse);
    const side = half.get(parent);
    if (!side || spouse === undefined) return own;
    // Both spouses married again. An inner spouse's other marriages would open towards the middle, and their children,
    // placed outward, would cross this couple's own line of descent. So they go past the outer spouse's, beside a repeat.
    const outerIdx = side < 0 ? 0 : 1;
    const theirs = others(spouse, id);
    if (idx !== outerIdx) return own.length && theirs.length ? [] : own;
    if (!own.length) return own;
    const drawn = new Set(own.map((u) => u.union.id));
    return [...own, ...theirs.filter((u) => !drawn.has(u.union.id))];
  };
  const t = tidy(focus, parentsOf, up, (id, parent, idx, dup) => {
    const units = dup ? [] : outward(id, parent, idx);
    const [l, r]: [number, number] = units.length ? besideSpan(units, idx === 0 ? -1 : 1) : [-CARD_W / 2, CARD_W / 2];
    // Leave room for the marriage line between the two parents.
    const married = withPartners && parent !== undefined && idx === 0 && unionsBetween(f, id, spouseOnLine(parent, 0) ?? '').length > 0;
    return [l, married ? r + PAIR_W - CARD_W - GAP_X : r];
  });
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  const ids = new Set<string>();
  const unions = new Map<string, Joined>();
  for (const it of t.items) {
    const row = -it.depth, y = row * ROW_H;
    if (isGhost(it.id)) {
      const [child, as] = it.id.slice(GHOST.length).split(':') as [string, 'father' | 'mother'];
      nodes.push({ key: it.id, id: it.id, x: it.dx, y, row, role: 'ghost', ghost: { child, as } });
      continue;
    }
    if (!it.dup) ids.add(it.id);
    nodes.push({
      key: it.dup ? `${it.id}#dup${it.dx}` : it.id,
      id: it.id,
      x: it.dx,
      y,
      row,
      role: it.dup ? 'dup' : 'main',
      hasMore: it.depth === up && parents(f, it.id).length > 0,
    });
  }
  if (withPartners) {
    t.items.forEach((it, i) => {
      if (it.parent < 0 || it.dup || isGhost(it.id)) return;
      const node = nodes[i];
      const dir = it.idx === 0 ? -1 : 1;
      const units = outward(it.id, t.items[it.parent].id, it.idx);
      const placed = besideCards(units, dir);
      placed.forEach((c, k) => {
        const hx = node.x + c.hostX, px = node.x + c.partnerX;
        if (k > 0) nodes.push({ key: `${node.key}:repeat:${c.union.id}`, id: c.host, x: hx, y: node.y, row: node.row, role: 'dup', hasMore: false });
        nodes.push({ key: `${node.key}:partner:${c.union.id}`, id: c.partner, x: px, y: node.y, row: node.row, role: 'partner', hasMore: parents(f, c.partner).length + children(f, c.partner).length > 0 });
        edges.push(marriageEdge(node.key, c.union, Math.min(hx, px), Math.max(hx, px), node.y, [c.host, c.partner]));
        unions.set(c.union.id, { a: c.host, b: c.partner, x: (hx + px) / 2, row: node.row });
      });
    });
  }
  // The pedigree's own unions: a child's two parents meet at the midpoint of their two cards.
  for (const pis of childIndex(t.items).values()) {
    if (pis.length < 2) continue;
    const [a, b] = [nodes[pis[0]], nodes[pis[1]]];
    for (const u of unionsBetween(f, a.id, b.id)) if (!unions.has(u.id)) unions.set(u.id, { a: a.id, b: b.id, x: (a.x + b.x) / 2, row: a.row });
  }
  for (const [ci, pis] of childIndex(t.items)) {
    const n = nodes[ci];
    let ps = pis.map((pi) => nodes[pi]);
    const couple = withPartners && ps.length >= 2 ? unionsBetween(f, ps[0].id, ps[1].id) : [];
    if (couple.length) {
      // The family view: the parents' marriage is drawn, and the child hangs from the middle of it.
      const [a, b] = ps;
      couple.forEach((u, k) => edges.push(marriageEdge(n.key, u, a.x, b.x, a.y, [a.id, b.id], k * REMARRIED_STEP)));
      const dashed = [a, b].some((p) => f.disputed.has(`${n.id}>${p.id}`) || f.linkKind.has(`${n.id}>${p.id}`));
      const trunk = forkDown(`${n.key}:couple`, { x: (a.x + b.x) / 2, y: a.y + CARD_H * 0.42 - CARD_H }, [{ x: n.x, y: n.y, id: n.id, dashed }], a.id, n.y - (ROW_H - CARD_H) / 2);
      trunk.forEach((e) => e.ids.push(b.id));
      edges.push(...trunk);
      ps = ps.slice(2);
    }
    edges.push(...forkUp(n.key, n, ps.map((p) => ({ x: p.x, y: p.y, id: p.id, dashed: p.role === 'ghost' || f.disputed.has(`${n.id}>${p.id}`) })), n.id));
  }
  return { nodes, edges, unions, ids };
}

/** Each card beside a person, relative to their centre: the host of a marriage and its partner. */
interface Placed { union: GUnion; host: string; partner: string; hostX: number; partnerX: number }

/** Marriages beside a person on side `dir` (−1 left, +1 right), nearest first. Repeats keep every marriage line between neighbours. */
function besideCards(units: Unit[], dir: -1 | 1): Placed[] {
  return units.map((u, k) => {
    const hostX = dir * k * UNIT_W;
    return { union: u.union, host: u.host, partner: u.partner, hostX, partnerX: hostX + dir * PAIR_W };
  });
}

function besideSpan(units: Unit[], dir: -1 | 1): [number, number] {
  let l = -CARD_W / 2, r = CARD_W / 2;
  for (const c of besideCards(units, dir)) {
    for (const x of [c.hostX, c.partnerX]) {
      l = Math.min(l, x - CARD_W / 2);
      r = Math.max(r, x + CARD_W / 2);
    }
  }
  return [l, r];
}

/**
 * A group of kin hanging from one union (or from one parent alone, when the other parent is unknown or not
 * drawn). `anchorX` is where the connector starts, `fromY` its top.
 */
interface KinGroup {
  id: string;
  from: string;
  row: number;
  anchorX: number;
  fromY: number;
  partner?: string;
  kids: string[];
  /** Which side of the focus the group is placed on. Defaults to the side of its anchor. */
  side?: -1 | 1;
  /** The height of the connector's bar. Defaults to the middle of the gap below the group's row. */
  lane?: number;
  role: 'kin' | 'sibling';
}

/**
 * Children of the drawn ancestors who are not on the focus's line: aunts and uncles from the grandparents'
 * unions and half-siblings from the parents' other unions. Every child is claimed once.
 */
function kinGroups(f: Family, top: Top, claimed: Set<string>, fullSibs: ReadonlySet<string>): KinGroup[] {
  const out: KinGroup[] = [];
  for (const [uid, j] of top.unions) {
    if (j.row !== -1 && j.row !== -2) continue;
    const kids = children(f, j.a).filter((c) => !claimed.has(c) && !(j.row === -1 && fullSibs.has(c)) && parents(f, c).includes(j.b));
    if (!kids.length) continue;
    out.push({ id: uid, from: j.a, row: j.row, anchorX: j.x, fromY: j.row * ROW_H + CARD_H * 0.42, partner: j.b, kids, role: 'kin' });
    kids.forEach((c) => claimed.add(c));
  }
  // Children whose other parent is not drawn: they hang from their parent alone.
  for (const n of top.nodes) {
    if (n.role !== 'main' || (n.row !== -1 && n.row !== -2)) continue;
    const solo = children(f, n.id).filter((c) => !claimed.has(c) && !(n.row === -1 && fullSibs.has(c)));
    if (!solo.length) continue;
    out.push({ id: `solo:${n.key}`, from: n.id, row: n.row, anchorX: n.x, fromY: n.y + CARD_H, kids: solo, role: 'kin' });
    solo.forEach((c) => claimed.add(c));
  }
  return out;
}

/**
 * Places one kin group outward of everything already on its rows, so nothing overlaps, with each child's own
 * partners and, for aunts, their children. The connector starts at the union the children came from.
 */
function placeKin(f: Family, g: KinGroup, placed: LNode[], claimed: Set<string>, collapsed: ReadonlySet<string>): { nodes: LNode[]; edges: LEdge[] } {
  const depth = g.row === -2 ? 1 : 0; // aunts keep their own children; half-siblings and siblings stand alone
  const kidRow = g.row + 1;
  const rows = Array.from({ length: depth + 1 }, (_, i) => kidRow + i);
  const kidsOf = (id: string) => (collapsed.has(id) ? [] : children(f, id).filter((c) => !claimed.has(c)));
  const prefix = `g:${g.id}:`;
  // Widths are measured with each block at the origin; moving a block does not change its width.
  const widths = g.kids.map((c) => {
    const m = familyUnits(f, c, kidsOf, depth, collapsed, { x: 0, y: 0, row: 0 }, `${prefix}${c}:`);
    return { minL: Math.min(...m.nodes.map((n) => n.x - CARD_W / 2)), maxR: Math.max(...m.nodes.map((n) => n.x + CARD_W / 2)) };
  });
  const side = g.side ?? (g.anchorX < 0 ? -1 : 1);
  const inRows = placed.filter((n) => rows.includes(n.row));
  // Start from the nearest card already on these rows, but never farther out than the anchor needs.
  let edge = side < 0
    ? Math.min(g.anchorX + CARD_W / 2, ...inRows.map((n) => n.x - CARD_W / 2))
    : Math.max(g.anchorX - CARD_W / 2, ...inRows.map((n) => n.x + CARD_W / 2));
  const rootX: number[] = [];
  const order = g.kids.map((_, i) => i);
  if (side < 0) order.reverse(); // the eldest ends furthest out, as on the other side
  for (const i of order) {
    const w = widths[i];
    const off = side < 0 ? edge - 2 * GAP_X - w.maxR : edge + 2 * GAP_X - w.minL;
    edge = side < 0 ? off + w.minL : off + w.maxR;
    rootX[i] = off;
  }
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  g.kids.forEach((c, i) => {
    const m = familyUnits(f, c, kidsOf, depth, collapsed, { x: rootX[i], y: kidRow * ROW_H, row: kidRow }, `${prefix}${c}:`);
    for (const n of m.nodes) nodes.push(n.id === c && n.row === kidRow && n.role === 'main' ? { ...n, role: g.role } : n);
    edges.push(...m.edges);
  });
  const roots = g.kids.map((c, i) => ({ x: rootX[i], y: kidRow * ROW_H, id: c, dashed: parents(f, c).some((p) => f.disputed.has(`${c}>${p}`) || f.linkKind.has(`${c}>${p}`)) }));
  const lane = g.lane ?? kidRow * ROW_H - (ROW_H - CARD_H) / 2;
  const trunk = forkDown(`g:${g.id}`, { x: g.anchorX, y: g.fromY - CARD_H }, roots, g.from, lane);
  if (g.partner) for (const e of trunk) e.ids.push(g.partner);
  edges.push(...trunk);
  return { nodes, edges };
}

function hourglass(f: Family, o: LayoutOptions): Layout {
  const focus = o.focus;
  const top = pedigree(f, focus, o.up, { partners: true });
  // Descendants below the focus, with every marriage of each person.
  const units = familyUnits(f, focus, (id) => (o.collapsed.has(id) ? [] : children(f, id)), o.down, o.collapsed);
  const focusNode = top.nodes.find((n) => n.id === focus && n.role === 'main')!;
  const unitFocus = units.nodes.find((n) => n.id === focus)!;
  focusNode.folded = unitFocus.folded;
  focusNode.hasMore = false;
  const down = units.nodes.filter((n) => n.key !== unitFocus.key);

  // Full siblings (the same two parents) hang from the parents' fork, older on the left, younger on the right.
  const sibs = siblings(f, focus).filter((s) => sameParents(f, s, focus));
  const by = yearOf(f.byId.get(focus)?.born);
  const older = sibs.filter((s) => yearOf(f.byId.get(s)?.born) < by || isNaN(by));
  const younger = sibs.filter((s) => !older.includes(s));
  const claimed = new Set<string>([...top.ids, focus]);
  const groups: KinGroup[] = [];
  const [p0, p1] = parents(f, focus);
  if (sibs.length && p0) {
    const bar = p1 ? sortedUnions(f, p0).find((u) => u.a === p1 || u.b === p1) : undefined;
    const fork = bar ? top.unions.get(bar.id) : undefined;
    const parentNode = top.nodes.find((n) => n.id === p0 && n.role === 'main');
    const anchorX = fork ? fork.x : parentNode?.x;
    if (anchorX !== undefined) {
      const fromY = bar ? (fork!.row * ROW_H) + CARD_H * 0.42 : parentNode!.y + CARD_H;
      const base = { from: p0, partner: bar ? p1 : undefined, row: -1, anchorX, fromY, role: 'sibling' as const };
      if (older.length) groups.push({ ...base, id: `sibs:older:${focus}`, kids: older, side: -1 });
      if (younger.length) groups.push({ ...base, id: `sibs:younger:${focus}`, kids: younger, side: 1 });
      [...older, ...younger].forEach((s) => claimed.add(s));
    }
  }
  groups.push(...kinGroups(f, top, claimed, new Set(sibs)));

  // Nearest groups first, so each one is placed beyond the ones before it on its side.
  groups.sort((a, b) => Math.abs(a.anchorX) - Math.abs(b.anchorX));
  // Each marriage's children get a bar of their own. The farther out a group starts, the higher its bar, so its
  // trunk stops above the bars of the nearer groups and its children, placed beyond theirs, are never crossed.
  const fans = new Map<string, KinGroup[]>();
  for (const g of groups) {
    const fan = `${g.row}:${g.side ?? (g.anchorX < 0 ? -1 : 1)}`;
    (fans.get(fan) ?? fans.set(fan, []).get(fan)!).push(g);
  }
  for (const fan of fans.values()) {
    const step = Math.min(32, 48 / Math.max(1, fan.length - 1));
    fan.forEach((g, k) => { if (k) g.lane = g.row * ROW_H + CARD_H + 60 - k * step; });
  }
  const placed: LNode[] = [...top.nodes, ...down];
  const kin = { nodes: [] as LNode[], edges: [] as LEdge[] };
  for (const g of groups) {
    const r = placeKin(f, g, placed, claimed, o.collapsed);
    kin.nodes.push(...r.nodes);
    placed.push(...r.nodes);
    kin.edges.push(...r.edges);
  }

  const nodes = [...top.nodes, ...down, ...kin.nodes];
  const edges = [...top.edges, ...kin.edges, ...units.edges];
  return finish(nodes, edges, f, focus);
}

/**
 * The descendants of `root` with every marriage of each person: a person's marriages are drawn beside them,
 * then each partner's other marriages beside the partner, and each child hangs from the marriage it was born of.
 * `at` moves the block; `prefix` keeps its keys unique when several blocks share one layout.
 */
function familyUnits(
  f: Family,
  root: string,
  kids: (id: string) => string[],
  depth: number,
  collapsed: ReadonlySet<string>,
  at: { x: number; y: number; row: number } = { x: 0, y: 0, row: 0 },
  prefix = '',
) {
  const chains = new Map<string, Unit[]>();
  const chain = (id: string) => {
    let c = chains.get(id);
    if (!c) chains.set(id, (c = unitsOf(f, id)));
    return c;
  };
  // Which marriage a child belongs to: the one joining both of its parents, else the one with either parent.
  const groupOf = (id: string, child: string) => {
    const ps = parents(f, child);
    let best = -1, score = 0;
    chain(id).forEach((u, i) => {
      const s = (ps.includes(u.host) && ps.includes(u.partner) ? 2 : 0) + (ps.includes(u.partner) && f.linkKind.get(`${child}>${u.partner}`) !== 'step' ? 1 : 0);
      if (s > score) { score = s; best = i; }
    });
    return best;
  };
  const people = (id: string) => [...new Set([id, ...chain(id).map((u) => u.partner)])];
  const t = tidy(root, (id) => {
    const cs = [...new Set(people(id).flatMap((p) => kids(p)))];
    return cs.sort((a, b) => groupOf(id, a) - groupOf(id, b) || yearOf(f.byId.get(a)?.born) - yearOf(f.byId.get(b)?.born));
  }, depth, (id) => {
    const m = chain(id).length;
    return [-CARD_W / 2, CARD_W / 2 + (m ? (m - 1) * UNIT_W + PAIR_W : 0)];
  });
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  const main = t.items.map((it, i): LNode => ({
    key: `${prefix}${it.id}:unit:${i}`,
    id: it.id,
    x: it.dx + at.x,
    y: it.depth * ROW_H + at.y,
    row: it.depth + at.row,
    role: it.dup ? 'dup' : 'main',
    folded: collapsed.has(it.id) && !it.dup ? countDesc(f, it.id, () => true) : undefined,
    hasMore: it.depth === depth && children(f, it.id).length > 0,
  }));
  const index = childIndex(t.items);
  main.forEach((n, i) => {
    nodes.push(n);
    const us = chain(n.id);
    const cs = (index.get(i) ?? []).map((ci) => main[ci]);
    us.forEach((u, j) => {
      const x = n.x + j * UNIT_W;
      if (j) nodes.push({ key: `${n.key}:repeat:${u.union.id}`, id: u.host, x, y: n.y, row: n.row, role: 'dup', hasMore: false });
      const sp = u.partner;
      nodes.push({ key: `${n.key}:partner:${u.union.id}`, id: sp, x: x + PAIR_W, y: n.y, row: n.row, role: 'partner', hasMore: true });
      edges.push(marriageEdge(n.key, u.union, x, x + PAIR_W, n.y, [u.host, sp]));
      const cx = x + PAIR_W / 2, cy = n.y + CARD_H * 0.42;
      const unionKids = cs.filter((c) => groupOf(n.id, c.id) === j);
      const branches = forkDown(`${n.key}:${u.union.id}`, { x: cx, y: n.y }, unionKids.map((c) => ({ ...c, dashed: f.disputed.has(`${c.id}>${n.id}`) || !!f.linkKind.get(`${c.id}>${n.id}`) || f.disputed.has(`${c.id}>${sp}`) || !!f.linkKind.get(`${c.id}>${sp}`) })), n.id, n.y + CARD_H + 28 + j * (64 / Math.max(1, us.length)));
      if (branches.length) branches[0].d = `M${cx},${cy}V${n.y + CARD_H}` + branches[0].d;
      branches.forEach((e) => e.ids.push(sp));
      edges.push(...branches);
    });
    edges.push(...forkDown(`${n.key}:unpaired`, n, cs.filter((c) => groupOf(n.id, c.id) < 0).map((c) => ({ ...c, dashed: f.disputed.has(`${c.id}>${n.id}`) || !!f.linkKind.get(`${c.id}>${n.id}`) })), n.id));
  });
  return { nodes, edges };
}
