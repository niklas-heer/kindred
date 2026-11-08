// Converts a Kindred Markdown archive into a SeedTree JSON file.
//   node scripts/import-kindred.ts <archive folder> data/seed/<family id>.json
// The output holds living people's data: data/seed/*.json is gitignored.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse } from 'yaml';
import type { SeedHouse, SeedPerson, SeedTree, Tincture } from '../src/lib/seed-format.ts';

const [archive, out] = process.argv.slice(2);
if (!archive || !out) {
  console.error('usage: node scripts/import-kindred.ts <archive folder> data/seed/<family id>.json');
  process.exit(1);
}
const familyId = basename(out, '.json');
const familyName = familyId.charAt(0).toUpperCase() + familyId.slice(1);
const dir = join(archive, 'people');

type Note = Record<string, any> & { body: string; file: string };
const notes: Note[] = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const text = readFileSync(join(dir, f), 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) throw new Error(`no front matter in ${f}`);
    return { ...parse(m[1]), body: m[2].trim(), file: basename(f, '.md') };
  });

// Kindred links name files ("[[people/klaus-heer]]"); the app uses the note's id.
const idByFile = new Map(notes.map((n) => [n.file, String(n.id)]));
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
  focus: idByFile.get('niklas-heer') ?? people[0].id,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(tree, null, 2));
console.log(`${out}: ${people.length} people, ${parents.length} parent links, ${tree.unions.length} unions, ${houses.size} houses`);
