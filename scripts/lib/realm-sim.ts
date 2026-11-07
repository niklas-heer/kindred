// Population simulation for the realm of Aurelmarch. Depth-first over couples: each couple has 0–9 children,
// children marry (from the pool of singles, or an outsider), widowed survivors sometimes remarry.
// Everything draws from one seeded rng, so the same seed always yields the same family.

import type { Rng } from './rng.ts';
import { mulberry32 } from './rng.ts';
import { COMMON_SURNAMES, GIVEN_F, GIVEN_M, HOUSES } from './realm-data.ts';

export const MAX_BIRTH = 1186;
const MAX_GEN = 12;

// Child-count weights for 0..9 children per couple. Tuned so the dynasty grows about 1.56× per generation
// and the other houses about 1.2×, after child mortality and marriage rates.
const DYNASTY_WEIGHTS = [18, 18, 18, 15, 11, 8, 5, 3, 2, 2];
const NORMAL_WEIGHTS = [24, 20, 18, 15, 10, 6, 4, 2, 1, 0];
// Share of surviving children who marry at once rather than waiting as singles for a later match.
const MARRY_NOW = 0.95;
const MARRY_CHANCE = 0.95;
const COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export interface SimPerson {
  id: number;
  given: string;
  surname: string | null;
  sex: 'm' | 'f';
  house: string | null;
  born: number;
  died: number;
  gen: number;
  dynasty: boolean;
  parents: number[];
  unions: number[];
}

export interface SimUnion {
  id: number;
  a: number;
  b: number;
  start: number;
  end: number | null;
  endReason: 'death' | 'annulment' | null;
  annulled: boolean;
  children: number[];
}

export interface SimLink {
  child: number;
  parent: number;
  kind: 'biological' | 'adoptive' | 'foster' | 'step';
  confidence: 'certain' | 'probable' | 'disputed';
}

export interface Sim {
  rng: Rng;
  people: SimPerson[];
  unions: SimUnion[];
  links: SimLink[];
  singles: number[];
  annulments: number;
}

export function createSim(seed: number): Sim {
  return { rng: mulberry32(seed), people: [], unions: [], links: [], singles: [], annulments: 0 };
}

/** Age at death. Adults (founders, spouses from outside) are never sampled as childhood deaths. */
function lifespan(sim: Sim, dynasty: boolean, adult: boolean): number {
  if (!adult) {
    const r = sim.rng.next();
    if (r < 0.1) return sim.rng.next(); // infant death
    if (r < 0.25) return 1 + sim.rng.next() * 13; // dies before 15
  }
  if (sim.rng.chance(0.07)) return (adult ? 20 : 18) + sim.rng.next() * 22; // war, plague, fever
  const age = sim.rng.gauss(dynasty ? 58 : 50, 13);
  return Math.min(90, Math.max(adult ? 22 : 16, age));
}

function addPerson(
  sim: Sim,
  init: Pick<SimPerson, 'given' | 'surname' | 'sex' | 'house' | 'born' | 'gen' | 'dynasty' | 'parents'> & {
    adult: boolean;
  },
): number {
  const id = sim.people.length;
  const { adult, ...rest } = init;
  const died = Math.min(rest.born + lifespan(sim, rest.dynasty, adult), MAX_BIRTH + 23.5);
  sim.people.push({ id, ...rest, died, unions: [] });
  return id;
}

function houseSurname(key: string): string {
  const house = HOUSES.find((h) => h.key === key);
  if (!house) throw new Error(`unknown house ${key}`);
  return house.surname;
}

/** An unlinked spouse: no recorded parents, so it can be the root of nothing but its own marriage. */
function makeOutsider(sim: Sim, sex: 'm' | 'f', near: number, gen: number, avoidHouse: string | null): number {
  const rng = sim.rng;
  const options = HOUSES.filter((h) => h.key !== 'valcourt' && h.key !== avoidHouse);
  const house = rng.chance(0.55) ? rng.pick(options).key : null;
  const given = rng.pick(sex === 'm' ? GIVEN_M : GIVEN_F);
  const surname = house ? houseSurname(house) : rng.pick(COMMON_SURNAMES);
  return addPerson(sim, {
    given,
    surname,
    sex,
    house,
    born: near + rng.gauss(0, 3),
    gen,
    dynasty: false,
    parents: [],
    adult: true,
  });
}

