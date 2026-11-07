// Generates data/seed/modern.json: the Lindqvist–Ashworth family, 1870 to today (2026-11-07), theme "modern".
// Run with `node scripts/gen-modern.ts`. Output is byte-identical on every run.

import { fileURLToPath } from 'node:url';
import type { SeedContact, SeedHouse, SeedParent, SeedPerson, SeedStory, SeedTree, SeedUnion } from '../src/lib/seed-format.ts';
import type { Rng } from './lib/rng.ts';
import { idOf, mulberry32 } from './lib/rng.ts';
import { summarize, validate, writeTree } from './lib/check.ts';
import {
  FAMILIES,
  FAVOURITE_FOODS,
  FAVOURITE_MUSIC,
  FAVOURITE_THINGS,
  GIVEN_F_DE,
  GIVEN_F_EN,
  GIVEN_F_SV,
  GIVEN_M_DE,
  GIVEN_M_EN,
  GIVEN_M_SV,
  NICKNAMES,
  OCCUPATIONS,
  OUTSIDE_SURNAMES,
  PLACES_MODERN,
} from './lib/modern-data.ts';
import { makeModernStory } from './lib/modern-text.ts';
import type { ModernSubject } from './lib/modern-text.ts';

const SEED = 1870;
const TEXT_SEED = 0xa5b0;
const OUT_PATH = fileURLToPath(new URL('../data/seed/modern.json', import.meta.url));
const NOW = 2026 + 310 / 365; // 2026-11-07
const LAST_BIRTH = 2024.5;
const MAX_GEN = 6;
const STORY_TOTAL = 250;
const KIDS = [0, 1, 2, 3, 4, 5];
const KID_WEIGHTS = [14, 20, 26, 22, 12, 6];
// Big early families, moderate middle, small later ones: most of the dead come from the older generations,
// which keeps the living share near 60% while the tree still reaches about 320 people.
const EARLY_KID_WEIGHTS = [4, 12, 22, 26, 20, 16];
const LATE_KID_WEIGHTS = [30, 30, 22, 12, 6, 0];

function kidWeightsFor(gen: number): number[] {
  if (gen <= 2) return EARLY_KID_WEIGHTS;
  return gen === 3 ? KID_WEIGHTS : LATE_KID_WEIGHTS;
}
const STREETS = ['Linden Way', 'Storgatan', 'Hauptstraße', 'Mill Lane', 'Birkenweg', 'Kvarnvägen', 'Rowan Close', 'Elm Road'];

type Nat = 'sv' | 'en' | 'de';
const NAT_OF_FAMILY: Record<string, Nat> = { lindqvist: 'sv', ashworth: 'en', brandt: 'de', sjoberg: 'sv' };
const NAT_POOLS: Record<Nat, { m: string[]; f: string[] }> = {
  sv: { m: GIVEN_M_SV, f: GIVEN_F_SV },
  en: { m: GIVEN_M_EN, f: GIVEN_F_EN },
  de: { m: GIVEN_M_DE, f: GIVEN_F_DE },
};
const NATS: Nat[] = ['sv', 'en', 'de'];

interface MPerson {
  id: number;
  given: string;
  surname: string;
  house: string | null;
  sex: 'm' | 'f';
  nat: Nat;
  born: number;
  died: number | null; // null while living
  gen: number;
  parents: number[];
  unions: number[];
}

interface MUnion {
  id: number;
  a: number;
  b: number;
  kind: 'marriage' | 'partnership';
  start: number;
  end: number | null;
  endReason: 'death' | 'divorce' | null;
  children: number[];
}

interface MLink {
  child: number;
  parent: number;
  kind: 'biological' | 'adoptive' | 'step';
}

interface MSim {
  rng: Rng;
  people: MPerson[];
  unions: MUnion[];
  links: MLink[];
  stats: { divorces: number; partnerships: number; sameSex: number; adoptions: number; steps: number };
}

function newSim(seed: number): MSim {
  return {
    rng: mulberry32(seed),
    people: [],
    unions: [],
    links: [],
    stats: { divorces: 0, partnerships: 0, sameSex: 0, adoptions: 0, steps: 0 },
  };
}

function lifespan(rng: Rng, born: number): number {
  if (rng.chance(0.04)) return rng.next() * 40; // accident or illness young
  const mean = born >= 1940 ? 80 : 72;
  return Math.min(102, Math.max(1, rng.gauss(mean, 10)));
}

