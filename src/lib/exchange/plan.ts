// Deciding what an import would do, from the file and the family as it is now. Pure: no reads, no writes.
//
// The rules are conservative, because an import must never damage a family:
//   - A person in the file matches a person already in the tree when they carry the same _KINDRED_ID, or else
//     when their name is the same and their birth years agree (or one has no birth year). A name that matches
//     two people is not guessed at: the person is added, and the report says so.
//   - Matched people are never changed. Where both files give a different birth or death date or place, the
//     difference is listed as a conflict for the steward to settle by hand.
//   - New people are added, with the id the file gives when that id is free, otherwise a new one.
//   - Parent links and partnerships are added when they are new; one already in the tree is counted, not repeated.
//   - A parent link that would make someone their own ancestor (directly or through others, in the tree or in the
//     file) is a conflict, and is not added. `applyImport` refuses the whole file while there are any.
import type { Incoming, IncomingPerson } from './gedcom.ts';
import type { ExParent, ExPerson, ExTree, ExUnion, Issue } from './model.ts';

export interface Conflict {
  name: string;
  id: string;
  field: 'born' | 'died' | 'born place' | 'died place' | 'parent';
  existing: string;
  incoming: string;
}

/** A parent link the file would make a cycle with: `child` cannot have `parent` as a parent. */
export interface Cycle {
  child: string;
  parent: string;
  childName: string;
  parentName: string;
}

