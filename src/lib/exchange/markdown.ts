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
//
// Life events join a person's `events` list beside marriages, with their own type (`baptism`, `residence`, …), `label`,
// `date`, `end`, `place` and `note`. Sources are notes of their own in sources/, and a person's `citations` list each fact's
// sources there: `fact` (birth, death, name, event, partnership, parent), the event's or partnership's `id` or the
// `parent`, the `source` as a link, `page`, `quality` and `text`. A partnership's citations are on the note that declares it.
//
// Stories (memories, sayings, anecdotes, recipes, notes) are in memories/, one file per person they are about, oldest first,
// each with its comments under it (migration 0027): who wrote it, when, and the plain text, quoted. Reactions are not written.
// A recipe written with the recipe form (migration 0031, docs/recipes.md) is a story whose text is the whole recipe written
// out: what it serves and how long it takes, the ingredients as a list, the method numbered, the notes. Its tags follow, and
// a line says how many pictures it has; the pictures themselves are in media storage, which no archive holds.
//
// The family's feed (migration 0029, docs/feed.md) is in feed/, one file per year, oldest first: each post with who wrote it
// and when, its text quoted, the people it is about as links, how many pictures it had (the pictures are the gallery's,
// which no archive holds) and its comments. The v1 tools and import-kindred.ts leave feed/ alone.
import { allGiven } from '../further-given.ts';
import type { ExCitation, ExParent, ExPerson, ExPost, ExStory, ExTree, ExUnion } from './model.ts';

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
  if (tree.extras.stories && !tree.stories) losses.push(`${tree.extras.stories} ${tree.extras.stories === 1 ? 'story, memory or saying is' : 'stories, memories and sayings are'} not in the archive (biographies are)`);
  const photoComments = tree.extras.photoComments ?? 0;
  if (photoComments) losses.push(`${photoComments} ${photoComments === 1 ? 'comment on a gallery photo is' : 'comments on gallery photos are'} not in the archive (the gallery is not either)`);
  if (tree.extras.fields) losses.push(`${tree.extras.fields} ${tree.extras.fields === 1 ? 'contact detail or other field is' : 'contact details and other fields are'} not in the archive`);
  if (tree.extras.houses) losses.push(`${tree.extras.houses} ${tree.extras.houses === 1 ? 'house and its arms are' : 'houses and their arms are'} not in the archive`);
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const link = (id: string) => `[[people/${names.get(id)}]]`;
  const files: ArchiveFile[] = [];

  // Sources, one note each, and each citation on the note of the person whose fact it is.
  const sourceNames = new Map<string, string>();
  {
    const used = new Set<string>();
    for (const x of tree.sources ?? []) {
      const base = x.title.normalize('NFKD').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'source';
      let name = base;
      for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
      used.add(name);
      sourceNames.set(x.id, name);
    }
  }
  const eventOwner = new Map((tree.events ?? []).map((e) => [e.id, e.person]));
  const unionOwner = new Map(tree.unions.map((u) => [u.id, u.a < u.b ? u.a : u.b]));
  const citesOn = new Map<string, ExCitation[]>();
  for (const c of tree.citations ?? []) {
    const t = c.target;
    const owner = t.fact === 'event' ? eventOwner.get(t.event) : t.fact === 'partnership' ? unionOwner.get(t.partnership) : t.fact === 'parent' ? t.child : t.person;
    if (owner && byId.has(owner) && sourceNames.has(c.source)) citesOn.set(owner, [...(citesOn.get(owner) ?? []), c]);
  }
  const lifeEvents = new Map<string, NonNullable<ExTree['events']>>();
  for (const e of tree.events ?? []) lifeEvents.set(e.person, [...(lifeEvents.get(e.person) ?? []), e]);

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
    const life = lifeEvents.get(p.id) ?? [];
    if (events.length || life.length) {
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
      for (const e of life) {
        lines.push(`  - id: ${str(e.id)}`, `    type: ${str(e.type)}`);
        if (e.label) lines.push(`    label: ${str(e.label)}`);
        if (e.date) lines.push(`    date: ${str(v1Date(e.date)!)}`);
        if (e.endDate) lines.push(`    end: ${str(v1Date(e.endDate)!)}`);
        if (e.place) lines.push(`    place: ${str(e.place)}`);
        if (e.note) lines.push(`    note: ${str(e.note)}`);
      }
    }
    const cites = citesOn.get(p.id) ?? [];
    if (cites.length) {
      lines.push('citations:');
      for (const c of cites) {
        const t = c.target;
        lines.push(`  - fact: ${str(t.fact)}`);
        if (t.fact === 'event') lines.push(`    event: ${str(t.event)}`);
        if (t.fact === 'partnership') lines.push(`    partnership: ${str(t.partnership)}`);
        if (t.fact === 'parent') lines.push(`    parent: ${str(byId.has(t.parent) ? link(t.parent) : t.parent)}`);
        lines.push(`    source: ${str(`[[sources/${sourceNames.get(c.source)}]]`)}`);
        if (c.page) lines.push(`    page: ${str(c.page)}`);
        if (c.quality) lines.push(`    quality: ${str(c.quality)}`);
        if (c.transcription) lines.push(`    text: ${str(c.transcription)}`);
      }
    }
    lines.push('---');
    const body = p.bio ? `\n## Story\n\n${p.bio.trim()}\n` : '';
    files.push({ path: `people/${names.get(p.id)}.md`, data: `${lines.join('\n')}\n${body}` });
  }

  // Stories, one file per person they are about, beside the person's note.
  const storiesOf = new Map<string, ExStory[]>();
  for (const x of tree.stories ?? []) if (byId.has(x.person)) storiesOf.set(x.person, [...(storiesOf.get(x.person) ?? []), x]);
  for (const [id, list] of storiesOf) {
    const p = byId.get(id)!;
    files.push({ path: `memories/${names.get(id)}.md`, data: memoriesNote(p, list, link(id)) });
  }

  const postsOf = new Map<string, ExPost[]>();
  for (const x of tree.posts ?? []) postsOf.set(x.at.slice(0, 4), [...(postsOf.get(x.at.slice(0, 4)) ?? []), x]);
  for (const [year, list] of postsOf) files.push({ path: `feed/${year}.md`, data: feedNote(tree.name, year, list, (id) => (byId.has(id) ? link(id) : null)) });
  const recipePictures = (tree.stories ?? []).reduce((n, x) => n + (x.recipe?.pictures ?? 0), 0);
  if (recipePictures) losses.push(`${recipePictures} ${recipePictures === 1 ? 'recipe picture is' : 'recipe pictures are'} not in the archive; the recipes are, written out`);
  const postPictures = (tree.posts ?? []).reduce((n, x) => n + x.pictures, 0);
  if (postPictures) losses.push(`${postPictures} ${postPictures === 1 ? 'picture shared in the family’s feed is' : 'pictures shared in the family’s feed are'} not in the archive (the gallery is not either); the posts are`);

  for (const x of tree.sources ?? []) {
    const lines = ['---', `id: ${str(x.id)}`, 'type: source', `title: ${str(x.title)}`];
    if (x.author) lines.push(`author: ${str(x.author)}`);
    if (x.publication) lines.push(`publication: ${str(x.publication)}`);
    if (x.reference) lines.push(`reference: ${str(x.reference)}`);
    if (x.date) lines.push(`date: ${str(v1Date(x.date)!)}`);
    lines.push('---');
    files.push({ path: `sources/${sourceNames.get(x.id)}.md`, data: `${lines.join('\n')}\n${x.note ? `\n${x.note.trim()}\n` : ''}` });
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
      'once, on the note of the partner whose id sorts first. Life events are in each person\'s events; sources are in',
      'sources/, and each person\'s citations name the source and the fact it backs. Memories, sayings and recipes are in',
      'memories/, one file per person, each with the comments the family wrote under it. What the family wrote to each',
      'other in the feed is in feed/, one file per year.',
      '',
      ...(losses.length ? ['Not in this archive:', ...losses.map((l) => `- ${l}`), ''] : []),
    ].join('\n'),
  });
  return { files, losses };
}

