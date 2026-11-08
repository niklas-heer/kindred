// A family draft from the assistant: many new people, their facts and their links, approved as one card.
//
// Two halves. `checkFamily` runs when the draft is proposed: it finds people who may already be in the tree and links
// that would make someone their own ancestor, so the card can warn before anything is applied. `applyFamilyBatch`
// runs on approval, under the approver's own role: each person is created in its own plan, then each link runs the
// same rules as the form (relations.server.ts). Every step carries its own retry key, so a repeated approval replays
// what already happened instead of writing twice. A step that cannot apply is reported and the rest carry on.
import { db, once, newId, q, type Db } from '../db.server';
import { buildFamily, fullName, parents } from '../graph';
import type { Graph } from '../types';
import { can, type Role } from '../roles';
import { validDate } from '../dates';
import { occupationCodeFor } from '../occupations';
import { linkPlan } from '../relations.server';
import { tr } from './labels';
import { NEW_REF, toAiLocale, type FamilyLink, type FamilyPerson } from './types';

/** Refusals and failures that the reader sees in their own language (translation keys, see errortext.ts). */
export const FAMILY_ERR = {
  refused: 'ai.famRefused',
  badDate: 'ai.famBadDate',
  notCreated: 'ai.famNotCreated',
  unknownRef: 'ai.famUnknownRef',
  duplicateRef: 'ai.famDuplicateRef',
  tellerGone: 'ai.famTellerGone',
} as const;

export interface FamilyRow extends FamilyPerson {
  /** The retry key of this person's step (a random id per row, kept until the row changes). */
  key: string;
}
export interface FamilyLinkRow extends FamilyLink {
  /** The retry key of this link's step. */
  key: string;
}
export interface FamilyBatch { people: FamilyRow[]; links: FamilyLinkRow[] }
export interface FamilyResult {
  people: { ref: string; id?: string; error?: string }[];
  links: { key: string; ok: boolean; error?: string }[];
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('en').normalize('NFD').replace(/\p{M}/gu, '');
const yearOf = (s: string | null | undefined) => (s ? parseInt(s.replace(/^~/, ''), 10) : NaN);

/** The edges a link adds, as child → parent pairs (a partner or sibling adds none of its own; a sibling adds the shared parents). */
function edgesOf(l: FamilyLink, sharedParents: string[]): [child: string, parent: string][] {
  if (l.relation === 'parent') return [[l.anchor, l.person]];
  if (l.relation === 'child') {
    const e: [string, string][] = [[l.person, l.anchor]];
    if (l.coParent && l.coParent !== l.anchor) e.push([l.person, l.coParent]);
    return e;
  }
  if (l.relation === 'sibling') return sharedParents.map((p): [string, string] => [l.person, p]);
  return [];
}

/**
 * The checks a card warns about, computed from the tree as it is now: people who may already be in the tree (same given
 * name, a compatible surname and birth year) and links that would loop. A year missing on either side still matches.
 */
export function checkFamily(g: Graph, people: FamilyPerson[], links: FamilyLink[]): { duplicates: { ref: string; id: string; name: string; born: string | null }[]; loops: number[] } {
  const duplicates: { ref: string; id: string; name: string; born: string | null }[] = [];
  for (const row of people) {
    const hit = g.people.find((p) => norm(p.given) === norm(row.given)
      && (!row.surname || !p.surname || norm(p.surname) === norm(row.surname))
      && (Number.isNaN(yearOf(p.born)) || Number.isNaN(yearOf(row.born)) || yearOf(p.born) === yearOf(row.born)));
    if (hit) duplicates.push({ ref: row.ref, id: hit.id, name: fullName(hit), born: hit.born ?? null });
  }
  // The ancestry as it stands, then each link's edges in order, as the approval applies them.
  const f = buildFamily(g);
  const parentOf = new Map<string, Set<string>>();
  const up = (id: string) => {
    let s = parentOf.get(id);
    if (!s) parentOf.set(id, (s = new Set(parents(f, id))));
    return s;
  };
  const ancestors = (id: string) => {
    const seen = new Set<string>();
    const stack = [...up(id)];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...up(x));
    }
    return seen;
  };
  const loops: number[] = [];
  links.forEach((l, i) => {
    const shared = l.relation === 'sibling' ? [...up(l.anchor)] : [];
    for (const [child, parent] of edgesOf(l, shared)) {
      if (child === parent || ancestors(parent).has(child)) {
        if (!loops.includes(i)) loops.push(i);
        continue;
      }
      up(child).add(parent);
    }
  });
  return { duplicates, loops };
}

