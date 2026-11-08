import { useQuery } from '@tanstack/react-query';
import { GameIcon } from '~/components/GameIcon';
import { useFamily, useTreeId } from './family';
import { houseSettingsQuery } from './houses.functions';
// What the house pages show about a house: its members, founder, years, seats and notables. All of it
// is derived from the graph already in the browser, so the pages need no extra request.
import { kinship, parents, yearOf, type Family, type Kinship } from './graph';
import { useT } from './i18n';
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
export function spanLabel(s: Pick<HouseStats, 'from' | 'to' | 'living'>, present = 'present'): string {
  if (s.from === undefined) return s.living ? present : '';
  return `${s.from} – ${s.to === undefined ? present : s.to}`;
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
  /** Why they are here, when it is not their own title. Shown through `useT`. */
  role?: 'founder' | 'eldest' | 'newest';
}

/**
 * Rulers and titled members, highest rank first, then by birth. A house without titles still shows its
 * founder, its eldest living member and its newest arrival, so the section is never empty.
 */
export function notables(s: HouseStats, limit = 12): Notable[] {
  const titled = s.members.filter((p) => p.title).sort((a, b) => titleRank(a) - titleRank(b) || byBirth(a, b));
  if (titled.length) {
    const out: Notable[] = titled.slice(0, limit).map((person) => ({ person }));
    if (s.founder && !out.some((n) => n.person.id === s.founder!.id)) out.unshift({ person: s.founder, role: 'founder' });
    else for (const n of out) if (n.person.id === s.founder?.id) n.role = 'founder';
    return out.slice(0, limit);
  }
  const out: Notable[] = [];
  const add = (p: GPerson | undefined, role: NonNullable<Notable['role']>) => {
    if (p && !out.some((n) => n.person.id === p.id)) out.push({ person: p, role });
  };
  add(s.founder, 'founder');
  const living = s.members.filter((p) => p.living && !Number.isNaN(birth(p))).sort(byBirth);
  add(living[0], 'eldest');
  add(living[living.length - 1], 'newest');
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
export function GenSpark({ perGen, width = 168, height = 34, label }: { perGen: number[]; width?: number; height?: number; label: string }) {
  const t = useT();
  const n = Math.max(perGen.length, 1);
  const max = Math.max(1, ...perGen);
  const gap = n > 24 ? 1 : 2;
  const bw = Math.max(1, (width - gap * (n - 1)) / n);
  return (
    <svg className="gen-spark" width={width} height={height + 2} viewBox={`0 0 ${width} ${height + 2}`} role="img" aria-label={label}>
      <line x1="0" x2={width} y1={height + 1} y2={height + 1} className="gen-spark-base" />
      {perGen.map((v, i) => {
        const h = v ? Math.max(3, (v / max) * height) : 0;
        const x = i * (bw + gap);
        return (
          <g key={i}>
            <title>{t('houses.genTitle', { n: i + 1, count: v })}</title>
            {/* A full-height hit target, larger than the mark, for the hover title. */}
            <rect x={x} y={0} width={bw + gap} height={height + 2} fill="transparent" />
            {h > 0 && <rect className="gen-spark-bar" x={x} y={height - h} width={bw} height={h} rx={Math.min(2, bw / 2)} />}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- succession ----------

export const SUCCESSION_LAWS = ['absolute-primogeniture', 'seniority', 'elective'] as const;
export type SuccessionLaw = (typeof SUCCESSION_LAWS)[number];

/** What a steward has set for a house. An unset head or heir follows the law. */
export interface HouseSettings {
  law: SuccessionLaw;
  head: string | null;
  heir: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
}
export const DEFAULT_HOUSE_SETTINGS: HouseSettings = { law: 'absolute-primogeniture', head: null, heir: null, country: null };
export const useHouseSettings = (tree: string) => useQuery(houseSettingsQuery(tree));

/** The countries a house can come from: the ISO 3166-1 alpha-2 codes that flags are drawn for. */
export const COUNTRY_CODES = (
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ ' +
  'OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TM TL TN TO TR TT TV TZ ' +
  'UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'
).split(' ');

/** At year precision, a recorded death ends eligibility that year. Unknown historical dates
 * are not guessed. Today uses the explicit living flag, even for undated members. */
export function aliveAt(p: GPerson, year?: number): boolean {
  if (year === undefined) return p.living;
  const born = yearOf(p.born), died = yearOf(p.died);
  return Number.isFinite(born) && born <= year && (Number.isFinite(died) ? died > year : p.living);
}
const eldest = (a: GPerson, b: GPerson) =>
  (a.born ?? '9999').replace('~', '').localeCompare((b.born ?? '9999').replace('~', '')) || a.id.localeCompare(b.id);

export interface Succession {
  head?: GPerson;
  heir?: GPerson;
  /** Everyone after the head, in order of succession: the heir first. */
  line: GPerson[];
}

/**
 * Who heads a house, and who is next, at `year` (or today, counting the living only).
 *
 * - Absolute primogeniture walks the house depth first, in birth order: the eldest child of the head
 *   comes straight after them, and a dead child's descendants stand in for them before a younger
 *   sibling. Sex never affects the order.
 * - Seniority is the eldest living member.
 * - Elective houses have no line: the head and heir are only what a steward has set.
 *
 * A steward's explicit head wins while they are alive; a heir override goes first in the line.
 * Biological and adoptive links transmit succession equally; foster and step links do not.
 * Visited sets make duplicate ancestry and malformed cycles safe.
 */
export function houseSuccession(f: Family, house: House, settings = DEFAULT_HOUSE_SETTINGS, year?: number): Succession {
  const members = f.graph.people.filter((p) => p.house === house.id);
  const byId = new Map(members.map((p) => [p.id, p]));
  const children = new Map<string, GPerson[]>();
  const hasParent = new Set<string>();
  for (const edge of f.graph.parents) {
    if (!['biological', 'adoptive'].includes(edge.kind) || !byId.has(edge.parent) || !byId.has(edge.child)) continue;
    const list = children.get(edge.parent) ?? [];
    if (!list.some((p) => p.id === edge.child)) list.push(byId.get(edge.child)!);
    children.set(edge.parent, list);
    hasParent.add(edge.child);
  }
  for (const list of children.values()) list.sort(eldest);
  const roots = members.filter((p) => !hasParent.has(p.id)).sort(eldest);
  const founder = house.founder ? byId.get(house.founder) : undefined;
  if (founder) roots.unshift(founder);
  const seen = new Set<string>();
  const order: GPerson[] = [];
  const visit = (p: GPerson) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    order.push(p);
    for (const child of children.get(p.id) ?? []) visit(child);
  };
  for (const p of [...roots, ...[...members].sort(eldest)]) visit(p);

  const elective = settings.law === 'elective';
  const eligible = order.filter((p) => aliveAt(p, year));
  if (settings.law === 'seniority') eligible.sort(eldest);
  const explicit = settings.head ? byId.get(settings.head) : undefined;
  const head = explicit && aliveAt(explicit, year) ? explicit : elective ? undefined : eligible[0];
  let line = elective ? [] : eligible.filter((p) => p.id !== head?.id);
  const heir = settings.heir ? byId.get(settings.heir) : undefined;
  if (heir && heir.id !== head?.id && aliveAt(heir, year)) line = [heir, ...line.filter((p) => p.id !== heir.id)];
  return { head, heir: line[0], line };
}

export interface HouseTenure { person: GPerson; from: number; to?: number }

/**
 * The heads of a house across its recorded years, oldest first. Only births and deaths change who is
 * eligible, so the head is worked out again at each of those years. Explicit overrides have no recorded
 * date, so they are left out rather than projected into earlier centuries. The last tenure has no `to`.
 */
export function houseHistory(f: Family, house: House, settings = DEFAULT_HOUSE_SETTINGS): HouseTenure[] {
  const members = f.graph.people.filter((p) => p.house === house.id);
  const now = new Date().getFullYear();
  const years = [...new Set(members.flatMap((p) => [yearOf(p.born), yearOf(p.died)]).filter((y) => Number.isFinite(y) && y <= now))].sort((a, b) => a - b);
  const history: HouseTenure[] = [];
  const historical: HouseSettings = { ...settings, head: null, heir: null };
  for (const year of years) {
    const head = houseSuccession(f, house, historical, year).head;
    const prev = history.at(-1);
    if (prev?.person.id === head?.id) continue;
    if (prev && prev.to === undefined) prev.to = year;
    if (head) history.push({ person: head, from: year });
  }
  return history;
}

/** A person's place in a house's succession today: its head, or its heir. */
export interface HouseRole { role: 'head' | 'heir'; house: House }

const marksCache = new WeakMap<Family, { settings: unknown; marks: Map<string, HouseRole> }>();

/** Every house's head and heir today, keyed by person. Cached per family and settings, so cards share it. */
export function houseMarks(f: Family, settings: Record<string, HouseSettings>): Map<string, HouseRole> {
  const cached = marksCache.get(f);
  if (cached && cached.settings === settings) return cached.marks;
  const marks = new Map<string, HouseRole>();
  for (const house of f.graph.houses) {
    const s = houseSuccession(f, house, settings[house.id] ?? DEFAULT_HOUSE_SETTINGS);
    if (s.head) marks.set(s.head.id, { role: 'head', house });
    if (s.heir) marks.set(s.heir.id, { role: 'heir', house });
  }
  marksCache.set(f, { settings, marks });
  return marks;
}

/** A house's name without its "House" prefix, for "Head of House X". */
export const bareHouseName = (h: House) => h.name.replace(/^House (of )?/i, '');

/** A person's house role today, or undefined. Tree cards use it for the crown and the heir ribbon. */
export function useHouseRole(tree: string, f: Family, id: string): HouseRole | undefined {
  const { data } = useQuery(houseSettingsQuery(tree));
  return data ? houseMarks(f, data).get(id) : undefined;
}

/**
 * "Head of House X" or "Heir of House X" under a person's name in the person panel. Renders nothing for
 * anyone else, so it can sit in the panel unconditionally.
 */
export function HeadOfHouse({ person }: { person: string }) {
  const t = useT();
  const tree = useTreeId();
  const f = useFamily();
  const { data } = useQuery(houseSettingsQuery(tree));
  const role = data ? houseMarks(f, data).get(person) : undefined;
  if (!role) return null;
  return (
    <p className={`head-of-house ${role.role}`}>
      <GameIcon name="crown" size={14} />{' '}
      {t(role.role === 'head' ? 'houses.headOf' : 'houses.heirOf', { name: bareHouseName(role.house) })}
    </p>
  );
}

/** Kinship of `other` to a house's head, as the head's relation: "son", "great-aunt". */
export function kinToHead(f: Family, head: GPerson | undefined, other: GPerson): Kinship | undefined {
  return head && head.id !== other.id ? kinship(f, head.id, other.id) : undefined;
}
