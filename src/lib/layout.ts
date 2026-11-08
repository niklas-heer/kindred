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
export const GAP_X = 44;
export const ROW_H = CARD_H + 120;

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

// ---------- contour tidy tree ----------

interface Item { id: string; dx: number; depth: number; dup: boolean; parent: number }
interface Sub {
  items: Item[];
  left: number[];
  right: number[];
}

function tidy(rootId: string, kids: (id: string) => string[], maxDepth: number, extent: (id: string) => [number, number] = () => [-CARD_W / 2, CARD_W / 2]): Sub {
  const seen = new Set<string>();
  const build = (id: string, depth: number): Sub => {
    const [leftEdge, rightEdge] = extent(id);
    const dup = seen.has(id);
    seen.add(id);
    const cs = dup || depth >= maxDepth ? [] : kids(id);
    if (!cs.length) return { items: [{ id, dx: 0, depth: 0, dup, parent: -1 }], left: [leftEdge], right: [rightEdge] };
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
      // The parent's own drop to the bar is included, so it connects even when grandparents are hidden.
      d: `M${Math.min(parent.x, ...xs)},${mid}H${Math.max(parent.x, ...xs)}` + [parent.x, ...xs].map((x) => `M${x},${mid}V${-ROW_H}`).join(''),
      ids: [parent.id, ...tops.map((n) => n.id)],
    });
  }
  return { nodes, edges };
}

function hourglass(f: Family, o: LayoutOptions): Layout {
  const focus = o.focus;
  const up = pedigree(f, focus, o.up);
  // Descendants below the focus.
  const units = familyUnits(f, focus, (id) => o.collapsed.has(id) ? [] : children(f, id), o.down, o.collapsed);
  const focusNode = up.nodes.find((n) => n.id === focus)!;
  const unitFocus = units.nodes.find((n) => n.id === focus)!;
  focusNode.folded = unitFocus.folded;
  focusNode.hasMore = false;
  const down = units.nodes.filter((n) => n.key !== unitFocus.key);

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
  const rightEdge = r0;
  younger.forEach((s, i) => side.push({ key: `s:${s}`, id: s, x: rightEdge + step * (i + 1) + 40, y: 0, row: 0, role: 'sibling', hasMore: children(f, s).length > 0 }));
  older.reverse().forEach((s, i) => side.push({ key: `s:${s}`, id: s, x: -step * (i + 1) - 40, y: 0, row: 0, role: 'sibling', hasMore: children(f, s).length > 0 }));

  // Aunts, uncles and cousins: the father's side far left, the mother's far right.
  const shown = new Set([focus, ...sibs, ...ps, ...up.nodes.map((n) => n.id)]);
  const rowsX = [...up.nodes, ...down, ...side].filter((n) => n.row === -1 || n.row === 0);
  const leftEdge = Math.min(...rowsX.map((n) => n.x - CARD_W / 2));
  const rightEdgeAll = Math.max(...rowsX.map((n) => n.x + CARD_W / 2));
  const parentNodes = up.nodes.filter((n) => n.row === -1 && n.role === 'main');
  let leftCursor = leftEdge, rightCursor = rightEdgeAll;
  const clusters = parentNodes.map((pn, i) => {
    const cluster = kinCluster(f, pn, i === 0 ? -1 : 1, i === 0 ? leftCursor : rightCursor, shown);
    for (const n of cluster.nodes) {
      leftCursor = Math.min(leftCursor, n.x - CARD_W / 2);
      rightCursor = Math.max(rightCursor, n.x + CARD_W / 2);
    }
    return cluster;
  });

  const nodes = [...up.nodes, ...down, ...side, ...clusters.flatMap((c) => c.nodes)];
  const edges = [...up.edges, ...clusters.flatMap((c) => c.edges)];
  // Sibling lines hang from the parents' fork.
  if (sibs.length && parents(f, focus).length) {
    const mid = -(ROW_H - CARD_H) / 2;
    const xs = side.filter((n) => n.role === 'sibling').map((n) => n.x);
    edges.push({ key: 'sibs', kind: 'line', dashed: false, d: `M${Math.min(0, ...xs)},${mid}H${Math.max(0, ...xs)}` + xs.map((x) => `M${x},${mid}V0`).join(''), ids: [focus, ...sibs] });
  }
  edges.push(...units.edges);
  return finish(nodes, edges, f, focus);
}

/** Reserve the complete horizontal family unit in the contour, including every remarriage.
 * Repeating the shared parent keeps each union and its child trunk unambiguous. */
