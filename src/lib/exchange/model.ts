// The exchange model: one family as plain data, read from a tree's database and written to or read from
// a GEDCOM or Markdown file. Pure: it imports nothing from storage at runtime, so the Node scripts, the
// Worker and the unit tests all share it. Dates are Kindred's partial dates ("1953", "1953-08",
// "1953-08-08"), with "~" in front of an approximate one.
import { parseFurther } from '../further-given.ts';
import type { Key } from '../i18n/dictionary.ts';
import type { Vars } from '../i18n/types.ts';
import type { Db } from '../store/db.ts';
import type { EventType, Fact, Quality } from '../events.ts';

export type Sex = 'm' | 'f' | 'x';
export type ParentKind = 'biological' | 'adoptive' | 'foster' | 'step';
export type Confidence = 'certain' | 'probable' | 'disputed';
export type UnionKind = 'marriage' | 'partnership' | 'betrothal' | 'other';

export interface ExPerson {
  id: string;
  given: string;
  /** Further given names in order after `given` (second name, third name, ...). */
  furtherGiven: string[];
  surname: string | null;
  /** The name the person goes by now, when it differs from the birth name. */
  currentGiven: string | null;
  currentSurname: string | null;
  sex: Sex | null;
  born: string | null;
  bornPlace: string | null;
  died: string | null;
  diedPlace: string | null;
  living: boolean;
  title: string | null;
  epithet: string | null;
  occupation: string | null;
  nickname: string | null;
  /** The biography (Markdown in the archive, a NOTE in GEDCOM). */
  bio: string | null;
  /** The portrait's media key and MIME type, when there is one. Pictures are not part of the text formats. */
  portrait: { key: string; mime: string } | null;
}

export interface ExParent {
  child: string;
  parent: string;
  kind: ParentKind;
  confidence: Confidence;
}

export interface ExUnion {
  id: string;
  a: string;
  b: string;
  kind: UnionKind;
  start: string | null;
  end: string | null;
  endReason: string | null;
  place: string | null;
}

/** A life event (migration 0024). */
export interface ExEvent {
  id: string;
  person: string;
  type: EventType;
  label: string | null;
  date: string | null;
  endDate: string | null;
  place: string | null;
  note: string;
  ord: number;
}

/** A source of the family's register. `document` and `media` link it to research and the gallery, which only this family has. */
export interface ExSource {
  id: string;
  title: string;
  author: string | null;
  publication: string | null;
  reference: string | null;
  date: string | null;
  note: string;
  document: string | null;
  media: string | null;
}

/** One source cited for one fact. */
export interface ExCitation {
  id: string;
  source: string;
  target: Fact;
  page: string | null;
  quality: Quality | null;
  transcription: string;
}

/** A comment on a story (migration 0027): plain text, with the name its writer showed. Only the Markdown archive carries it. */
export interface ExComment {
  author: string;
  at: string;
  edited: string | null;
  body: string;
}

/** A memory, saying, anecdote, recipe or note, with its comments, oldest first. GEDCOM leaves it out; the Markdown archive has it. */
export interface ExStory {
  id: string;
  person: string;
  kind: string;
  title: string | null;
  body: string;
  author: string;
  at: string;
  context: string | null;
  comments: ExComment[];
}

export interface ExTree {
  id: string;
  name: string;
  people: ExPerson[];
  parents: ExParent[];
  unions: ExUnion[];
  /** Life events, sources and citations (migration 0024). Absent in a tree made before them, as empty. */
  events?: ExEvent[];
  sources?: ExSource[];
  citations?: ExCitation[];
  /** The stories and their comments, for the Markdown archive. Absent in a tree built without them (a GEDCOM's). */
  stories?: ExStory[];
  /**
   * What the tree holds beyond this model, counted for the loss report. `photoComments` (migration 0027) are the comments
   * on gallery photos, which no export carries, as the photos themselves are not in one.
   */
  extras: { stories: number; fields: number; houses: number; places: number; photoComments?: number };
}

/** A translation key for something a reader is told about in the import preview (`exchange.issue.*`). */
export type IssueCode = Extract<Key, `exchange.issue.${string}`>;

/**
 * Something a reader should know about a file or an export: a skipped tag, a guess, a conflict. `message` is the
 * English text, which the CLI and the tests read. The app says `code` with `vars` in the reader's language.
 */
export interface Issue {
  level: 'skipped' | 'warning' | 'loss';
  message: string;
  code: IssueCode;
  vars: Vars;
}

interface PersonRow {
  id: string;
  given: string;
  further_given: string | null;
  surname: string | null;
  current_given: string | null;
  current_surname: string | null;
  sex: Sex | null;
  born: string | null;
  born_place: string | null;
  died: string | null;
  died_place: string | null;
  living: number;
  title: string | null;
  epithet: string | null;
  occupation: string | null;
  nickname: string | null;
  bio: string | null;
  portrait_key: string | null;
  portrait_mime: string | null;
}

const or = <T>(v: T | null | undefined): T | null => (v === undefined || v === null ? null : v);

