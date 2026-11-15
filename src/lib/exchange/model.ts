// The exchange model: one family as plain data, read from a tree's database and written to or read from
// a GEDCOM or Markdown file. Pure: it imports nothing from storage or the server at runtime, so the Node scripts, the
// Worker and the unit tests all share it. What needs the server's secret (a secret vote's struck guests) is passed in. Dates are Kindred's partial dates ("1953", "1953-08",
// "1953-08-08"), with "~" in front of an approximate one.
import { parseFurther } from '../further-given.ts';
import type { Key } from '../i18n/dictionary.ts';
import type { Vars } from '../i18n/types.ts';
import type { Db } from '../store/db.ts';
import { countVote } from '../votes/count.ts';
import type { VoteKind, VoteResult } from '../votes/types.ts';
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
  /**
   * Set for a recipe written with the recipe form (migration 0031, docs/recipes.md). Its `body` is already the whole recipe
   * written out; this adds its tags and how many pictures it has (the pictures are in media storage, which no export holds).
   */
  recipe?: { tags: string[]; pictures: number };
}

/**
 * A post in the family's feed (migration 0029, docs/feed.md) with its comments, oldest first. Only the Markdown archive
 * carries it. Its pictures are gallery pictures, which no export holds: `pictures` says how many it had.
 */
export interface ExPost {
  id: string;
  author: string;
  at: string;
  edited: string | null;
  body: string;
  /** The people from the tree it is about. */
  people: string[];
  pictures: number;
  comments: ExComment[];
}

/**
 * A family vote (tree migration 0037, docs/votes.md), for the Markdown archive only. `result` is set once the vote has closed
 * and counts the ballots a steward did not strike; `ballots` (who chose what, by option label) only for a closed open vote.
 * A secret vote keeps just its totals and `voters`, who voted; a vote still open carries neither result nor ballots.
 */
export interface ExVote {
  id: string;
  author: string;
  at: string;
  question: string;
  description: string;
  kind: VoteKind;
  secret: boolean;
  /** When it closes, or closed. */
  closes: string;
  closed: boolean;
  options: { id: string; label: string }[];
  voters: { name: string; guest: boolean; struck: boolean }[];
  result: VoteResult | null;
  ballots: { name: string; guest: boolean; choices: string[] }[] | null;
  /** A secret vote with struck guests whose ballots could not be found (no `voterKey` was given), so the totals count them. */
  strikesIgnored?: boolean;
  /** The family's comments on it, oldest first. */
  comments: ExComment[];
}

/** What a reader of the tree may be given: the server's `voterKey` (votes/voter-key.server.ts), only by callers that run on the server. */
export interface ReadOptions {
  voterKey?: (vote: string, secret: boolean, voterId: string) => Promise<string>;
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
  /** The posts of the family's feed and their comments, oldest first, for the Markdown archive. */
  posts?: ExPost[];
  /** The family's votes, oldest first, for the Markdown archive. */
  votes?: ExVote[];
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
export async function readTree(d: Db, opts: ReadOptions = {}): Promise<ExTree> {
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
  // What makes a story a structured recipe: its tags, and how many pictures it has.
  const recipes = await d.all<{ story: string; tags: string; pictures: number }>(
    'SELECT r.story, r.tags, (SELECT count(*) FROM recipe_image i WHERE i.story = r.story AND i.gone_at IS NULL) AS pictures FROM recipe r',
  );
  const recipeOf = new Map(recipes.map((r) => [r.story, { tags: tagList(r.tags), pictures: r.pictures }]));
  // The family's feed: every post with the people it is about, how many pictures it has, and its comments.
  const posts = await d.all<{ id: string; author_name: string; created_at: string; edited_at: string | null; body: string; pictures: number }>(
    'SELECT id, author_name, created_at, edited_at, body, (SELECT count(*) FROM post_media pm WHERE pm.post = post.id) AS pictures FROM post ORDER BY created_at, id',
  );
  const postPeople = await d.all<{ post: string; person: string }>('SELECT post, person FROM post_person ORDER BY post, rowid');
  const postComments = await d.all<{ target: string; author_name: string; created_at: string; edited_at: string | null; body: string }>(
    "SELECT target, author_name, created_at, edited_at, body FROM comment WHERE target_kind = 'post' ORDER BY created_at, id",
  );
  const peopleOf = new Map<string, string[]>();
  for (const r of postPeople) peopleOf.set(r.post, [...(peopleOf.get(r.post) ?? []), r.person]);
  const postCommentsOf = new Map<string, ExComment[]>();
  for (const c of postComments) postCommentsOf.set(c.target, [...(postCommentsOf.get(c.target) ?? []), { author: c.author_name, at: c.created_at, edited: c.edited_at, body: c.body }]);
  const votes = await readVotes(d, opts);
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
    stories: stories.map((r) => ({ ...r, title: or(r.title), context: or(r.context), comments: commentsOf.get(r.id) ?? [], ...(recipeOf.has(r.id) ? { recipe: recipeOf.get(r.id)! } : {}) })),
    posts: posts.map((r) => ({ id: r.id, author: r.author_name, at: r.created_at, edited: r.edited_at, body: r.body, people: peopleOf.get(r.id) ?? [], pictures: r.pictures, comments: postCommentsOf.get(r.id) ?? [] })),
    votes,
    extras: {
      stories: await count('SELECT count(*) AS n FROM story'),
      fields: await count("SELECT count(*) AS n FROM person_field WHERE visibility <> 'personal'"), // a personal item is its author's alone, even as a number
      houses: await count('SELECT count(*) AS n FROM house'),
      places: await count('SELECT count(*) AS n FROM place'),
      photoComments: await count("SELECT count(*) AS n FROM comment WHERE target_kind = 'media'"),
    },
  };
}

