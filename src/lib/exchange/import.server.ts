// Importing a GEDCOM file into a family: the preview (what would happen, nothing written) and the apply (the
// same plan, written as one guarded batch through `once`, so a retry or a second copy cannot write twice).
// Server-only: it uses the family's database. The steward's permission is checked by the server function that
// calls this (exchange.functions.ts), before anything here runs.
import { db, newId, once, type OpKey } from '../db.server.ts';
import { guard, q, type Query } from '../store/index.ts';
import { readGedcom } from './gedcom.ts';
import { planImport, type ConflictCode, type ImportPlan } from './plan.ts';
import type { Vars } from '../i18n/types.ts';
import { readTree, type ExTree, type IssueCode } from './model.ts';

/** Lists are cut at this many rows; the counts are always complete. */
const LIST = 300;

export interface ImportPreview {
  /** The family's own name, and the name the file gives itself. */
  family: { name: string };
  fileName: string | null;
  existing: number;
  incoming: number;
  add: { name: string }[];
  addCount: number;
  matched: { name: string; by: 'id' | 'name' }[];
  matchCount: number;
  ambiguous: string[];
  conflicts: { name: string; field: string; code: ConflictCode; kind: 'value' | 'cycle'; existing: string; incoming: string; vars: Vars }[];
  conflictCount: number;
  parents: number;
  duplicateParents: number;
  unions: number;
  duplicateUnions: number;
  unlinked: number;
  pictures: number;
  issues: { level: string; message: string; code: IssueCode; vars: Vars }[];
  issueCount: number;
}

function summarize(plan: ImportPlan, incoming: ReturnType<typeof readGedcom>, existing: ExTree): ImportPreview {
  return {
    family: { name: existing.name },
    fileName: incoming.tree.name,
    existing: existing.people.length,
    incoming: incoming.people.length,
    add: plan.add.slice(0, LIST).map((p) => ({ name: [p.given, p.surname].filter(Boolean).join(' ') })),
    addCount: plan.add.length,
    matched: plan.matched.slice(0, LIST).map((m) => ({ name: m.name, by: m.by })),
    matchCount: plan.matched.length,
    ambiguous: plan.ambiguous.slice(0, LIST),
    conflicts: plan.conflicts
      .slice(0, LIST)
      .map((c) => ({ name: c.name, field: c.field, code: c.code, kind: c.kind, existing: c.existing, incoming: c.incoming, vars: c.vars })),
    conflictCount: plan.conflicts.length,
    parents: plan.parents.length,
    duplicateParents: plan.duplicateParents,
    unions: plan.unions.length,
    duplicateUnions: plan.duplicateUnions,
    unlinked: plan.unlinked,
    pictures: incoming.pictures,
    issues: plan.issues.slice(0, LIST).map((i) => ({ level: i.level, message: i.message, code: i.code, vars: i.vars })),
    issueCount: plan.issues.length,
  };
}

/** What importing `text` into `tree` would do. Reads only. */
export async function previewImport(tree: string, text: string): Promise<ImportPreview> {
  const existing = await readTree(db(tree));
  const incoming = readGedcom(text);
  return summarize(planImport(incoming, existing, newId), incoming, existing);
}

export interface ApplyResult {
  people: number;
  parents: number;
  unions: number;
  matched: number;
}

/**
 * Writes the import. A family that already has people needs `allowExisting`: adding a file to a family is
 * never the default. The batch restates what the plan read, so if anyone else changed the family in between,
 * nothing is written and the import is planned again on fresh reads (see `once`). The parent links are guarded by
 * the ancestry revision (migration 0011), which every change to a link bumps: one number, the same size for a
 * family of any size, and it moves even when another editor replaces one link with a different one and leaves the
 * count the same. The loop check above only holds for the links it read.
 */
export function applyImport(tree: string, text: string, op: OpKey | undefined, allowExisting: boolean): Promise<ApplyResult> {
  return once<ApplyResult>(tree, op, 'importExchange', async (d) => {
    // The revision is read before the links: a change between the two reads makes the guard fail, never pass.
    const rev = await d.get<{ rev: number }>('SELECT rev FROM ancestry_rev WHERE id = 1');
    if (!rev) throw new Error('The family database is missing its ancestry revision: run its migrations.');
    const existing = await readTree(d);
    if (existing.people.length && !allowExisting) {
      throw new Error('exchange.import.needAllow');
    }
    const incoming = readGedcom(text);
    const plan = planImport(incoming, existing, newId);
    // A file that would make someone their own ancestor is not written at all: the steward corrects it first.
    if (plan.cycles.length) throw new Error('exchange.cycle_refused');
    const writes: Query[] = [
      guard('(SELECT count(*) FROM person) = ?', existing.people.length),
      guard('(SELECT count(*) FROM parent) = ?', existing.parents.length),
      guard('(SELECT rev FROM ancestry_rev WHERE id = 1) = ?', rev.rev),
      guard('(SELECT count(*) FROM partnership) = ?', existing.unions.length),
    ];
    for (const p of plan.add) {
      writes.push(
        q(
          `INSERT INTO person (id, given, surname, sex, born, born_place, died, died_place, living, title, epithet, occupation, nickname, bio, current_given, current_surname)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          p.id,
          p.given,
          p.surname,
          p.sex,
          p.born,
          p.bornPlace,
          p.died,
          p.diedPlace,
          p.living ? 1 : 0,
          p.title,
          p.epithet,
          p.occupation,
          p.nickname,
          p.bio,
          p.currentGiven,
          p.currentSurname,
        ),
      );
    }
    for (const l of plan.parents) writes.push(q('INSERT INTO parent (child, parent, kind, confidence) VALUES (?, ?, ?, ?)', l.child, l.parent, l.kind, l.confidence));
    for (const u of plan.unions) {
      writes.push(
        q('INSERT INTO partnership (id, a, b, kind, start, end, end_reason, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', u.id, u.a, u.b, u.kind, u.start, u.end, u.endReason, u.place),
      );
    }
    return {
      writes,
      result: { people: plan.add.length, parents: plan.parents.length, unions: plan.unions.length, matched: plan.matched.length },
    };
  });
}
