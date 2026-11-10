// Reactions and comments on a memory, a gallery photo or a post: the shapes the server and the browser share. Members
// only; a share-link guest gets none of it (docs/responses.md). Safe to import anywhere.

/** What a reaction or a comment is on: a story (its id), a gallery photo (its media key) or a post in the feed (its id). */
export type TargetKind = 'story' | 'media' | 'post';
export const TARGET_KINDS = ['story', 'media', 'post'] as const satisfies readonly TargetKind[];

/**
 * The reactions, a small set that means something in a family: a heart, "I remember this", a laugh, a candle for the
 * one remembered, and a thank-you to whoever shared it. The order is the order they are shown in.
 */
export const REACTIONS = ['heart', 'remember', 'laugh', 'candle', 'thanks'] as const;
export type ReactionKind = (typeof REACTIONS)[number];

/** The most characters a comment may have. The database holds the same limit. */
export const MAX_COMMENT = 1000;

/** How a target is doing, for a Chronicle entry or a gallery tile: the counts, and what the reader gave. */
export interface ResponseSummary {
  /** How many of each reaction, only those above zero. */
  reactions: Partial<Record<ReactionKind, number>>;
  /** The reader's own reactions. */
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
  /** The names of the members who gave each reaction, in the order they gave it. */
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
