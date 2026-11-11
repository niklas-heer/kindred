// Addresses as text and as parts. Pure, so the browser, the server and the tests share it: reading what someone typed
// into street, postcode, town and country, and reading an OpenStreetMap result into the same parts.

export interface AddressParts { street: string; postcode: string; city: string; country: string }

/** Lower case, no accents, punctuation as spaces. Keep in step with `foldPlace` in db.server.ts. */
export function foldText(s: string) {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss').replace(/[øœ]/g, (c) => (c === 'ø' ? 'o' : 'oe')).replace(/æ/g, 'ae').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/þ/g, 'th').replace(/ı/g, 'i')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

let countries: Map<string, string> | undefined;

/** Codes that were retired or are exceptional, and whose names the platform gives to a current country ("DD" is Germany). */
const RETIRED = new Set(['AN', 'BU', 'CS', 'DD', 'DY', 'EU', 'EZ', 'FX', 'NT', 'QU', 'SU', 'TP', 'UK', 'YU', 'ZR']);

/**
 * Folded country names (English, German and Afrikaans) and codes → ISO 3166 alpha-2, from the platform's own region
 * names. A name two regions share is left out, so it can never pick the wrong one.
 */
function countryTable(): Map<string, string> {
  if (countries) return countries;
  const table = new Map<string, string>();
  const clash = new Set<string>();
  const namers = ['en', 'de', 'af'].map((l) => new Intl.DisplayNames([l], { type: 'region' }));
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (RETIRED.has(code)) continue;
      const keys = new Set([foldText(code), ...namers.map((n) => foldText(n.of(code) ?? ''))].filter(Boolean));
      for (const k of keys) {
        if (table.has(k) && table.get(k) !== code) clash.add(k);
        table.set(k, code);
      }
    }
  }
  for (const k of clash) table.delete(k);
  // What people write that is not a region's formal name.
  table.set('usa', 'US');
  table.set('uk', 'GB');
  return (countries = table);
}

/** The ISO code of a country written as its name (any of the three languages) or as its code; null when unknown. */
export function countryCodeOf(name: string): string | null {
  return countryTable().get(foldText(name.trim())) ?? null;
}

/** The current country codes that have a real name: for lists of countries. */
export function countryCodes(): string[] {
  const named = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const out: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (RETIRED.has(code) || code === 'UN' || code === 'ZZ' || (a === 81 && b >= 77) || (a === 88 && code !== 'XK')) continue;
      if (named.of(code)) out.push(code);
    }
  }
  return out;
}

// Postcodes as written around the world: 70173, 8001, 1234 AB, SW1A 2AA, K1A 0B1, 1000-001, 00-001.
const CODE = String.raw`\d{4}\s?[A-Z]{2}|\d{4,6}|\d{2,4}-\d{3}|[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}|[A-Z]\d[A-Z]\s\d[A-Z]\d`;
const WHOLE = new RegExp(`^(?:${CODE})$`);
const LEADING = new RegExp(`^(${CODE})\\s+(.+)$`);
const TRAILING = new RegExp(`^(.+?)\\s+(${CODE})$`);

/**
 * Reads a typed address into its parts. Understands "Street 1, 70173 Town, Country", "Street 1, Town, 70173, Country" and
 * "Town, Country". Text it cannot place is kept in the town, so no typed word is ever lost.
 */
export function parseAddress(text: string): AddressParts {
  const out: AddressParts = { street: '', postcode: '', city: '', country: '' };
  const segs = text.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (segs.length && countryCodeOf(segs[segs.length - 1])) out.country = segs.pop()!;

  let cityFromCode = false;
  for (let i = segs.length - 1; i >= 0 && !out.postcode; i--) {
    const s = segs[i];
    // The first part is usually the street, whose number must not be mistaken for a postcode, unless it is all there is.
    const alone = segs.length === 1;
    const m = WHOLE.test(s) ? [s, s, ''] : i > 0 || (alone && /^\d{5}\s/.test(s)) ? LEADING.exec(s) : null;
    const end = !m && i > 0 ? TRAILING.exec(s) : null;
    if (m) {
      out.postcode = m[1];
      if (m[2]) { segs[i] = m[2]; cityFromCode = true; } else segs.splice(i, 1);
    } else if (end) {
      out.postcode = end[2];
      segs[i] = end[1];
      cityFromCode = true;
    }
  }

  if (segs.length === 1) {
    // A lone part is a street if it has a house number or a postcode gave the town away elsewhere; else a town.
    if (cityFromCode || !/\d/.test(segs[0])) out.city = segs[0];
    else out.street = segs[0];
  } else if (segs.length > 1) {
    out.street = segs[0];
    out.city = segs.slice(1).join(', ');
  }
  return out;
}

/** The parts as one line, in the order `parseAddress` reads back. */
export const formatAddress = (a: Partial<AddressParts>) =>
  [a.street, [a.postcode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ');

/** Which town the end of a typed address is asking about: "Musterweg 12, 70173 Stutt" → street, postcode, "Stutt". */
export function townQuery(text: string): { street: string; postcode: string; q: string } {
  const segs = text.split(',').map((s) => s.trim());
  const last = segs.pop() ?? '';
  const street = segs.filter(Boolean).join(', ');
  const m = /^(\d{4,6})\s+(.*)$/.exec(last);
  if (m) return { street, postcode: m[1], q: m[2] };
  return { street, postcode: '', q: /\d/.test(last) ? '' : last };
}

// ---------- OpenStreetMap, through Photon ----------

/** An address the online lookup found, ready to fill the parts. */
export interface AddressHit { id: string; label: string; parts: AddressParts }

/** Countries that write the house number before the street. Elsewhere it follows. */
const NUMBER_FIRST = new Set(['us', 'gb', 'ie', 'ca', 'au', 'nz', 'za', 'fr', 'in']);

/**
 * One Photon result (a GeoJSON feature, https://github.com/komoot/photon/blob/master/docs/api-v1.md) as address parts; null
 * when it says nothing usable. A street on its own carries its name as `name`; a house names its street in `street` (and
 * its `name`, if any, is a shop or an office, not part of the address).
 */
export function photonHit(raw: unknown): AddressHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = (raw as { properties?: unknown }).properties;
  if (!p || typeof p !== 'object') return null;
  const a = p as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim().slice(0, 120) : '');
  const kind = str('type');
  const road = str('street') || (kind === 'street' ? str('name') : '');
  const number = str('housenumber');
  const cc = str('countrycode').toLowerCase();
  const parts: AddressParts = {
    street: !road ? '' : !number ? road : NUMBER_FIRST.has(cc) ? `${number} ${road}` : `${road} ${number}`,
    postcode: str('postcode'),
    city: str('city') || (kind === 'city' ? str('name') : '') || str('locality') || str('district'),
    country: str('country'),
  };
  if (!parts.street && !parts.city) return null;
  const label = formatAddress(parts);
  const osm = typeof a.osm_id === 'number' || typeof a.osm_id === 'string' ? `${str('osm_type')}${String(a.osm_id)}` : '';
  return { id: osm || label, label, parts };
}

/** A Photon answer as hits, the same address listed once. Anything that is not a feature collection is no hits. */
export function photonHits(body: unknown): AddressHit[] | null {
  const features = body && typeof body === 'object' ? (body as { features?: unknown }).features : undefined;
  if (!Array.isArray(features)) return null;
  const seen = new Set<string>();
  const out: AddressHit[] = [];
  for (const f of features) {
    const h = photonHit(f);
    if (!h || seen.has(h.label)) continue;
    seen.add(h.label);
    out.push(h);
  }
  return out;
}
