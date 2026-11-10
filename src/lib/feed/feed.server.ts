// The family feed on the server (docs/feed.md): one stream, newest first, of what people in the family did. Members
// only; a share-link guest is refused here as well as by the server function.
//
// What a page mixes:
//   post     a member's message to the family (posts.server.ts)
//   story    a memory, saying, recipe, note or anecdote from the Chronicle; an answer to the question of the week says so
//   photos   one member's uploads of one day to one album, as one entry (a post's own pictures are the post's)
//   people   the people one member added to the tree on one day, from the change history; a newborn is said as one
//   season   a season of the Campaign that ended
//
// How it stays cheap. A page is one batch of reads in the family's database (`readBatch`: one round trip on D1), each
// read bounded by a LIMIT, plus one read of the accounts database for the writers' faces. No read per entry. Each source
// hands over its newest entries after the cursor; the page is the newest FEED_PAGE of them together. A source that
// groups rows (photos by day, people by day) reads a window of rows: when the window was full it says how far down it
// looked (its floor), and the page ends there, so nothing a later page would bring is skipped.
import { db, q, type Query } from '../db.server';
import { needsMember, postParts, postViews, standingFor, type PostRow, type Who } from './posts.server';
import { afterCursor, decodeCursor, encodeCursor, feedOrder, FEED_PAGE, type FeedAuthor, type FeedCursor, type FeedItem, type FeedPage, type FeedPicture } from './types';
import { seedVoice } from './voice';

/** The rows a grouping source reads at most. */
const PHOTO_WINDOW = 400;
const PEOPLE_WINDOW = 120;
/** The pictures a day's uploads show. */
const PHOTO_PREVIEWS = 4;
/** The names a "people added" entry carries. */
const PEOPLE_NAMED = 6;
/** The ended seasons a page looks at: a season lasts weeks, so one page never holds more. */
const SEASONS = 4;
/** A person added within this long of being born is a newborn. */
const NEWBORN_DAYS = 366;

interface StoryRow { id: string; person: string; kind: 'note' | 'quote' | 'anecdote' | 'recipe' | 'memory'; title: string | null; body: string; author: string; at: string; context: string | null; week: string | null }
interface MediaRow { key: string; width: number; height: number; album: string | null; album_name: string | null; uploaded_by: string; uploaded_at: string }
interface AddedRow { at: string; account: string | null; name: string; person: string; born: string | null }
interface SeasonRow { season: number; ended: string; winner: string | null }

/** What a source found: its entries, and how far down it looked when it could not look at everything (else null). */
interface Found { items: FeedItem[]; floor: string | null }

const day = (at: string) => at.slice(0, 10);
/** A cursor's key that every entry's key sorts before: the page after a floor takes everything of the floor's instant. */
const FLOOR_KEY = '~';
/**
 * A grouping source reads from the end of the cursor's day, so that a group which straddles the cursor is seen whole
 * (and then dropped, as an earlier page had it). A cursor that is a floor (a bare day) is already a day's edge.
 */
const upperOf = (c: FeedCursor | null) => (!c ? '9999' : c.at.length === 10 ? c.at : `${day(c.at)}U`);

/**
 * Cuts a full window's oldest day off (it may go on beyond the window) and says where the window's view ends. `partial`:
 * one day alone filled the window, so its groups are shown as far as they were read.
 */
function windowed<R>(rows: R[], limit: number, at: (r: R) => string): { rows: R[]; floor: string | null; partial: boolean } {
  if (rows.length < limit) return { rows, floor: null, partial: false };
  const last = day(at(rows[rows.length - 1]!));
  const whole = rows.filter((r) => day(at(r)) > last);
  // One day alone fills the window: the next page starts below that day.
  if (!whole.length) return { rows, floor: last, partial: true };
  // Everything from the day after the cut one is whole: the next page starts with the cut day ("U" sorts after its "T…").
  return { rows: whole, floor: `${last}U`, partial: false };
}