function addPerson(sim: MSim, init: Omit<MPerson, 'id' | 'died' | 'unions'>): number {
  const id = sim.people.length;
  const died = init.born + lifespan(sim.rng, init.born);
  sim.people.push({ ...init, id, died: died > NOW ? null : died, unions: [] });
  return id;
}

function person(sim: MSim, id: number): MPerson {
  return sim.people[id]!;
}

/** A spouse who arrives from outside the four families: no recorded parents. */
function outsider(sim: MSim, sex: 'm' | 'f', near: number, gen: number): number {
  const rng = sim.rng;
  const nat = rng.pick(NATS);
  return addPerson(sim, {
    given: rng.pick(NAT_POOLS[nat][sex]),
    surname: rng.pick(OUTSIDE_SURNAMES),
    house: null,
    sex,
    nat,
    born: near + rng.gauss(0, 3),
    gen,
    parents: [],
  });
}

function addChild(sim: MSim, father: number, mother: number, born: number, gen: number): number {
  const rng = sim.rng;
  const f = person(sim, father);
  const sex = rng.chance(0.5) ? 'm' : 'f';
  const id = addPerson(sim, {
    given: rng.pick(NAT_POOLS[f.nat][sex]),
    surname: f.surname,
    house: f.house,
    sex,
    nat: f.nat,
    born,
    gen,
    parents: [father, mother],
  });
  sim.links.push({ child: id, parent: father, kind: 'biological' }, { child: id, parent: mother, kind: 'biological' });
  return id;
}

function makeUnion(sim: MSim, a: number, b: number, start: number, kind: MUnion['kind']): number {
  const id = sim.unions.length;
  sim.unions.push({ id, a, b, kind, start, end: null, endReason: null, children: [] });
  person(sim, a).unions.push(id);
  person(sim, b).unions.push(id);
  return id;
}

/** A child of the tree who is single and free when they come of age: someone from another family, else an outsider. */
function pickSpouse(sim: MSim, childId: number, at: number, gen: number): number {
  const rng = sim.rng;
  const c = person(sim, childId);
  const sameSex = rng.chance(0.07);
  const want = sameSex ? c.sex : c.sex === 'm' ? 'f' : 'm';
  if (!sameSex && rng.chance(0.35)) {
    const loose = sim.people.filter(
      (p) =>
        p.house !== null &&
        p.house !== c.house &&
        p.sex === want &&
        p.unions.length === 0 &&
        Math.abs(p.born - c.born) <= 5 &&
        (p.died === null || p.died > at),
    );
    if (loose.length > 0) return rng.pick(loose).id;
  }
  return outsider(sim, want, c.born, gen);
}

