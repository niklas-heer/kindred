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
//     A partnership in the file between two people who already have one in the tree is that partnership: where its
//     kind, dates or place differ, the difference is a conflict, as for people. A couple is never given a second one.
//     A partnership id the tree already uses is never reused for a new one.
//   - A new parent link keeps the link form's rules (parent-rules.ts), also when it joins people already in the tree:
//     no third parent of one kind, and no birth or adoptive parent born after (or with) the child. A link that breaks
//     one is a conflict, and is not added; the rest of the file still is.
//   - A parent link that would make someone their own ancestor (directly or through others, in the tree or in the
//     file) is a conflict, and is not added. `applyImport` refuses the whole file while there are any.
//   - Life events, sources and citations are added when they are new, as links are. A source in the file is the tree's
//     own when it carries its _KINDRED_ID or has the same title and author; an event of a matched person is already
//     there when one of the same type, date, place and details is; a citation when the same source already backs the
//     same fact with the same page. A citation of a fact that is not imported (a refused link) is left out.
import type { Key } from '../i18n/dictionary.ts';
import { bornBeforeParent, MAX_PARENTS } from '../parent-rules.ts';
import type { Vars } from '../i18n/types.ts';
import type { Incoming, IncomingPerson } from './gedcom.ts';
import { factKey, type Fact } from '../events.ts';
import type { ExCitation, ExEvent, ExParent, ExPerson, ExSource, ExTree, ExUnion, Issue, IssueCode, ParentKind } from './model.ts';

type ConflictField = 'born' | 'died' | 'born place' | 'died place' | 'parent' | 'union start' | 'union end' | 'union kind' | 'union place';
export type ConflictCode = Extract<Key, `exchange.conflict.field.${string}`>;

/** The field's translation key, for each raw field word. */
const FIELD_CODE: Record<ConflictField, ConflictCode> = {
  born: 'exchange.conflict.field.born',
  died: 'exchange.conflict.field.died',
  'born place': 'exchange.conflict.field.born_place',
  'died place': 'exchange.conflict.field.died_place',
  parent: 'exchange.conflict.field.parent',
  'union start': 'exchange.conflict.field.union_start',
  'union end': 'exchange.conflict.field.union_end',
  'union kind': 'exchange.conflict.field.union_kind',
  'union place': 'exchange.conflict.field.union_place',
};

