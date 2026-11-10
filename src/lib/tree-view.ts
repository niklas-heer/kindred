// The tree page's rules that are not drawing: which people a lens lights, where a house's tree starts, what folding
// keeps open, which card the arrow keys walk to, how a generation row is marked, and whose birthday it is.
import { ancestorDepths, children, descendants, kinPath, parents, type Family } from './graph.ts';
import type { LNode, View } from './layout.ts';
import type { GPerson } from './types.ts';

export type Lens = 'none' | 'line' | 'living' | 'house' | 'path' | 'gaps';

/**
 * The people a lens lights (everyone else is dimmed), or null when it lights everyone. `sel` is the selected person,
 * `from` and `to` the two ends of the path lens, `gapped` whether someone still has gaps the reader counts.
 */
export function lensMembers(
  f: Family,
  lens: Lens,
  { sel, from, to, gapped }: { sel: string; from: string; to: string; gapped: (p: GPerson) => boolean },
): Set<string> | null {
  if (lens === 'line') return new Set([sel, ...ancestorDepths(f, sel).keys(), ...descendants(f, sel)]);
  if (lens === 'living') return new Set(f.graph.people.filter((p) => p.living).map((p) => p.id));
  if (lens === 'gaps') return new Set(f.graph.people.filter(gapped).map((p) => p.id));
  if (lens === 'house') {
    const h = f.byId.get(sel)?.house;
    return new Set(f.graph.people.filter((p) => p.house === h).map((p) => p.id));
  }
  if (lens === 'path') {
    const path = kinPath(f, from, to);
    return path.length ? new Set(path) : null;
  }
  return null;
}

/** Where a house's tree starts: its founder, or the member with the most descendants in the house. */
export function houseRoot(f: Family, house: string): string | undefined {
  const h = f.house.get(house);
  if (h?.founder && f.byId.has(h.founder)) return h.founder;
  const members = f.graph.people.filter((p) => p.house === house);
  const tops = members.filter((p) => !parents(f, p.id).some((q) => f.byId.get(q)?.house === house));
  let best: string | undefined, size = -1;
  for (const t of tops) {
    const n = [...descendants(f, t.id)].filter((d) => f.byId.get(d)?.house === house).length;
    if (n > size) { best = t.id; size = n; }
  }
  return best;
}

/** "Fold the others": everyone drawn who has children is folded, except the line from the root to `sel`. */
export function foldAllBut(f: Family, nodes: readonly Pick<LNode, 'id'>[], sel: string): Set<string> {
  const keep = new Set([sel, ...ancestorDepths(f, sel).keys()]);
  const n = new Set<string>();
  for (const node of nodes) if (!keep.has(node.id) && children(f, node.id).length) n.add(node.id);
  return n;
}

/** The set with `id` added, or taken out when it was there. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(set);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

/** The nearest real card in the same row to the left or the right of `cur`, for the arrow keys. */
export function rowNeighbour(nodes: readonly LNode[], cur: Pick<LNode, 'row' | 'x'>, dir: 'left' | 'right'): LNode | undefined {
  const row = nodes.filter((n) => n.row === cur.row && n.role !== 'dup' && n.role !== 'ghost' && (dir === 'left' ? n.x < cur.x : n.x > cur.x));
  row.sort((a, b) => Math.abs(a.x - cur.x) - Math.abs(b.x - cur.x));
  return row[0];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

/**
 * The mark beside a generation row: a dynasty counts its generations (in Roman numerals in the codex theme), the
 * other views count up and down from the person in the middle.
 */
export function rowMark(view: View, codex: boolean, row: number, i: number): string {
  if (view === 'dynasty') return codex ? ROMAN[i] ?? String(i + 1) : String(i + 1);
  return row === 0 ? '●' : row < 0 ? `↑${-row}` : `↓${row}`;
}

/** The living people born on this day of the year (a full date only), with the age they turn. */
export function birthdaysOn(people: readonly GPerson[], today: Date): { person: GPerson; age: number }[] {
  const md = `-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return people
    .filter((p) => p.living && p.born && /^\d{4}-\d\d-\d\d$/.test(p.born) && p.born.endsWith(md))
    .map((person) => ({ person, age: today.getFullYear() - parseInt(person.born!, 10) }));
}
