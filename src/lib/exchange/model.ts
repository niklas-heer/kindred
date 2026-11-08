// The exchange model: one family as plain data, read from a tree's database and written to or read from
// a GEDCOM or Markdown file. Pure: it imports nothing from storage at runtime, so the Node scripts, the
// Worker and the unit tests all share it. Dates are Kindred's partial dates ("1953", "1953-08",
// "1953-08-08"), with "~" in front of an approximate one.
import type { Key } from '../i18n/dictionary.ts';
import type { Vars } from '../i18n/types.ts';
import type { Db } from '../store/db.ts';

export type Sex = 'm' | 'f' | 'x';
export type ParentKind = 'biological' | 'adoptive' | 'foster' | 'step';
export type Confidence = 'certain' | 'probable' | 'disputed';
export type UnionKind = 'marriage' | 'partnership' | 'betrothal' | 'other';

export interface ExPerson {
  id: string;
  given: string;
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

export interface ExTree {
  id: string;
  name: string;
  people: ExPerson[];
  parents: ExParent[];
  unions: ExUnion[];
  /** What the tree holds beyond this model, counted for the loss report. */
  extras: { stories: number; fields: number; houses: number; places: number };
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
  const people = await d.all<PersonRow>(`SELECT p.id, p.given, p.surname, p.current_given, p.current_surname, p.sex, p.born, p.born_place,
      p.died, p.died_place, p.living, p.title, p.epithet, p.occupation, p.nickname, p.bio,
      ph.key AS portrait_key, ph.mime AS portrait_mime
    FROM person p LEFT JOIN photo ph ON ph.person = p.id ORDER BY p.id`);
  const parents = await d.all<{ child: string; parent: string; kind: ParentKind; confidence: Confidence }>(
    'SELECT child, parent, kind, confidence FROM parent ORDER BY child, parent',
  );
  const unions = await d.all<{ id: string; a: string; b: string; kind: UnionKind; start: string | null; end: string | null; end_reason: string | null; place: string | null }>(
    'SELECT id, a, b, kind, start, end, end_reason, place FROM partnership ORDER BY start, id',
  );
  const count = async (sql: string) => (await d.get<{ n: number }>(sql))?.n ?? 0;
  return {
    id: meta.id ?? '',
    name: meta.name ?? meta.id ?? '',
    people: people.map((r) => ({
      id: r.id,
      given: r.given,
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
    extras: {
      stories: await count('SELECT count(*) AS n FROM story'),
      fields: await count('SELECT count(*) AS n FROM person_field'),
      houses: await count('SELECT count(*) AS n FROM house'),
      places: await count('SELECT count(*) AS n FROM place'),
    },
  };
}
