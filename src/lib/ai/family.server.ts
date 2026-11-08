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
import { addPersonField } from '../person.server';
import { socialLink } from '../social';
import { DEFAULT_LABEL, defaultVisibility, fieldInput, PRESETS, storedValue } from '../../components/fields/model';
import { tr } from './labels';
import { storeFurther } from '../further-given';
import { NEW_REF, toAiLocale, type FamilyLink, type FamilyPerson } from './types';

/** Refusals and failures that the reader sees in their own language (translation keys, see errortext.ts). */
export const FAMILY_ERR = {
  refused: 'ai.famRefused',
  badDate: 'ai.famBadDate',
  notCreated: 'ai.famNotCreated',
  unknownRef: 'ai.famUnknownRef',
  duplicateRef: 'ai.famDuplicateRef',
  tellerGone: 'ai.famTellerGone',
  existingGone: 'ai.famExistingGone',
  badHandle: 'ai.famBadHandle',
} as const;

export interface FamilyRow extends FamilyPerson {
  /** The retry key of this person's step (a random id per row, kept until the row changes). */
  key: string;
  /** Someone already in the tree: no one is created, and this row's new details go on them. */
  existing?: string;
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

// ---------- social profiles ----------

/**
 * A social profile as it is stored: the network under its usual name, the handle without its @. Null when a known network
 * could not have this handle, so what a model misread never becomes a link.
 */
export function cleanSocial(s: { network: string; handle: string }): { network: string; handle: string } | null {
  const network = s.network.trim();
  const handle = s.handle.trim().replace(/^@/, '');
  if (!network || !handle || /\s/.test(handle)) return null;
  const known = PRESETS.social.find((p) => p.toLowerCase() === network.toLowerCase());
  const link = socialLink(handle, network);
  // A network Kindred builds links for has to accept the handle. Any other (Signal, say) stays plain text.
  if (!link && socialLink('someone', network)) return null;
  return { network: link?.network ?? known ?? network, handle };
}

/** The same profile whichever way it was typed: a full address, an @handle or a bare username. */
export function profileKey(network: string, handle: string): string {
  const link = socialLink(handle, network);
  return `${(link?.network ?? network).trim().toLowerCase()}|${(link?.handle ?? handle).trim().replace(/^@/, '').toLowerCase()}`;
}

/** Every social profile in the tree that an editor may see, by profileKey: who has it. Someone's personal notes are left out. */
export async function profilesInTree(tree: string): Promise<Map<string, string>> {
  const rows = await db(tree).all<{ person: string; label: string; value: string }>("SELECT person, label, value FROM person_field WHERE type = 'social' AND visibility != 'personal'");
  const out = new Map<string, string>();
  for (const r of rows) {
    let handle = '';
    try {
      handle = (JSON.parse(r.value) as { handle?: string }).handle ?? '';
    } catch {}
    if (handle) out.set(profileKey(r.label, handle), r.person);
  }
  return out;
}

export interface PersonMatch { id: string; name: string; born: string | null; sure: boolean }

/**
 * Who in the tree a draft row may be, best first, at most four. Sure is the same profile, or the same given name and surname
 * with no birth year against it. A first name alone is only offered: a list of first names matches many people.
 */
export function matchesFor(g: Graph, row: FamilyPerson, profiles: ReadonlyMap<string, string>): PersonMatch[] {
  const out: PersonMatch[] = [];
  const add = (id: string, sure: boolean) => {
    const p = g.people.find((x) => x.id === id);
    if (p && !out.some((m) => m.id === id)) out.push({ id, name: fullName(p), born: p.born ?? null, sure });
  };
  for (const s of row.social ?? []) {
    const owner = profiles.get(profileKey(s.network, s.handle));
    if (owner) add(owner, true);
  }
  for (const p of g.people) {
    if (norm(p.given) !== norm(row.given)) continue;
    const bothSurnames = !!row.surname && !!p.surname;
    if (bothSurnames && norm(p.surname) !== norm(row.surname)) continue;
    const yearFits = Number.isNaN(yearOf(p.born)) || Number.isNaN(yearOf(row.born)) || yearOf(p.born) === yearOf(row.born);
    if (yearFits) add(p.id, bothSurnames);
  }
  return out.sort((a, b) => Number(b.sure) - Number(a.sure)).slice(0, 4);
}

/** The person's own fields, as the plan stores them. Dates are checked on the calendar; an approximate one keeps its ~. */
function personFields(row: FamilyRow) {
  return {
    given: row.given.trim(),
    furtherGiven: row.furtherGiven?.map((x) => x.trim()).filter(Boolean) ?? [],
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

async function profilesOf(tree: string, person: string): Promise<Set<string>> {
  const rows = await db(tree).all<{ label: string; value: string }>("SELECT label, value FROM person_field WHERE person = ? AND type = 'social' AND visibility != 'personal'", person);
  const out = new Set<string>();
  for (const r of rows) {
    try {
      out.add(profileKey(r.label, (JSON.parse(r.value) as { handle?: string }).handle ?? ''));
    } catch {}
  }
  return out;
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
      // Each profile is checked first, so one that cannot be saved does not leave a person without it.
      const socials = (row.social ?? []).map((s) => {
        const clean = cleanSocial(s);
        if (!clean) throw new Error(FAMILY_ERR.badHandle);
        return clean;
      });
      if (row.existing && !(await db(tree).get('SELECT id FROM person WHERE id = ?', row.existing))) throw new Error(FAMILY_ERR.existingGone);
      const id = row.existing ?? await once(tree, { key: row.key, user, payload: f }, 'aiFamilyPerson', async (d) => {
        const newPersonId = newId(f.given);
        return {
          writes: [q(
            'INSERT INTO person (id, given, further_given, surname, sex, born, born_place, died, died_place, living, occupation, occupation_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            newPersonId, f.given, storeFurther(f.furtherGiven), f.surname, f.sex, f.born, f.bornPlace, f.died, f.diedPlace, f.living ? 1 : 0, f.occupation, occupationCodeFor(f.occupation),
          )],
          result: newPersonId,
        };
      });
      refs.set(row.ref, id);
      // The profiles this person does not have yet, each with its own retry key, through the same step as the person's page.
      const have = await profilesOf(tree, id);
      for (const [i, s] of socials.entries()) {
        if (have.has(profileKey(s.network, s.handle))) continue;
        const field = fieldInput.parse({ type: 'social', label: s.network, value: { handle: s.handle }, visibility: defaultVisibility('social') });
        await addPersonField(tree, id, field, { key: `${row.key}f${i}`, user, payload: { person: id, ...s } }, o.author, { account: o.user, role: o.role, guest: false });
        have.add(profileKey(s.network, s.handle));
      }
      // Other facts read from a picture, each at the level its type starts at (defaultVisibility: addresses and religion at editors). One that does not
      // fit its type (a misread email, say) is skipped and named in the person's note below, so it never blocks the person.
      const skipped: string[] = [];
      for (const [i, d] of (row.details ?? []).entries()) {
        const field = fieldInput.safeParse({ type: d.type, label: d.label ?? DEFAULT_LABEL[d.type] ?? d.type, value: d.value, visibility: defaultVisibility(d.type) });
        if (!field.success) {
          skipped.push(d.type); // the type only: a misread contact detail is not copied into a note anyone can read
          continue;
        }
        const stored = storedValue(field.data.type, field.data.value);
        await addPersonField(tree, id, field.data, { key: `${row.key}d${i}`, user, payload: { person: id, type: d.type, value: stored } }, o.author, { account: o.user, role: o.role, guest: false });
      }
      people.push({ ref: row.ref, id });
      const unsure = [...(row.unsure ?? []).map((x) => x.trim()), ...skipped].filter(Boolean);
      // The doubts stay with the person as a note (added to their story when there is one), if the approver may add stories.
      const note = unsure.length ? c('ai.famUnsureNote', { items: unsure.join('; ') }) : '';
      const story = row.story ? { ...row.story, body: [row.story.body, note].filter(Boolean).join('\n\n') } : note && can(role, 'add-story') ? { kind: 'note' as const, title: undefined, body: note, teller: undefined } : undefined;
      if (story) {
        const s = story;
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
