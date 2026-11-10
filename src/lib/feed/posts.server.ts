// Posts on the server (tree migration 0029, docs/feed.md): a member's short message to the family, with a few pictures
// and the people from the tree it is about.
//
// Members only: every function here refuses a share-link guest itself, besides the server functions' own checks
// (feed.functions.ts).
//   (a member)   viewer       read posts, and react to them (responses.server.ts)
//   post         contributor  write a post, change your own, comment on any
//   remove-post  editor       remove anyone's post (everyone may remove their own, whatever their role now)
//
// What it promises:
// - A post is the family talking, not a record: it writes no change history (NOT_A_RECORD). Its pictures are gallery
//   pictures, uploaded through the gallery's own code before the post is made, so they have their history rows already;
//   removing a post removes its pictures, and that is in the history as any removed photo is.
// - A post keeps the name it was written under and the person its writer stood for, so it stays, signed, when the member
//   leaves (auth/members.server.ts).
// - Every change is a `once` plan whose guards restate what it read (db.server.ts), so a demo and a steward's preview
//   refuse it before anything happens.
import { fail } from '../auth/guard.server';
import { forbidden, notMember } from '../auth/errors';
import { accounts } from '../auth/store.server';
import { db, guard, media as mediaStore, NOT_A_RECORD, once, q, removed, type Db, type OpKey, type Query } from '../db.server';
import { can, type Role } from '../roles';
import { seedVoice } from './voice';
import { MAX_POST, MAX_POSTS_AN_HOUR, MAX_POST_MEDIA, MAX_POST_PEOPLE, cleanPost, type FeedAuthor, type FeedPicture, type PostView } from './types';

/** Who is asking: a member (their account id, the name they show, their role, the person they stand for), or a guest. */
export interface Who { id: string; name: string; role: Role; person?: string | null; guest?: boolean }

export function needsMember(who: Who) {
  if (who.guest || !who.id) throw fail(notMember());
}
function needs(who: Who, action: 'post' | 'remove-post') {
  needsMember(who);
  if (!can(who.role, action)) throw fail(forbidden(action, action === 'post' ? 'contributor' : 'editor'));
}

const marks = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');
const unique = (xs: readonly string[]) => [...new Set(xs)];
/** A membership's person, when it names one ("-" is "nobody in the tree"). */
const personOf = (p: string | null | undefined) => (p && p !== '-' ? p : null);

// ---------- reads ----------

export interface PostRow { id: string; account: string; author_name: string; author_person: string | null; body: string; created_at: string; edited_at: string | null }
interface PostMediaRow { post: string; key: string; width: number; height: number }
interface PostPersonRow { post: string; person: string }

/**
 * The reads that complete a set of posts: their pictures and their people. `sub` is an SQL query for the posts' ids (with
 * its parameters), so a page of the feed sends these beside its other reads, in one round trip.
 */
export const postParts = (sub: string, params: (string | number)[]): [Query, Query] => [
  q(`SELECT pm.post, pm.media AS key, m.width, m.height FROM post_media pm JOIN media m ON m.key = pm.media WHERE pm.post IN (${sub}) ORDER BY pm.post, pm.ord, pm.media`, ...params),
  q(`SELECT pp.post, pp.person FROM post_person pp WHERE pp.post IN (${sub}) ORDER BY pp.post, pp.rowid`, ...params),
];

/**
 * The person each of these accounts stands for in this family now, in one read of the accounts database. A member who
 * said who they are after writing has their face on what they wrote before.
 */
export async function standingFor(tree: string, ids: readonly string[]): Promise<Map<string, { name: string; person: string | null }>> {
  const real = unique(ids).filter((id) => id && !seedVoice(id));
  if (!real.length) return new Map();
  const rows = await accounts().all<{ id: string; name: string; person: string | null }>(
    `SELECT u.id, u.name, m.person FROM user u JOIN membership m ON m.user = u.id AND m.tree = ? WHERE u.id IN (SELECT value FROM json_each(?))`,
    tree, JSON.stringify(real),
  );
  return new Map(rows.map((r) => [r.id, { name: r.name, person: personOf(r.person) }]));
}

/** Who wrote a post, for the reader: the name it was written under, and the face of who they are now, or were then. */
export const authorOf = (row: Pick<PostRow, 'account' | 'author_name' | 'author_person'>, now: Map<string, { person: string | null }>): FeedAuthor => ({
  name: row.author_name,
  person: now.get(row.account)?.person ?? row.author_person ?? seedVoice(row.account),
});

