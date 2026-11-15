// What a suggestion is, as the browser and the server both read it. Browser-safe: type-only imports, no Node or Worker APIs.
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Pictures and PDFs. No HEIC: it keeps its location (GPS) metadata, which nothing here can take out; a phone's picker sends JPEG. */
export const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_NOTE = 1000;
export const MAX_REASON = 300;
export const GUEST_WAITING_PER_NETWORK = 20;
export const GUEST_WAITING_PER_LINK = 100;
export const MEMBER_WAITING = 50;
export const PENDING_BYTES = 200 * 1024 * 1024;
export const EXPIRY_DAYS = 90;
/** A source file's key as /api/source-file/<tree>/<key> takes it: its storage key (`source/<uuid>.<ext>`) without `source/`. */
export const SOURCE_FILE_KEY = /^[0-9a-f-]{36}\.(?:pdf|jpg|png|webp)$/;

export const SUGGESTION_KINDS = ['details', 'relative', 'event', 'source'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_STATUSES = ['waiting', 'approved', 'declined', 'expired', 'withdrawn'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/**
 * The facts of a person a suggestion may change, each to a value or to none (null). `surname` is the surname they go by now
 * (`current_surname`, else `surname`), `birthName` their surname at birth (`surname`).
 */
export type DetailsPayload = Partial<{
  given: string;
  surname: string | null;
  birthName: string | null;
  nickname: string | null;
  title: string | null;
  sex: 'm' | 'f' | 'x' | null;
  living: boolean;
  born: string | null;
  bornPlace: string | null;
  died: string | null;
  diedPlace: string | null;
}>;

/** A person to add, as the add-relative form writes one (the shape `addRelative` in src/lib/api.ts validates). */
export interface NewPerson {
  given: string;
  furtherGiven?: string[];
  surname?: string;
  sex?: 'm' | 'f' | 'x';
  born?: string;
  died?: string;
  living: boolean;
}

/** A relative the tree misses, and how they are linked to the person the suggestion is about. */
export interface RelativePayload {
  person: NewPerson;
  link: { kind: 'parent' | 'child' | 'partner' | 'sibling'; parentKind?: string; partnerKind?: string };
}

/**
 * A life event to add, or (with `event`, the event's id) to correct its date, place or note; or (with `partnership`, its id)
 * a correction of a partnership's kind, start and place. A correction may set a value to none (null).
 */
export interface EventPayload {
  event?: string;
  kind?: string;
  /** A new event's own name; a custom event needs one. */
  label?: string;
  date?: string | null;
  place?: string | null;
  note?: string;
  partnership?: string;
  partnershipKind?: string;
  start?: string | null;
  startPlace?: string | null;
}

/** A source to add, and optionally the fact it backs. */
export interface SourcePayload {
  title: string;
  author?: string;
  publication?: string;
  reference?: string;
  date?: string;
  note?: string;
  transcription?: string;
  backs?: { fact: string; event?: string };
}

export type SuggestionPayload = DetailsPayload | RelativePayload | EventPayload | SourcePayload;

/**
 * One suggestion as a reader sees it: a reviewer (any waiting one), or its suggester (their own). Nobody else reads one
 * (reads.server.ts).
 */
export interface SuggestionView {
  id: string;
  kind: SuggestionKind;
  person: string | null;
  payload: SuggestionPayload;
  /** For a reviewer: the values on record a correction was made against (`basis`), else null. */
  basis: Record<string, unknown> | null;
  /** For a reviewer: the record's values now of the fields a correction changes, for "current → suggested", else null. */
  current: Record<string, unknown> | null;
  note: string;
  status: SuggestionStatus;
  /** Approved with changes; null when that is not known (closed as partly applied, with no decision to tell). */
  adjusted: boolean | null;
  /** Approved only in part: an approval that could not finish, closed with what it had written. */
  partial: boolean;
  reason: string | null;
  author: { name: string; person: string | null; guest: boolean };
  createdAt: string;
  decidedAt: string | null;
  files: { id: string; name: string; mime: string; size: number }[];
  mine: boolean;
  /** What this reader may do now; `close` is closing a begun approval as partly applied (a reviewer's). */
  may: { withdraw: boolean; approve: boolean; decline: boolean; close: boolean };
}
