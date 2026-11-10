// The change history's shapes, shared by the server (history.server.ts) and the pages that show it. No server code here.

export const HISTORY_KINDS = [
  'person', 'field', 'link', 'partnership', 'event', 'source', 'citation', 'story', 'photo', 'album', 'tag', 'portrait',
  'house', 'place', 'research', 'family', 'import',
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];
export const HISTORY_ACTIONS = ['added', 'changed', 'removed'] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** The History page's kind filter: groups of kinds a reader thinks of as one. */
export const HISTORY_FILTERS = {
  people: ['person', 'field', 'link', 'partnership', 'portrait'],
  events: ['event'],
  sources: ['source', 'citation'],
  stories: ['story'],
  photos: ['photo', 'album', 'tag'],
  houses: ['house'],
  places: ['place'],
  research: ['research'],
  family: ['family', 'import'],
} as const satisfies Record<string, readonly HistoryKind[]>;
export type HistoryFilter = keyof typeof HISTORY_FILTERS;
export const HISTORY_FILTER_NAMES = Object.keys(HISTORY_FILTERS) as HistoryFilter[];

/** A value as history keeps it: text, a number, or nothing. */
export type HistoryValue = string | number | null;

/** One changed field of a row, as a reader may see it. */
export interface HistoryFieldChange {
  name: string;
  before: HistoryValue;
  after: HistoryValue;
  /** Its values are for editors only, and this reader is not one: both are null. */
  hidden?: true;
  /** A value was cut short to keep the row small. */
  truncated?: true;
  /** History keeps that it changed, not what to (a picture, the arms, a portrait's look). */
  opaque?: true;
}

/** One row of the history, as a reader may see it. */
export interface HistoryItem {
  id: number;
  at: string;
  /** The name shown when the change was made; empty for Kindred itself. */
  author: string;
  /** A stable key for the author within this family, for the filter. Never the account id. Null for Kindred itself. */
  authorKey: string | null;
  byMe: boolean;
  kind: HistoryKind;
  record: string;
  person: string | null;
  personName: string | null;
  label: string | null;
  action: HistoryAction;
  count: number;
  fields: HistoryFieldChange[];
  /** The fields this reader may put back to their earlier value (an editor, a person's own facts). */
  restorable: string[];
}

export interface HistoryPage {
  items: HistoryItem[];
  /** The cursor for the next page (pass as `before`), or null at the end. */
  next: number | null;
  /** Everyone who changed something this reader may see, for the filter. */
  authors: { key: string; name: string }[];
}

/** One line of "What's new": what one author did of one kind, counted. */
export interface WhatsNewLine {
  author: string;
  kind: HistoryKind;
  action: HistoryAction;
  count: number;
  /** The record's label when the line is about a single record. */
  label: string | null;
}

/** "What's new", grouped by the person it is about; `person` null is the family as a whole. */
export interface WhatsNewGroup { person: string | null; name: string | null; lines: WhatsNewLine[] }

/** A comment or reactions on something the reader wrote. */
export interface WhatsNewReply {
  kind: 'comment' | 'reaction';
  /** What was commented on: a story or a photo. */
  target: 'story' | 'media';
  /** Its id (a story's id or a photo's key). */
  id: string;
  /** Its title or caption, if it has one. */
  label: string | null;
  /** The person a story is about. */
  person: string | null;
  /** Who: the commenter's name, or for reactions the first one's. */
  author: string;
  count: number;
}

export interface WhatsNew {
  /** Where the news is counted from (ISO), so the component can say "since Tuesday". */
  since: string;
  /** Whether this is the reader's first visit (then the news covers the last two weeks). */
  first: boolean;
  groups: WhatsNewGroup[];
  replies: WhatsNewReply[];
  /** How many changes in all, before grouping. */
  total: number;
}

/** The person's own facts, which an editor may put back from a history row (person.server.ts restorePersonValue). */
export const RESTORABLE_FIELDS = [
  'given', 'further_given', 'surname', 'current_given', 'current_surname', 'nickname', 'sex', 'born', 'born_place', 'died', 'died_place',
  'living', 'title', 'epithet', 'occupation', 'bio',
] as const;
export type RestorableField = (typeof RESTORABLE_FIELDS)[number];
export const isRestorable = (name: string): name is RestorableField => (RESTORABLE_FIELDS as readonly string[]).includes(name);