export interface ImportPlan {
  /** New people, with the ids they will have in the tree. */
  add: ExPerson[];
  /** People in the file who are already in the tree, and how they were found. */
  matched: { name: string; id: string; by: 'id' | 'name' }[];
  /** People with more than one possible match: added as new, to be checked by a steward. */
  ambiguous: string[];
  conflicts: Conflict[];
  /** Parent links refused because they would make someone their own ancestor (also listed in `conflicts`). */
  cycles: Cycle[];
  /** New parent links (ids of the tree), and how many were already there. */
  parents: ExParent[];
  duplicateParents: number;
  /** New partnerships, and how many were already there. */
  unions: ExUnion[];
  duplicateUnions: number;
  /** Links whose people are not in the file's people (should not happen in a valid file). */
  unlinked: number;
  issues: Issue[];
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const yearOf = (d: string | null) => (d ? d.replace(/^~/, '').slice(0, 4) : null);
const nameOf = (p: { given: string; surname: string | null }) => [p.given, p.surname].filter(Boolean).join(' ');
const unionKey = (a: string, b: string, kind: string, start: string | null, end: string | null) => `${[a, b].sort().join('|')}|${kind}|${start ?? ''}|${end ?? ''}`;

/**
 * The import plan for `incoming` into `existing`. `makeId(given)` gives a new id for a person (or a partnership,
 * given "union") whose file id is missing or taken.
 */
export function planImport(incoming: Incoming, existing: ExTree, makeId: (given: string) => string): ImportPlan {
  const issues: Issue[] = [...incoming.issues];
  const byId = new Map(existing.people.map((p) => [p.id, p]));
  const taken = new Set(existing.people.map((p) => p.id));
  const matchedIds = new Set<string>();
  const byName = new Map<string, ExPerson[]>();
  for (const p of existing.people) {
    const k = fold(nameOf(p));
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }

  const keyToId = new Map<string, string>();
  const matched: ImportPlan['matched'] = [];
  const ambiguous: string[] = [];
  const conflicts: Conflict[] = [];
  const add: ExPerson[] = [];

  const compatible = (e: ExPerson, p: IncomingPerson) => {
    const ey = yearOf(e.born);
    const py = yearOf(p.born);
    return !ey || !py || ey === py;
  };

  const seenInFile = new Set<string>();
  for (const p of incoming.people) {
    const name = nameOf(p);
    let hit: ExPerson | undefined;
    let by: 'id' | 'name' = 'name';
    if (p.preferredId) {
      if (seenInFile.has(p.preferredId)) {
        issues.push({ level: 'warning', message: `${name} has the same id as an earlier person in the file; this one is matched by name or added as new` });
      }
      seenInFile.add(p.preferredId);
    }
    if (p.preferredId && byId.has(p.preferredId) && !matchedIds.has(p.preferredId)) {
      hit = byId.get(p.preferredId);
      by = 'id';
    } else {
      const candidates = (byName.get(fold(name)) ?? []).filter((e) => !matchedIds.has(e.id) && compatible(e, p));
      if (candidates.length === 1) hit = candidates[0];
      else if (candidates.length > 1) {
        ambiguous.push(name);
        issues.push({ level: 'warning', message: `${name} matches ${candidates.length} people in the family; added as a new person` });
      }
    }

    if (hit) {
      matchedIds.add(hit.id);
      keyToId.set(p.id, hit.id);
      matched.push({ name, id: hit.id, by });
      const check = (field: Conflict['field'], a: string | null, b: string | null) => {
        if (a && b && fold(a) !== fold(b)) conflicts.push({ name, id: hit!.id, field, existing: a, incoming: b });
      };
      check('born', hit.born, p.born);
      check('died', hit.died, p.died);
      check('born place', hit.bornPlace, p.bornPlace);
      check('died place', hit.diedPlace, p.diedPlace);
      continue;
    }

    const preferred = p.preferredId && !taken.has(p.preferredId) ? p.preferredId : null;
    const id = preferred ?? makeId(p.given);
    taken.add(id);
    keyToId.set(p.id, id);
    add.push({
      id,
      given: p.given,
      surname: p.surname,
      currentGiven: p.currentGiven,
      currentSurname: p.currentSurname,
      sex: p.sex,
      born: p.born,
      bornPlace: p.bornPlace,
      died: p.died,
      diedPlace: p.diedPlace,
      living: p.living,
      title: p.title,
      epithet: p.epithet,
      occupation: p.occupation,
      nickname: p.nickname,
      bio: p.bio,
      portrait: null,
    });
  }

  // Parent links. Each new link is checked against the ancestry as it stands: the family's, plus the links
  // accepted so far in this file. A link that would make a person their own ancestor is refused, not written.
  const existingLinks = new Set(existing.parents.map((l) => `${l.child}|${l.parent}`));
  const parentsOf = new Map<string, Set<string>>();
  for (const l of existing.parents) addParent(parentsOf, l.child, l.parent);
  const nameById = new Map([...existing.people, ...add].map((p) => [p.id, nameOf(p)]));
  const parents: ExParent[] = [];
  const cycles: Cycle[] = [];
  let duplicateParents = 0;
  let unlinked = 0;
  for (const l of incoming.parents) {
    const child = keyToId.get(l.child);
    const parent = keyToId.get(l.parent);
    if (!child || !parent) {
      unlinked++;
      continue;
    }
    const k = `${child}|${parent}`;
    if (existingLinks.has(k)) {
      duplicateParents++;
      continue;
    }
    // Adding child→parent closes a cycle exactly when the child is already an ancestor of (or the same as) the parent.
    if (isAncestorOf(parentsOf, child, parent)) {
      const cycle = { child, parent, childName: nameById.get(child) ?? child, parentName: nameById.get(parent) ?? parent };
      cycles.push(cycle);
      conflicts.push({ name: cycle.childName, id: child, field: 'parent', existing: `${cycle.parentName} is a descendant`, incoming: `${cycle.parentName} as a parent` });
      continue;
    }
    existingLinks.add(k);
    addParent(parentsOf, child, parent);
    parents.push({ child, parent, kind: l.kind, confidence: l.confidence });
  }
  if (cycles.length) {
    issues.push({
      level: 'loss',
      message: `${cycles.length} parent link${cycles.length === 1 ? '' : 's'} would make someone their own ancestor. Nothing is imported until the file is corrected.`,
    });
  }

  // Partnerships.
  const existingUnions = new Set(existing.unions.map((u) => unionKey(u.a, u.b, u.kind, u.start, u.end)));
  const unions: ExUnion[] = [];
  let duplicateUnions = 0;
  for (const u of incoming.unions) {
    const a = keyToId.get(u.a);
    const b = keyToId.get(u.b);
    if (!a || !b || a === b) {
      unlinked++;
      continue;
    }
    const k = unionKey(a, b, u.kind, u.start, u.end);
    if (existingUnions.has(k)) {
      duplicateUnions++;
      continue;
    }
    existingUnions.add(k);
    const preferred = u.preferredId && !taken.has(u.preferredId) ? u.preferredId : null;
    const id = preferred ?? makeId('union');
    taken.add(id);
    unions.push({ id, a, b, kind: u.kind, start: u.start, end: u.end, endReason: u.endReason, place: u.place });
  }

  return { add, matched, ambiguous, conflicts, cycles, parents, duplicateParents, unions, duplicateUnions, unlinked, issues };
}

const addParent = (parentsOf: Map<string, Set<string>>, child: string, parent: string) => {
  const set = parentsOf.get(child) ?? new Set<string>();
  set.add(parent);
  parentsOf.set(child, set);
};

/** Whether `x` is `of` or one of its ancestors, walking up the parent links. */
function isAncestorOf(parentsOf: Map<string, Set<string>>, x: string, of: string): boolean {
  const seen = new Set<string>();
  const up = [of];
  while (up.length) {
    const cur = up.pop()!;
    if (cur === x) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of parentsOf.get(cur) ?? []) up.push(p);
  }
  return false;
}