/** Start a couple, let them have children, let adult children marry, and handle divorce and remarriage. */
function formCouple(sim: MSim, a: number, b: number, start: number, gen: number): void {
  const rng = sim.rng;
  const pa = person(sim, a);
  const pb = person(sim, b);
  const cut = Math.min(pa.died ?? NOW, pb.died ?? NOW);
  if (start >= cut - 0.5 || start > LAST_BIRTH + 1) return;

  const sameSex = pa.sex === pb.sex;
  const kind: MUnion['kind'] = !sameSex && rng.chance(0.09) ? 'partnership' : 'marriage';
  const uid = makeUnion(sim, a, b, start, kind);
  const union = sim.unions[uid]!;
  if (kind === 'partnership') sim.stats.partnerships++;

  if (sameSex) {
    sim.stats.sameSex++;
    if (rng.chance(0.6)) {
      // Two men or two women adopt a child from elsewhere.
      const born = start + 1.5 + rng.next() * 2;
      if (born < cut - 0.5 && born <= LAST_BIRTH) {
        const sex = rng.chance(0.5) ? 'm' : 'f';
        const kid = addPerson(sim, {
          given: rng.pick(NAT_POOLS[pa.nat][sex]),
          surname: pa.house ? pa.surname : pb.surname,
          house: pa.house ?? pb.house,
          sex,
          nat: pa.nat,
          born,
          gen: gen + 1,
          parents: [a, b],
        });
        sim.links.push({ child: kid, parent: a, kind: 'adoptive' }, { child: kid, parent: b, kind: 'adoptive' });
        union.children.push(kid);
        sim.stats.adoptions++;
      }
    }
    return;
  }

  const father = pa.sex === 'm' ? a : b;
  const mother = father === a ? b : a;
  const divorceAt = rng.chance(0.14) ? start + 6 + rng.next() * 10 : null;
  const mcap = Math.min(person(sim, mother).born + 42, cut - 0.5, LAST_BIRTH);
  const kids = rng.weighted(KIDS, kidWeightsFor(gen));
  let year = start + 1 + rng.next() * 2;
  for (let i = 0; i < kids && year <= mcap; i++) {
    if (divorceAt !== null && year > divorceAt) break;
    union.children.push(addChild(sim, father, mother, year, gen + 1));
    year += 2 + rng.next() * 2;
  }

  // Adult children may start families of their own.
  if (gen + 1 < MAX_GEN) {
    for (const c of union.children) {
      const child = person(sim, c);
      const at = child.born + 22 + rng.next() * 5;
      if (!rng.chance(0.85) || at >= NOW - 1 || (child.died !== null && child.died <= at + 1)) continue;
      const spouse = pickSpouse(sim, c, at, gen + 1);
      const spouseAt = person(sim, spouse).born + 22 + rng.next() * 5;
      formCouple(sim, c, spouse, Math.max(at, spouseAt), gen + 1);
    }
  }

  // Divorce, and sometimes a second marriage for one of the former partners.
  if (divorceAt !== null && divorceAt < cut - 1 && divorceAt < NOW - 2) {
    union.end = divorceAt;
    union.endReason = 'divorce';
    sim.stats.divorces++;
    if (rng.chance(0.6)) {
      const who = rng.chance(0.5) ? a : b;
      const whoPerson = person(sim, who);
      const newSpouse = outsider(sim, whoPerson.sex === 'm' ? 'f' : 'm', whoPerson.born, gen);
      const secondStart = divorceAt + 1 + rng.next() * 3;
      const ns = person(sim, newSpouse);
      for (const c of union.children) {
        const cp = person(sim, c);
        if (cp.born < secondStart && cp.born > secondStart - 18 && ns.born <= cp.born - 16) {
          sim.links.push({ child: c, parent: newSpouse, kind: 'step' });
          sim.stats.steps++;
        }
      }
      formCouple(sim, who, newSpouse, secondStart, gen);
    }
  }
}

function buildFamilies(sim: MSim): void {
  const rng = sim.rng;
  // Two founding couples per family: eight marriages in the 1870s, the large early generation.
  Array.from({ length: FAMILIES.length * 2 }, (_, k) => k).forEach((i) => {
    const fam = FAMILIES[i % FAMILIES.length]!;
    const nat = NAT_OF_FAMILY[fam.key]!;
    const founder = addPerson(sim, {
      given: rng.pick(NAT_POOLS[nat].m),
      surname: fam.surname,
      house: fam.key,
      sex: 'm',
      nat,
      born: 1866 + rng.next() * 14,
      gen: 1,
      parents: [],
    });
    const other = FAMILIES[(i + 1) % FAMILIES.length]!;
    const otherNat = NAT_OF_FAMILY[other.key]!;
    const wife = addPerson(sim, {
      given: rng.pick(NAT_POOLS[otherNat].f),
      surname: other.surname,
      house: other.key,
      sex: 'f',
      nat: otherNat,
      born: person(sim, founder).born + rng.gauss(0, 3),
      gen: 1,
      parents: [],
    });
    formCouple(sim, founder, wife, person(sim, founder).born + 24 + rng.next() * 6, 1);
  });

  // A marriage that ends in death closes on the earlier death.
  for (const u of sim.unions) {
    if (u.end !== null) continue;
    const ca = person(sim, u.a).died;
    const cb = person(sim, u.b).died;
    if (ca !== null || cb !== null) {
      u.end = Math.min(ca ?? Infinity, cb ?? Infinity);
      u.endReason = 'death';
    }
  }
}

function findFocus(sim: MSim): number {
  for (const p of sim.people) {
    if (p.born < 1986 || p.born >= 1991 || p.died !== null) continue;
    const kids = p.unions.flatMap((uid) => sim.unions[uid]!.children).filter((c) => person(sim, c).born >= 2014);
    const partnered = p.unions.some((uid) => sim.unions[uid]!.end === null);
    if (partnered && kids.length >= 2 && kids.length <= 3) return p.id;
  }
  return -1;
}

