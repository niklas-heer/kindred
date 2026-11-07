// Tree layouts. Every view is a rooted tree drawn with a contour-packing tidy layout (subtrees slide
// as close as their outlines allow), so 300 dynasty members stay compact.
//
//  dynasty   — descendants of a root, optionally only those in the root's house (CK3's dynasty tree)
//  family    — hourglass around the focus: ancestors above, descendants below, siblings and partners beside,
//              aunts, uncles and cousins on each parent's side
//  ancestors — the pedigree of the focus, deeper, with an empty slot for every unknown parent
import { children, partnersOf, parents, siblings, yearOf, type Family } from './graph';

export const CARD_W = 148;
export const CARD_H = 196;
export const GAP_X = 22;
export const ROW_H = CARD_H + 92;

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

// ---------- contour tidy tree ----------

interface Item { id: string; dx: number; depth: number; dup: boolean; parent: number }
interface Sub {
  items: Item[];
  left: number[];
  right: number[];
}

function tidy(rootId: string, kids: (id: string) => string[], maxDepth: number): Sub {
  const seen = new Set<string>();
  const half = CARD_W / 2;
  const build = (id: string, depth: number): Sub => {
    const dup = seen.has(id);
    seen.add(id);
    const cs = dup || depth >= maxDepth ? [] : kids(id);
    if (!cs.length) return { items: [{ id, dx: 0, depth: 0, dup, parent: -1 }], left: [-half], right: [half] };
    const subs = cs.map((c) => build(c, depth + 1));
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
    const items: Item[] = [{ id, dx: 0, depth: 0, dup, parent: -1 }];
    const left: number[] = [-half];
    const rightC: number[] = [half];
    subs.forEach((s, i) => {
      const o = offsets[i] - centre;
      const base = items.length;
      for (const it of s.items) items.push({ ...it, dx: it.dx + o, depth: it.depth + 1, parent: it.parent < 0 ? 0 : it.parent + base });
      s.left.forEach((l, d) => (left[d + 1] = Math.min(left[d + 1] ?? Infinity, l + o)));
      s.right.forEach((r, d) => (rightC[d + 1] = Math.max(rightC[d + 1] ?? -Infinity, r + o)));
    });
    return { items, left, right: rightC };
  };
  return build(rootId, 0);
}