/** Posts as this member reads them, from their rows and their parts. */
export function postViews(who: Who, rows: PostRow[], mediaRows: PostMediaRow[], personRows: PostPersonRow[], now: Map<string, { person: string | null }>): PostView[] {
  const pictures = new Map<string, FeedPicture[]>();
  for (const m of mediaRows) pictures.set(m.post, [...(pictures.get(m.post) ?? []), { key: m.key, width: m.width, height: m.height }]);
  const people = new Map<string, string[]>();
  for (const p of personRows) people.set(p.post, [...(people.get(p.post) ?? []), p.person]);
  const removeAny = can(who.role, 'remove-post');
  return rows.map((r): PostView => {
    const mine = r.account === who.id;
    return {
      id: r.id, author: authorOf(r, now), body: r.body, at: r.created_at, editedAt: r.edited_at,
      pictures: pictures.get(r.id) ?? [], people: people.get(r.id) ?? [], mine, removable: mine || removeAny,
    };
  });
}

const POST_COLUMNS = 'id, account, author_name, author_person, body, created_at, edited_at';

/** The posts about one person, newest first: their page shows them. */
export async function personPosts(tree: string, who: Who, person: string, limit = 20): Promise<PostView[]> {
  needsMember(who);
  const sub = 'SELECT p.id FROM post p JOIN post_person pp ON pp.post = p.id WHERE pp.person = ? ORDER BY p.created_at DESC, p.id DESC LIMIT ?';
  const params = [person, Math.min(Math.max(limit, 1), 50)];
  const [rows, mediaRows, personRows] = (await db(tree).readBatch([
    q(`SELECT ${POST_COLUMNS} FROM post WHERE id IN (${sub}) ORDER BY created_at DESC, id DESC`, ...params),
    ...postParts(sub, params),
  ])) as unknown as [PostRow[], PostMediaRow[], PostPersonRow[]];
  return postViews(who, rows, mediaRows, personRows, await standingFor(tree, rows.map((r) => r.account)));
}

/** One post, if it is there. */
export async function postView(tree: string, who: Who, id: string): Promise<PostView | null> {
  needsMember(who);
  const [rows, mediaRows, personRows] = (await db(tree).readBatch([
    q(`SELECT ${POST_COLUMNS} FROM post WHERE id = ?`, id),
    ...postParts('SELECT ?', [id]),
  ])) as unknown as [PostRow[], PostMediaRow[], PostPersonRow[]];
  return postViews(who, rows, mediaRows, personRows, await standingFor(tree, rows.map((r) => r.account)))[0] ?? null;
}

// ---------- changes ----------

export interface PostInput { body: string; media?: string[]; people?: string[] }

function bodyOf(text: string, pictures: number): string {
  const body = cleanPost(text);
  if (!body && !pictures) throw new Error('feed.err.empty');
  if (body.length > MAX_POST) throw new Error('feed.err.long');
  return body;
}

/** The people a post is about, checked: each is in the tree. Answers the guard that holds it. */
async function peopleOf(d: Db, ids: readonly string[]): Promise<{ people: string[]; guards: Query[] }> {
  const people = unique(ids);
  if (people.length > MAX_POST_PEOPLE) throw new Error('feed.err.people');
  if (!people.length) return { people, guards: [] };
  const found = await d.get<{ n: number }>(`SELECT count(*) AS n FROM person WHERE id IN (${marks(people)})`, ...people);
  if (found?.n !== people.length) throw new Error('feed.err.person_gone');
  return { people, guards: [guard(`(SELECT count(*) FROM person WHERE id IN (${marks(people)})) = ?`, ...people, people.length)] };
}

/**
 * Writes a post under the member's own name. Its pictures were uploaded to the gallery just before (photos.server.ts
 * `addPhoto`): each must be the writer's own upload and in no other post. Answers the post's id.
 */
