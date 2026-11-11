// What the campaign's pages receive from the server. Types only: safe to import anywhere.
import type { GameMap, Move, PlaceIn, Score, State } from './engine.ts';
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

/** What a reign is played on: the map with its terrain, the four sides in their order, and the opening. */
export interface FieldView { map: GameMap; sides: StoredSide[]; start: State }

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
  /** The daily quiz's reward waiting for the reader's next reign today: extra levy on its first turn. */
  grant: number;
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
}

/** One line of a table: a member's best (or one reign), by the name they had then. */
export interface BoardRow {
  name: string;
  side: string;
  score: number;
  /** Reigns finished this week (the weekly table only). */
  runs?: number;
  /** The week it was played (the all-time list only). */
  week?: string;
  mine: boolean;
}

export interface HouseTotal { side: string; name: string; arms: House['arms']; total: number; members: number }

export interface Leaderboard {
  week: BoardRow[];
  allTime: BoardRow[];
  houses: HouseTotal[];
  me: { best: number | null; runs: number; rank: number | null; of: number };
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
  /** What a practice reign is made from (a fresh field each time): the family's places and the sides, also while the game is off. */
  kit: { places: PlaceIn[]; sides: SideView[] };
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
  week?: string;
  /** The reader's best this week, their reigns, and their place among the members who played. */
  best?: number | null;
  runs?: number;
  rank?: number | null;
  of?: number;
}

/** What finishing a reign answers: its score as the server worked it out, and where it stands. */
export interface FinishResult { score: Score; best: number; rank: number; of: number; personalBest: boolean }

export type { Move };