/**
 * The family's votes for the archive. A secret ballot is stored under an HMAC the server alone can compute: a struck guest's
 * is left out only when the caller gave `voterKey`; without it nothing is left out and the vote says so (`strikesIgnored`).
 */
async function readVotes(d: Db, read: ReadOptions): Promise<ExVote[]> {
  const rows = await d.all<{ id: string; author_name: string; created_at: string; question: string; description: string; kind: VoteKind; secret: number; closes_at: string; closed_at: string | null }>(
    'SELECT id, author_name, created_at, question, description, kind, secret, closes_at, closed_at FROM vote ORDER BY created_at, id',
  );
  if (!rows.length) return [];
  const options = await d.all<{ vote: string; id: string; label: string }>('SELECT vote, id, label FROM vote_option ORDER BY vote, ord');
  const voters = await d.all<{ vote: string; account: string | null; guest_key: string | null; name: string; struck: number }>('SELECT vote, account, guest_key, name, struck FROM vote_voter ORDER BY vote, name, id');
  const ballots = await d.all<{ vote: string; voter: string; choices: string }>('SELECT vote, voter, choices FROM ballot');
  const comments = await d.all<{ target: string; author_name: string; created_at: string; edited_at: string | null; body: string }>(
    "SELECT target, author_name, created_at, edited_at, body FROM comment WHERE target_kind = 'vote' ORDER BY created_at, id",
  );
  const now = new Date().toISOString();
  const out: ExVote[] = [];
  for (const v of rows) {
    const opts = options.filter((o) => o.vote === v.id);
    const label = (id: string) => opts.find((o) => o.id === id)?.label ?? '';
    const mine = voters.filter((x) => x.vote === v.id);
    const closed = !!v.closed_at || v.closes_at <= now;
    let result: VoteResult | null = null;
    let named: ExVote['ballots'] = null;
    let ignored = false;
    if (closed) {
      const own = ballots.filter((b) => b.vote === v.id);
      const hmac = read.voterKey;
      const key = async (x: (typeof mine)[number]) => {
        const id = (x.account ?? x.guest_key)!;
        return v.secret ? hmac!(v.id, true, id) : id;
      };
      ignored = !!v.secret && !hmac && mine.some((x) => x.struck);
      const struck = new Set(ignored ? [] : await Promise.all(mine.filter((x) => x.struck).map(key)));
      const counted = own.filter((b) => !struck.has(b.voter));
      result = countVote(v.kind, opts.map((o) => o.id), counted.map((b) => JSON.parse(b.choices) as string[]));
      if (!v.secret) {
        const byKey = new Map(mine.map((x) => [(x.account ?? x.guest_key)!, x]));
        named = counted.flatMap((b) => {
          const x = byKey.get(b.voter);
          return x ? [{ name: x.name, guest: !x.account, choices: (JSON.parse(b.choices) as string[]).map(label) }] : [];
        }).sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    out.push({
      id: v.id, author: v.author_name, at: v.created_at, question: v.question, description: v.description, kind: v.kind, secret: !!v.secret,
      closes: v.closed_at ?? v.closes_at, closed, options: opts.map((o) => ({ id: o.id, label: o.label })),
      voters: mine.map((x) => ({ name: x.name, guest: !x.account, struck: !!x.struck })), result, ballots: named, ...(ignored ? { strikesIgnored: true } : {}),
      comments: comments.filter((c) => c.target === v.id).map((c) => ({ author: c.author_name, at: c.created_at, edited: c.edited_at, body: c.body })),
    });
  }
  return out;
}

/** A recipe's tags from their JSON column: a list of words, or none when it is not one. */
function tagList(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
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
