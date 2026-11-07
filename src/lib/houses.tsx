// What the house pages show about a house: its members, founder, years, seats and notables. All of it
// is derived from the graph already in the browser, so the pages need no extra request.
import { parents, yearOf, type Family } from './graph';
import type { GPerson, House } from './types';

export interface HouseStats {
  house: House;
  members: GPerson[];
  living: number;
  founder?: GPerson;
  /** Earliest known year: the founder's birth, else the earliest member's. */
  from?: number;
  /** Latest known year, or undefined while members are living ("present"). */
  to?: number;
  /** Members per generation, indexed from the tree's first generation (shared axis for every house). */
  perGen: number[];
  /** How many generations have at least one member. */
  generations: number;
  /** Most common birthplaces, most first. */
  seats: { place: string; n: number }[];
}

const birth = (p: GPerson) => yearOf(p.born);
const byBirth = (a: GPerson, b: GPerson) => (birth(a) || 99999) - (birth(b) || 99999) || a.given.localeCompare(b.given);

/** The tree's deepest generation number, for a shared sparkline axis. */
export function maxGeneration(f: Family & { gen: Map<string, number> }): number {
  let m = 0;
  for (const g of f.gen.values()) m = Math.max(m, g);
  return m;
}

export function houseStats(f: Family & { gen: Map<string, number> }, house: House, maxGen = maxGeneration(f)): HouseStats {
  const members = f.graph.people.filter((p) => p.house === house.id);
  const living = members.filter((p) => p.living).length;
  // The recorded founder, else the earliest member whose parents are outside the house.
  const founder =
    (house.founder ? f.byId.get(house.founder) : undefined) ??
    [...members].filter((p) => !parents(f, p.id).some((q) => f.byId.get(q)?.house === house.id)).sort(byBirth)[0];

  const births = members.map(birth).filter((y) => !Number.isNaN(y));
  const ends = members.map((p) => yearOf(p.died)).filter((y) => !Number.isNaN(y));
  const from = founder && !Number.isNaN(birth(founder)) ? Math.min(birth(founder), ...births) : births.length ? Math.min(...births) : undefined;
  const to = living ? undefined : ends.length || births.length ? Math.max(...ends, ...births) : undefined;

  const perGen = new Array<number>(maxGen + 1).fill(0);
  for (const p of members) {
    const g = f.gen.get(p.id);
    if (g !== undefined) perGen[g]++;
  }
  const generations = perGen.filter(Boolean).length;

  const places = new Map<string, number>();
  for (const p of members) if (p.bornPlace) places.set(p.bornPlace, (places.get(p.bornPlace) ?? 0) + 1);
  const seats = [...places].map(([place, n]) => ({ place, n })).sort((a, b) => b.n - a.n || a.place.localeCompare(b.place));

  return { house, members, living, founder, from, to, perGen, generations, seats };
}

/** "880 – present", "c. 1020 – 1188", or "" when nothing is dated. */
export function spanLabel(s: Pick<HouseStats, 'from' | 'to' | 'living'>): string {
  if (s.from === undefined) return s.living ? 'present' : '';
  return `${s.from} – ${s.to === undefined ? 'present' : s.to}`;
}

// Rulers first, then the great titles, the church, and knights; anything else titled after.
const RANKS: [RegExp, number][] = [
  [/^(King|Queen|Emperor|Empress)\b/, 0],
  [/^(Prince|Princess)\b/, 1],
  [/^(Duke|Duchess)\b/, 2],
  [/^(Count|Countess|Earl|Margrave)\b/, 3],
  [/^(Archbishop|Bishop|Abbess|Abbot|Prior|Prioress)\b/, 4],
  [/^(Baron|Baroness|Lord|Lady|Knight|Sir|Dame)\b/, 5],
];
export function titleRank(p: GPerson): number {
  if (!p.title) return 99;
  for (const [re, r] of RANKS) if (re.test(p.title)) return r;
  return 6;
}
export const isRuler = (p: GPerson) => titleRank(p) === 0;

export interface Notable {
  person: GPerson;
  /** Why they are here, when it is not their own title: "Founder", "Eldest living". */
  role?: string;
}

/**
 * Rulers and titled members, highest rank first, then by birth. A house without titles still shows its
 * founder, its eldest living member and its newest arrival, so the section is never empty.
 */
export function notables(s: HouseStats, limit = 12): Notable[] {
  const titled = s.members.filter((p) => p.title).sort((a, b) => titleRank(a) - titleRank(b) || byBirth(a, b));
  if (titled.length) {
    const out: Notable[] = titled.slice(0, limit).map((person) => ({ person }));
    if (s.founder && !out.some((n) => n.person.id === s.founder!.id)) out.unshift({ person: s.founder, role: 'Founder' });
    else for (const n of out) if (n.person.id === s.founder?.id) n.role = 'Founder';
    return out.slice(0, limit);
  }
  const out: Notable[] = [];
  const add = (p: GPerson | undefined, role: string) => {
    if (p && !out.some((n) => n.person.id === p.id)) out.push({ person: p, role });
  };
  add(s.founder, 'Founder');
  const living = s.members.filter((p) => p.living && !Number.isNaN(birth(p))).sort(byBirth);
  add(living[0], 'Eldest living');
  add(living[living.length - 1], 'Newest member');
  return out;
}

/** Living first, then everyone by birth (undated last). */
export function memberOrder(a: GPerson, b: GPerson): number {
  return Number(b.living) - Number(a.living) || byBirth(a, b);
}

/**
 * Members per generation as small bars on the tree's shared generation axis, so houses line up in time.
 * One series in the accent colour; each bar names its generation and count on hover.
 */
export function GenSpark({ perGen, width = 168, height = 34, label }: { perGen: number[]; width?: number; height?: number; label?: string }) {
  const n = Math.max(perGen.length, 1);
  const max = Math.max(1, ...perGen);
  const gap = n > 24 ? 1 : 2;
  const bw = Math.max(1, (width - gap * (n - 1)) / n);
  const peak = perGen.indexOf(Math.max(...perGen));
  const summary = label ?? `Members per generation, from generation 1 to ${n}. Most in generation ${peak + 1}, with ${perGen[peak] ?? 0}.`;
  return (
    <svg className="gen-spark" width={width} height={height + 2} viewBox={`0 0 ${width} ${height + 2}`} role="img" aria-label={summary}>
      <line x1="0" x2={width} y1={height + 1} y2={height + 1} className="gen-spark-base" />
      {perGen.map((v, i) => {
        const h = v ? Math.max(3, (v / max) * height) : 0;
        const x = i * (bw + gap);
        return (
          <g key={i}>
            <title>{`Generation ${i + 1}: ${v} ${v === 1 ? 'member' : 'members'}`}</title>
            {/* A full-height hit target, larger than the mark, for the hover title. */}
            <rect x={x} y={0} width={bw + gap} height={height + 2} fill="transparent" />
            {h > 0 && <rect className="gen-spark-bar" x={x} y={height - h} width={bw} height={h} rx={Math.min(2, bw / 2)} />}
          </g>
        );
      })}
    </svg>
  );
}
