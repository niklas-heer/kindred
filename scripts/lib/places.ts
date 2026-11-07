// Birth, death and wedding places for the generated trees, with coordinates for the Atlas.
// Deterministic: same tree and seed, same places.
import type { SeedPlace, SeedTree } from '../../src/lib/seed-format.ts';
import type { Rng } from './rng.ts';

type Town = [name: string, lat: number, lng: number];

// Real towns (approximate centres) for the modern family.
const TOWNS: Record<string, Town[]> = {
  se: [['Stockholm', 59.33, 18.07], ['Göteborg', 57.71, 11.97], ['Uppsala', 59.86, 17.64], ['Falun', 60.61, 15.63], ['Västerås', 59.61, 16.55], ['Malmö', 55.6, 13.0], ['Örebro', 59.27, 15.21], ['Mora', 61.0, 14.54], ['Lund', 55.7, 13.19]],
  gb: [['Leeds', 53.8, -1.55], ['Whitby', 54.49, -0.61], ['York', 53.96, -1.08], ['Manchester', 53.48, -2.24], ['London', 51.51, -0.13], ['Bristol', 51.45, -2.59], ['Norwich', 52.63, 1.3], ['Halifax', 53.72, -1.86], ['Cardiff', 51.48, -3.18]],
  de: [['Hamburg', 53.55, 9.99], ['Bremen', 53.08, 8.8], ['Lübeck', 53.87, 10.69], ['Kiel', 54.32, 10.12], ['Berlin', 52.52, 13.4], ['Hannover', 52.37, 9.73], ['Freiburg', 47.99, 7.85], ['München', 48.14, 11.58]],
  no: [['Oslo', 59.91, 10.75], ['Bergen', 60.39, 5.32], ['Trondheim', 63.43, 10.39]],
  ng: [['Lagos', 6.52, 3.38], ['Enugu', 6.44, 7.5], ['Onitsha', 6.15, 6.78]],
  mx: [['Ciudad de México', 19.43, -99.13], ['Guadalajara', 20.67, -103.35], ['Puebla', 19.04, -98.21]],
  // Where people emigrate to.
  away: [['Toronto', 43.65, -79.38], ['Melbourne', -37.81, 144.96], ['Copenhagen', 55.68, 12.57], ['Amsterdam', 52.37, 4.9], ['Edinburgh', 55.95, -3.19], ['New York', 40.71, -74.01], ['Barcelona', 41.39, 2.17], ['Zürich', 47.38, 8.54]],
};

const ORIGIN: Record<string, string> = {
  Lindqvist: 'se', Holm: 'se', Ström: 'se', Berglund: 'se', Nyberg: 'se', Sjöberg: 'se',
  Whitfield: 'gb', Morgan: 'gb', Ashworth: 'gb', Pritchard: 'gb',
  Vogel: 'de', Brandt: 'de', Hartmann: 'de', Keller: 'de', Bauer: 'de',
  Halvorsen: 'no', Okonkwo: 'ng', Reyes: 'mx',
};

const countryOf = new Map<string, string>(Object.entries(TOWNS).flatMap(([c, ts]) => ts.map((t) => [t[0], c] as [string, string])));
const townByName = new Map<string, Town>(Object.values(TOWNS).flat().map((t) => [t[0], t]));

export function placeModern(tree: SeedTree, rng: Rng): void {
  const r = rng.fork('places');
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const parentsOf = new Map<string, string[]>();
  for (const l of tree.parents) if (l.kind !== 'step') (parentsOf.get(l.child) ?? parentsOf.set(l.child, []).get(l.child)!).push(l.parent);
  const year = (d?: string) => (d ? parseInt(d.replace('~', ''), 10) : 9999);
  const people = [...tree.people].sort((a, b) => year(a.born) - year(b.born));
  const pickIn = (c: string) => r.pick(TOWNS[c] ?? TOWNS.away)[0];

  for (const p of people) {
    const ps = (parentsOf.get(p.id) ?? []).map((id) => byId.get(id)!).filter((q) => q?.bornPlace);
    const mother = ps.find((q) => q.sex === 'f') ?? ps[0];
    if (mother?.bornPlace) {
      // Mostly born where the family already is; sometimes elsewhere in the country, or abroad.
      const home = (mother as { livedIn?: string }).livedIn ?? mother.bornPlace;
      const roll = r.next();
      p.bornPlace = roll < 0.7 ? home : roll < 0.92 ? pickIn(countryOf.get(home) ?? 'away') : pickIn('away');
    } else {
      p.bornPlace = pickIn(ORIGIN[p.surname ?? ''] ?? r.pick(['se', 'gb', 'de']));
    }
    // Where they settled as adults: where their children will mostly be born.
    (p as { livedIn?: string }).livedIn = r.chance(0.65) ? p.bornPlace : pickIn(r.chance(0.8) ? countryOf.get(p.bornPlace!) ?? 'away' : 'away');
    if (p.died && !p.living) p.diedPlace = r.chance(0.6) ? (p as { livedIn?: string }).livedIn : pickIn(countryOf.get(p.bornPlace!) ?? 'away');
  }
  for (const u of tree.unions) {
    if (u.place || (u.kind && u.kind !== 'marriage')) continue;
    const a = byId.get(u.a) as { livedIn?: string } | undefined;
    u.place = a?.livedIn;
  }
  for (const p of tree.people) delete (p as { livedIn?: string }).livedIn;

  // Places the generator named itself (a church, a hall) stay without coordinates: the Atlas lists them as unplaced.
  const used = new Set([...tree.people.flatMap((p) => [p.bornPlace, p.diedPlace]), ...tree.unions.map((u) => u.place)].filter((n): n is string => !!n && townByName.has(n)));
  tree.places = [...used].sort().map((n): SeedPlace => {
    const [name, lat, lng] = townByName.get(n)!;
    return { name, lat, lng, country: countryOf.get(n) === 'away' ? undefined : countryOf.get(n) };
  });
}

/**
 * The realm's places are invented, so they get invented positions: spread over the Frankish lands
 * between the Garonne and the Rhine, the busiest place (the royal seat) near the middle, with a
 * minimum distance so pins never sit on each other.
 */
export function placeRealm(tree: SeedTree, rng: Rng): void {
  const r = rng.fork('realm-places');
  const counts = new Map<string, number>();
  const bump = (n?: string) => n && counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const p of tree.people) { bump(p.bornPlace); bump(p.diedPlace); }
  for (const u of tree.unions) bump(u.place);
  const names = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b));
  const box = { lat: [44.2, 49.6], lng: [-0.6, 7.2] };
  const placed: SeedPlace[] = [];
  for (const [i, name] of names.entries()) {
    let lat = 46.9, lng = 3.2;
    for (let tries = 0; tries < 200; tries++) {
      if (i > 0 || tries > 0) {
        lat = box.lat[0] + r.next() * (box.lat[1] - box.lat[0]);
        lng = box.lng[0] + r.next() * (box.lng[1] - box.lng[0]);
      }
      if (placed.every((p) => Math.hypot(p.lat - lat, (p.lng - lng) * 0.7) > 0.75)) break;
    }
    placed.push({ name, lat: +lat.toFixed(3), lng: +lng.toFixed(3) });
  }
  tree.places = placed;
}
