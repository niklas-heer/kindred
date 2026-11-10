// What the campaign's pages receive from the server. Types only: safe to import anywhere.
import type { GameEvent, GameMap, Levy, State } from './engine.ts';
import type { Renown } from './renown.ts';
import type { House } from '../types.ts';

/** A side as a season keeps it: a house (with the smaller houses allied to it) or a regent company. */
export interface StoredSide {
  id: string;
  name: string;
  arms: House['arms'];
  /** An invented company a regent always plays. */
  rival: boolean;
  /** The house ids that fight under this banner: its own, then its allies'. */
  houses: string[];
  allies: { id: string; name: string }[];
  /** What renown added to its levy at the last nightfall. */
  bonus: number;
}

export interface SideView extends StoredSide {
  provinces: number;
  troops: number;
  /** Levy waiting to be mustered. */
  pool: number;
  /** Tomorrow's levy, with its parts. */
  levy: Levy;
  renown: Renown;
  /** Members who fight for it. */
  members: number;
  /** Seasons it has won. */
  laurels: number;
}

export type LogKind = 'muster' | 'march' | 'attack' | 'season_start' | 'season_end' | 'pledge' | 'bonus';

export interface LogEntry {
  id: number;
  day: number;
  at: string;
  kind: LogKind;
  side: string | null;
  /** The member's name as it was then; null for a regent. */
  name: string | null;
  /** Whether the reader gave this order. */
  mine: boolean;
  event?: GameEvent;
  /** For the season's end: the winner's side id. */
  winner?: string | null;
  cry: string | null;
}

export interface FameEntry {
  season: number;
  ended: string;
  winner: { id: string; name: string; arms: House['arms'] } | null;
  standings: { id: string; name: string; provinces: number; troops: number }[];
}

export interface CampaignMe {
  /** The side the reader fights for, or null until they choose one. */
  side: string | null;
  /** True when the reader stands for nobody in a house, so the side is theirs to choose. */
  chooses: boolean;
  orders: number;
  /** Whether today's bonus order has been earned. */
  bonusToday: boolean;
}

export interface CampaignBoard {
  map: GameMap;
  sides: SideView[];
  /** Each side's people per province name: decides the seats of a practice skirmish as it did the season's. */
  homes: Record<string, Record<string, number>>;
}

export interface CampaignView {
  enabled: boolean;
  /** The map and sides, also while the game is off: the practice skirmish needs nothing else. */
  board: CampaignBoard;
  season?: { number: number; day: number; days: number; started: string; ends: string };
  state?: State;
  me?: CampaignMe;
  log?: LogEntry[];
  /** Provinces that changed hands since the reader last looked. */
  changed?: number[];
  fame: FameEntry[];
}

/** The small summary the Today page's card and the navigation use. */
export interface CampaignStatus {
  enabled: boolean;
  season?: number;
  day?: number;
  days?: number;
  side?: { id: string; name: string; arms: House['arms']; provinces: number; rank: number; of: number } | null;
  orders?: number;
}

export interface OrderResult { event: GameEvent; orders: number }
