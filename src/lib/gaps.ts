// What the family still needs to find out about someone: the research to-do list. Which kinds of
// gap count is up to the reader (per tree); the standard genealogical set is on by default.
import { useMemo } from 'react';
import type { Key } from './i18n/dictionary.ts';
import { parents, type Family } from './graph';
import { setPref, usePref } from './prefs';
import type { Action } from './roles';
import type { GPerson } from './types';

export type GapKey = 'born' | 'birthday' | 'birthplace' | 'parents' | 'died' | 'sex' | 'photo' | 'contact' | 'occupation' | 'story';

/** The gap's short name, as a translation key: `t(GAP_LABEL[gap])`. */
export const GAP_LABEL: Record<GapKey, Key> = {
  born: 'needed.gap.born',
  birthday: 'needed.gap.birthday',
  birthplace: 'needed.gap.birthplace',
  parents: 'needed.gap.parents',
  died: 'needed.gap.died',
  sex: 'needed.gap.sex',
  photo: 'needed.gap.photo',
  contact: 'needed.gap.contact',
  occupation: 'needed.gap.occupation',
  story: 'needed.gap.story',
};

/** What the gap is about, as a translation key. */
export const GAP_HINT: Record<GapKey, Key> = {
  born: 'needed.hint.born',
  birthday: 'needed.hint.birthday',
  birthplace: 'needed.hint.birthplace',
  parents: 'needed.hint.parents',
  died: 'needed.hint.died',
  sex: 'needed.hint.sex',
  photo: 'needed.hint.photo',
  contact: 'needed.hint.contact',
  occupation: 'needed.hint.occupation',
  story: 'needed.hint.story',
};

export const ALL_GAPS: GapKey[] = ['born', 'birthday', 'birthplace', 'parents', 'died', 'sex', 'photo', 'contact', 'occupation', 'story'];
export const DEFAULT_GAPS: GapKey[] = ['born', 'birthday', 'birthplace', 'parents', 'died', 'sex'];

/** Where to fill a gap in from the panel: the edit form, or the dashed slots on the tree. */
export const GAP_WHERE: Record<GapKey, 'edit' | 'tree' | 'everyday' | 'stories'> = {
  born: 'edit', birthday: 'edit', birthplace: 'edit', parents: 'tree', died: 'edit', sex: 'edit',
  photo: 'edit', contact: 'everyday', occupation: 'edit', story: 'stories',
};

/** What filling a gap in takes: the same actions the server checks (src/lib/roles.ts). */
export const GAP_ACTION: Record<GapKey, Action> = {
  born: 'edit-person', birthday: 'edit-person', birthplace: 'edit-person', died: 'edit-person', sex: 'edit-person', occupation: 'edit-person',
  parents: 'add-person', photo: 'upload-photo', contact: 'edit-contact', story: 'add-story',
};

const isAdult = (p: GPerson) => {
  const y = parseInt(p.born ?? '', 10);
  return !isNaN(y) && new Date().getFullYear() - y >= 16;
};

/** What a guest whose link protects living people does not get of the living, so it is never a gap to them (protect-living.ts). */
const WITHHELD_FROM_GUEST: ReadonlySet<GapKey> = new Set(['born', 'birthday', 'birthplace', 'contact', 'occupation', 'story']);

export function gapsOf(f: Family, p: GPerson, required: ReadonlySet<GapKey> = new Set(DEFAULT_GAPS)): GapKey[] {
  const out: GapKey[] = [];
  const withheld = f.graph.livingProtected && p.living;
  const want = (k: GapKey) => required.has(k) && !(withheld && WITHHELD_FROM_GUEST.has(k));
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
