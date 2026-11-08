// The addresses of someone's close family, to copy one with a click: couples and their children often share a home.
// Every address comes through `person`, the same privacy-filtered read the person panel uses, so a reader is only ever
// offered what they could already open on that relative's own page. Nothing here decides who may see what.
import { formatAddress, foldText, type AddressParts } from './address.ts';
import { db, person } from './db.server.ts';
import type { Audience } from './visibility.ts';

export interface FamilyAddress {
  parts: AddressParts;
  /** Who has it, closest first. */
  who: string[];
}

/** Enough for any real household; the reads below are one per relative. */
const MAX_RELATIVES = 16;
const AT_ONCE = 6;

/** Living partners (current unions only), parents, children and siblings, in that order. */
async function closeFamily(tree: string, id: string): Promise<string[]> {
  const d = db(tree);
  const [unions, parents, children] = await Promise.all([
    d.all<{ a: string; b: string }>('SELECT a, b FROM partnership WHERE (a = ? OR b = ?) AND end IS NULL', id, id),
    d.all<{ parent: string }>('SELECT parent FROM parent WHERE child = ?', id),
    d.all<{ child: string }>('SELECT child FROM parent WHERE parent = ?', id),
  ]);
  const parentIds = parents.map((p) => p.parent);
  const siblings = parentIds.length
    ? await d.all<{ child: string }>(`SELECT DISTINCT child FROM parent WHERE parent IN (${parentIds.map(() => '?').join(',')})`, ...parentIds)
    : [];
  const ids = [...new Set([...unions.map((u) => (u.a === id ? u.b : u.a)), ...parentIds, ...children.map((c) => c.child), ...siblings.map((s) => s.child)])].filter((x) => x !== id);
  if (!ids.length) return [];
  const living = new Set((await d.all<{ id: string }>(`SELECT id FROM person WHERE living = 1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids)).map((r) => r.id));
  return ids.filter((x) => living.has(x)).slice(0, MAX_RELATIVES);
}

const partsOf = (v: Record<string, string>): AddressParts => ({ street: v.street ?? '', postcode: v.postcode ?? '', city: v.city ?? '', country: v.country ?? '' });

/**
 * The addresses of `id`'s close family that this reader may see (`reader`, as for `person`), each once, with who has
 * it. An address the person already has is left out.
 */
export async function familyAddresses(tree: string, id: string, reader: Audience): Promise<FamilyAddress[]> {
  const relatives = await closeFamily(tree, id);
  const own = new Set((await person(tree, id, reader)).fields.filter((f) => f.type === 'address').map((f) => foldText(formatAddress(partsOf(f.value)))));
  const found = new Map<string, FamilyAddress>();
  for (let i = 0; i < relatives.length; i += AT_ONCE) {
    const batch = relatives.slice(i, i + AT_ONCE);
    const details = await Promise.all(batch.map((r) => person(tree, r, reader)));
    details.forEach((detail, j) => {
      for (const f of detail.fields) {
        if (f.type !== 'address') continue;
        const parts = partsOf(f.value);
        const key = foldText(formatAddress(parts));
        if (!key || own.has(key)) continue;
        const had = found.get(key);
        if (!had) found.set(key, { parts, who: [batch[j]] });
        else if (!had.who.includes(batch[j])) had.who.push(batch[j]);
      }
    });
  }
  return [...found.values()];
}
