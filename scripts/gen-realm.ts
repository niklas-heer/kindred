// Generates data/seed/realm.json: "The Realm of Aurelmarch", 880–1210, theme "codex".
// Run with `node scripts/gen-realm.ts`. Output is byte-identical on every run.

import { fileURLToPath } from 'node:url';
import type { SeedHouse, SeedParent, SeedPerson, SeedStory, SeedTree, SeedUnion } from '../src/lib/seed-format.ts';
import { idOf, mulberry32 } from './lib/rng.ts';
import type { Rng } from './lib/rng.ts';
import { summarize, validate, writeTree } from './lib/check.ts';
import { placeRealm } from './lib/places.ts';
import { addLife } from './lib/life.ts';
import {
  ABBEYS,
  BISHOP_SEES,
  EPITHETS_F,
  EPITHETS_M,
  HOUSES,
  OCCUPATIONS_MEDIEVAL,
  PLACES,
  TRAITS,
} from './lib/realm-data.ts';
import { countCollapsedUnions, createSim, simulateRealm } from './lib/realm-sim.ts';
import type { Sim, SimPerson } from './lib/realm-sim.ts';
import { makeBio, makeStory } from './lib/realm-text.ts';
import type { TextSubject } from './lib/realm-text.ts';

const SEED = 880;
const TEXT_SEED = 0x5eed;
const OUT_PATH = fileURLToPath(new URL('../data/seed/realm.json', import.meta.url));
const STORY_TOTAL = 400;
const FOCUS_YEAR = 1160;

type Headwear = NonNullable<SeedPerson['look']>['headwear'];

/** Per-person extras decided after the simulation: titles, epithets, headwear, places. */
interface Extra {
  title?: string;
  epithet?: string;
  headwear?: Headwear;
  occupation?: string;
  place: string;
}

interface Reign {
  king: number;
  from: number;
  to: number;
}

function childrenOf(sim: Sim, idx: number): SimPerson[] {
  const out: SimPerson[] = [];
  for (const u of sim.unions) {
    if (u.a === idx || u.b === idx) for (const c of u.children) out.push(sim.people[c]!);
  }
  return out;
}

/** Succession: the eldest surviving son, else a daughter, else any living dynasty man. */
function royalChain(sim: Sim, rng: Rng): Reign[] {
  const chain: Reign[] = [];
  let current = 0; // the founder of House Valcourt is the first person simulated
  let from = 880;
  for (let step = 0; step < 20; step++) {
    const king = sim.people[current]!;
    chain.push({ king: current, from, to: king.died });
    const alive = childrenOf(sim, current).filter((c) => c.born + 16 <= king.died && c.died > king.died);
    const sons = alive.filter((c) => c.sex === 'm').sort((x, y) => x.born - y.born);
    const daughters = alive.filter((c) => c.sex === 'f').sort((x, y) => x.born - y.born);
    let heir: SimPerson | undefined = sons[0] ?? daughters[0];
    if (!heir) {
      const others = sim.people.filter(
        (p) => p.house === 'valcourt' && p.sex === 'm' && p.born + 16 <= king.died && p.died > king.died,
      );
      heir = others.length > 0 ? rng.pick(others) : undefined;
    }
    if (!heir) break;
    from = king.died;
    current = heir.id;
  }
  return chain;
}

/** Focus: the king reigning in 1160 needs a spouse, 3–5 children, and a parent alive for part of his youth. */
function findFocus(sim: Sim, chain: Reign[]): number {
  const reigning = chain.find((r) => r.from <= FOCUS_YEAR && FOCUS_YEAR < r.to);
  if (!reigning) return -1;
  const idx = reigning.king;
  const p = sim.people[idx]!;
  const spouse = sim.unions.some((u) => u.a === idx || u.b === idx);
  const kids = childrenOf(sim, idx).length;
  const parentLived = p.parents.some((par) => sim.people[par]!.died >= p.born + 18);
  return spouse && kids >= 3 && kids <= 5 && parentLived ? idx : -1;
}

function fmtDate(year: number, rng: Rng, approx = false): string {
  const y = Math.floor(year);
  if (approx) return `~${y}`;
  const roll = rng.next();
  if (roll < 0.6) return String(y);
  const mm = String(rng.int(1, 12)).padStart(2, '0');
  if (roll < 0.9) return `${y}-${mm}`;
  return `${y}-${mm}-${String(rng.int(1, 28)).padStart(2, '0')}`;
}

function seatOf(houseIdx: number): string {
  return PLACES[(houseIdx * 2) % PLACES.length]!;
}