export interface Conflict {
  name: string;
  id: string;
  /** The raw word ("born place", "parent"), for the CLI and the tests. */
  field: ConflictField;
  /** The field's name in the reader's language. */
  code: ConflictCode;
  /**
   * `value`: one fact differs between the file and the family. `cycle`: a parent link that would make a loop.
   * `parents`: a parent link that would give the child a third parent of one kind. `order`: a birth or adoptive parent
   * born after (or in the same year as) the child.
   */
  kind: 'value' | 'cycle' | 'parents' | 'order';
  existing: string;
  incoming: string;
  /** What the translated sentence needs: `exchange.conflict.value` or `exchange.conflict.cycle`. */
  vars: Vars;
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
  /**
   * The birth dates of people already in the family that the accepted parent links were checked against, so the write
   * can guard them: a date changed in between makes the import plan again.
   */
  bornRead: Map<string, string | null>;
  /** New parent links (ids of the tree), and how many were already there. */
  parents: ExParent[];
  duplicateParents: number;
  /** New partnerships, and how many were already there. */
  unions: ExUnion[];
  duplicateUnions: number;
  /** Links whose people are not in the file's people (should not happen in a valid file). */
  unlinked: number;
  /** New sources, life events and citations (ids of the tree), and how many of each were already there. */
  sources: ExSource[];
  duplicateSources: number;
  events: ExEvent[];
  duplicateEvents: number;
  citations: ExCitation[];
  duplicateCitations: number;
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
/**
 * A new id that nothing in `taken` has. `makeId` is random but short (newId: six hex digits, so a few thousand partnerships
 * in one file already meet twice), so it is asked again on a collision, and a counter settles one that keeps coming back.
 */
function freshId(makeId: (given: string) => string, given: string, taken: ReadonlySet<string>): string {
  for (let i = 0; i < 8; i++) {
    const id = makeId(given);
    if (!taken.has(id)) return id;
  }
  const base = makeId(given);
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

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
        issues.push({
          level: 'warning',
          code: 'exchange.issue.duplicate_id',
          vars: { name },
          message: `${name} has the same id as an earlier person in the file; this one is matched by name or added as new`,
        });
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
        issues.push({
          level: 'warning',
          code: 'exchange.issue.ambiguous',
          vars: { name, count: candidates.length },
          message: `${name} matches ${candidates.length} people in the family; added as a new person`,
        });
      }
    }

    if (hit) {
      matchedIds.add(hit.id);
      keyToId.set(p.id, hit.id);
      matched.push({ name, id: hit.id, by });
      const check = (field: ConflictField, a: string | null, b: string | null) => {
        if (a && b && fold(a) !== fold(b)) {
          conflicts.push({ name, id: hit!.id, field, code: FIELD_CODE[field], kind: 'value', existing: a, incoming: b, vars: { name, existing: a, incoming: b } });
        }
      };
      check('born', hit.born, p.born);
      check('died', hit.died, p.died);
      check('born place', hit.bornPlace, p.bornPlace);
      check('died place', hit.diedPlace, p.diedPlace);
      continue;
    }

    const preferred = p.preferredId && !taken.has(p.preferredId) ? p.preferredId : null;
    const id = preferred ?? freshId(makeId, p.given, taken);
    taken.add(id);
    keyToId.set(p.id, id);
    add.push({
      id,
      given: p.given,
      furtherGiven: p.furtherGiven,
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

  // Parent links. Each new link is checked against the family as it stands plus the links accepted so far in this
  // file: the ancestry (a link that would make a person their own ancestor is refused, and refuses the file), and the
  // link form's rules (a third parent of one kind, or a parent born after the child, is refused on its own).
  const existingLinks = new Set(existing.parents.map((l) => `${l.child}|${l.parent}`));
  const parentsOf = new Map<string, Set<string>>();
  const kindCount = new Map<string, number>();
  const countKey = (child: string, kind: ParentKind) => `${child}|${kind}`;
  for (const l of existing.parents) {
    addParent(parentsOf, l.child, l.parent);
    kindCount.set(countKey(l.child, l.kind), (kindCount.get(countKey(l.child, l.kind)) ?? 0) + 1);
  }
  const nameById = new Map([...existing.people, ...add].map((p) => [p.id, nameOf(p)]));
  const bornById = new Map([...existing.people, ...add].map((p) => [p.id, p.born]));
  const bornRead = new Map<string, string | null>();
  const parents: ExParent[] = [];
  const cycles: Cycle[] = [];
  let refused = 0;
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
    const childName = nameById.get(child) ?? child;
    const parentName = nameById.get(parent) ?? parent;
    // Adding child→parent closes a cycle exactly when the child is already an ancestor of (or the same as) the parent.
    if (isAncestorOf(parentsOf, child, parent)) {
      const cycle = { child, parent, childName, parentName };
      cycles.push(cycle);
      conflicts.push({
        name: childName,
        id: child,
        field: 'parent',
        code: FIELD_CODE.parent,
        kind: 'cycle',
        existing: `${parentName} is a descendant`,
        incoming: `${parentName} as a parent`,
        vars: { name: childName, parent: parentName },
      });
      continue;
    }
    // A step or foster parent can be younger than the child; a birth or adoptive parent cannot.
    const ordered = l.kind === 'biological' || l.kind === 'adoptive';
    const tooYoung = ordered && bornBeforeParent(bornById.get(child), bornById.get(parent));
    const tooMany = (kindCount.get(countKey(child, l.kind)) ?? 0) >= MAX_PARENTS;
    if (tooYoung || tooMany) {
      refused++;
      conflicts.push({
        name: childName,
        id: child,
        field: 'parent',
        code: FIELD_CODE.parent,
        kind: tooYoung ? 'order' : 'parents',
        existing: tooYoung ? `${childName} born ${bornById.get(child)}` : `${MAX_PARENTS} ${l.kind} parents`,
        incoming: `${parentName}${tooYoung ? ` born ${bornById.get(parent)}` : ''} as a parent`,
        vars: { name: childName, parent: parentName },
      });
      continue;
    }
    for (const id of [child, parent]) if (byId.has(id)) bornRead.set(id, byId.get(id)!.born);
    existingLinks.add(k);
    addParent(parentsOf, child, parent);
    kindCount.set(countKey(child, l.kind), (kindCount.get(countKey(child, l.kind)) ?? 0) + 1);
    parents.push({ child, parent, kind: l.kind, confidence: l.confidence });
  }
  if (refused) {
    issues.push({
      level: 'loss',
      code: 'exchange.issue.parents_refused',
      vars: { count: refused },
      message: `${refused} parent link${refused === 1 ? '' : 's'} would give someone a third parent of one kind, or a parent born after them, and ${refused === 1 ? 'is' : 'are'} not imported`,
    });
  }
  if (cycles.length) {
    const code: IssueCode = 'exchange.issue.cycles';
    issues.push({
      level: 'loss',
      code,
      vars: { count: cycles.length },
      message: `${cycles.length} parent link${cycles.length === 1 ? '' : 's'} would make someone their own ancestor. Nothing is imported until the file is corrected.`,
    });
  }

  // Partnerships. One that is in the tree as it is, is counted. One between two people who already have a partnership
  // in the tree is matched to it (the one with its id first, then one of the same kind, then any), and where they
  // differ, that is a conflict for the steward: a re-imported backup must not marry a couple twice.
  const unionIds = new Set(existing.unions.map((u) => u.id));
  const exact = new Map<string, ExUnion[]>();
  const byCouple = new Map<string, ExUnion[]>();
  const couple = (a: string, b: string) => [a, b].sort().join('|');
  for (const u of existing.unions) {
    const k = unionKey(u.a, u.b, u.kind, u.start, u.end);
    exact.set(k, [...(exact.get(k) ?? []), u]);
    byCouple.set(couple(u.a, u.b), [...(byCouple.get(couple(u.a, u.b)) ?? []), u]);
  }
  const usedUnions = new Set<ExUnion>();
  /** Which partnership of the tree each family of the file became, for the citations that name it. */
  const unionOfKey = new Map<string, string>();
  const unions: ExUnion[] = [];
  let duplicateUnions = 0;
  const pending: { u: (typeof incoming.unions)[number]; a: string; b: string }[] = [];
  for (const u of incoming.unions) {
    const a = keyToId.get(u.a);
    const b = keyToId.get(u.b);
    if (!a || !b || a === b) {
      unlinked++;
      continue;
    }
    // Exact copies first, so a couple married twice keeps each marriage matched to its own.
    const same = (exact.get(unionKey(a, b, u.kind, u.start, u.end)) ?? []).find((e) => !usedUnions.has(e));
    if (same) {
      usedUnions.add(same);
      if (u.key) unionOfKey.set(u.key, same.id);
      duplicateUnions++;
      continue;
    }
    pending.push({ u, a, b });
  }
  for (const { u, a, b } of pending) {
    const candidates = (byCouple.get(couple(a, b)) ?? []).filter((e) => !usedUnions.has(e));
    const hit = candidates.find((e) => e.id === u.preferredId) ?? candidates.find((e) => e.kind === u.kind) ?? candidates[0];
    if (hit) {
      usedUnions.add(hit);
      if (u.key) unionOfKey.set(u.key, hit.id);
      duplicateUnions++;
      const name = `${nameById.get(hit.a) ?? hit.a} & ${nameById.get(hit.b) ?? hit.b}`;
      const check = (field: ConflictField, x: string | null, y: string | null) => {
        if (x && y && fold(x) !== fold(y)) {
          conflicts.push({ name, id: hit.id, field, code: FIELD_CODE[field], kind: 'value', existing: x, incoming: y, vars: { name, existing: x, incoming: y } });
        }
      };
      check('union kind', hit.kind, u.kind);
      check('union start', hit.start, u.start);
      check('union end', hit.end, u.end);
      check('union place', hit.place, u.place);
      continue;
    }
    const preferred = u.preferredId && !unionIds.has(u.preferredId) ? u.preferredId : null;
    const id = preferred ?? freshId(makeId, 'union', unionIds);
    unionIds.add(id);
    if (u.key) unionOfKey.set(u.key, id);
    unions.push({ id, a, b, kind: u.kind, start: u.start, end: u.end, endReason: u.endReason, place: u.place });
  }

  // Sources: the tree's own by id, then by title and author; the rest are new.
  const treeSources = existing.sources ?? [];
  const sourceIds = new Set(treeSources.map((x) => x.id));
  const sourceOfKey = new Map<string, string>();
  const sources: ExSource[] = [];
  let duplicateSources = 0;
  const sourceName = (x: { title: string; author: string | null }) => `${fold(x.title)}|${fold(x.author ?? '')}`;
  const byTitle = new Map([...treeSources].reverse().map((x) => [sourceName(x), x.id]));
  for (const x of incoming.sources ?? []) {
    const had = x.preferredId && treeSources.some((t) => t.id === x.preferredId) ? x.preferredId : byTitle.get(sourceName(x));
    if (had) {
      sourceOfKey.set(x.key, had);
      duplicateSources++;
      continue;
    }
    const id = x.preferredId && !sourceIds.has(x.preferredId) ? x.preferredId : makeId('source');
    sourceIds.add(id);
    sourceOfKey.set(x.key, id);
    byTitle.set(sourceName(x), id);
    const { key: _key, preferredId: _pref, ...rest } = x;
    sources.push({ id, ...rest });
  }

  // Life events: all of a new person's; of a matched person, those the tree does not have yet.
  const treeEvents = existing.events ?? [];
  const eventIds = new Set(treeEvents.map((e) => e.id));
  const eventOfKey = new Map<string, string>();
  const events: ExEvent[] = [];
  let duplicateEvents = 0;
  const eventSig = (e: Pick<ExEvent, 'person' | 'type' | 'date' | 'place' | 'label'>) => [e.person, e.type, e.date ?? '', fold(e.place ?? ''), fold(e.label ?? '')].join('|');
  const treeEventBySig = new Map(treeEvents.map((e) => [eventSig(e), e.id]));
  const ordOf = new Map<string, number>();
  for (const e of treeEvents) ordOf.set(e.person, Math.max(ordOf.get(e.person) ?? -1, e.ord));
  for (const e of incoming.events ?? []) {
    const person = keyToId.get(e.person);
    if (!person) continue;
    const had = treeEventBySig.get(eventSig({ ...e, person }));
    if (had) {
      eventOfKey.set(e.key, had);
      duplicateEvents++;
      continue;
    }
    const id = e.preferredId && !eventIds.has(e.preferredId) ? e.preferredId : makeId('event');
    eventIds.add(id);
    eventOfKey.set(e.key, id);
    const ord = (ordOf.get(person) ?? -1) + 1;
    ordOf.set(person, ord);
    events.push({ id, person, type: e.type, label: e.label, date: e.date, endDate: e.endDate, place: e.place, note: e.note, ord });
  }

  // Citations: only of facts the family will have, and not twice.
  const linked = new Set(existingLinks);
  const citationIds = new Set((existing.citations ?? []).map((c) => c.id));
  const citeSig = (source: string, f: Fact, page: string | null) => `${source}|${factKey(f)}|${fold(page ?? '')}`;
  const citedAlready = new Set((existing.citations ?? []).map((c) => citeSig(c.source, c.target, c.page)));
  const citations: ExCitation[] = [];
  let duplicateCitations = 0;
  for (const c of incoming.citations ?? []) {
    const source = sourceOfKey.get(c.source);
    const t = c.target;
    let target: Fact | null = null;
    if (t.fact === 'event') target = eventOfKey.has(t.event) ? { fact: 'event', event: eventOfKey.get(t.event)! } : null;
    else if (t.fact === 'partnership') target = unionOfKey.has(t.union) ? { fact: 'partnership', partnership: unionOfKey.get(t.union)! } : null;
    else if (t.fact === 'parent') {
      const child = keyToId.get(t.child), parent = keyToId.get(t.parent);
      target = child && parent && linked.has(`${child}|${parent}`) ? { fact: 'parent', child, parent } : null;
    } else {
      const person = keyToId.get(t.person);
      target = person ? { fact: t.fact, person } : null;
    }
    if (!source || !target) continue;
    const sig = citeSig(source, target, c.page);
    if (citedAlready.has(sig)) {
      duplicateCitations++;
      continue;
    }
    citedAlready.add(sig);
    const id = c.preferredId && !citationIds.has(c.preferredId) ? c.preferredId : makeId('citation');
    citationIds.add(id);
    citations.push({ id, source, target, page: c.page, quality: c.quality, transcription: c.transcription });
  }

  return {
    add, matched, ambiguous, conflicts, cycles, bornRead, parents, duplicateParents, unions, duplicateUnions, unlinked, issues,
    sources, duplicateSources, events, duplicateEvents, citations, duplicateCitations,
  };
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
