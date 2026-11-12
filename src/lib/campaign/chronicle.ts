// A reign's chronicle: what happened in it, worked out by playing its moves again. It gives the page its short account
// at the end (the provinces held turn by turn, the battles worth telling) and the reign its title ("a bold reign"), which
// the family's table shows beside the score. Pure, like the engine: the browser and the server get the same chronicle
// from the same moves. A title is about the reign, never about the person who played it.
import { RULES, openReign, play, provincesOf, scoreOf, terrainOf, townsOf, type Move, type Reign, type Score, type State } from './engine.ts';

/** A reign's title, most telling first: the first whose deed the reign did is the one it carries. */
export const TITLES = ['hard', 'conqueror', 'townlord', 'bold', 'seafarer', 'unbroken', 'relentless', 'prudent', 'unlucky', 'peaceable', 'steadfast'] as const;
export type Title = (typeof TITLES)[number];

export const isTitle = (value: unknown): value is Title => typeof value === 'string' && (TITLES as readonly string[]).includes(value);

/** What the player did in a reign, counted. */
export interface Deeds {
  /** Attacks made and won; provinces lost to a regent, and regents' attacks thrown back. */
  attacks: number;
  taken: number;
  lost: number;
  held: number;
  /** Attacks won against the odds (a chance under two in five), and lost with the odds (three in five or better). */
  bold: number;
  unlucky: number;
  /** Provinces taken across the sea. */
  bySea: number;
}

/** One thing worth telling: the player took a province, lost one, or threw an attack back. */
export interface Telling {
  turn: number;
  kind: 'took' | 'lost' | 'held';
  province: number;
  /** The other side: who held it, who took it, or who was thrown back; null for a free march. */
  other: string | null;
  /** The attacker's chance, 0 to 1. */
  chance: number;
  town: boolean;
  bySea: boolean;
}

export interface Chronicle {
  score: Score;
  deeds: Deeds;
  title: Title;
  /** The player's provinces at the opening and after each turn: RULES.TURNS + 1 numbers for a finished reign. */
  held: number[];
  tellings: Telling[];
  /** Where the reign ended. */
  state: State;
}

/** The title a reign carries: `hard` when it ends with no points, else the first deed in TITLES' order that it did. */
export function titleOf(deeds: Deeds, state: State, reign: Reign, score: Score): Title {
  // A reign that ends with no points is not praised for a deed along the way.
  if (score.total <= 0) return 'hard';
  if (score.provinces >= 9) return 'conqueror';
  if (townsOf(state, reign.map, reign.player) >= 4) return 'townlord';
  if (deeds.bold >= 1) return 'bold';
  if (deeds.bySea >= 1) return 'seafarer';
  if (deeds.lost === 0 && score.provinces >= 5) return 'unbroken';
  if (score.won >= 12) return 'relentless';
  if (score.lost <= 4 && score.provinces >= 4) return 'prudent';
  if (deeds.unlucky >= 3) return 'unlucky';
  if (deeds.attacks === 0) return 'peaceable';
  return 'steadfast';
}

/**
 * Plays a reign's moves from its opening and tells what happened. Throws the engine's CampaignError on a move the rules
 * refuse; a list that stops before the last turn is told as far as it goes.
 */
export function chronicleOf(start: State, reign: Reign, moves: Move[]): Chronicle {
  const me = reign.player;
  let s = openReign(start, reign);
  const deeds: Deeds = { attacks: 0, taken: 0, lost: 0, held: 0, bold: 0, unlucky: 0, bySea: 0 };
  const held = [provincesOf(s, me)];
  const tellings: Telling[] = [];
  for (const move of moves) {
    const played = play(s, reign, move);
    for (const e of played.events) {
      if (e.t !== 'attack') continue;
      const about = { turn: e.turn, province: e.to, chance: e.chance, town: terrainOf(reign.map, e.to) === 'town', bySea: e.crossing === 'sea' };
      if (e.side === me) {
        deeds.attacks++;
        if (e.took) {
          deeds.taken++;
          if (e.chance < 0.4) deeds.bold++;
          if (e.crossing === 'sea') deeds.bySea++;
          tellings.push({ ...about, kind: 'took', other: e.defender });
        } else if (e.chance >= 0.6) deeds.unlucky++;
      } else if (e.defender === me) {
        if (e.took) { deeds.lost++; tellings.push({ ...about, kind: 'lost', other: e.side }); }
        else { deeds.held++; tellings.push({ ...about, kind: 'held', other: e.side }); }
      }
    }
    s = played.state;
    if (move.t === 'end') held.push(provincesOf(s, me));
  }
  const score = scoreOf(s, reign.map, me);
  return { score, deeds, title: titleOf(deeds, s, reign, score), held, tellings, state: s };
}

/**
 * The few tellings a short chronicle keeps, in the order they happened: a town changing hands first, then a win against
 * the odds or across the sea, then a province lost, then the rest.
 */
export function highlights(chronicle: Chronicle, most = 5): Telling[] {
  const weight = (t: Telling) =>
    (t.town && t.kind !== 'held' ? 8 : 0) + (t.kind === 'took' && t.chance < 0.4 ? 6 : 0) + (t.kind === 'took' && t.bySea ? 4 : 0)
    + (t.kind === 'lost' ? 3 : t.kind === 'took' ? 2 : 1) + (t.kind === 'took' && t.other ? 1 : 0) + (t.turn === RULES.TURNS - 1 ? 1 : 0);
  return chronicle.tellings
    .map((t, i) => ({ t, i }))
    .sort((a, b) => weight(b.t) - weight(a.t) || a.i - b.i)
    .slice(0, most)
    .sort((a, b) => a.i - b.i)
    .map(({ t }) => t);
}

/** The season a turn falls in, and the year of the reign: twelve turns are three years of four seasons. */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const seasonOf = (turn: number): { season: Season; year: number } => ({ season: SEASONS[((turn % 4) + 4) % 4], year: Math.floor(turn / 4) + 1 });
