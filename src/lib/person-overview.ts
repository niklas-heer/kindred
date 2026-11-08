// What the person panel's Overview works out from the family graph: life at a glance, the closest family, which dates
// are near, and which of its sections this browser keeps open. Pure (no React), so the test runner loads it.
import { children, parents, siblings, sortedUnions, type Family } from './graph.ts';
import { ageOn, compareDates, widowedOn } from './life.ts';
import type { GPerson, GUnion } from './types.ts';

export type GlanceItem =
  | { key: 'together'; married: boolean; years: number; approx: boolean }
  | { key: 'children' | 'grandchildren' | 'descendants' | 'siblings'; n: number }
  | { key: 'order'; position: number; of: number };

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day a partnership stopped counting, today while it stands, or undefined when that can't be told. */
function partnershipUntil(p: GPerson, o: GPerson, u: GUnion, today?: Date): string | undefined {
  if (u.end) return u.end;
  const widowed = widowedOn(p, o, u);
  if (widowed) return widowed;
  if (u.endReason) return undefined;
  if (!p.living) return p.died;
  return o.living && today ? isoDay(today) : undefined;
}

/** How long their partnership lasted: the one that stands now, else the longest. A year or more, and only with a start date. */
function longestTogether(f: Family, p: GPerson, today?: Date): Extract<GlanceItem, { key: 'together' }> | undefined {
  let best: { item: Extract<GlanceItem, { key: 'together' }>; standing: boolean } | undefined;
  for (const u of f.unionsOf.get(p.id) ?? []) {
    const o = f.byId.get(u.a === p.id ? u.b : u.a);
    if (!o || !u.start) continue;
    const span = ageOn(u.start, partnershipUntil(p, o, u, today));
    if (!span || span.years < 1) continue;
    const standing = !u.end && !u.endReason && p.living && o.living;
    if (!best || (standing && !best.standing) || (standing === best.standing && span.years > best.item.years)) {
      best = { item: { key: 'together', married: u.kind === 'marriage', years: span.years, approx: span.approx }, standing };
    }
  }
  return best?.item;
}

function descendantsOf(f: Family, id: string): Set<string> {
  const seen = new Set<string>();
  const queue = [...children(f, id)];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (next === id || seen.has(next)) continue;
    seen.add(next);
    queue.push(...children(f, next));
  }
  return seen;
}

/** Where they come among their siblings, when every birth can be put in order around theirs. */
function birthOrder(f: Family, p: GPerson, sibs: string[]): Extract<GlanceItem, { key: 'order' }> | undefined {
  if (!p.born) return undefined;
  let earlier = 0;
  for (const id of sibs) {
    const born = f.byId.get(id)?.born;
    const side = born ? compareDates(born, p.born) : 0;
    if (side === 0) return undefined;
    if (side < 0) earlier++;
  }
  return { key: 'order', position: earlier + 1, of: sibs.length + 1 };
}

/** The few numbers that sum up a life. Only what the family has recorded: an empty list when nothing is known. */
export function lifeGlance(f: Family, p: GPerson, today?: Date): GlanceItem[] {
  const out: GlanceItem[] = [];
  const together = longestTogether(f, p, today);
  if (together) out.push(together);
  const kids = children(f, p.id);
  if (kids.length) out.push({ key: 'children', n: kids.length });
  const grand = new Set(kids.flatMap((k) => children(f, k)));
  if (grand.size) out.push({ key: 'grandchildren', n: grand.size });
  const all = descendantsOf(f, p.id).size;
  if (all > kids.length + grand.size) out.push({ key: 'descendants', n: all });
  const sibs = siblings(f, p.id);
  if (sibs.length) out.push(birthOrder(f, p, sibs) ?? { key: 'siblings', n: sibs.length });
  return out;
}

export interface CloseRelative {
  id: string;
  kind: 'partner' | 'parent' | 'child' | 'sibling';
  /** A partner by marriage. */
  married?: boolean;
  /** An adoptive, step or other non-biological link: shown with the plain word for the relation. */
  neutral?: boolean;
}

/**
 * The people nearest to someone, for a small row of faces: current partners, parents, children, then siblings. A partner
 * they parted from is on the Family tab, not here, and counts in `more`, the relatives left out of `shown`.
 */
export function closestFamily(f: Family, id: string, limit: number): { shown: CloseRelative[]; more: number } {
  const seen = new Set<string>();
  const out: CloseRelative[] = [];
  const add = (r: CloseRelative) => {
    if (!f.byId.has(r.id) || seen.has(r.id)) return;
    seen.add(r.id);
    out.push(r);
  };
  const unions = sortedUnions(f, id);
  const parted = (u: GUnion) => !!(u.end || u.endReason) && u.endReason !== 'death';
  for (const u of unions) if (!parted(u)) add({ id: u.a === id ? u.b : u.a, kind: 'partner', married: u.kind === 'marriage' });
  for (const r of parents(f, id)) add({ id: r, kind: 'parent', neutral: f.linkKind.has(`${id}>${r}`) });
  for (const r of children(f, id)) add({ id: r, kind: 'child', neutral: f.linkKind.has(`${r}>${id}`) });
  for (const r of siblings(f, id)) add({ id: r, kind: 'sibling' });
  const former = new Set(unions.filter(parted).map((u) => (u.a === id ? u.b : u.a)).filter((o) => f.byId.has(o) && !seen.has(o)));
  const shown = out.slice(0, limit);
  return { shown, more: out.length - shown.length + former.size };
}

/** A date this close is worth showing up front; anything further waits in its own section. */
export const SOON_DAYS = 30;

export function partitionSoon<T>(items: T[], days: (item: T) => number): { soon: T[]; later: T[] } {
  return { soon: items.filter((x) => days(x) <= SOON_DAYS), later: items.filter((x) => days(x) > SOON_DAYS) };
}

export const FOLD_KEYS = ['life', 'places', 'photos', 'research', 'dates', 'missing'] as const;
export type FoldKey = (typeof FOLD_KEYS)[number];
export const FOLD_PREF = 'overview-open';
const DEFAULT_OPEN: FoldKey[] = ['life'];

/** The Overview sections open in this browser, from their saved value. Nothing saved, or anything unreadable, gives the default. */
export function openFolds(raw: string | null): FoldKey[] {
  if (raw === null) return DEFAULT_OPEN;
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? FOLD_KEYS.filter((k) => list.includes(k)) : DEFAULT_OPEN;
  } catch {
    return DEFAULT_OPEN;
  }
}

export const toggleFold = (open: FoldKey[], key: FoldKey): FoldKey[] => (open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);
