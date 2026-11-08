// Where the places an import brings are on the map. A place name gets coordinates from the gazetteer (GeoNames towns,
// CC BY 4.0, on Node in data/gazetteer.db and on Workers in the GAZETTEER D1 database) only when the match is certain:
// its town name matches exactly one gazetteer town, or, when the name also gives a country, exactly one town of that
// name in that country. A name with more than one candidate is never guessed at. The place's text is never changed.
import { countryCodeOf } from './address.ts';
import { foldPlace } from './db.server.ts';
import { store, type Db } from './store/index.ts';

export { countryCodeOf };

export interface Located {
  lat: number;
  lng: number;
  /** ISO 3166 alpha-2, lower case, as the place table keeps it. */
  country: string | null;
}

/** The town and the country of a place name: "Hamburg, Hamburg, Germany" → Hamburg, Germany. The first part is the town. */
export function splitPlace(name: string): { town: string; country: string | null } {
  const parts = name.split(',').map((p) => p.trim()).filter(Boolean);
  return { town: parts[0] ?? '', country: parts.length > 1 ? parts[parts.length - 1] : null };
}

/**
 * Coordinates for each name that is certainly a gazetteer town. Reads only. A name that matches no town, or more than
 * one (after the country, when it gives one), is left out of the result.
 */
export async function locatePlaces(g: Db, names: string[]): Promise<Map<string, Located>> {
  const out = new Map<string, Located>();
  const unique = [...new Set(names)];
  // A few lookups at a time: on D1 each one is a round trip, and a family's places are many.
  for (let i = 0; i < unique.length; i += 16) {
    const batch = unique.slice(i, i + 16);
    const found = await Promise.all(batch.map((name) => locateOne(g, name)));
    batch.forEach((name, j) => {
      if (found[j]) out.set(name, found[j]!);
    });
  }
  return out;
}

async function locateOne(g: Db, name: string): Promise<Located | null> {
  const { town, country } = splitPlace(name);
  const key = foldPlace(town);
  if (key.length < 2) return null;
  // A country we cannot name is no reason to guess: the town then has to be unique on its own.
  const code = country ? countryCodeOf(country) : null;
  const rows = await g.all<{ id: number; cc: string | null; lat: number; lng: number }>(
    'SELECT DISTINCT p.id, p.cc, p.lat, p.lng FROM name n JOIN place p ON p.id = n.id WHERE n.key = ?',
    key,
  );
  const towns = code ? rows.filter((r) => r.cc === code.toLowerCase()) : rows;
  return towns.length === 1 ? { lat: towns[0].lat, lng: towns[0].lng, country: towns[0].cc } : null;
}

/** The gazetteer on this deployment, or null when there is none (Node before `mise run gazetteer`; Workers without GAZETTEER). */
export const gazetteer = (): Db | null => store.gazetteer();
