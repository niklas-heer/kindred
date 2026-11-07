// What the family still needs to find out about someone: the research to-do list. Which kinds of
// gap count is up to the reader (per tree); the standard genealogical set is on by default.
import { useMemo } from 'react';
import { parents, type Family } from './graph';
import { setPref, usePref } from './prefs';
import type { GPerson } from './types';

export type GapKey = 'born' | 'birthday' | 'birthplace' | 'parents' | 'died' | 'sex' | 'photo' | 'contact' | 'occupation' | 'story';

export const GAP_LABEL: Record<GapKey, string> = {
  born: 'Birth year',
  birthday: 'Full birthday',
  birthplace: 'Birthplace',
  parents: 'Parents',
  died: 'Death date',
  sex: 'Sex',
  photo: 'Photo',
  contact: 'Contact',
  occupation: 'Occupation',
  story: 'A memory',
};

/** What the gap is about, for the settings row. */
export const GAP_HINT: Record<GapKey, string> = {
  born: 'Everyone has at least a birth year',
  birthday: 'Living people have a full date, so the Almanac can remind you',
  birthplace: 'Everyone has a birthplace, for the Atlas',
  parents: 'Both parents are known',
  died: 'The dead have a death date',
  sex: 'Sex is recorded, for kinship words like aunt or uncle',
  photo: 'Everyone has a real photo instead of a drawn portrait',
  contact: 'Living adults have a phone, email or address',
  occupation: 'What they do or did for a living',
  story: 'At least one memory, saying or anecdote',
};

export const ALL_GAPS: GapKey[] = ['born', 'birthday', 'birthplace', 'parents', 'died', 'sex', 'photo', 'contact', 'occupation', 'story'];
export const DEFAULT_GAPS: GapKey[] = ['born', 'birthday', 'birthplace', 'parents', 'died', 'sex'];

/** Where to fill a gap in from the panel: the edit form, or the dashed slots on the tree. */
export const GAP_WHERE: Record<GapKey, 'edit' | 'tree' | 'everyday' | 'stories'> = {
  born: 'edit', birthday: 'edit', birthplace: 'edit', parents: 'tree', died: 'edit', sex: 'edit',
  photo: 'edit', contact: 'everyday', occupation: 'edit', story: 'stories',
};

const isAdult = (p: GPerson) => {
  const y = parseInt(p.born ?? '', 10);
  return !isNaN(y) && new Date().getFullYear() - y >= 16;
};

export function gapsOf(f: Family, p: GPerson, required: ReadonlySet<GapKey> = new Set(DEFAULT_GAPS)): GapKey[] {
  const out: GapKey[] = [];
  const want = (k: GapKey) => required.has(k);
  if (want('born') && !p.born) out.push('born');
  // Living people need a full date, so the Almanac can remind the family of their birthday.
  if (want('birthday') && p.living && !/^\d{4}-\d\d-\d\d$/.test(p.born ?? '') && !(want('born') && !p.born)) out.push('birthday');
  if (want('birthplace') && !p.bornPlace) out.push('birthplace');
  // Both slots, as in the ancestors view: one known parent still leaves the other to find.
  if (want('parents') && parents(f, p.id).length < 2) out.push('parents');
  if (want('died') && !p.living && !p.died) out.push('died');
  if (want('sex') && !p.sex) out.push('sex');
  if (want('photo') && !p.photo) out.push('photo');
  if (want('contact') && p.living && isAdult(p) && !p.contacts) out.push('contact');
  if (want('occupation') && !p.occupation && (!p.living || isAdult(p))) out.push('occupation');
  if (want('story') && !p.stories) out.push('story');
  return out;
}

/** The gap kinds this tree's reader counts as needed. */
export function useRequired(tree: string): [ReadonlySet<GapKey>, (keys: GapKey[]) => void] {
  const raw = usePref(`required:${tree}`);
  const set = useMemo(() => {
    try {
      const keys = raw ? (JSON.parse(raw) as GapKey[]).filter((k) => ALL_GAPS.includes(k)) : DEFAULT_GAPS;
      return new Set(keys);
    } catch {
      return new Set(DEFAULT_GAPS);
    }
  }, [raw]);
  return [set, (keys) => setPref(`required:${tree}`, JSON.stringify(keys))];
}
