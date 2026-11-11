// Reactions and comments on a memory, a gallery photo, a post or an event of the feed: the shapes the server and the
// browser share. Members only; a share-link guest gets none of it (docs/responses.md). Safe to import anywhere.

/**
 * What a reaction or a comment is on: a story (its id), a gallery photo (its media key), a post in the feed (its id), or
 * an event of the feed drawn from the change history or the calendar (its key, see `EVENT_TARGET`).
 */
export type TargetKind = 'story' | 'media' | 'post' | 'event';
export const TARGET_KINDS = ['story', 'media', 'post', 'event'] as const satisfies readonly TargetKind[];

/**
 * An event's key, as the feed gives it:
 *   updates:<day>|<author>   one member's changes to the family's records on one day (feed.server.ts)
 *   people:<day>|<author>    the people one member added on one day; <author> is a key, never an account id
 *   b:<person>:<year>        a birthday today; a new year is a new day to celebrate
 *   a:<partnership>:<year>   a wedding anniversary today
 */
export const EVENT_TARGET = /^(?:(?:updates|people):\d{4}-\d{2}-\d{2}\|[a-z0-9.-]{1,120}|[ba]:[^\s:|]{1,100}:\d{4})$/;

/**
 * A reaction is one emoji, like a chat's: a heart, a laugh, a candle for the one remembered. Stored as the emoji itself
 * (tree migration 0030 turned the five named reactions of before into theirs).
 */
export type ReactionKind = string;

/** The quick row under every entry, in its order. The rest are one press away, in the palette. */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👏', '🕯️'] as const;

/** The most different emoji one member may give one thing. */
export const MAX_REACTIONS = 12;

/** What the five named reactions of before became (tree migration 0030 does the same in the database). */
export const LEGACY_REACTIONS = { heart: '❤️', laugh: '😂', candle: '🕯️', thanks: '🙏', remember: '💭' } as const;

let rgi: RegExp | null | undefined;
/** `\p{RGI_Emoji}` needs the `v` flag; an engine without it gets null, and the server (which has it) decides. */
function rgiEmoji(): RegExp | null {
  if (rgi === undefined) {
    try {
      rgi = new RegExp('^\\p{RGI_Emoji}$', 'v');
    } catch {
      rgi = null;
    }
  }
  return rgi;
}

/**
 * The reaction a text stands for, or null: exactly one RGI emoji grapheme (a flag, a family, a skin tone are one), as it
 * is fully written. An emoji sent without its emoji presentation selector (U+FE0F, as some keyboards do: "❤" for "❤️")
 * is given it, so one emoji is always stored one way.
 */
export function reactionOf(text: unknown): ReactionKind | null {
  if (typeof text !== 'string' || !text || text.length > 40) return null;
  const s = text.normalize('NFC');
  const re = rgiEmoji();
  if (!re) return /^[^\s\p{L}\p{N}\p{P}]+$/u.test(s) ? s : null;
  if (re.test(s)) return s;
  const full = `${s}\uFE0F`;
  return re.test(full) ? full : null;
}

/** A target's emoji in the order they are shown: the quick row's first, in its order, then the others by how many gave them. */
export function reactionOrder(counts: Partial<Record<ReactionKind, number>>): ReactionKind[] {
  const quick = QUICK_REACTIONS as readonly string[];
  return Object.keys(counts)
    .filter((r) => (counts[r] ?? 0) > 0)
    .sort((a, b) => {
      const qa = quick.indexOf(a), qb = quick.indexOf(b);
      if (qa >= 0 || qb >= 0) return (qa < 0 ? 99 : qa) - (qb < 0 ? 99 : qb);
      return (counts[b] ?? 0) - (counts[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0);
    });
}

/** The most characters a comment may have. The database holds the same limit. */
export const MAX_COMMENT = 1000;

/** How a target is doing, for a Chronicle entry or a gallery tile: the counts, and what the reader gave. */
export interface ResponseSummary {
  /** How many gave each emoji, only those above zero. */
  reactions: Partial<Record<ReactionKind, number>>;
  /** The emoji the reader gave. */
  mine: ReactionKind[];
  comments: number;
}

/** Every target of the family that has a response, keyed `<kind>:<target>`. A target with none is not in it. */
export type ResponseCounts = Record<string, ResponseSummary>;

export const targetKey = (kind: TargetKind, target: string) => `${kind}:${target}`;
export const EMPTY_SUMMARY: ResponseSummary = { reactions: {}, mine: [], comments: 0 };

/** One comment as a member reads it. */
export interface CommentView {
  id: string;
  authorName: string;
  /** The person the author stands for in this family, when they say so: their portrait goes beside the comment. */
  person: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** The reader wrote it: they may change it and remove it. */
  mine: boolean;
  /** The reader may remove it (theirs, or an editor's or a steward's right). */
  removable: boolean;
}

/** A target's whole conversation: the comments oldest first, and who gave each reaction. */
export interface Thread {
  comments: CommentView[];
  /** The names of the members who gave each emoji, in the order they gave it. */
  reactors: Partial<Record<ReactionKind, string[]>>;
}

/** A comment as it is stored: trimmed, line endings made plain, and at most two blank lines in a row. Empty when nothing is left. */
export function cleanComment(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Control characters other than the line break and the tab do not belong in a comment.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}