function assignExtras(sim: Sim, chain: Reign[], rng: Rng): Map<number, Extra> {
  const extras = new Map<number, Extra>();
  const houseIndex = new Map(HOUSES.map((h, i) => [h.key, i] as const));
  const place = (): string => rng.pick(PLACES);
  const kingIds = new Set(chain.map((r) => r.king));
  // Sons of rulers wear a circlet as heirs (or as cadets, once they are given a county).
  const sons = new Set<number>();
  for (const r of chain) {
    for (const c of childrenOf(sim, r.king)) if (c.sex === 'm') sons.add(c.id);
  }

  // Rulers: crown, epithet always.
  for (const r of chain) {
    const k = sim.people[r.king]!;
    extras.set(r.king, {
      title: k.sex === 'm' ? 'King of Aurelmarch' : 'Queen of Aurelmarch',
      epithet: rng.pick(k.sex === 'm' ? EPITHETS_M : EPITHETS_F),
      headwear: 'crown',
      place: seatOf(0),
    });
  }

  // Ducal heads for the eleven rival houses, one each; every fourth is a duchess.
  HOUSES.forEach((house, i) => {
    if (house.key === 'valcourt') return;
    const sex = i % 4 === 3 ? 'f' : 'm';
    const head = sim.people.find(
      (p) => p.house === house.key && p.sex === sex && p.gen >= 2 && p.gen <= 6 && !extras.has(p.id),
    );
    if (!head) return;
    const seat = seatOf(houseIndex.get(house.key)!);
    extras.set(head.id, {
      title: `${sex === 'm' ? 'Duke' : 'Duchess'} of ${seat}`,
      headwear: 'circlet',
      place: seat,
    });
  });

  for (const p of sim.people) {
    if (extras.has(p.id) || kingIds.has(p.id)) continue;
    const adultAge = p.died - p.born > 18;
    if (p.house === 'valcourt' && p.sex === 'm' && adultAge && rng.chance(0.12)) {
      // Cadet branch: a younger son of the royal line, given a county.
      const county = place();
      extras.set(p.id, { title: `Count of ${county}`, headwear: 'circlet', place: county });
    } else if (p.house && p.sex === 'm' && adultAge && rng.chance(0.03)) {
      const county = place();
      extras.set(p.id, { title: `Count of ${county}`, headwear: 'circlet', place: county });
    } else if (p.house && p.sex === 'f' && adultAge && rng.chance(0.02)) {
      const county = place();
      extras.set(p.id, { title: `Countess of ${county}`, headwear: 'circlet', place: county });
    } else if (p.sex === 'm' && adultAge && p.born < 1180 && rng.chance(0.012)) {
      const see = rng.pick(BISHOP_SEES);
      extras.set(p.id, { title: `Bishop of ${see}`, headwear: 'mitre', occupation: 'bishop', place: see });
    } else if (p.sex === 'f' && adultAge && p.born < 1180 && rng.chance(0.02)) {
      const abbey = rng.pick(ABBEYS);
      extras.set(p.id, { title: `Abbess of ${abbey}`, headwear: 'veil', occupation: 'abbess', place: abbey });
    } else if (p.house && p.sex === 'm' && adultAge && rng.chance(0.04)) {
      const manor = place();
      extras.set(p.id, { title: `Knight of ${manor}`, place: manor });
    } else if (!p.house && p.sex === 'm' && adultAge && rng.chance(0.02)) {
      extras.set(p.id, { occupation: 'monk', headwear: 'hood', place: place() });
    } else if (p.house && p.sex === 'f' && rng.chance(0.25)) {
      extras.set(p.id, { headwear: 'veil', place: seatOf(houseIndex.get(p.house) ?? 0) });
    } else {
      extras.set(p.id, {
        occupation: !p.house && rng.chance(0.4) ? rng.pick(OCCUPATIONS_MEDIEVAL) : undefined,
        place: p.house ? seatOf(houseIndex.get(p.house) ?? 0) : place(),
      });
    }
  }
  // About 20% of everyone else carries an epithet.
  for (const [id, e] of extras) {
    if (kingIds.has(id) || e.epithet || !rng.chance(0.2)) continue;
    e.epithet = rng.pick(sim.people[id]!.sex === 'm' ? EPITHETS_M : EPITHETS_F);
  }
  for (const id of sons) {
    const e = extras.get(id);
    if (e && !e.headwear) e.headwear = 'circlet';
  }
  return extras;
}