/** Calendar date from a fractional year, e.g. 1988.5 → "1988-07-02". Used for living people and marriages. */
function isoDate(v: number): string {
  const y = Math.floor(v);
  const day = Math.floor((v - y) * 365.25);
  return new Date(Date.UTC(y, 0, 1 + day)).toISOString().slice(0, 10);
}

/** Partial date for the deceased: year, year-month, or approximate. */
function partialDate(v: number, rng: Rng): string {
  const y = Math.floor(v);
  const roll = rng.next();
  if (roll < 0.5) return String(y);
  return `${y}-${String(rng.int(1, 12)).padStart(2, '0')}`;
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function phoneFor(nat: Nat, rng: Rng): string {
  const cc = nat === 'sv' ? '+46' : nat === 'en' ? '+44' : '+49';
  return `${cc} 555 ${rng.int(100, 999)} ${rng.int(1000, 9999)}`;
}

function build(seed: number): { tree: SeedTree; focus: number; seed: number } | null {
  const sim = newSim(seed);
  buildFamilies(sim);

  const n = sim.people.length;
  const living = sim.people.filter((p) => p.died === null).length;
  const share = living / n;
  if (n < 290 || n > 350 || share < 0.55 || share > 0.65) return null;
  if (sim.stats.divorces < 3 || sim.stats.partnerships < 3 || sim.stats.sameSex < 2) return null;
  if (sim.stats.adoptions < 1 || sim.stats.steps < 2) return null;
  const focus = findFocus(sim);
  if (focus < 0) return null;

  const rng = mulberry32(TEXT_SEED);
  // Rare non-binary entries: two adults, chosen by the seeded shuffle.
  const nonBinary = new Set(rng.shuffle(sim.people.filter((q) => q.born >= 1950)).slice(0, 2).map((q) => q.id));

  const people: SeedPerson[] = sim.people.map((p) => {
    const alive = p.died === null;
    const adult = p.born <= 2008;
    const out: SeedPerson = {
      id: idOf('p', p.id + 1),
      given: p.given,
      surname: p.surname,
      house: p.house ?? undefined,
      sex: nonBinary.has(p.id) ? 'x' : p.sex,
      born: alive ? isoDate(p.born) : partialDate(p.born, rng),
      look: {
        skin: rng.int(0, 5),
        hair: rng.int(0, 7),
        eyes: rng.int(0, 4),
        ...(p.sex === 'm' && p.born < 2000 && rng.chance(0.4) ? { beard: true } : {}),
      },
    };
    if (!out.house) delete out.house;
    if (!alive) out.died = partialDate(p.died!, rng);
    if (alive) out.living = true;
    if (rng.chance(0.25)) out.nickname = rng.pick(NICKNAMES);
    if (alive && adult && rng.chance(0.75)) out.occupation = rng.pick(OCCUPATIONS);
    if (alive && adult && rng.chance(0.6)) {
      out.favourite = `${rng.pick(FAVOURITE_FOODS)}, ${rng.pick(FAVOURITE_MUSIC)}, ${rng.pick(FAVOURITE_THINGS)}`;
    }
    return out;
  });

  const parents: SeedParent[] = sim.links.map((l) => {
    const link: SeedParent = { child: idOf('p', l.child + 1), parent: idOf('p', l.parent + 1) };
    if (l.kind !== 'biological') link.kind = l.kind === 'step' ? 'step' : 'adoptive';
    return link;
  });

  const unions: SeedUnion[] = sim.unions.map((u) => {
    const union: SeedUnion = {
      id: idOf('u', u.id + 1),
      a: idOf('p', u.a + 1),
      b: idOf('p', u.b + 1),
      kind: u.kind,
      start: isoDate(u.start),
    };
    if (u.end !== null) {
      union.end = isoDate(u.end);
      union.endReason = u.endReason!;
    }
    if (rng.chance(0.4)) union.place = rng.pick(PLACES_MODERN);
    return union;
  });

  const contacts: SeedContact[] = [];
  for (const p of sim.people) {
    if (p.died !== null || p.born > 2008) continue;
    const pid = idOf('p', p.id + 1);
    if (rng.chance(0.7)) contacts.push({ person: pid, kind: 'phone', label: 'mobile', value: phoneFor(p.nat, rng) });
    if (rng.chance(0.6)) {
      contacts.push({ person: pid, kind: 'email', label: 'personal', value: `${slug(p.given)}.${slug(p.surname)}@example.com` });
    }
    if (rng.chance(0.4)) {
      const street = `${rng.int(1, 120)} ${rng.pick(STREETS)}, ${rng.pick(PLACES_MODERN)}`;
      contacts.push({ person: pid, kind: 'address', label: 'home', value: street });
    }
  }

  const stories = buildStories(sim, rng);

  const tree: SeedTree = {
    id: 'modern',
    name: 'The Lindqvist–Ashworth family',
    tagline: 'Four families, 1870 to today, with recipes and birthdays',
    theme: 'modern',
    houses: FAMILIES.map((fam) => {
      const founder = sim.people.find((p) => p.house === fam.key && p.gen === 1 && p.sex === 'm')!;
      const house: SeedHouse = { id: fam.key, name: fam.name, arms: { ...fam.arms }, founder: idOf('p', founder.id + 1) };
      return house;
    }),
    people,
    parents,
    unions,
    stories,
    contacts,
    focus: idOf('p', focus + 1),
  };
  return { tree, focus, seed };
}

function buildStories(sim: MSim, rng: Rng): SeedStory[] {
  const living = sim.people.filter((p) => p.died === null && p.born <= 2008);
  const weights = sim.people.map((p) => {
    if (p.born < 1950) return 2;
    if (p.died === null && p.born >= 1986 && p.born < 1991) return 4;
    return 1;
  });
  const everyone = sim.people.map((p) => p.id);
  const stories: SeedStory[] = [];
  while (stories.length < STORY_TOTAL) {
    const subjectId = rng.weighted(everyone, weights);
    const p = person(sim, subjectId);
    const subject: ModernSubject = {
      label: labelFor(p, rng),
      sex: p.sex,
      place: rng.pick(PLACES_MODERN),
    };
    const draft = makeModernStory(rng, subject);
    const author = rng.pick(living.filter((a) => a.id !== subjectId));
    stories.push({
      id: idOf('s', stories.length + 1),
      person: idOf('p', subjectId + 1),
      kind: draft.kind,
      ...(draft.title ? { title: draft.title } : {}),
      body: draft.body,
      author: `${author.given} ${author.surname}`,
      at: storyStampFor(rng),
      ...(draft.context ? { context: draft.context } : {}),
    });
  }
  return stories;
}

function labelFor(p: MPerson, rng: Rng): string {
  if (p.born < 1950) {
    const prefix = p.nat === 'de' ? (p.sex === 'f' ? 'Oma' : 'Opa') : p.nat === 'sv' ? (p.sex === 'f' ? 'Mormor' : 'Morfar') : p.sex === 'f' ? 'Granny' : 'Grandad';
    return `${prefix} ${p.given}`;
  }
  return rng.chance(0.3) ? `${p.given}` : p.given;
}

function storyStampFor(rng: Rng): string {
  const year = rng.pick([2024, 2025, 2026]);
  const month = year === 2026 ? rng.int(1, 10) : rng.int(1, 12);
  const day = rng.int(1, 28);
  const hh = String(rng.int(7, 22)).padStart(2, '0');
  const mm = String(rng.int(0, 59)).padStart(2, '0');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hh}:${mm}:00Z`;
}

function main(): void {
  for (let seed = SEED; seed < SEED + 5000; seed++) {
    const built = build(seed);
    if (!built) continue;
    const { tree, focus } = built;
    validate(tree);
    writeTree(tree, OUT_PATH);

    const s = summarize(tree);
    console.log(`modern: wrote ${OUT_PATH} (seed ${built.seed})`);
    console.log(`  people ${s.people}, unions ${s.unions}, stories ${s.stories}, contacts ${s.contacts}`);
    console.log(`  living ${s.living}, max generation depth ${s.maxGenerationDepth}`);
    console.log(`  largest house ${s.largestHouse.name} (${s.largestHouse.members} members)`);
    console.log(`  focus ${tree.focus} (${tree.people.find((p) => p.id === tree.focus)?.given ?? ''}, focus index ${focus})`);
    return;
  }
  throw new Error(`no seed in ${SEED}..${SEED + 4999} met the modern family constraints`);
}

main();