function photoEntries(rows: MediaRow[], partial: boolean, names: Map<string, FeedAuthor>): FeedItem[] {
  const groups = new Map<string, MediaRow[]>();
  for (const r of rows) {
    const k = `${day(r.uploaded_at)}|${r.album ?? ''}|${r.uploaded_by}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()].map(([k, g]): FeedItem => ({
    type: 'photos', at: g[0]!.uploaded_at, key: `photos:${k}`,
    by: names.get(g[0]!.uploaded_by) ?? { name: '', person: seedVoice(g[0]!.uploaded_by) },
    album: g[0]!.album && g[0]!.album_name !== null ? { id: g[0]!.album, name: g[0]!.album_name } : null,
    count: g.length,
    more: partial,
    pictures: g.slice(0, PHOTO_PREVIEWS).map((m): FeedPicture => ({ key: m.key, width: m.width, height: m.height })),
  }));
}

function peopleEntries(rows: AddedRow[]): FeedItem[] {
  const groups = new Map<string, AddedRow[]>();
  for (const r of rows) {
    // By account, and by name only for rows that have none (Kindred itself, a script).
    const k = `${day(r.at)}|${r.account ?? `-${[...r.name].map((ch) => ch.codePointAt(0)!.toString(36)).join('.')}`}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const newborn = (r: AddedRow) => !!r.born && /^\d{4}-\d{2}-\d{2}$/.test(r.born) && Date.parse(r.at) - Date.parse(`${r.born}T00:00:00Z`) < NEWBORN_DAYS * 86_400_000 && r.born <= day(r.at);
  return [...groups.entries()].map(([k, g]): FeedItem => {
    // One person is named once, however often they were added and removed on the day.
    const seen = new Set<string>();
    const people = g.filter((r) => !seen.has(r.person) && !!seen.add(r.person));
    return {
      type: 'people', at: g[0]!.at, key: `people:${k}`, by: g[0]!.name, count: people.length,
      people: people.slice(0, PEOPLE_NAMED).map((r) => ({ id: r.person, born: newborn(r) ? r.born : null })),
    };
  });
}

/**
 * One page of the feed for a member, after `cursor` (a page's `next`), newest first. The same for every member: what a
 * viewer may not read (private research, editors' notes) is in none of its sources.
 */
export async function feedPage(tree: string, who: Who, cursor?: string | null, limit: number = FEED_PAGE): Promise<FeedPage> {
  needsMember(who);
  const n = Math.min(Math.max(limit, 1), 50);
  const c = decodeCursor(cursor);
  // A row source takes n + 1 after the cursor: one more than a page, so the page knows whether anything follows.
  const after = (at: string, key: string) => (c ? ` AND (${at} < ? OR (${at} = ? AND ${key} < ?))` : '');
  const afterParams = c ? [c.at, c.at, c.key] : [];
  const upper = upperOf(c);
  const postIds = `SELECT id FROM post WHERE 1 = 1${after('created_at', "('post:' || id)")} ORDER BY created_at DESC, id DESC LIMIT ?`;
  const postParams = [...afterParams, n + 1];
  const reads: Query[] = [
    q(`SELECT id, account, author_name, author_person, body, created_at, edited_at FROM post WHERE id IN (${postIds}) ORDER BY created_at DESC, id DESC`, ...postParams),
    ...postParts(postIds, postParams),
    q(`SELECT s.id, s.person, s.kind, s.title, s.body, s.author, s.at, s.context, a.week FROM story s LEFT JOIN today_answer a ON a.story = s.id
       WHERE 1 = 1${after('s.at', "('story:' || s.id)")} ORDER BY s.at DESC, s.id DESC LIMIT ?`, ...afterParams, n + 1),
    q(`SELECT m.key, m.width, m.height, m.album, al.name AS album_name, m.uploaded_by, m.uploaded_at FROM media m LEFT JOIN album al ON al.id = m.album
       WHERE m.uploaded_at < ? AND m.key NOT IN (SELECT media FROM post_media) ORDER BY m.uploaded_at DESC, m.key LIMIT ?`, upper, PHOTO_WINDOW),
    q(`SELECT h.at, h.account, h.name, h.person, p.born FROM history h JOIN person p ON p.id = h.person
       WHERE h.kind = 'person' AND h.action = 'added' AND h.level = 'family' AND h.at < ? ORDER BY h.at DESC, h.id DESC LIMIT ?`, upper, PEOPLE_WINDOW),
    q(`SELECT season, ended, json_extract(result, '$.winner.name') AS winner FROM campaign_season
       WHERE ended IS NOT NULL${after('ended', "('season:' || season)")} ORDER BY ended DESC LIMIT ?`, ...afterParams, SEASONS),
  ];
  const [postRows, postMedia, postPeople, storyRows, mediaRows, addedRows, seasonRows] = (await db(tree).readBatch(reads)) as unknown as [
    PostRow[], Parameters<typeof postViews>[2], Parameters<typeof postViews>[3], StoryRow[], MediaRow[], AddedRow[], SeasonRow[],
  ];

  // The one read of the accounts database: who the writers and the uploaders are in the tree now.
  const standing = await standingFor(tree, [...postRows.map((r) => r.account), ...mediaRows.map((r) => r.uploaded_by)]);
  const names = new Map<string, FeedAuthor>([...standing].map(([id, m]) => [id, { name: m.name, person: m.person }]));

  const photos = windowed(mediaRows, PHOTO_WINDOW, (r) => r.uploaded_at);
  const added = windowed(addedRows, PEOPLE_WINDOW, (r) => r.at);
  const sources: Found[] = [
    { items: postViews(who, postRows, postMedia, postPeople, standing).map((post): FeedItem => ({ type: 'post', at: post.at, key: `post:${post.id}`, post })), floor: postRows.length > n ? postRows[n]!.created_at : null },
    {
      items: storyRows.map((s): FeedItem => ({ type: 'story', at: s.at, key: `story:${s.id}`, id: s.id, person: s.person, kind: s.kind, title: s.title, body: s.body, author: s.author, context: s.context, week: s.week })),
      floor: storyRows.length > n ? storyRows[n]!.at : null,
    },
    { items: photoEntries(photos.rows, photos.partial, names), floor: photos.floor },
    { items: peopleEntries(added.rows), floor: added.floor },
    { items: seasonRows.map((s): FeedItem => ({ type: 'season', at: s.ended, key: `season:${s.season}`, season: s.season, winner: s.winner })), floor: seasonRows.length >= SEASONS ? seasonRows[SEASONS - 1]!.ended : null },
  ];

  // A source that hit its limit has looked no further down than its floor (a row source's is its last row), so only what
  // is above the highest floor is certain to be complete, and the page ends there.
  const floor = sources.reduce<string | null>((top, s) => (s.floor !== null && (top === null || s.floor > top) ? s.floor : top), null);
  const all = sources.flatMap((s) => s.items).filter((i) => afterCursor(i, c)).sort(feedOrder);
  const safe = floor === null ? all : all.filter((i) => i.at > floor);
  const items = safe.slice(0, n);
  // The next page starts after the last entry shown; a page that ends at a floor starts there, with everything of that instant.
  const last = items[items.length - 1];
  const next = safe.length > n ? encodeCursor({ at: last!.at, key: last!.key }) : floor !== null ? encodeCursor({ at: floor, key: FLOOR_KEY }) : null;
  return { items, next };
}
