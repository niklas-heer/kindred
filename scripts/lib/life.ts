// Life events and sources for the generated families, so the screenshots and the journeys have them: baptisms, schooling,
// service, moves and burials, a few sources of the right era, and citations of births, events, parent links and marriages.
// Deterministic: the same tree and seed give the same records. Run after the places are placed, so events use the
// family's own pinned towns. Everything here is invented.
import type { SeedCitation, SeedEvent, SeedSource, SeedTree } from '../../src/lib/seed-format.ts';
import type { Rng } from './rng.ts';

const yearOf = (d?: string) => (d ? parseInt(d.replace(/^~/, ''), 10) : NaN);
const THIS_YEAR = 2026;

const REALM_SOURCES: SeedSource[] = [
  { id: 'src-chronicle', title: 'Chronicle of Saint-Maixent', author: 'The brothers of Saint-Maixent', publication: 'Abbey library of Saint-Maixent', reference: 'MS 14', note: 'Kept year by year from 1020.' },
  { id: 'src-charters', title: 'Royal charter roll of Aurelmarch', publication: 'Chancery of Aurelmarch', reference: 'Roll C' },
  { id: 'src-accounts', title: 'Household accounts of Valcourt', author: 'Stewards of Castel Sainte-Ode', reference: 'Box 3, quire 7' },
  { id: 'src-parish', title: 'Baptismal book of the cathedral', publication: 'Cathedral chapter', note: 'Partly damaged by fire.' },
];

const MODERN_SOURCES: SeedSource[] = [
  { id: 'src-registry', title: 'Civil registry: births and marriages', publication: 'Town registry office', reference: 'Reg. 1950–1999' },
  { id: 'src-bible', title: 'The family bible', note: 'Names and dates written on the front pages.' },
  { id: 'src-census', title: 'Census returns', publication: 'National archives', reference: 'https://example.org/census' },
  { id: 'src-letters', title: 'Letters from the old house', author: 'Various relatives', note: 'A shoebox of letters, sorted by year.' },
  { id: 'src-school', title: 'School yearbooks', publication: 'Local school archive' },
];

