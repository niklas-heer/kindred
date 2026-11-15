// Shared by the browser and the server: limits and shapes for arms proposals. No server imports.
import type { FeedAuthor } from '../feed/types.ts';
import type { House } from '../types.ts';

/** The house's stored arms, as `house.arms` keeps them. */
export type ArmsJson = House['arms'];

export const MAX_PROPOSAL_NAME = 60;
export const MAX_PROPOSAL_NOTE = 500;
export const MAX_DECLINE_REASON = 300;
/** Open (waiting or voting) proposals one member may have for one house. */
export const MAX_OPEN_PER_MEMBER = 3;
/** Proposals in one arms vote; the vote's "keep" option makes the twentieth. */
export const MAX_PROPOSALS_PER_VOTE = 19;
export const ARMS_VOTE_DAYS = 7;

/** What happens to a new proposal: a steward decides, a vote decides, or the steward chooses each time. */
export type ArmsMode = 'steward' | 'vote' | 'choose';

export type ProposalStatus = 'waiting' | 'voting' | 'accepted' | 'declined' | 'withdrawn';

export interface ProposalView {
  id: string;
  house: string;
  name: string;
  note: string | null;
  arms: ArmsJson;
  status: ProposalStatus;
  reason: string | null;
  author: FeedAuthor | null;
  createdAt: string;
  decidedAt: string | null;
  /** The id of the open vote this proposal is in, if any. */
  inVote: string | null;
  mine: boolean;
  may: { withdraw: boolean; accept: boolean; decline: boolean; putToVote: boolean };
}