/**
 * Plain text as Markdown that reads as the same text and nothing more: a post is written as text, never as markup
 * (docs/feed.md), so what Markdown would read as a link, a picture, HTML, emphasis or code is escaped with a backslash, and
 * so is a line's opening mark (a heading, a list, a quote). Ordinary words, punctuation and line breaks stay as they are.
 */
export function plainMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/[\\`*_[\]<>]/g, '\\$&')
        // An entity (&amp;, &#106;) would be read as its character; a lone "&" is left alone.
        .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
        // A line's opening mark: a heading, a list item (also "1." or "1)"), a setext underline.
        .replace(/^(\s*)([#+\-=])/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])/, '$1\\$2'))
    .join('\n');
}

/** A year of the family's feed, oldest first: each post with its writer, its text, who it is about, and its comments. */
export function feedNote(family: string, year: string, posts: ExPost[], personLink: (id: string) => string | null): string {
  const out: string[] = [`# ${family}: the feed, ${year}`, ''];
  for (const x of posts) {
    // The writer's name and every word they wrote are the reader's input: written as text, never as markup.
    out.push(`## ${x.at.slice(0, 10)}, ${x.author ? plainMarkdown(x.author.replace(/\s+/g, ' ')) : 'a former member'}${x.edited ? ' (changed)' : ''}`, '');
    if (x.body.trim()) out.push(quoted(plainMarkdown(x.body.trim())), '');
    const about = x.people.map(personLink).filter((l): l is string => !!l);
    const notes = [
      ...(about.length ? [`About ${about.join(', ')}.`] : []),
      ...(x.pictures ? [`With ${x.pictures} ${x.pictures === 1 ? 'picture' : 'pictures'}, kept in the gallery.`] : []),
    ];
    if (notes.length) out.push(`*${notes.join(' ')}*`, '');
    if (x.comments.length) {
      out.push('### Comments', '');
      for (const c of x.comments) out.push(`**${c.author ? plainMarkdown(c.author.replace(/\s+/g, ' ')) : 'A former member'}**, ${c.at.slice(0, 10)}${c.edited ? ' (changed)' : ''}:`, '', quoted(plainMarkdown(c.body)), '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

const STORY_KIND: Record<string, string> = { memory: 'Memory', quote: 'Saying', anecdote: 'Anecdote', recipe: 'Recipe', note: 'Note' };
/** A quoted block: every line of the text behind "> ", blank lines kept, so line breaks survive and nothing is read as a heading. */
const quoted = (text: string) => text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');

/** The stories about one person, oldest first, each with its comments. */
export function memoriesNote(p: ExPerson, stories: ExStory[], personLink: string): string {
  const name = [allGiven(p.given, p.furtherGiven), p.surname].filter(Boolean).join(' ');
  const out: string[] = [`# Memories of ${name}`, '', `About ${personLink}.`, ''];
  for (const x of stories) {
    const kind = STORY_KIND[x.kind] ?? 'Story';
    out.push(`## ${x.title ? x.title.replace(/\s+/g, ' ').trim() : kind}`, '');
    out.push(`*${kind}, written by ${x.author || 'someone'} on ${x.at.slice(0, 10)}${x.context ? `. ${x.context.replace(/\s+/g, ' ').trim()}` : ''}*`, '');
    out.push(x.kind === 'quote' ? quoted(x.body.trim()) : x.body.trim(), '');
    if (x.recipe) {
      // The tags are the family's words: written as text. The pictures stay in Kindred.
      const notes = [
        ...(x.recipe.tags.length ? [`Tags: ${x.recipe.tags.map((t) => plainMarkdown(t.replace(/\s+/g, ' '))).join(', ')}.`] : []),
        ...(x.recipe.pictures ? [`With ${x.recipe.pictures} ${x.recipe.pictures === 1 ? 'picture' : 'pictures'}, kept in Kindred.`] : []),
      ];
      if (notes.length) out.push(`*${notes.join(' ')}*`, '');
    }
    if (x.comments.length) {
      out.push('### Comments', '');
      for (const c of x.comments) {
        out.push(`**${c.author || 'A former member'}**, ${c.at.slice(0, 10)}${c.edited ? ' (changed)' : ''}:`, '', quoted(c.body), '');
      }
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}
