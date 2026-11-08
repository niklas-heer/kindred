// A Kindred Markdown archive in the v1 format: one note per person, in people/, with YAML front matter for the
// relationships, dates and places, and the biography under "## Story". It is the shape Kindred's own v1 tools
// write and read, and the one scripts/import-kindred.ts reads, so an archive goes both ways:
//
//   v2 → v1:  export a Markdown archive here, open it in the v1 CLI or run import-kindred.ts on it.
//   v1 → v2:               run scripts/import-kindred.ts on the v1 archive, or import a GEDCOM it exported.
//
// Every value that is text is written as a JSON string, which YAML reads as the same text. Keys the v1 schema
// does not name (sex, title, epithet, current name, the end of a partnership) are extra properties, which
// v1 retains; import-kindred ignores them.
import { allGiven } from '../further-given.ts';
import type { ExParent, ExPerson, ExTree, ExUnion } from './model.ts';

export interface ArchiveFile {
  path: string;
  data: string | Uint8Array;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const str = (s: string) => JSON.stringify(s);
/** Kindred's "~1900" is the v1 "about 1900" (import-kindred turns it back). */
const v1Date = (d: string | null) => (d === null ? null : d.startsWith('~') ? `about ${d.slice(1)}` : d);

/** A file name for each person's note: the id, made safe for every file system, and unique. */
export function noteNames(people: ExPerson[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const p of people) {
    const base = p.id.replace(/[^A-Za-z0-9._-]+/g, '_') || 'person';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    names.set(p.id, name);
  }
  return names;
}

/** Where a portrait goes in the archive: attachments/<note>.<ext>. */
export function portraitPath(p: ExPerson, names: Map<string, string>): string | null {
  if (!p.portrait) return null;
  return `attachments/${names.get(p.id)}.${EXT[p.portrait.mime] ?? 'bin'}`;
}

/**
 * The archive's files: one note per person and a README, and what the format leaves out. `portraits` is the
 * path of each picture the caller has fetched (its bytes go in the archive too); a person without one is
 * written without a portrait line.
 */
export function markdownArchive(tree: ExTree, portraits: Set<string> = new Set(), now: Date = new Date()): { files: ArchiveFile[]; losses: string[] } {
  const names = noteNames(tree.people);
  const losses: string[] = [];
  const steps = tree.parents.filter((l) => l.kind === 'step').length;
  if (steps) losses.push(`${steps} step-parent ${steps === 1 ? 'link is' : 'links are'} not written: the v1 format has no step relation`);
  if (tree.extras.stories) losses.push(`${tree.extras.stories} ${tree.extras.stories === 1 ? 'story, memory or saying is' : 'stories, memories and sayings are'} not in the archive (biographies are)`);
  if (tree.extras.fields) losses.push(`${tree.extras.fields} ${tree.extras.fields === 1 ? 'contact detail or other field is' : 'contact details and other fields are'} not in the archive`);
  if (tree.extras.houses) losses.push(`${tree.extras.houses} ${tree.extras.houses === 1 ? 'house and its arms are' : 'houses and their arms are'} not in the archive`);
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const link = (id: string) => `[[people/${names.get(id)}]]`;
  const files: ArchiveFile[] = [];

  // Each partnership belongs to its lower-id partner's note, so it is declared once.
  const partnersOf = new Map<string, ExUnion[]>();
  for (const u of tree.unions) {
    if (!byId.has(u.a) || !byId.has(u.b) || u.a === u.b) continue;
    const owner = u.a < u.b ? u.a : u.b;
    partnersOf.set(owner, [...(partnersOf.get(owner) ?? []), u]);
  }
  const parentsOf = new Map<string, ExParent[]>();
  for (const l of tree.parents) {
    if (!byId.has(l.child) || !byId.has(l.parent) || l.child === l.parent) continue;
    parentsOf.set(l.child, [...(parentsOf.get(l.child) ?? []), l]);
  }

  for (const p of tree.people) {
    const lines: string[] = ['---', 'version: 1', `id: ${str(p.id)}`, 'type: person', `name: ${str([allGiven(p.given, p.furtherGiven), p.surname].filter(Boolean).join(' '))}`];
    if (p.furtherGiven.length) lines.push(`given_names: [${[p.given, ...p.furtherGiven].map(str).join(', ')}]`);
    lines.push(`living: ${p.living ? 'true' : 'false'}`);
    if (p.sex) lines.push(`sex: ${str(p.sex)}`);
    if (p.born) lines.push(`born: ${str(v1Date(p.born)!)}`);
    if (p.bornPlace) lines.push(`birth_place: ${str(p.bornPlace)}`);
    if (p.died) lines.push(`died: ${str(v1Date(p.died)!)}`);
    if (p.diedPlace) lines.push(`death_place: ${str(p.diedPlace)}`);
    if (p.occupation) lines.push(`occupation: ${str(p.occupation)}`);
    if (p.title) lines.push(`title: ${str(p.title)}`);
    if (p.epithet) lines.push(`epithet: ${str(p.epithet)}`);
    if (p.nickname) lines.push(`aliases: [${str(p.nickname)}]`);
    if (p.currentGiven || p.currentSurname) {
      lines.push(`current_name: ${str([p.currentGiven ?? p.given, p.currentSurname ?? p.surname].filter(Boolean).join(' '))}`);
    }
    const portrait = portraitPath(p, names);
    if (portrait && portraits.has(portrait)) lines.push(`portrait: ${str(portrait)}`);

    // v1 has no step-parent relation (it would read as a biological claim), so step links are left out and counted.
    const parents = (parentsOf.get(p.id) ?? []).filter((l) => l.kind !== 'step');
    if (parents.length) {
      lines.push('parents:');
      for (const l of parents) {
        const parent = byId.get(l.parent)!;
        const role = parent.sex === 'f' ? 'mother' : parent.sex === 'm' ? 'father' : 'parent';
        lines.push(`  - person: ${str(link(l.parent))}`);
        lines.push(`    relation: ${str(`${l.kind}_parent`)}`);
        lines.push(`    kind: ${str(l.kind)}`);
        lines.push(`    role: ${str(role)}`);
        lines.push(`    status: ${str(l.confidence === 'certain' ? 'accepted' : l.confidence === 'probable' ? 'tentative' : 'disputed')}`);
      }
    }

    const unions = partnersOf.get(p.id) ?? [];
    const partners = unions.filter((u) => u.kind !== 'marriage');
    const marriages = unions.filter((u) => u.kind === 'marriage');
    if (partners.length) {
      lines.push('partners:');
      for (const u of partners) {
        const other = u.a === p.id ? u.b : u.a;
        // v1 has no date on a partnership; its start and place ride along as extra properties (v1 keeps them).
        lines.push(`  - person: ${str(link(other))}`, `    id: ${str(u.id)}`, `    status: "accepted"`);
        if (u.start) lines.push(`    start: ${str(v1Date(u.start)!)}`);
        if (u.place) lines.push(`    place: ${str(u.place)}`);
      }
    }
    // A marriage is an event (with its date and place); a divorce is one too. Other endings are kept as the
    // marriage's `ended` properties, which v1 retains.
    const events: { type: string; u: ExUnion }[] = [
      ...marriages.map((u) => ({ type: 'marriage', u })),
      ...unions.filter((u) => u.end && u.endReason === 'divorce').map((u) => ({ type: 'divorce', u })),
    ];
    if (events.length) {
      lines.push('events:');
      for (const { type, u } of events) {
        const other = u.a === p.id ? u.b : u.a;
        lines.push(`  - id: ${str(u.id)}`, `    type: ${str(type)}`);
        const date = type === 'marriage' ? u.start : u.end;
        if (date) lines.push(`    date: ${str(v1Date(date)!)}`);
        if (u.place) lines.push(`    place: ${str(u.place)}`);
        if (type === 'marriage' && u.end && u.endReason !== 'divorce') {
          lines.push(`    ended: ${str(v1Date(u.end)!)}`, `    ended_by: ${str(u.endReason ?? '')}`);
        }
        lines.push(`    people: [${str(link(other))}]`); // the owner is implicit; import-kindred takes owner + people
      }
    }
    lines.push('---');
    const body = p.bio ? `\n## Story\n\n${p.bio.trim()}\n` : '';
    files.push({ path: `people/${names.get(p.id)}.md`, data: `${lines.join('\n')}\n${body}` });
  }

  files.push({
    path: 'README.md',
    data: [
      `# ${tree.name}`,
      '',
      `Exported from Kindred on ${now.toISOString().slice(0, 10)}. One note per person in people/, in the Kindred`,
      'archive format (version 1). Attachments/ holds the portraits.',
      '',
      'Open it with the Kindred v1 tools, or import it into Kindred v2 with scripts/import-kindred.ts.',
      'Dates keep their original wording as "about 1900" (Kindred v2 reads "~1900"). Partnerships are declared',
      'once, on the note of the partner whose id sorts first.',
      '',
      ...(losses.length ? ['Not in this archive:', ...losses.map((l) => `- ${l}`), ''] : []),
    ].join('\n'),
  });
  return { files, losses };
}