/** Placed children per placed parent, by index into the tidy items. */
function childIndex(items: Item[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  items.forEach((it, i) => it.parent >= 0 && (m.get(it.parent) ?? m.set(it.parent, []).get(it.parent)!).push(i));
  return m;
}

// ---------- edges ----------

/** Orthogonal connector from one person to their children, CK3 style: down, across, down. */
function forkDown(key: string, from: { x: number; y: number }, kids: { x: number; y: number; id: string; dashed?: boolean }[], fromId: string): LEdge[] {
  if (!kids.length) return [];
  const y0 = from.y + CARD_H;
  const mid = kids[0].y - (ROW_H - CARD_H) / 2;
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
  if (o.view === 'ancestors') return pedigree(f, o.focus, Math.max(o.up, 6), true);
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
  const t = tidy(root, kids, 99);
  const nodes: LNode[] = [];
  for (const it of t.items) {
    const all = children(f, it.id);
    const inside = all.filter(inLine);
    const n: LNode = {
      key: it.dup ? `${it.id}#dup${it.dx}` : it.id,
      id: it.id,
      x: it.dx,
      y: it.depth * ROW_H,
      row: it.depth,
      role: it.dup ? 'dup' : 'main',
      folded: o.collapsed.has(it.id) && !it.dup ? countDesc(f, it.id, inLine) : undefined,
      outOfHouse: all.length - inside.length || undefined,
      hasMore: it.depth === 0 && parents(f, it.id).length > 0,
    };
    nodes.push(n);
  }
  const edges: LEdge[] = [];
  for (const [pi, cis] of childIndex(t.items)) {
    const n = nodes[pi];
    edges.push(...forkDown(n.key, n, cis.map((ci) => nodes[ci]).map((c) => ({ x: c.x, y: c.y, id: c.id, dashed: f.disputed.has(`${c.id}>${n.id}`) || f.linkKind.has(`${c.id}>${n.id}`) })), n.id));
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
  return [father ?? `${GHOST}${id}:father`, mother ?? `${GHOST}${id}:mother`];
}

function pedigree(f: Family, focus: string, up: number, slots = false): Layout {
  const t = tidy(focus, (id) => parentSlots(f, id, slots), up);
  const nodes: LNode[] = t.items.map((it) => {
    if (isGhost(it.id)) {
      const [child, as] = it.id.slice(GHOST.length).split(':') as [string, 'father' | 'mother'];
      return { key: it.id, id: it.id, x: it.dx, y: -it.depth * ROW_H, row: -it.depth, role: 'ghost', ghost: { child, as } };
    }
    return {
      key: it.dup ? `${it.id}#dup${it.dx}` : it.id,
      id: it.id,
      x: it.dx,
      y: -it.depth * ROW_H,
      row: -it.depth,
      role: it.dup ? 'dup' : 'main',
      hasMore: it.depth === up && parents(f, it.id).length > 0,
    };
  });
  const edges: LEdge[] = [];
  for (const [ci, pis] of childIndex(t.items)) {
    const n = nodes[ci];
    edges.push(...forkUp(n.key, n, pis.map((pi) => nodes[pi]).map((p) => ({ x: p.x, y: p.y, id: p.id, dashed: p.role === 'ghost' || f.disputed.has(`${n.id}>${p.id}`) })), n.id));
  }
  return finish(nodes, edges, f, focus);
}

/**
 * A parent's brothers and sisters with their children, packed outward from `edge` (dir −1: left,
 * +1: right) on the parents' row and the focus's row, hanging from the grandparents' line.
 */
function kinCluster(f: Family, parent: { id: string; x: number }, dir: -1 | 1, edge: number, exclude: ReadonlySet<string>): { nodes: LNode[]; edges: LEdge[] } {
  const aunts = siblings(f, parent.id).filter((a) => !exclude.has(a));
  if (dir === -1) aunts.reverse(); // the eldest ends up furthest out on either side
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  let cursor = edge;
  for (const a of aunts) {
    const t = tidy(a, (id) => children(f, id).filter((c) => !exclude.has(c)), 1);
    const minL = Math.min(...t.left), maxR = Math.max(...t.right);
    const offset = dir === -1 ? cursor - GAP_X * 2 - maxR : cursor + GAP_X * 2 - minL;
    cursor = dir === -1 ? offset + minL : offset + maxR;
    const placed = t.items.map((it, i): LNode => ({
      key: `k:${it.id}`, id: it.id, x: it.dx + offset, y: (i === 0 ? -1 : 0) * ROW_H, row: i === 0 ? -1 : 0, role: 'kin',
      hasMore: i === 0 ? false : children(f, it.id).length > 0,
    }));
    nodes.push(...placed);
    for (const [pi, cis] of childIndex(t.items)) {
      const n = placed[pi];
      edges.push(...forkDown(`k:${n.id}`, n, cis.map((ci) => placed[ci]).map((c) => ({ x: c.x, y: c.y, id: c.id })), n.id));
    }
  }
  if (nodes.length) {
    // Hang the aunts and uncles from the same bar as the parent, under the grandparents.
    const tops = nodes.filter((n) => n.row === -1);
    const mid = -ROW_H - (ROW_H - CARD_H) / 2;
    const xs = tops.map((n) => n.x);
    edges.push({
      key: `kin:${parent.id}`,
      kind: 'line',
      d: `M${Math.min(parent.x, ...xs)},${mid}H${Math.max(parent.x, ...xs)}` + xs.map((x) => `M${x},${mid}V${-ROW_H}`).join(''),
      ids: [parent.id, ...tops.map((n) => n.id)],
    });
  }
  return { nodes, edges };
}

function hourglass(f: Family, o: LayoutOptions): Layout {
  const focus = o.focus;
  const up = pedigree(f, focus, o.up);
  // Descendants below the focus.
  const t = tidy(focus, (id) => (o.collapsed.has(id) ? [] : children(f, id)), o.down);
  const down: LNode[] = t.items.slice(1).map((it) => ({
    key: it.dup ? `${it.id}#dup${it.dx}` : it.id,
    id: it.id,
    x: it.dx,
    y: it.depth * ROW_H,
    row: it.depth,
    role: it.dup ? 'dup' : 'main',
    hasMore: it.depth === o.down && children(f, it.id).length > 0,
    folded: o.collapsed.has(it.id) ? countDesc(f, it.id, () => true) : undefined,
  }));
  const focusNode = up.nodes.find((n) => n.id === focus)!;
  focusNode.hasMore = false;
  focusNode.folded = o.collapsed.has(focus) ? countDesc(f, focus, () => true) : undefined;

  // Partners right of the focus, siblings outside both: older left, younger right.
  const step = CARD_W + GAP_X;
  const side: LNode[] = [];
  const ps = partnersOf(f, focus).filter((p) => f.byId.has(p));
  const sibs = siblings(f, focus);
  const by = yearOf(f.byId.get(focus)?.born);
  const older = sibs.filter((s) => yearOf(f.byId.get(s)?.born) < by || isNaN(by));
  const younger = sibs.filter((s) => !older.includes(s));
  const rowExtent = (row: number) => {
    const xs = [...up.nodes, ...down].filter((n) => n.row === row).map((n) => n.x);
    return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 0];
  };
  const [, r0] = rowExtent(0);
  ps.forEach((p, i) => side.push({ key: `p:${p}`, id: p, x: r0 + step * (i + 1) + 12, y: 0, row: 0, role: 'partner', hasMore: true }));
  const rightEdge = r0 + step * ps.length + 12;
  younger.forEach((s, i) => side.push({ key: `s:${s}`, id: s, x: rightEdge + step * (i + 1) + 40, y: 0, row: 0, role: 'sibling', hasMore: children(f, s).length > 0 }));
  older.reverse().forEach((s, i) => side.push({ key: `s:${s}`, id: s, x: -step * (i + 1) - 40, y: 0, row: 0, role: 'sibling', hasMore: children(f, s).length > 0 }));

  // Aunts, uncles and cousins: the father's side far left, the mother's far right.
  const shown = new Set([focus, ...sibs, ...ps, ...up.nodes.map((n) => n.id)]);
  const rowsX = [...up.nodes, ...side].filter((n) => n.row === -1 || n.row === 0);
  const leftEdge = Math.min(...rowsX.map((n) => n.x - CARD_W / 2));
  const rightEdgeAll = Math.max(...rowsX.map((n) => n.x + CARD_W / 2));
  const parentNodes = up.nodes.filter((n) => n.row === -1 && n.role === 'main');
  const clusters = parentNodes.map((pn, i) => kinCluster(f, pn, i === 0 ? -1 : 1, i === 0 ? leftEdge : rightEdgeAll, shown));

  const nodes = [...up.nodes, ...down, ...side, ...clusters.flatMap((c) => c.nodes)];
  const edges = [...up.edges, ...clusters.flatMap((c) => c.edges)];
  // Marriage lines from the focus to each partner.
  for (const s of side.filter((n) => n.role === 'partner')) {
    edges.push({ key: `m:${s.id}`, kind: 'marriage', d: `M${CARD_W / 2},${CARD_H * 0.42}H${s.x - CARD_W / 2}`, ids: [focus, s.id] });
  }
  // Sibling lines hang from the parents' fork.
  if (sibs.length && parents(f, focus).length) {
    const mid = -(ROW_H - CARD_H) / 2;
    const xs = side.filter((n) => n.role === 'sibling').map((n) => n.x);
    edges.push({ key: 'sibs', kind: 'line', dashed: false, d: `M${Math.min(0, ...xs)},${mid}H${Math.max(0, ...xs)}` + xs.map((x) => `M${x},${mid}V0`).join(''), ids: [focus, ...sibs] });
  }
  // Down edges from each descendant placement (index 0 is the focus).
  const placed = [focusNode, ...down];
  for (const [pi, cis] of childIndex(t.items)) {
    const n = placed[pi];
    edges.push(...forkDown(`d:${n.key}`, n, cis.map((ci) => placed[ci]).map((c) => ({ x: c.x, y: c.y, id: c.id, dashed: f.disputed.has(`${c.id}>${n.id}`) || f.linkKind.has(`${c.id}>${n.id}`) })), n.id));
  }
  return finish(nodes, edges, f, focus);
}