/** A family's whole exchangeable record, read through the same `Db` the app uses. */
export async function readTree(d: Db): Promise<ExTree> {
  const meta = Object.fromEntries((await d.all<{ key: string; value: string }>('SELECT key, value FROM meta')).map((r) => [r.key, r.value]));
  const people = await d.all<PersonRow>(`SELECT p.id, p.given, p.further_given, p.surname, p.current_given, p.current_surname, p.sex, p.born, p.born_place,
      p.died, p.died_place, p.living, p.title, p.epithet, p.occupation, p.nickname, p.bio,
      ph.key AS portrait_key, ph.mime AS portrait_mime
    FROM person p LEFT JOIN photo ph ON ph.person = p.id ORDER BY p.id`);
  const parents = await d.all<{ child: string; parent: string; kind: ParentKind; confidence: Confidence }>(
    'SELECT child, parent, kind, confidence FROM parent ORDER BY child, parent',
  );
  const unions = await d.all<{ id: string; a: string; b: string; kind: UnionKind; start: string | null; end: string | null; end_reason: string | null; place: string | null }>(
    'SELECT id, a, b, kind, start, end, end_reason, place FROM partnership ORDER BY start, id',
  );
  const events = await d.all<{ id: string; person: string; type: EventType; label: string | null; date: string | null; end_date: string | null; place: string | null; note: string; ord: number }>(
    'SELECT id, person, type, label, date, end_date, place, note, ord FROM life_event ORDER BY person, ord, id',
  );
  const sources = await d.all<ExSource>('SELECT id, title, author, publication, reference, date, note, document, media FROM source ORDER BY title, id');
  const citations = await d.all<{ id: string; source: string; fact: Fact['fact']; person: string | null; parent: string | null; event: string | null; partnership: string | null; page: string | null; quality: Quality | null; transcription: string }>(
    'SELECT id, source, fact, person, parent, event, partnership, page, quality, transcription FROM citation ORDER BY created_at, id',
  );
  const stories = await d.all<{ id: string; person: string; kind: string; title: string | null; body: string; author: string; at: string; context: string | null }>(
    'SELECT id, person, kind, title, body, author, at, context FROM story ORDER BY person, at, id',
  );
  const comments = await d.all<{ target: string; author_name: string; created_at: string; edited_at: string | null; body: string }>(
    "SELECT target, author_name, created_at, edited_at, body FROM comment WHERE target_kind = 'story' ORDER BY created_at, id",
  );
  const commentsOf = new Map<string, ExComment[]>();
  for (const c of comments) commentsOf.set(c.target, [...(commentsOf.get(c.target) ?? []), { author: c.author_name, at: c.created_at, edited: c.edited_at, body: c.body }]);
  const count = async (sql: string) => (await d.get<{ n: number }>(sql))?.n ?? 0;
  return {
    id: meta.id ?? '',
    name: meta.name ?? meta.id ?? '',
    people: people.map((r) => ({
      id: r.id,
      given: r.given,
      furtherGiven: parseFurther(r.further_given),
      surname: or(r.surname),
      currentGiven: or(r.current_given),
      currentSurname: or(r.current_surname),
      sex: or(r.sex),
      born: or(r.born),
      bornPlace: or(r.born_place),
      died: or(r.died),
      diedPlace: or(r.died_place),
      living: r.living === 1,
      title: or(r.title),
      epithet: or(r.epithet),
      occupation: or(r.occupation),
      nickname: or(r.nickname),
      bio: or(r.bio),
      portrait: r.portrait_key && r.portrait_mime ? { key: r.portrait_key, mime: r.portrait_mime } : null,
    })),
    parents: parents.map((r) => ({ child: r.child, parent: r.parent, kind: r.kind, confidence: r.confidence })),
    unions: unions.map((r) => ({ id: r.id, a: r.a, b: r.b, kind: r.kind, start: or(r.start), end: or(r.end), endReason: or(r.end_reason), place: or(r.place) })),
    events: events.map((r) => ({ id: r.id, person: r.person, type: r.type, label: or(r.label), date: or(r.date), endDate: or(r.end_date), place: or(r.place), note: r.note, ord: r.ord })),
    sources: sources.map((r) => ({ ...r, author: or(r.author), publication: or(r.publication), reference: or(r.reference), date: or(r.date), document: or(r.document), media: or(r.media) })),
    citations: citations.map((r) => ({ id: r.id, source: r.source, target: citationTarget(r), page: or(r.page), quality: or(r.quality), transcription: r.transcription })),
    stories: stories.map((r) => ({ ...r, title: or(r.title), context: or(r.context), comments: commentsOf.get(r.id) ?? [] })),
    extras: {
      stories: await count('SELECT count(*) AS n FROM story'),
      fields: await count("SELECT count(*) AS n FROM person_field WHERE visibility <> 'personal'"), // a personal item is its author's alone, even as a number
      houses: await count('SELECT count(*) AS n FROM house'),
      places: await count('SELECT count(*) AS n FROM place'),
      photoComments: await count("SELECT count(*) AS n FROM comment WHERE target_kind = 'media'"),
    },
  };
}

/** The fact a citation row names (see migration 0024). */
export function citationTarget(r: { fact: Fact['fact']; person: string | null; parent: string | null; event: string | null; partnership: string | null }): Fact {
  switch (r.fact) {
    case 'event': return { fact: 'event', event: r.event! };
    case 'partnership': return { fact: 'partnership', partnership: r.partnership! };
    case 'parent': return { fact: 'parent', child: r.person!, parent: r.parent! };
    default: return { fact: r.fact, person: r.person! };
  }
}
