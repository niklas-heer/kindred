// "Who is this?" (docs/who-is-this.md): the shapes the server sends the card and the page.
import type { Box } from '../photos/types.ts';

/** A gallery picture nobody is tagged in yet, as the game shows it. */
export interface WhoPhoto {
  key: string;
  width: number;
  height: number;
  taken: string | null;
  caption: string | null;
  /** The reader skipped it before: it comes after the pictures they have not seen. */
  skipped: boolean;
}

/** People other members named in a picture, waiting for someone who may tag pictures to agree. */
export interface WhoReview {
  /** The earliest proposal's id: what Confirm and "Not right" send. */
  id: number;
  key: string;
  width: number;
  height: number;
  person: string;
  box: Box | null;
  /** The members who said so, earliest first. */
  names: string[];
}

export interface WhoRound {
  photos: WhoPhoto[];
  /** Empty for a reader who may not confirm. */
  review: WhoReview[];
  /** This calendar month (UTC): how many people the reader named, and how many of those are confirmed. */
  month: { named: number; confirmed: number };
}

/**
 * What became of an answer. `proposed`: kept for someone to confirm. `confirmed`: the reader agreed with an earlier proposal
 * and may tag, so it is a tag now. `already`: that person is tagged in the picture already. `noted`: "I don't know" or a
 * skip. `not-stored`: a demo or a steward's preview, where the game is played and nothing is kept.
 */
export type WhoOutcome = 'proposed' | 'confirmed' | 'already' | 'noted' | 'not-stored';
