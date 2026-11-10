// The family feed's shapes, shared by the server (posts.server.ts, feed.server.ts) and the Today page (docs/feed.md).
// Members only: a share-link guest gets none of it. Safe to import anywhere.
import { cleanComment } from '../responses.ts';

/** The most characters a post may have. The database holds the same limit. */
export const MAX_POST = 4000;
/** The most pictures a post carries. */
export const MAX_POST_MEDIA = 6;
/** The most people from the tree a post may be about. */
export const MAX_POST_PEOPLE = 12;
/** The most posts one member may write in an hour. */
export const MAX_POSTS_AN_HOUR = 20;
/** How many entries a page of the feed holds. */
export const FEED_PAGE = 20;

/** A post's text as it is stored: trimmed, plain line endings, no control characters, at most two blank lines in a row. */
export const cleanPost = cleanComment;

/** A picture of a post or of a day's uploads: its gallery key and its size, for the tile's shape. */
export interface FeedPicture { key: string; width: number; height: number }

/** Who wrote something: the name they wrote it under, and the person they stand for in the tree, for the face. */
export interface FeedAuthor { name: string; person: string | null }

/** A post as a member reads it. */
export interface PostView {
  id: string;
  author: FeedAuthor;
  body: string;
  at: string;
  editedAt: string | null;
  pictures: FeedPicture[];
  /** The people from the tree it is about. */
  people: string[];
  /** The reader wrote it: they may change it. */
  mine: boolean;
  /** The reader may remove it (theirs, or an editor's or a steward's right). */
  removable: boolean;
}

/** One entry of the feed. `at` is when it happened (ISO); `key` is unique in the feed and orders entries of one instant. */
export type FeedItem = { at: string; key: string } & (
  | { type: 'post'; post: PostView }
  /** A memory, saying, recipe, note or anecdote from the Chronicle. `week` is set for an answer to the question of the week. */
  | { type: 'story'; id: string; person: string; kind: 'note' | 'quote' | 'anecdote' | 'recipe' | 'memory'; title: string | null; body: string; author: string; context: string | null; week: string | null }
  /** One member's uploads of one day to one album, as one entry. `more` says the count is a lower bound (a very large day). */
  | { type: 'photos'; by: FeedAuthor; album: { id: string; name: string } | null; count: number; more: boolean; pictures: FeedPicture[] }
  /** People one member added to the tree on one day. `born` is set for a newborn (born within a year of being added). */
  | { type: 'people'; by: string; people: { id: string; born: string | null }[]; count: number }
  /** A season of the Campaign ended. */
  | { type: 'season'; season: number; winner: string | null }
);

/** A page of the feed, newest first. `next` is the cursor for the page after it, or null at the end. */
export interface FeedPage { items: FeedItem[]; next: string | null }

/** Where a page starts: strictly after this entry in the feed's order (newest first, then by key). */
export interface FeedCursor { at: string; key: string }

export const encodeCursor = (c: FeedCursor) => `${c.at}~${c.key}`;
export function decodeCursor(s: string | null | undefined): FeedCursor | null {
  if (!s) return null;
  const i = s.indexOf('~');
  if (i < 10 || s.length > 300) return null;
  const at = s.slice(0, i);
  // A moment, or a day's edge: its start ("2026-11-03") or its end ("2026-11-03U"), where a page of grouped days ended.
  return /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?|U)?$/.test(at) ? { at, key: s.slice(i + 1) } : null;
}

/** Whether an entry comes after the cursor in the feed's order (so on a later page). */
export const afterCursor = (item: { at: string; key: string }, c: FeedCursor | null) => !c || item.at < c.at || (item.at === c.at && item.key < c.key);

/** The feed's order: newest first, and entries of one instant by key, so paging never repeats or skips one. */
export const feedOrder = (a: { at: string; key: string }, b: { at: string; key: string }) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
