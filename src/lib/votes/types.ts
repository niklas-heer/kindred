// Shared by the browser and the server: limits and result shapes for family votes. No server imports.
import type { ArmsJson } from '../arms-proposals/types.ts';
import type { FeedAuthor } from '../feed/types.ts';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 20;
export const MAX_QUESTION = 200;
export const MAX_DESCRIPTION = 1000;
export const MAX_OPTION = 120;
export const MAX_VOTES_AN_HOUR = 5;
export const DEFAULT_CLOSE_DAYS = 7;
export const MIN_CLOSE_MS = 3_600_000;
export const MAX_CLOSE_DAYS = 90;
export const MAX_GUEST_NAME = 60;
/** Guest voters per vote, per network. */
export const GUEST_VOTERS_PER_NETWORK = 12;
/** Guest voters per vote, per guest link. */
export const GUEST_VOTERS_PER_LINK = 40;

export type VoteKind = 'single' | 'ranked';

export type VoteResult =
  | { kind: 'single'; tallies: Record<string, number>; winners: string[]; ballots: number }
  | {
      kind: 'ranked';
      rounds: { tallies: Record<string, number>; out: string[]; exhausted: number }[];
      winners: string[];
      ballots: number;
    };

/**
 * A vote in the list, as this reader may see it. A guest's carries no author (`name` empty, no face). A house's arms vote's
 * `question` (and its Keep option's label, in `winners` and `options`) is in the reader's language. `closesAt` is when it
 * closes, or when it closed; `voterCount` counts the voters a steward has not struck; `voted` is the reader's own; `winners`
 * are option labels, only once it has closed (empty when nobody voted, more than one for a tie).
 */
export interface VoteSummary {
  id: string;
  question: string;
  kind: VoteKind;
  secret: boolean;
  guests: boolean;
  author: FeedAuthor;
  createdAt: string;
  closesAt: string;
  closed: boolean;
  voterCount: number;
  voted: boolean;
  winners: string[] | null;
}

/**
 * One vote, as this reader may see it:
 * - `mine` is the reader's own ballot (option ids), or null before they vote.
 * - `result` (by option id): once it has closed; while it is open, in an open vote to whoever has voted, in a secret one never.
 * - `ballots`, who chose what: only in an open vote, only to a member, only with the result; never a struck guest's.
 * - `voters`, who has voted, by name: members only (guests get null); `struck` only for a steward, and only a steward sees a
 *   struck guest at all.
 * - A guest reads no member's name or face, and no other guest's: `author` and every `addedBy` are empty for them.
 * - A house's arms vote's options carry their shield (`arms`: the proposal's, or for Keep the arms the vote started from);
 *   a guest gets only `{ id, label, arms }` of each, a member also `addedBy` (the proposer; empty for Keep).
 * - `may` is what the server would let this reader do now; all false for a guest.
 */
export interface VoteView extends VoteSummary {
  description: string;
  addOptions: boolean;
  options: { id: string; label: string; addedBy?: string; arms?: ArmsJson }[];
  mine: string[] | null;
  voters: { id: string; name: string; person: string | null; guest: boolean; struck?: boolean }[] | null;
  ballots: { name: string; person: string | null; guest: boolean; choices: string[] }[] | null;
  result: VoteResult | null;
  may: { edit: boolean; close: boolean; remove: boolean; addOption: boolean; strike: boolean };
}