/** Disputed fatherhood (3) and adoptions or fosterings (4). Alternates and guardians are always older than the child. */
function addFamilyLinks(sim: Sim, rng: Rng): void {
  const kids = sim.people.filter((p) => p.parents.length === 2 && p.born > 1000 && p.born < 1180);
  let disputed = 0;
  for (const c of rng.shuffle(kids)) {
    if (disputed === 3) break;
    const alts = sim.people.filter(
      (p) => p.sex === 'm' && p.id !== c.parents[0] && p.born >= c.born - 45 && p.born <= c.born - 16,
    );
    if (alts.length === 0) continue;
    sim.links.push({ child: c.id, parent: rng.pick(alts).id, kind: 'biological', confidence: 'disputed' });
    disputed++;
  }

  let placed = 0;
  const orphans = rng.shuffle(kids.filter((c) => sim.people[c.parents[0]!]!.died < c.born + 15));
  for (const c of orphans) {
    if (placed === 4) break;
    const guardians = sim.people.filter(
      (p) => p.born <= c.born - 16 && p.died >= c.born + 5 && !c.parents.includes(p.id),
    );
    if (guardians.length === 0) continue;
    sim.links.push({
      child: c.id,
      parent: rng.pick(guardians).id,
      kind: placed < 2 ? 'adoptive' : 'foster',
      confidence: 'certain',
    });
    placed++;
  }
}

function buildPeople(sim: Sim, extras: Map<number, Extra>, rng: Rng): SeedPerson[] {
  return sim.people.map((p) => {
    const e = extras.get(p.id)!;
    const age = p.died - p.born;
    const approx = p.gen === 0 || rng.chance(0.12);
    const person: SeedPerson = {
      id: idOf('p', p.id + 1),
      given: p.given,
      sex: p.sex,
      born: fmtDate(p.born, rng, approx),
      died: fmtDate(p.died, rng),
      traits: rng.shuffle(TRAITS).slice(0, rng.int(1, 4)),
      look: {
        skin: rng.int(0, 5),
        hair: rng.int(0, 7),
        eyes: rng.int(0, 4),
        ...(p.sex === 'm' && age >= 18 && rng.chance(0.55) ? { beard: true } : {}),
        ...(e.headwear ? { headwear: e.headwear } : {}),
      },
    };
    if (p.surname) person.surname = p.surname;
    if (p.house) person.house = p.house;
    if (rng.chance(0.7)) person.bornPlace = rng.chance(0.6) ? e.place : rng.pick(PLACES);
    if (rng.chance(0.5)) person.diedPlace = rng.pick(PLACES);
    if (e.epithet) person.epithet = e.epithet;
    if (e.title) person.title = e.title;
    if (e.occupation) person.occupation = e.occupation;
    if (e.title || e.epithet) {
      const subject: TextSubject = {
        name: p.given,
        title: e.title,
        sex: p.sex,
        place: e.place,
        year: Math.floor(p.born + 25),
        house: p.house ? HOUSES.find((h) => h.key === p.house)?.name : undefined,
      };
      person.bio = makeBio(rng, subject, e.epithet);
    }
    return person;
  });
}

function buildHouses(sim: Sim): SeedHouse[] {
  return HOUSES.map((h) => {
    const founder = sim.people.find((p) => p.house === h.key && p.gen === 0 && p.sex === 'm');
    const house: SeedHouse = { id: h.key, name: h.name, motto: h.motto, arms: { ...h.arms } };
    if (founder) house.founder = idOf('p', founder.id + 1);
    return house;
  });
}

function buildUnions(sim: Sim, rng: Rng): SeedUnion[] {
  return sim.unions.map((u) => {
    const a = sim.people[u.a]!;
    const b = sim.people[u.b]!;
    const union: SeedUnion = {
      id: idOf('u', u.id + 1),
      a: idOf('p', a.id + 1),
      b: idOf('p', b.id + 1),
      start: fmtDate(u.start, rng),
    };
    if (u.annulled && u.end !== null) {
      union.end = fmtDate(u.end, rng);
      union.endReason = 'annulment';
    } else {
      union.end = fmtDate(Math.min(a.died, b.died), rng);
      union.endReason = 'death';
    }
    if (rng.chance(0.4)) union.place = rng.pick(PLACES);
    return union;
  });
}

