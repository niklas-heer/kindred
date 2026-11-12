// What the campaign's pages receive from the server. Types only: safe to import anywhere.
import type { Title } from './chronicle.ts';
import type { GameMap, Move, Score, State } from './engine.ts';
import type { Renown } from './renown.ts';
import type { House } from '../types.ts';

/** A side as a field keeps it: a house (with the smaller houses allied to it) or an invented regent company. */
export interface StoredSide {
  id: string;
  name: string;
  arms: House['arms'];
  /** An invented company: a regent always plays it. */
  rival: boolean;
  /** The house ids that fight under this banner: its own, then its allies'. */
  houses: string[];
  allies: { id: string; name: string }[];
}

/** A side as the page shows it: its house's name and arms today, and its renown. */
export interface SideView extends StoredSide {
  renown: Renown;
}

/** What a reign is played on: the map (an invented continent, with its terrain), the four sides in their order, and the opening. */
export interface FieldView { map: GameMap; sides: StoredSide[]; start: State }

/**
 * Where a member's counted reign of a day stands: `open` while none has begun (the next one begun is it), `begun` while it
 * is being played (it can be continued, and nothing else begun that day counts), `played` once it is finished.
 */
export type DaySlot = 'open' | 'begun' | 'played';

/** A counted reign under way, as the server keeps it: what it began with, the moves reported so far, and the turn they reach. */
export interface Resume { run: RunStart; moves: Move[]; turn: number }

/** This week's challenge, as the reader would play it. */
export interface Challenge {
  /** The ISO week, "2026-W46", and its last day (a Sunday, UTC). */
  week: string;
  ends: string;
  /** The dice's seed for this week. A browser can see it; no browser can work out another week's. */
  seed: string;
  field: FieldView;
  /** The side the reader plays: their own house's, or null until they choose one. */
  side: string | null;
  /** True when the reader stands for nobody in a house, so the side is theirs to choose for each reign. */
  chooses: boolean;
  /** What renown adds to the levy each turn for each side the reader could play. */
  renown: Record<string, number>;
  /** The daily quiz's reward waiting for the reader's counted reign today: extra levy on its first turn. */
  grant: number;
  /** Whether a reign begun now is today's counted one: true until the reader has begun a reign today. */
  counts: boolean;
  /** Where today's counted reign stands. */
  today: DaySlot;
  /** Today's counted reign while it is under way, to go on with: here, in another tab or on another device. */
  resume?: Resume;
}

/** A reign the server has begun: what the browser plays it with. */
export interface RunStart {
  id: string;
  week: string;
  seed: string;
  field: FieldView;
  side: string;
  renown: number;
  grant: number;
  /** Whether this reign is the day's counted one, fixed when it began; an extra reign is kept and never ranked. Missing in a reign kept from before. */
  counts?: boolean;
}

/** One line of a table: a member's best counted reign (or one reign), by the name they had then. */
export interface BoardRow {
  name: string;
  side: string;
  score: number;
  /** The place: equal scores share one, and the next is skipped. */
  rank: number;
  /** What the levy had beyond the base when the reign began: the house's renown each turn, and the quiz's reward on the first. */
  renown?: number;
  grant?: number;
  /** Counted reigns this week, one a day at most (the weekly table only). */
  runs?: number;
  /** The week it was played (the all-time list only). */
  week?: string;
  /** The reign's title ("a bold reign"), when it has one. */
  title?: Title;
  mine: boolean;
}

/** A house's participation total: the sum of its members' bests, so it grows with every member who plays. */
export interface HouseTotal { side: string; name: string; arms: House['arms']; total: number; members: number; rank: number }

export interface Leaderboard {
  week: BoardRow[];
  allTime: BoardRow[];
  houses: HouseTotal[];
  /**
   * The reader this week: their best counted reign, how many counted reigns, their place (`tied` when shared), and
   * `record`, their best reign ever under today's rules, counted or extra. `today` says where the day's counted reign stands.
   */
  me: { best: number | null; runs: number; rank: number | null; of: number; tied: boolean; record: number | null; today: DaySlot };
  /** Reigns played under earlier rules, shown apart and never ranked with today's: this week's, and the best ever. */
  earlier?: { week: BoardRow[]; allTime: BoardRow[] };
}

/** A season of the old shared game: its winner and standings, kept for the hall of fame. */
export interface FameEntry {
  season: number;
  ended: string;
  winner: { id: string; name: string; arms: House['arms'] } | null;
  standings: { id: string; name: string; provinces: number; troops: number }[];
}

export interface CampaignView {
  enabled: boolean;
  /** The server's operator has the game off for this family: the stewards' switch is locked (docs/hosting-many-families.md). */
  locked?: boolean;
  /** What a practice reign is made from (a fresh continent each time): the sides, also while the game is off. */
  kit: { sides: SideView[] };
  /** The side of the reader's own house among the kit's sides, or null when they stand for nobody in one. */
  mySide: string | null;
  /** This week's challenge and table, while the game is on. */
  challenge?: Challenge;
  board?: Leaderboard;
  fame: FameEntry[];
}

/** The small summary the Today page's card and the navigation use. */
export interface CampaignStatus {
  enabled: boolean;
  /** The server's operator has the game off for this family: nothing offers to turn it on. */
  locked?: boolean;
  week?: string;
  /** The reader's best this week, their reigns, and their place among the members who played. */
  best?: number | null;
  runs?: number;
  rank?: number | null;
  of?: number;
  /** Whether they share that place. */
  tied?: boolean;
  /** Their best reign ever under today's rules. */
  record?: number | null;
  /** Where today's counted reign stands: still to begin, under way, or played. */
  today?: DaySlot;
}

/** What finishing a reign answers: its score as the server worked it out, its title, and where it stands. */
export interface FinishResult {
  score: Score;
  title: Title;
  /** Whether it was its day's counted reign (fixed when it began). An extra reign is kept and can be a personal best, but is never ranked. */
  counted: boolean;
  /** The member's best counted reign this week and their place among the members who played; null with none counted. */
  best: number | null;
  rank: number | null;
  of: number;
  /** Whether they share that place. */
  tied: boolean;
  /** It beat their earlier best counted reign of the week; it beat every reign they finished before. Never with no points. */
  personalBest: boolean;
  record: boolean;
  /** Their first finished reign under today's rules. */
  first: boolean;
  /** Where the house they ruled stands among the houses this week, and whether this reign lifted it (a counted reign only). */
  house: { name: string; rank: number; of: number; rose: boolean } | null;
}

export type { Move };