/** Adds events, sources and citations to a generated tree. `kind` chooses the era's events and sources. */
export function addLife(tree: SeedTree, rng: Rng, kind: 'realm' | 'modern'): void {
  const events: SeedEvent[] = [];
  const citations: SeedCitation[] = [];
  const sources = kind === 'realm' ? REALM_SOURCES : MODERN_SOURCES;
  const pinned = (tree.places ?? []).map((p) => p.name);
  const anyPlace = () => (pinned.length ? rng.pick(pinned) : undefined);
  let n = 0;
  const add = (e: Omit<SeedEvent, 'id'>) => {
    const ev = { id: `ev${String(++n).padStart(5, '0')}`, ...e };
    events.push(ev);
    return ev;
  };
  let c = 0;
  const cite = (source: string, target: SeedCitation['target'], extra: Partial<SeedCitation> = {}) =>
    citations.push({ id: `ci${String(++c).padStart(5, '0')}`, source, target, ...extra });

  for (const p of tree.people) {
    const born = yearOf(p.born);
    if (isNaN(born)) continue;
    const died = yearOf(p.died);
    const end = isNaN(died) ? THIS_YEAR : died;
    const age = end - born;
    const home = p.bornPlace ?? anyPlace();
    if (kind === 'realm') {
      if (rng.chance(0.55)) {
        const bapt = add({ person: p.id, type: 'baptism', date: String(born), place: home });
        if (rng.chance(0.4)) cite('src-parish', { fact: 'event', event: bapt.id }, { page: `f. ${rng.int(2, 180)}r`, quality: rng.chance(0.7) ? 'original' : 'derivative' });
      }
      if (p.sex === 'm' && age > 20 && rng.chance(0.22)) {
        const from = born + rng.int(16, 24);
        add({ person: p.id, type: 'military', label: rng.pick(['The king’s host', 'Garrison of the march', 'The northern campaign']), date: String(from), endDate: String(Math.min(end, from + rng.int(1, 6))), place: anyPlace() });
      }
      if (p.title && age > 25 && rng.chance(0.5)) {
        const award = add({ person: p.id, type: 'award', label: rng.pick(['Grant of lands', 'Knighted', 'Keeper of the seal']), date: String(born + rng.int(22, Math.max(23, age))), place: anyPlace() });
        cite('src-charters', { fact: 'event', event: award.id }, { page: `m. ${rng.int(1, 40)}`, quality: 'original', transcription: 'Granted by the king’s own hand.' });
      }
      if (age > 30 && rng.chance(0.06)) add({ person: p.id, type: 'custom', label: rng.pick(['Pilgrimage', 'Founded a chapel', 'Held the bridge']), date: String(born + rng.int(25, Math.max(26, age))), place: anyPlace() });
      if (!p.living && !isNaN(died) && rng.chance(0.65)) add({ person: p.id, type: 'burial', date: String(died), place: p.diedPlace ?? home, note: rng.chance(0.2) ? 'Laid in the family vault.' : undefined });
      if (rng.chance(0.3)) cite(rng.chance(0.5) ? 'src-chronicle' : 'src-accounts', { fact: 'birth', person: p.id }, { page: `p. ${rng.int(1, 300)}`, quality: rng.pick(['original', 'derivative', 'unsure'] as const) });
    } else {
      if (rng.chance(0.25)) add({ person: p.id, type: rng.chance(0.5) ? 'baptism' : 'christening', date: String(born), place: home });
      if (age > 16 && rng.chance(0.6)) {
        const school = add({ person: p.id, type: 'education', label: rng.pick(['Primary school', 'Grammar school', 'Comprehensive school']), date: String(born + 6), endDate: String(born + rng.int(15, 18)), place: home });
        if (rng.chance(0.2)) cite('src-school', { fact: 'event', event: school.id }, { quality: 'derivative' });
      }
      if (age > 23 && rng.chance(0.35)) add({ person: p.id, type: 'graduation', label: rng.pick(['Teacher training', 'Engineering degree', 'Apprenticeship', 'Nursing diploma']), date: String(born + rng.int(19, 25)), place: anyPlace() });
      if (p.occupation && age > 22) add({ person: p.id, type: 'occupation', label: p.occupation, date: String(born + rng.int(18, 26)), place: anyPlace() });
      for (let i = 0, moves = age > 25 ? rng.int(0, 2) : 0; i < moves; i++) {
        add({ person: p.id, type: 'residence', label: rng.pick(['A flat above the bakery', 'The house by the river', 'A terraced house', 'The farm']), date: String(born + rng.int(20, Math.max(21, age))), place: anyPlace() });
      }
      if (age > 30 && rng.chance(0.04)) add({ person: p.id, type: rng.chance(0.5) ? 'emigration' : 'immigration', date: String(born + rng.int(20, 30)), place: anyPlace() });
      if (age > 66 && rng.chance(0.5)) add({ person: p.id, type: 'retirement', date: String(born + 65) });
      if (!p.living && !isNaN(died) && rng.chance(0.7)) add({ person: p.id, type: rng.chance(0.6) ? 'burial' : 'cremation', date: String(died), place: p.diedPlace ?? home });
      if (rng.chance(0.4)) cite(rng.chance(0.6) ? 'src-registry' : 'src-bible', { fact: 'birth', person: p.id }, { page: rng.chance(0.5) ? `No. ${rng.int(1, 900)}` : undefined, quality: rng.pick(['original', 'derivative'] as const) });
      if (rng.chance(0.1)) cite('src-census', { fact: 'name', person: p.id }, { quality: 'derivative' });
    }
  }
  // Some parent links and marriages, from the era's register.
  for (const l of tree.parents) if (rng.chance(kind === 'realm' ? 0.08 : 0.12)) cite(kind === 'realm' ? 'src-chronicle' : 'src-registry', { fact: 'parent', child: l.child, parent: l.parent }, { quality: 'derivative' });
  for (const u of tree.unions) if (rng.chance(0.2)) cite(kind === 'realm' ? 'src-charters' : 'src-letters', { fact: 'partnership', partnership: u.id }, { transcription: kind === 'realm' ? 'Married before the altar of Saint Ode.' : 'We were married in the spring, and it rained.' });

  const used = new Set(citations.map((x) => x.source));
  tree.events = events;
  tree.sources = sources.filter((s) => used.has(s.id) || s.id === sources[sources.length - 1].id);
  tree.citations = citations;
}
