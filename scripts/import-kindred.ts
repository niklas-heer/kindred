// Converts a Kindred Markdown archive into a SeedTree JSON file: a Kindred v1 archive, or the archive Kindred v2 exports
// in the same format (src/lib/exchange/markdown.ts), with its life events, sources (sources/) and citations.
//   node scripts/import-kindred.ts <archive folder> data/seed/<family id>.json [focus]
// The family view opens on the person whose note is named by [focus] (the note's file name, without .md), or else on the
// first person in the archive.
// The output holds living people's data: data/seed/*.json is gitignored.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse } from 'yaml';
import { EVENT_TYPES, type EventType, type Fact } from '../src/lib/events.ts';
import type { SeedCitation, SeedEvent, SeedHouse, SeedPerson, SeedSource, SeedTree, Tincture } from '../src/lib/seed-format.ts';

const [archive, out, focusFile] = process.argv.slice(2);
if (!archive || !out) {
  console.error('usage: node scripts/import-kindred.ts <archive folder> data/seed/<family id>.json [focus]');
  process.exit(1);
}
const familyId = basename(out, '.json');
const familyName = familyId.charAt(0).toUpperCase() + familyId.slice(1);
const dir = join(archive, 'people');

type Note = Record<string, any> & { body: string; file: string };
const readNotes = (folder: string): Note[] =>
  readdirSync(folder)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const text = readFileSync(join(folder, f), 'utf8');
      const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!m) throw new Error(`no front matter in ${f}`);
      return { ...parse(m[1]), body: m[2].trim(), file: basename(f, '.md') };
    });
const notes = readNotes(dir);
// Sources are notes of their own in sources/ (an archive Kindred v2 wrote); a v1 archive has none.
const sourceNotes = existsSync(join(archive, 'sources')) ? readNotes(join(archive, 'sources')).filter((n) => n.type === 'source' && n.id != null && n.title) : [];

// Kindred links name files ("[[people/klaus-heer]]"); the app uses the note's id.
const idByFile = new Map(notes.map((n) => [n.file, String(n.id)]));
if (focusFile && !idByFile.has(focusFile)) {
  console.error(`no person note named ${focusFile}.md in ${dir}`);
  process.exit(1);
}
const link = (l: unknown) => {
  const file = String(l).replace(/^\[\[(?:people\/)?|\]\]$/g, '');
  const id = idByFile.get(file);
  if (!id) throw new Error(`broken link ${l}`);
  return id;
};
const place = (p: any) => (p ? (typeof p === 'string' ? p : p.name) : undefined);
const date = (d: any) => (d == null ? undefined : String(d).replace(/^about /, '~'));

const tinctures: Tincture[] = ['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure'];
const charges = ['lion', 'eagle', 'tower', 'star', 'crescent', 'fleur', 'key', 'rose', 'boar', 'stag', 'sword'] as const;
const divisions = ['plain', 'per-pale', 'per-fess', 'per-bend', 'quarterly', 'chevron'] as const;
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

const houses = new Map<string, SeedHouse>();
const sexes = new Map<string, 'm' | 'f'>();
for (const n of notes) for (const p of n.parents ?? []) sexes.set(link(p.person), p.role === 'mother' ? 'f' : 'm');

