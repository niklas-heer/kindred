// What the family still needs to find out about someone: the research to-do list.
import { parents, type Family } from './graph';
import type { GPerson } from './types';

export type GapKey = 'birthday' | 'born' | 'birthplace' | 'parents' | 'died' | 'sex';

export const GAP_LABEL: Record<GapKey, string> = {
  born: 'Birth year',
  birthday: 'Full birthday',
  birthplace: 'Birthplace',
  parents: 'Parents',
  died: 'Death date',
  sex: 'Sex',
};

/** Where to fill a gap in: the edit form, or a dashed slot on the tree. */
export const GAP_WHERE: Record<GapKey, 'edit' | 'tree'> = {
  born: 'edit', birthday: 'edit', birthplace: 'edit', parents: 'tree', died: 'edit', sex: 'edit',
};

export function gapsOf(f: Family, p: GPerson): GapKey[] {
  const out: GapKey[] = [];
  if (!p.born) out.push('born');
  // Living people need a full date, so the Almanac can remind the family of their birthday.
  else if (p.living && !/^\d{4}-\d\d-\d\d$/.test(p.born)) out.push('birthday');
  if (!p.bornPlace) out.push('birthplace');
  // Both slots, as in the ancestors view: one known parent still leaves the other to find.
  if (parents(f, p.id).length < 2) out.push('parents');
  if (!p.living && !p.died) out.push('died');
  if (!p.sex) out.push('sex');
  return out;
}