function addChild(sim: Sim, father: number, mother: number, born: number): number {
  const f = sim.people[father]!;
  const m = sim.people[mother]!;
  const sex = sim.rng.chance(0.5) ? 'm' : 'f';
  // Children take the father's house; a commoner father passes his surname.
  const house = f.house;
  const surname = house ? houseSurname(house) : f.surname;
  const id = addPerson(sim, {
    given: sim.rng.pick(sex === 'm' ? GIVEN_M : GIVEN_F),
    surname,
    sex,
    house,
    born,
    gen: Math.max(f.gen, m.gen) + 1,
    dynasty: f.dynasty || m.dynasty,
    parents: [father, mother],
    adult: false,
  });
  sim.links.push({ child: id, parent: father, kind: 'biological', confidence: 'certain' });
  sim.links.push({ child: id, parent: mother, kind: 'biological', confidence: 'certain' });
  return id;
}

function makeUnion(sim: Sim, a: number, b: number, start: number): number {
  const id = sim.unions.length;
  const annul = sim.annulments < 2 && start > 940 && sim.rng.chance(0.012);
  if (annul) sim.annulments++;
  sim.unions.push({
    id,
    a,
    b,
    start,
    end: annul ? start + 1 + sim.rng.next() : null,
    endReason: annul ? 'annulment' : null,
    annulled: annul,
    children: [],
  });
  sim.people[a]!.unions.push(id);
  sim.people[b]!.unions.push(id);
  return id;
}

function grandparents(sim: Sim, idx: number): number[] {
  const out: number[] = [];
  for (const par of sim.people[idx]!.parents) out.push(...sim.people[par]!.parents);
  return out;
}

function sharesGrandparent(sim: Sim, a: number, b: number): boolean {
  const gb = new Set(grandparents(sim, b));
  return grandparents(sim, a).some((g) => gb.has(g));
}

function siblings(sim: Sim, a: number, b: number): boolean {
  const pa = sim.people[a]!.parents;
  return sim.people[b]!.parents.some((p) => pa.includes(p));
}

/** Pick a spouse for `idx`: usually a single from the pool (cousins preferred sometimes), else an outsider. */
function chooseSpouse(sim: Sim, idx: number): number {
  const rng = sim.rng;
  const p = sim.people[idx]!;
  const want = p.sex === 'm' ? 'f' : 'm';
  if (rng.chance(0.6) && sim.singles.length > 0) {
    const cands = sim.singles.filter((c) => {
      const s = sim.people[c]!;
      return (
        s.sex === want &&
        Math.abs(s.born - p.born) <= 8 &&
        !siblings(sim, idx, c) &&
        (s.house === null || s.house !== p.house)
      );
    });
    if (cands.length > 0) {
      const cousins = cands.filter((c) => sharesGrandparent(sim, idx, c));
      const pick = cousins.length > 0 && rng.chance(0.7) ? rng.pick(cousins) : rng.pick(cands);
      sim.singles.splice(sim.singles.indexOf(pick), 1);
      return pick;
    }
  }
  return makeOutsider(sim, want, p.born, p.gen, p.house);
}

function sampleCount(sim: Sim, dynasty: boolean): number {
  return sim.rng.weighted(COUNTS, dynasty ? DYNASTY_WEIGHTS : NORMAL_WEIGHTS);
}

/** Marry `idx` to a chosen spouse, then let the couple have children. */
function marry(sim: Sim, idx: number): void {
  const p = sim.people[idx]!;
  if (p.gen >= MAX_GEN || !sim.rng.chance(MARRY_CHANCE)) return;
  const spouseIdx = chooseSpouse(sim, idx);
  const s = sim.people[spouseIdx]!;
  const ageAt = (x: SimPerson) => x.born + (x.sex === 'm' ? 20 : 16) + sim.rng.next() * 8;
  const start = Math.max(ageAt(p), ageAt(s));
  if (start > Math.min(p.died, s.died) - 1 || start > MAX_BIRTH) return;
  const u = makeUnion(sim, idx, spouseIdx, start);
  bearChildren(sim, u);
}

