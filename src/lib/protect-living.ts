// Protecting living people from a share-link guest. A link can be forwarded, and on a family site the exact birthday and
// birthplace of a living child are the wrong thing to hand to whoever ends up holding it, so a link protects the living by
// default (migration accounts/0023). This file is the one rule for what such a guest gets of someone the family marks as living:
//
//   kept      their names (given, further, current, surname, title, epithet, nickname), sex, house, where they stand in the
//             tree (parents and partnerships, with their kind), and their face: photo, painted portrait and drawn look.
//   withheld  every date (no year either: a birth year and a name already identify a child, and an age follows from it),
//             every place, occupation, traits, biography, stories, story translations, research that names them, their tags
//             on gallery pictures, the caption, date and place of any picture they are tagged in (the caption is often
//             their name and the occasion, the date their age), the dates and place of their partnerships, and any count
//             that would describe them.
//
// The `living` flag decides, as stored: someone marked not living is shown as today even without a date of death. The dead
// are untouched. The reads apply this on the server where they shape a guest's answer (db.server.ts graph, person, chronicle,
// todayIn; photos.server.ts; research.server.ts; the story translations; recipes/recipes.server.ts, as a recipe is a story, with
// its pictures), so no response to such a guest carries what is withheld.
import type { GPerson, GUnion, Graph, PersonDetail } from './types';

/** An SQL condition that is true for a living person's id, for reads that filter rows about people. */
export const LIVING_IDS = 'SELECT id FROM person WHERE living = 1';

/** The gallery pictures a living person is tagged in, confirmed or only suggested: such a guest gets them without caption, date or place. */
export const LIVING_PICTURES = `SELECT media FROM media_person WHERE person IN (${LIVING_IDS})`;

/** A picture's column (`m.caption`, `m.taken`, `m.place`), or NULL for such a guest when a living person is tagged in it. */
export const pictureColumn = (column: string, protectLiving: boolean | undefined, key = 'm.key') =>
  protectLiving ? `CASE WHEN ${key} IN (${LIVING_PICTURES}) THEN NULL ELSE ${column} END` : column;

/** A living person as such a guest gets them. */
export function protectPerson(p: GPerson): GPerson {
  if (!p.living) return p;
  const out: GPerson = {
    id: p.id,
    given: p.given,
    living: true,
    stories: 0,
    contacts: 0,
  };
  const keep = ['surname', 'house', 'sex', 'epithet', 'title', 'nickname', 'photo', 'currentGiven', 'furtherGiven', 'currentSurname', 'preferAvatar', 'preferPortrait', 'portrait'] as const;
  for (const k of keep) if (p[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = p[k];
  // The drawing's look stays, but not an age pinned in it.
  if (p.look) {
    const { age: _age, ...look } = p.look as typeof p.look & { age?: number };
    out.look = look as GPerson['look'];
  }
  return out;
}

/** A partnership with a living partner keeps who and what it is, without its dates or place: no anniversary to find. */
export function protectUnion(u: GUnion, living: (id: string) => boolean): GUnion {
  if (!living(u.a) && !living(u.b)) return u;
  const { start: _s, end: _e, place: _p, ...rest } = u;
  return rest;
}

/**
 * The family as such a guest gets it. The places are only those the remaining records name, so the Atlas has no pin, and no
 * frame, that only a living person's records would have drawn. `livingProtected` tells the pages that the gaps they would see
 * in the living are not gaps.
 */
export function protectGraph(g: Graph): Graph {
  const livingIds = new Set(g.people.filter((p) => p.living).map((p) => p.id));
  const living = (id: string) => livingIds.has(id);
  const people = g.people.map(protectPerson);
  const unions = g.unions.map((u) => protectUnion(u, living));
  const named = new Set<string>();
  for (const p of people) for (const n of [p.bornPlace, p.diedPlace]) if (n) named.add(n);
  for (const u of unions) if (u.place) named.add(u.place);
  return { ...g, people, unions, places: g.places.filter((pl) => named.has(pl.name)), livingProtected: true };
}

/** One living person's details as such a guest gets them: nothing but who they are. */
export function protectDetail(d: PersonDetail): PersonDetail {
  return { id: d.id, updatedAt: d.updatedAt, stories: [], fields: [] };
}
