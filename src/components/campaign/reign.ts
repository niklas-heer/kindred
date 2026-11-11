// A reign in the browser: the engine plays every move here, so the board answers at once, and the list of moves is what
// the server is sent at the end (it plays them again and keeps the score). Placing a troop and marching can be undone
// until the turn ends, back to the last battle; a battle cannot, since its dice have been rolled.
import { useState } from 'react';
import { RULES, openReign, play, scoreOf, type GameEvent, type Move, type Reign, type State } from '~/lib/campaign/engine';

interface History { states: State[]; moves: Move[] }

export function useReign(reign: Reign, start: State) {
  const [h, setH] = useState<History>(() => ({ states: [openReign(start, reign)], moves: [] }));
  const state = h.states[h.states.length - 1];
  const last = h.moves[h.moves.length - 1];

  /** Plays one move. Throws a CampaignError, and changes nothing, when the rules refuse it. Returns what happened. */
  const move = (m: Move): GameEvent[] => {
    const played = play(state, reign, m);
    setH({ states: [...h.states, played.state], moves: [...h.moves, m] });
    return played.events;
  };

  return {
    state,
    moves: h.moves,
    over: state.turn >= RULES.TURNS,
    score: scoreOf(state, reign.map, reign.player),
    move,
    /** Whether the last move can be taken back: a placed troop or a march of this turn. */
    canUndo: !!last && (last.t === 'place' || last.t === 'march'),
    undo: () => {
      if (!last || (last.t !== 'place' && last.t !== 'march')) return;
      setH({ states: h.states.slice(0, -1), moves: h.moves.slice(0, -1) });
    },
  };
}

export type ReignGame = ReturnType<typeof useReign>;