function bearChildren(sim: Sim, uIdx: number): void {
  const rng = sim.rng;
  const u = sim.unions[uIdx]!;
  if (u.annulled) return;
  const a = sim.people[u.a]!;
  const b = sim.people[u.b]!;
  const father = a.sex === 'm' ? u.a : u.b;
  const mother = a.sex === 'm' ? u.b : u.a;
  const m = sim.people[mother]!;
  const count = sampleCount(sim, a.dynasty || b.dynasty);
  const lastBirth = Math.min(Math.min(a.died, b.died) - 0.5, m.born + 41, MAX_BIRTH);
  let year = u.start + 1 + rng.next() * 2;

  for (let i = 0; i < count && year <= lastBirth; i++) {
    const c = addChild(sim, father, mother, year);
    u.children.push(c);
    const child = sim.people[c]!;
    // Adults who survive to marry: most marry, some wait as singles for a later match.
    if (child.died > child.born + 17 && rng.chance(MARRY_NOW)) {
      if (rng.chance(0.15)) sim.singles.push(c);
      else marry(sim, c);
    }
    year += 1.5 + rng.next() * 1.5;
  }

  widowRemarriage(sim, uIdx);
}

function widowRemarriage(sim: Sim, uIdx: number): void {
  const rng = sim.rng;
  const u = sim.unions[uIdx]!;
  if (u.annulled) return;
  const a = sim.people[u.a]!;
  const b = sim.people[u.b]!;
  const survivorIdx = a.died < b.died ? u.b : u.a;
  const survivor = sim.people[survivorIdx]!;
  const deathYear = Math.min(a.died, b.died);
  if (survivor.died < deathYear + 3 || deathYear - u.start < 3) return;
  if (deathYear - survivor.born > 52 || !rng.chance(0.15)) return;

  const spouseIdx = makeOutsider(sim, survivor.sex === 'm' ? 'f' : 'm', survivor.born, survivor.gen, survivor.house);
  const spouse = sim.people[spouseIdx]!;
  // The new marriage must start while both are alive; otherwise the spouse waits in the pool.
  const latest = Math.min(survivor.died, spouse.died) - 2;
  const start = deathYear + 1 + rng.next() * 3;
  if (start >= latest || start > MAX_BIRTH - 2) {
    sim.singles.push(spouseIdx);
    return;
  }
  const u2 = makeUnion(sim, survivorIdx, spouseIdx, start);

  // Children of the first marriage still under 15 gain a step-parent, if the step-parent is old enough.
  for (const c of u.children) {
    const cp = sim.people[c]!;
    if (cp.born < start && cp.born > start - 15 && spouse.born <= cp.born - 16) {
      sim.links.push({ child: c, parent: spouseIdx, kind: 'step', confidence: 'certain' });
    }
  }
  bearChildren(sim, u2);
}

/** Build the whole realm: one founding couple per house, then everything descends from them. */
export function simulateRealm(sim: Sim): void {
  const rng = sim.rng;
  HOUSES.forEach((house) => {
    const founder = addPerson(sim, {
      given: rng.pick(GIVEN_M),
      surname: house.surname,
      sex: 'm',
      house: house.key,
      born: 846 + rng.next() * 22,
      gen: 0,
      dynasty: house.key === 'valcourt',
      parents: [],
      adult: true,
    });
    const wife = makeOutsider(sim, 'f', sim.people[founder]!.born, 0, house.key);
    const f = sim.people[founder]!;
    // Clamp to before either spouse dies, so a founder who dies young never marries after death.
    const start = Math.min(f.born + 24 + rng.next() * 6, Math.min(f.died, sim.people[wife]!.died) - 1);
    const u = makeUnion(sim, founder, wife, start);
    bearChildren(sim, u);
  });
}

/** Count couples whose partners share a grandparent (first-cousin or closer pedigree collapse). */
export function countCollapsedUnions(sim: Sim): number {
  return sim.unions.filter((u) => sharesGrandparent(sim, u.a, u.b)).length;
}
