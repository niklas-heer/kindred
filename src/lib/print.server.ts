// What the family book prints of each person beyond the family graph: the biography, the memories, the life events, which
// sources back which fact, and the gallery pictures they are in. One read for a batch of people, so a book of 1,600 people is
// a few dozen requests rather than several thousand (print.functions.ts asks for them a batch at a time).
//
// Printing is for members: a share-link guest gets nothing here. Paper leaves the family's hands, so unless the reader asks
// for the living in full (`living`), nothing of someone the family marks as living is returned: no biography, memory, event or
// citation of theirs, no picture a living person is in, and no citation of a partnership with a living partner (its date and
// place are withheld on the page too, src/lib/print.ts).
import { fail } from './auth/guard.server';
import { notMember } from './auth/errors';
import { db } from './db.server';
import { eventOf, type LifeReader } from './events.server';
import { byDate, type FactKind, type LifeEvent, type Quality } from './events.ts';
import { LIVING_PICTURES } from './protect-living.ts';
import type { Story } from './types';

/** At most this many people in one read: D1 binds at most 100 values to a statement. */
export const PRINT_BATCH = 40;
/** At most this many gallery pictures of one person in the book, the earliest first. */
export const PRINT_PHOTOS = 6;

export interface PrintCitation {
  source: string;
  fact: FactKind;
  /** For an event's citation, the event; for a partnership's, the partnership; for a parent link's, the parent. */
  event?: string;
  partnership?: string;
  parent?: string;
  page: string | null;
  quality: Quality | null;
}

export interface PrintPhoto { key: string; width: number; height: number; caption: string | null; taken: string | null; place: string | null }

export interface PrintPerson {
  id: string;
  bio?: string;
  stories: Pick<Story, 'id' | 'kind' | 'title' | 'body' | 'author' | 'at' | 'context'>[];
  events: LifeEvent[];
  citations: PrintCitation[];
  photos: PrintPhoto[];
}

interface CitationRow {
  source: string; fact: FactKind; person: string | null; parent: string | null; event: string | null; partnership: string | null;
  page: string | null; quality: Quality | null; event_person: string | null; pa: string | null; pb: string | null; la: number | null; lb: number | null;
}

/** The book's details of up to PRINT_BATCH people, in the order asked. Someone unknown is left out. */
export async function printPeople(tree: string, ids: readonly string[], o: { living: boolean; photos: boolean }, who: LifeReader): Promise<PrintPerson[]> {
  if (who.guest || !who.id) throw fail(notMember());
  const asked = [...new Set(ids)].slice(0, PRINT_BATCH);
  if (!asked.length) return [];
  const d = db(tree);
  const marks = asked.map((_, i) => `?${i + 1}`).join(', ');
  const people = await d.all<{ id: string; bio: string | null; living: number }>(`SELECT id, bio, living FROM person WHERE id IN (${marks})`, ...asked);
  const out = new Map<string, PrintPerson>();
  // Only these people's details are read at all: with the living withheld, a living person is not among them.
  const shown: string[] = [];
  for (const p of people) {
    const full = o.living || p.living !== 1;
    out.set(p.id, { id: p.id, ...(full && p.bio ? { bio: p.bio } : {}), stories: [], events: [], citations: [], photos: [] });
    if (full) shown.push(p.id);
  }
  if (shown.length) {
    const inShown = shown.map((_, i) => `?${i + 1}`).join(', ');
    const [stories, events, citations, photos] = await Promise.all([
      d.all<any>(`SELECT id, person, kind, title, body, author, at, context FROM story WHERE person IN (${inShown}) ORDER BY at, id`, ...shown),
      d.all<any>(`SELECT * FROM life_event WHERE person IN (${inShown})`, ...shown),
      d.all<CitationRow>(
        `SELECT c.source, c.fact, c.person, c.parent, c.event, c.partnership, c.page, c.quality, e.person AS event_person, u.a AS pa, u.b AS pb,
           (SELECT living FROM person WHERE id = u.a) AS la, (SELECT living FROM person WHERE id = u.b) AS lb
         FROM citation c LEFT JOIN life_event e ON e.id = c.event LEFT JOIN partnership u ON u.id = c.partnership
         WHERE c.person IN (${inShown}) OR e.person IN (${inShown}) OR u.a IN (${inShown}) OR u.b IN (${inShown})
         ORDER BY c.created_at, c.id`,
        ...shown,
      ),
      o.photos
        ? d.all<PrintPhoto & { person: string }>(
            `SELECT m.key, m.width, m.height, m.caption, m.taken, m.place, mp.person FROM media_person mp JOIN media m ON m.key = mp.media
             WHERE mp.confirmed = 1 AND mp.person IN (${inShown})${o.living ? '' : ` AND m.key NOT IN (${LIVING_PICTURES})`}
             ORDER BY (m.taken IS NULL), m.taken, m.key`,
            ...shown,
          )
        : [],
    ]);
    for (const s of stories) {
      out.get(s.person)?.stories.push({ id: s.id, kind: s.kind, body: s.body, author: s.author, at: s.at, ...(s.title ? { title: s.title } : {}), ...(s.context ? { context: s.context } : {}) });
    }
    for (const e of events) out.get(e.person)?.events.push(eventOf(e));
    for (const p of out.values()) p.events.sort(byDate);
    for (const c of citations) {
      const base = { source: c.source, fact: c.fact, page: c.page, quality: c.quality };
      if (c.fact === 'event') {
        if (c.event && c.event_person && shown.includes(c.event_person)) out.get(c.event_person)!.citations.push({ ...base, event: c.event });
      } else if (c.fact === 'partnership') {
        if (!o.living && (c.la === 1 || c.lb === 1)) continue;
        for (const partner of new Set([c.pa, c.pb])) if (partner && shown.includes(partner)) out.get(partner)!.citations.push({ ...base, partnership: c.partnership! });
      } else if (c.person && shown.includes(c.person)) {
        out.get(c.person)!.citations.push({ ...base, ...(c.fact === 'parent' && c.parent ? { parent: c.parent } : {}) });
      }
    }
    for (const { person, ...photo } of photos) {
      const list = out.get(person)?.photos;
      if (list && list.length < PRINT_PHOTOS) list.push(photo);
    }
  }
  return asked.map((id) => out.get(id)).filter((p): p is PrintPerson => !!p);
}
