// The moves of a reign under way, as the server keeps them while it is played (docs/campaign.md, "A reign is kept as it is
// played"). Pure, and shared: the browser decides with it what to report and which copy of a reign is further on, the
// server what to keep and whether a list goes on from what it has.
import type { Move } from './engine.ts';

type Any = { t: Move['t']; from?: number; to?: number; troops?: number };

const sameMove = (a: Any, b: Any) => a.t === b.t && a.from === b.from && a.to === b.to && a.troops === b.troops;

/** Whether `moves` goes on from `kept`: the same moves in the same order, then any more. */
export const goesOnFrom = (moves: Move[], kept: Move[]): boolean => moves.length >= kept.length && kept.every((m, i) => sameMove(m, moves[i]));

/**
 * The moves of a list that can no longer be taken back: up to its last battle or end of a turn. Troops placed and
 * marches made since then can still be undone in the browser, so they are not reported or kept.
 */
export const settled = (moves: Move[]): Move[] => moves.slice(0, moves.reduce((n, m, i) => (m.t === 'attack' || m.t === 'end' ? i + 1 : n), 0));

/** The turn a list of moves has reached, counted from 0: one for every turn ended. */
export const turnOf = (moves: Move[]): number => moves.reduce((n, m) => n + (m.t === 'end' ? 1 : 0), 0);
