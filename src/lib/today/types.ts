// What the Today page's cards receive from the server (./today.functions.ts).
import type { QuizQuestion } from './quiz.ts';

/** The question a week asks: a curated one by its id ("q17"), or a steward's own words. */
export interface WeekQuestion {
  /** The ISO week, "2026-W46". */
  week: string;
  /** "q01" to "q60" (the words are `today.q.<id>` in the dictionary), or "custom". */
  id: string;
  /** A steward's own question, when `id` is "custom". */
  text?: string;
  /** A steward chose to ask nothing this week. */
  skipped: boolean;
}

/** An answer: a memory in the family's Chronicle, tagged with the week it answers. */
export interface WeekAnswer { id: string; person: string; author: string; at: string; body: string }

export interface WeekView {
  current: WeekQuestion;
  /** The curated question this week would ask, for a steward who wants it back. */
  curated: string;
  answers: WeekAnswer[];
  /** The weeks before, the latest first, each with how many answers it has. */
  earlier: (WeekQuestion & { answers: number })[];
}

export interface QuizHouseRow { house: string; right: number; answered: number; players: number }

export interface QuizView {
  /** False when a steward has switched the quiz off. */
  enabled: boolean;
  /** The UTC day the question belongs to, "2026-11-10". */
  day: string;
  /** Today's question; absent while the quiz is off or the family's records cannot carry one yet. */
  question?: QuizQuestion;
  /** The reader's own answer, once given. Everything below it is only sent then. */
  mine?: { choice: string; correct: boolean };
  /** The right choice: an option's number, or for `order` the numbers from the eldest to the youngest. */
  answer?: string;
  /** The person or house the question was about, for the link. */
  about?: string;
  /** How the family did today: how many answered, and how many of them were right. */
  family?: { answered: number; right: number };
  /** Days in a row the reader has answered, today or yesterday included. */
  streak: number;
  /** This month's right answers by house, the most first. */
  houses: QuizHouseRow[];
  /** Set on the answer itself: the right answer earned an extra order in the Campaign. */
  bonus?: boolean;
}
