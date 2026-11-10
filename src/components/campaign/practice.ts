// The practice skirmish: the same engine as the season, run in the browser. The member has as many orders as they
// like, the regents move when the turn ends, and after ten turns the house with the most provinces has won. Nothing is
// sent to the server and nothing is kept: closing the page ends it.
import { useCallback, useMemo, useState } from 'react';
import { RULES, addLevy, applyOrder, endDay, startState, type GameEvent, type Order, type SideRules, type State } from '~/lib/campaign/engine';
import type { CampaignBoard, LogEntry } from '~/lib/campaign/types';

interface Game { seed: string; side: string; state: State; plays: number; log: LogEntry[] }

const entry = (id: number, day: number, e: GameEvent, name: string | null): LogEntry => ({ id, day, at: '', kind: e.t, side: e.side, name, mine: name !== null, event: e, cry: null });

export function usePractice(board: CampaignBoard, firstSide: string, name: string) {
  const rules = useMemo((): SideRules[] => board.sides.map((s) => ({ id: s.id, bonus: s.renown.bonus, temper: 'bold' })), [board.sides]);
  const fresh = useCallback((side: string): Game => {
    // Only for the dice and the opening of a game nobody else sees: the browser's own randomness is enough.
    const seed = `practice:${Math.random().toString(36).slice(2)}`;
    const opening = startState(board.map, board.sides.map((s) => s.id), seed, board.homes);
    return { seed, side, state: addLevy(opening, rules), plays: 0, log: [] };
  }, [board, rules]);
  const [game, setGame] = useState<Game>(() => fresh(firstSide));
  const over = game.state.day >= RULES.PRACTICE_DAYS;

  /** Plays one order for the member's side. Throws a CampaignError when the rules refuse it. */
  const give = (order: Order): GameEvent => {
    const played = applyOrder(game.state, board.map, game.side, order, `${game.seed}:${game.plays}`, RULES.PRACTICE_DAYS);
    setGame({ ...game, state: played.state, plays: game.plays + 1, log: [entry(game.log.length + 1, game.state.day, played.event, name), ...game.log] });
    return played.event;
  };

  /** Ends the turn: every other side's regent moves, then the next turn's levy arrives. Returns what the regents did. */
  const endTurn = (): GameEvent[] => {
    const mine = game.state.acted.includes(game.side) ? game.state : { ...game.state, acted: [...game.state.acted, game.side] };
    const night = endDay(mine, board.map, rules, game.seed, RULES.PRACTICE_DAYS);
    const attacks = night.events.filter((e) => e.t === 'attack');
    setGame({ ...game, state: night.state, log: [...attacks.map((e, i) => entry(game.log.length + attacks.length - i, game.state.day, e, null)), ...game.log] });
    return attacks;
  };

  return { ...game, over, give, endTurn, restart: (side: string = game.side) => setGame(fresh(side)) };
}