function familyUnits(f: Family, root: string, kids: (id: string) => string[], depth: number, collapsed: ReadonlySet<string>) {
  const pairStep = CARD_W + 124;
  const unitStep = pairStep + CARD_W + GAP_X;
  const unions = (id: string) => [...(f.unionsOf.get(id) ?? [])]
    .filter((u) => f.byId.has(u.a === id ? u.b : u.a))
    .sort((a, b) => (a.start?.replace(/^~/, '') ?? '9999').localeCompare(b.start?.replace(/^~/, '') ?? '9999') || a.id.localeCompare(b.id));
  const partner = (id: string, u: ReturnType<typeof unions>[number]) => u.a === id ? u.b : u.a;
  const group = (id: string, child: string) => {
    const us = unions(id);
    const ps = parents(f, child);
    const primary = us.findIndex((u) => ps.includes(partner(id, u)) && f.linkKind.get(`${child}>${partner(id, u)}`) !== 'step');
    return primary >= 0 ? primary : us.findIndex((u) => ps.includes(partner(id, u)));
  };
  const t = tidy(root, (id) => [...kids(id)].sort((a, b) => {
    const ga = group(id, a), gb = group(id, b);
    return (ga < 0 ? Infinity : ga) - (gb < 0 ? Infinity : gb) || yearOf(f.byId.get(a)?.born) - yearOf(f.byId.get(b)?.born);
  }), depth, (id) => [-CARD_W / 2, CARD_W / 2 + (unions(id).length ? (unions(id).length - 1) * unitStep + pairStep : 0)]);
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  const main = t.items.map((it, i): LNode => ({
    key: `${it.id}:unit:${i}`, id: it.id, x: it.dx, y: it.depth * ROW_H, row: it.depth,
    role: it.dup ? 'dup' : 'main',
    folded: collapsed.has(it.id) && !it.dup ? countDesc(f, it.id, () => true) : undefined,
    hasMore: it.depth === depth && children(f, it.id).length > 0,
  }));
  const index = childIndex(t.items);
  main.forEach((n, i) => {
    nodes.push(n);
    const us = unions(n.id);
    const cs = (index.get(i) ?? []).map((ci) => main[ci]);
    us.forEach((u, j) => {
      const x = n.x + j * unitStep;
      if (j) nodes.push({ ...n, key: `${n.key}:repeat:${u.id}`, x, role: 'dup', folded: undefined, hasMore: false });
      const sp = partner(n.id, u);
      nodes.push({ key: `${n.key}:partner:${u.id}`, id: sp, x: x + pairStep, y: n.y, row: n.row, role: 'partner', hasMore: true });
      const start = yearOf(u.start), end = yearOf(u.end);
      const label = `${u.kind === 'marriage' ? '⚭' : '◇'}${Number.isFinite(start) ? ` ${start}` : ''}${Number.isFinite(end) ? `–${end}` : ''}`;
      const cx = x + pairStep / 2, cy = n.y + CARD_H * .42;
      edges.push({ key: `${n.key}:marriage:${u.id}`, kind: 'marriage', ids: [n.id, sp], dashed: !!u.end,
        d: `M${x + CARD_W / 2},${cy}H${x + pairStep - CARD_W / 2}`,
        label: { x: cx, y: cy - 9, text: label, status: u.endReason === 'death' ? 'widowed' : u.endReason === 'divorce' ? 'divorced' : u.endReason } });
      const unionKids = cs.filter((c) => group(n.id, c.id) === j);
      const branches = forkDown(`${n.key}:${u.id}`, { x: cx, y: n.y }, unionKids.map((c) => ({ ...c, dashed: f.disputed.has(`${c.id}>${n.id}`) || !!f.linkKind.get(`${c.id}>${n.id}`) || f.disputed.has(`${c.id}>${sp}`) || !!f.linkKind.get(`${c.id}>${sp}`) })), n.id, n.y + CARD_H + 28 + j * (64 / Math.max(1, us.length)));
      if (branches.length) branches[0].d = `M${cx},${cy}V${n.y + CARD_H}` + branches[0].d;
      branches.forEach((e) => e.ids.push(sp));
      edges.push(...branches);
    });
    edges.push(...forkDown(`${n.key}:unpaired`, n, cs.filter((c) => group(n.id, c.id) < 0).map((c) => ({ ...c, dashed: f.disputed.has(`${c.id}>${n.id}`) || !!f.linkKind.get(`${c.id}>${n.id}`) })), n.id));
  });
  return { nodes, edges };
}