function storyStamp(rng: Rng): string {
  const year = rng.pick([2024, 2025, 2026]);
  const month = year === 2026 ? rng.int(1, 10) : rng.int(1, 12);
  const day = rng.int(1, 28);
  const hh = String(rng.int(7, 22)).padStart(2, '0');
  const mm = String(rng.int(0, 59)).padStart(2, '0');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hh}:${mm}:00Z`;
}

function buildStories(sim: Sim, reigns: Reign[], extras: Map<number, Extra>, people: SeedPerson[], rng: Rng): SeedStory[] {
  const stories: SeedStory[] = [];
  const subjectOf = (idx: number): TextSubject => {
    const p = sim.people[idx]!;
    const e = extras.get(idx)!;
    return {
      name: p.given,
      title: e.title,
      sex: p.sex,
      place: e.place,
      year: Math.floor(p.born + 25),
      house: p.house ? HOUSES.find((h) => h.key === p.house)?.name : undefined,
    };
  };
  const add = (idx: number): void => {
    const draft = makeStory(rng, subjectOf(idx));
    stories.push({
      id: idOf('s', stories.length + 1),
      person: people[idx]!.id,
      kind: draft.kind,
      ...(draft.title ? { title: draft.title } : {}),
      body: draft.body,
      author: draft.author,
      at: storyStamp(rng),
      ...(draft.context ? { context: draft.context } : {}),
    });
  };

  // Rulers get 3–8 each.
  for (const r of reigns) {
    const n = rng.int(3, 8);
    for (let i = 0; i < n; i++) add(r.king);
  }

  // The rest are weighted toward titled and epithet holders. Rulers already have their 3–8, so they are excluded.
  const rulerIds = new Set(reigns.map((r) => r.king));
  const weights = sim.people.map((p) => {
    if (rulerIds.has(p.id)) return 0;
    const e = extras.get(p.id)!;
    if (e.title) return 4;
    if (e.epithet) return 3;
    return p.dynasty ? 0.4 : 0.15;
  });
  const everyone = sim.people.map((_, i) => i);
  while (stories.length < STORY_TOTAL) {
    add(rng.weighted(everyone, weights));
  }
  return stories;
}

interface Built {
  tree: SeedTree;
  sim: Sim;
  reigns: Reign[];
  focus: number;
  seed: number;
}

/** Returns null when this seed misses a hard constraint, so the driver can try the next one. */
function build(seed: number): Built | null {
  const sim = createSim(seed);
  simulateRealm(sim);
  const dynasty = sim.people.filter((p) => p.dynasty).length;
  if (sim.people.length < 1300 || sim.people.length > 1800) return null;
  if (dynasty < 300 || dynasty > 420 || countCollapsedUnions(sim) < 3 || sim.annulments < 1) return null;

  const rng = mulberry32(TEXT_SEED);
  addFamilyLinks(sim, rng);
  const reigns = royalChain(sim, rng);
  const focus = findFocus(sim, reigns);
  if (focus < 0) return null;
  const extras = assignExtras(sim, reigns, rng);
  const people = buildPeople(sim, extras, rng);
  const stories = buildStories(sim, reigns, extras, people, rng);

  const parents: SeedParent[] = sim.links.map((l) => {
    const link: SeedParent = { child: idOf('p', l.child + 1), parent: idOf('p', l.parent + 1) };
    if (l.kind !== 'biological') link.kind = l.kind;
    if (l.confidence !== 'certain') link.confidence = l.confidence;
    return link;
  });

  const tree: SeedTree = {
    id: 'realm',
    name: 'The Realm of Aurelmarch',
    tagline: 'Aurelmarch, 880–1210: the House of Valcourt and its rivals',
    theme: 'codex',
    houses: buildHouses(sim),
    people,
    parents,
    unions: buildUnions(sim, rng),
    stories,
    contacts: [],
    focus: idOf('p', focus + 1),
  };
  return { tree, sim, reigns, focus, seed };
}

function main(): void {
  for (let seed = SEED; seed < SEED + 5000; seed++) {
    const built = build(seed);
    if (!built) continue;
    const { tree, sim, reigns, focus } = built;
    validate(tree);
    placeRealm(tree, mulberry32(built.seed));
    // Life events and sources after the places, so events name the family's pinned towns (scripts/lib/life.ts).
    addLife(tree, mulberry32(built.seed + 24), 'realm');
    writeTree(tree, OUT_PATH);

    const s = summarize(tree);
    console.log(`realm: wrote ${OUT_PATH} (seed ${built.seed})`);
    console.log(`  people ${s.people}, unions ${s.unions}, stories ${s.stories}, contacts ${s.contacts}, events ${tree.events?.length ?? 0}, citations ${tree.citations?.length ?? 0}`);
    console.log(`  living ${s.living}, max generation depth ${s.maxGenerationDepth}`);
    console.log(`  largest house ${s.largestHouse.name} (${s.largestHouse.members} members)`);
    console.log(`  dynasty descendants of Valcourt ${sim.people.filter((p) => p.dynasty).length}; cousin-marriage unions ${countCollapsedUnions(sim)}`);
    console.log(`  rulers ${reigns.length}; focus ${tree.focus} (${sim.people[focus]!.given})`);
    return;
  }
  throw new Error(`no seed in ${SEED}..${SEED + 4999} met the realm constraints`);
}

main();