/** The person's own fields, as the plan stores them. Dates are checked on the calendar; an approximate one keeps its ~. */
function personFields(row: FamilyRow) {
  return {
    given: row.given.trim(),
    surname: row.surname?.trim() || null,
    sex: row.sex ?? null,
    born: row.born ?? null,
    bornPlace: row.bornPlace?.trim() || null,
    died: row.died ?? null,
    diedPlace: row.diedPlace?.trim() || null,
    living: row.living,
    occupation: row.occupation?.trim() || null,
  };
}

/**
 * One batch, approved by one reader. `user` and `author` are the approver's own id and name, never sent by the browser.
 * A memory told in a family session is saved under the person who told it, named from the tree, and its context says who
 * approved it. The browser can only send that person's id, so a memory cannot carry a made-up name.
 */
export async function applyFamilyBatch(o: { tree: string; user: string; author: string; me?: string | null; role: Role; locale?: string; batch: FamilyBatch }): Promise<FamilyResult> {
  const { tree, user, role, batch } = o;
  const c = tr(toAiLocale(o.locale));
  const refs = new Map<string, string>();
  const failed = new Set<string>();
  const people: FamilyResult['people'] = [];

  const seen = new Set<string>();
  for (const row of batch.people) {
    if (seen.has(row.ref)) {
      failed.add(row.ref);
      people.push({ ref: row.ref, error: FAMILY_ERR.duplicateRef });
      continue;
    }
    seen.add(row.ref);
    try {
      const f = personFields(row);
      if (!can(role, 'add-person')) throw new Error(FAMILY_ERR.refused);
      if ((f.born && !validDate(f.born)) || (f.died && !validDate(f.died))) throw new Error(FAMILY_ERR.badDate);
      // Checked before the person is written, so a memory that cannot be attributed does not leave half a row behind.
      if (row.story && !can(role, 'add-story')) throw new Error(FAMILY_ERR.refused);
      const tellerId = row.story?.teller && row.story.teller !== o.me ? row.story.teller : null;
      const teller = tellerId ? await db(tree).get<{ given: string; surname: string | null }>('SELECT given, surname FROM person WHERE id = ?', tellerId) : undefined;
      if (tellerId && !teller) throw new Error(FAMILY_ERR.tellerGone);
      const id = await once(tree, { key: row.key, user, payload: f }, 'aiFamilyPerson', async (d) => {
        const newPersonId = newId(f.given);
        return {
          writes: [q(
            'INSERT INTO person (id, given, surname, sex, born, born_place, died, died_place, living, occupation, occupation_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            newPersonId, f.given, f.surname, f.sex, f.born, f.bornPlace, f.died, f.diedPlace, f.living ? 1 : 0, f.occupation, occupationCodeFor(f.occupation),
          )],
          result: newPersonId,
        };
      });
      refs.set(row.ref, id);
      people.push({ ref: row.ref, id });
      if (row.story) {
        const s = row.story;
        const author = teller ? [teller.given, teller.surname].filter(Boolean).join(' ') : o.author;
        const context = teller ? c('ai.famStoryContext', { name: o.author }) : null;
        await once(tree, { key: `${row.key}s`, user, payload: { person: id, ...s } }, 'aiFamilyStory', () => ({
          writes: [q('INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            crypto.randomUUID(), id, s.kind, s.title || null, s.body, author, new Date().toISOString(), context)],
          result: undefined,
        }));
      }
    } catch (e) {
      failed.add(row.ref);
      people.push({ ref: row.ref, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const resolve = (x: string): string | Error => {
    if (failed.has(x)) return new Error(FAMILY_ERR.notCreated);
    if (refs.has(x)) return refs.get(x)!;
    if (NEW_REF.test(x)) return new Error(FAMILY_ERR.unknownRef);
    return x;
  };

  const links: FamilyResult['links'] = [];
  for (const l of batch.links) {
    try {
      if (!can(role, 'edit-person')) throw new Error(FAMILY_ERR.refused);
      const anchor = resolve(l.anchor);
      const person = resolve(l.person);
      const coParent = l.coParent ? resolve(l.coParent) : undefined;
      for (const x of [anchor, person, coParent]) if (x instanceof Error) throw x;
      await once(tree, { key: l.key, user, payload: { anchor, person, relation: l.relation, coParent } }, 'aiFamilyLink', (d) =>
        linkPlan(d, { anchor: anchor as string, person: person as string, relation: l.relation, coParent: coParent as string | undefined }));
      links.push({ key: l.key, ok: true });
    } catch (e) {
      links.push({ key: l.key, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { people, links };
}
