// Shared by the browser and the server: limits and result shapes for family votes. No server imports.

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
