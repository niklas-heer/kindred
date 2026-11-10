// A house's renown: how well its people are recorded, as a score from 0 to 100, and what it adds to the daily levy.
// Every part is a share of the house's own people, so a house of five that is recorded with care outshines a house of
// fifty that is not. Pure: the counts come from ./campaign.server.ts.
//
// Renown counts what has been written down, never what it says: a date being known, not how long a life was.
import { RULES } from './engine.ts';

export interface RenownCounts {
  /** People in the house (and in the houses allied to it). */
  people: number;
  /** People with a photo or an accepted painted portrait. */
  portraits: number;
  /** People whose birth is dated, and whose death is too when they have died. */
  dated: number;
  /** People with a birthplace. */
  placed: number;
  /** Memories, sayings and recipes about them. */
  memories: number;
  /** Life events recorded for them. */
  events: number;
  /** Citations of a source on their facts. */
  sources: number;
}

export type RenownKey = 'portraits' | 'dates' | 'places' | 'memories' | 'events' | 'sources';

export interface RenownPart {
  key: RenownKey;
  /** Points earned, and the most this part can give. */
  points: number;
  max: number;
  /** How many there are, and how many would fill the part. */
  have: number;
  of: number;
}

export interface Renown {
  /** 0 to 100. */
  score: number;
  /** What it adds to the daily levy. */
  bonus: number;
  parts: RenownPart[];
  /** Points still missing for the next troop a day, or null at the top. */
  toNext: number | null;
  /** The parts where the most points are still to be had, best first: what the page suggests. */
  tips: RenownKey[];
}

/** The score at which renown adds one troop a day, then two. */
export const RENOWN_STEPS: readonly number[] = [30, 60];

const WEIGHT: Record<RenownKey, number> = { portraits: 20, dates: 20, places: 20, memories: 20, events: 10, sources: 10 };

/**
 * `missing` names the parts this database cannot count yet (life events and sources arrive with a later migration):
 * they are left out of the parts and the tips, so nobody is asked for something the app cannot take.
 */
export function renownOf(c: RenownCounts, missing: readonly RenownKey[] = []): Renown {
  const people = Math.max(0, c.people);
  const share = (n: number) => (people ? Math.min(1, Math.max(0, n) / people) : 0);
  // One memory, event or source for each person fills its part; the square root makes the first few count the most.
  const parts: RenownPart[] = (
    [
      ['portraits', share(c.portraits), c.portraits],
      ['dates', share(c.dated), c.dated],
      ['places', share(c.placed), c.placed],
      ['memories', Math.sqrt(share(c.memories)), c.memories],
      ['events', Math.sqrt(share(c.events)), c.events],
      ['sources', Math.sqrt(share(c.sources)), c.sources],
    ] as [RenownKey, number, number][]
  ).filter(([key]) => !missing.includes(key)).map(([key, filled, have]) => ({ key, points: Math.round(filled * WEIGHT[key]), max: WEIGHT[key], have: Math.min(have, people), of: people }));
  const score = parts.reduce((sum, p) => sum + p.points, 0);
  const bonus = Math.min(RULES.RENOWN_MAX_BONUS, RENOWN_STEPS.filter((step) => score >= step).length);
  const next = RENOWN_STEPS[bonus];
  return {
    score,
    bonus,
    parts,
    toNext: next === undefined || bonus >= RULES.RENOWN_MAX_BONUS ? null : next - score,
    tips: parts.filter((p) => p.points < p.max).sort((a, b) => (b.max - b.points) - (a.max - a.points)).slice(0, 3).map((p) => p.key),
  };
}

/** A regent company has no records: its renown is fixed in the middle, one troop a day. */
export const RIVAL_RENOWN: Renown = { score: RENOWN_STEPS[0], bonus: 1, parts: [], toNext: null, tips: [] };