const people: SeedPerson[] = notes.map((n) => {
  const words = String(n.name).split(/\s+/);
  const surname = words.length > 1 ? words.at(-1)! : undefined;
  if (surname && !houses.has(surname)) {
    const h = hash(surname);
    houses.set(surname, {
      id: surname.toLowerCase(),
      name: surname,
      arms: {
        field: tinctures[h % 7],
        field2: tinctures[(h >>> 3) % 7],
        division: divisions[(h >>> 6) % divisions.length],
        charge: charges[(h >>> 9) % charges.length],
        chargeTincture: tinctures[(h >>> 3) % 2 === 0 ? 0 : 1],
      },
    });
  }
  const aliases: string[] = n.aliases ?? [];
  return {
    id: String(n.id),
    given: words.slice(0, -1).join(' ') || words[0],
    surname,
    house: surname?.toLowerCase(),
    sex: sexes.get(String(n.id)),
    born: date(n.born),
    bornPlace: place(n.birth_place),
    died: date(n.died),
    diedPlace: place(n.death_place),
    living: n.living === true,
    occupation: [n.occupation].flat().filter(Boolean).join(", ") || undefined,
    nickname: aliases.find((a) => !a.includes(' ')),
    bio: n.body.replace(/^## Story\s*/i, '') || undefined,
  };
});

const parents = notes.flatMap((n) =>
  (n.parents ?? []).map((p: any) => ({ child: String(n.id), parent: link(p.person), kind: p.kind ?? 'biological' })),
);

// A partnership is declared once; its marriage event (if any) supplies date and place.
const unions = new Map<string, SeedTree['unions'][number]>();
for (const n of notes) {
  for (const p of n.partners ?? []) {
    const [a, b] = [String(n.id), link(p.person)].sort();
    unions.set(`${a}__${b}`, { id: p.id ?? `${a}__${b}`, a, b, kind: 'partnership' });
  }
}
for (const n of notes) {
  for (const e of n.events ?? []) {
    if (e.type !== 'marriage') continue;
    const [a, b] = [String(n.id), ...(e.people ?? []).map(link)].sort();
    const u = unions.get(`${a}__${b}`) ?? { id: e.id, a, b };
    unions.set(`${a}__${b}`, { ...u, kind: 'marriage', start: date(e.date), place: place(e.place) });
  }
}

// Life events beside the marriages and divorces (those are the partnerships above). A type Kindred does not know is kept
// as a custom event named by it; birth and death are the person's own fields, not events.
const KNOWN = new Set<string>(EVENT_TYPES);
const text = (v: unknown) => (v == null || v === '' ? undefined : String(v));
const events: SeedEvent[] = [];
for (const n of notes) {
  for (const [i, e] of ((n.events ?? []) as any[]).entries()) {
    const kind = String(e.type ?? '');
    if (['marriage', 'divorce', 'birth', 'death', ''].includes(kind)) continue;
    const type: EventType = KNOWN.has(kind) ? (kind as EventType) : 'custom';
    events.push({
      id: e.id != null ? String(e.id) : `${n.id}-event-${i}`,
      person: String(n.id),
      type,
      label: text(e.label) ?? (type === 'custom' ? kind : undefined),
      date: date(e.date),
      endDate: date(e.end),
      place: place(e.place),
      note: text(e.note),
    });
  }
}

const sources: SeedSource[] = sourceNotes.map((x) => ({
  id: String(x.id),
  title: String(x.title),
  author: text(x.author),
  publication: text(x.publication),
  reference: text(x.reference),
  date: date(x.date),
  note: x.body || undefined,
}));

// Citations name the source by its note ("[[sources/parish-register]]") and the fact by kind: the note's own birth, death
// or name, an event or partnership by id, or a parent link by its parent. One that names nothing here is left out.
const sourceByFile = new Map(sourceNotes.map((x) => [x.file, String(x.id)]));
const eventIds = new Set(events.map((e) => e.id));
const unionIds = new Set([...unions.values()].map((u) => u.id));
const parentLinks = new Set(parents.map((l) => `${l.child}\n${l.parent}`));
const QUALITIES = new Set(['original', 'derivative', 'unsure']);
const citations: SeedCitation[] = [];
let uncited = 0;
for (const n of notes) {
  for (const [i, c] of ((n.citations ?? []) as any[]).entries()) {
    const source = sourceByFile.get(String(c.source ?? '').replace(/^\[\[(?:sources\/)?|\]\]$/g, ''));
    const person = String(n.id);
    const parent = c.parent == null ? undefined : idByFile.get(String(c.parent).replace(/^\[\[(?:people\/)?|\]\]$/g, ''));
    const target: Fact | null =
      c.fact === 'birth' || c.fact === 'death' || c.fact === 'name' ? { fact: c.fact, person }
        : c.fact === 'event' && eventIds.has(String(c.event)) ? { fact: 'event', event: String(c.event) }
          : c.fact === 'partnership' && unionIds.has(String(c.partnership)) ? { fact: 'partnership', partnership: String(c.partnership) }
            : c.fact === 'parent' && parent && parentLinks.has(`${person}\n${parent}`) ? { fact: 'parent', child: person, parent }
              : null;
    if (!source || !target) {
      uncited++;
      continue;
    }
    citations.push({
      id: `${person}-cite-${i}`,
      source,
      target,
      page: text(c.page),
      quality: QUALITIES.has(c.quality) ? c.quality : undefined,
      transcription: text(c.text),
    });
  }
}

// Coordinates come from a local gazetteer next to the output (gitignored: it says where the family lived).
const gazetteer = join(dirname(out), `${familyId}-places.json`);
const places: SeedTree['places'] = existsSync(gazetteer) ? JSON.parse(readFileSync(gazetteer, 'utf8')) : [];

const tree: SeedTree = {
  id: familyId,
  name: `The ${familyName} family`,
  tagline: 'Imported from a Kindred archive',
  theme: 'modern',
  houses: [...houses.values()],
  people,
  parents,
  unions: [...unions.values()],
  stories: [],
  contacts: [],
  places,
  events,
  sources,
  citations,
  focus: (focusFile && idByFile.get(focusFile)) || people[0].id,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(tree, null, 2));
console.log(`${out}: ${people.length} people, ${parents.length} parent links, ${tree.unions.length} unions, ${houses.size} houses, ${events.length} events, ${sources.length} sources, ${citations.length} citations`);
if (uncited) console.warn(`${uncited} citation(s) named a source or a fact the archive does not hold and were left out`);