export async function createPost(tree: string, who: Who, input: PostInput, op?: OpKey, now: Date = new Date()): Promise<{ id: string }> {
  needs(who, 'post');
  const keys = unique(input.media ?? []);
  if (keys.length > MAX_POST_MEDIA) throw new Error('feed.err.pictures');
  const body = bodyOf(input.body, keys.length);
  return once(tree, op, 'createPost', async (d) => {
    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
    const recent = await d.get<{ n: number }>('SELECT count(*) AS n FROM post WHERE account = ? AND created_at > ?', who.id, hourAgo);
    if ((recent?.n ?? 0) >= MAX_POSTS_AN_HOUR) throw new Error('feed.err.too_many');
    const { people, guards } = await peopleOf(d, input.people ?? []);
    if (keys.length) {
      const own = await d.get<{ n: number }>(
        `SELECT count(*) AS n FROM media WHERE key IN (${marks(keys)}) AND uploaded_by = ? AND key NOT IN (SELECT media FROM post_media)`, ...keys, who.id);
      if (own?.n !== keys.length) throw new Error('feed.err.picture_gone');
    }
    const author = personOf(who.person);
    const authorThere = author ? !!(await d.get('SELECT 1 AS x FROM person WHERE id = ?', author)) : false;
    const id = crypto.randomUUID();
    const at = now.toISOString();
    return {
      writes: [
        ...guards,
        ...(keys.length ? [guard(`(SELECT count(*) FROM media WHERE key IN (${marks(keys)}) AND uploaded_by = ? AND key NOT IN (SELECT media FROM post_media)) = ?`, ...keys, who.id, keys.length)] : []),
        q('INSERT INTO post (id, account, author_name, author_person, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, who.id, who.name, authorThere ? author : null, body, at),
        ...keys.map((key, i) => q('INSERT INTO post_media (post, media, ord) VALUES (?, ?, ?)', id, key, i)),
        ...people.map((person) => q('INSERT INTO post_person (post, person) VALUES (?, ?)', id, person)),
      ],
      history: NOT_A_RECORD,
      result: { id },
    };
  });
}

/** Changes the member's own post: its words and the people it is about. Nobody changes anyone else's, an editor included. */
export async function editPost(tree: string, who: Who, id: string, input: Pick<PostInput, 'body' | 'people'>, op?: OpKey, now: Date = new Date()): Promise<void> {
  needs(who, 'post');
  return once(tree, op, 'editPost', async (d) => {
    const row = await d.get<{ account: string; body: string; pictures: number }>('SELECT account, body, (SELECT count(*) FROM post_media WHERE post = post.id) AS pictures FROM post WHERE id = ?', id);
    if (!row) throw new Error('feed.err.post_gone');
    if (row.account !== who.id) throw fail(forbidden('post', 'contributor'));
    const body = bodyOf(input.body, row.pictures);
    const { people, guards } = input.people ? await peopleOf(d, input.people) : { people: null, guards: [] };
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM post WHERE id = ? AND account = ?)', id, who.id),
        ...guards,
        // The words changed, or only who it is about: "changed" is said for the words.
        ...(body === row.body ? [] : [q('UPDATE post SET body = ?, edited_at = ? WHERE id = ?', body, now.toISOString(), id)]),
        ...(people ? [q('DELETE FROM post_person WHERE post = ?', id), ...people.map((person) => q('INSERT INTO post_person (post, person) VALUES (?, ?)', id, person))] : []),
      ],
      history: NOT_A_RECORD,
      result: undefined,
    };
  });
}

/**
 * Removes a post: the member's own, whatever their role now, or anyone's for an editor or a steward. Its comments and
 * reactions go with it (a trigger), and so do its pictures: they leave the gallery and the storage, and the history
 * says so as for any removed photo.
 */
export async function removePost(tree: string, who: Who, id: string, op?: OpKey): Promise<{ removed: boolean }> {
  needsMember(who);
  return once<{ removed: boolean }>(tree, op, 'removePost', async (d) => {
    const row = await d.get<{ account: string }>('SELECT account FROM post WHERE id = ?', id);
    if (!row) return { writes: [], history: NOT_A_RECORD, result: { removed: false } };
    if (row.account !== who.id && !can(who.role, 'remove-post')) throw fail(forbidden('remove-post', 'editor'));
    const pictures = await d.all<{ key: string; thumb: string | null; caption: string | null }>(
      'SELECT m.key, m.thumb, m.caption FROM post_media pm JOIN media m ON m.key = pm.media WHERE pm.post = ?', id);
    return {
      writes: [
        // The pictures as read: one added meanwhile makes the plan decide again.
        guard('(SELECT count(*) FROM post_media WHERE post = ?) = ?', id, pictures.length),
        ...pictures.map((p) => q('DELETE FROM media WHERE key = ?', p.key)),
        q('DELETE FROM post WHERE id = ?', id),
      ],
      history: pictures.length ? pictures.map((p) => removed('photo', p.key, { label: p.caption })) : NOT_A_RECORD,
      result: { removed: true },
      after: async () => {
        for (const p of pictures) for (const k of [p.key, p.thumb]) if (k) await mediaStore.delete(tree, k).catch((e) => console.error('photos.err.delete_failed', k, e));
      },
    };
  });
}
