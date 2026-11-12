// A week's reign kept in the tab while it is played, so a reload or a visit to another page does not lose it. The run as
// the server began it and the moves so far are kept in sessionStorage, keyed by the family, the account and the run;
// the page plays the moves again through the engine to come back to the same position. Only one reign per family and
// account is kept: beginning another forgets the last. It lasts until the tab closes, and nothing here is sent anywhere.
// A practice is not kept: its field is dealt fresh each time and stores nothing.
//
// A reign kept under earlier rules (another map, other terrain) cannot be played on: it is let go, and the page is told,
// so it can say so once instead of failing.
import { RULESET, openReign, play, rulesetOf, type Move, type Reign, type State } from './engine.ts';
import type { RunStart } from './types.ts';

/** A reign being played, as the tab keeps it. `opKey` is the retry key its finish is sent with, so a resend is the same. */
export interface SavedReign { run: RunStart; submit: boolean; moves: Move[]; opKey: string }

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const prefix = (tree: string, account: string) => `kindred:campaign:reign:${tree}:${account}:`;
export const savedKey = (tree: string, account: string, run: string) => `${prefix(tree, account)}${run}`;

/** The session's storage, or null where there is none (the server) or it is switched off. */
export function tabStore(): Store | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

const keysOf = (store: Store, tree: string, account: string) => {
  const p = prefix(tree, account);
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(p)) out.push(k); }
  return out;
};

/** Keeps the reign, forgetting any other this account kept for this family. */
export function saveReign(store: Store | null, tree: string, account: string, saved: SavedReign) {
  if (!store) return;
  const key = savedKey(tree, account, saved.run.id);
  try {
    for (const k of keysOf(store, tree, account)) if (k !== key) store.removeItem(k);
    store.setItem(key, JSON.stringify(saved));
  } catch { /* storage full or off: the reign goes on, it is only not kept */ }
}

/** Whether a kept reign is one today's rules can play: a field laid out for them, whole. */
const playable = (s: SavedReign) => {
  const field = s.run?.field;
  return !!field && rulesetOf(field.map) === RULESET && Array.isArray(field.map.provinces) && Array.isArray(field.map.borders) && Array.isArray(field.sides) && Array.isArray(field.start?.holder);
};

/** What the tab kept: the reign to come back to, or `outdated` when one was kept under earlier rules and has been let go. */
export interface Kept { saved: SavedReign | null; outdated: boolean }

/**
 * The reign this account keeps for this family, if any, and only one that belongs to `week`. A reign of another week is
 * forgotten quietly; one of this week that today's rules cannot play is forgotten too, and `outdated` says so.
 */
export function loadReign(store: Store | null, tree: string, account: string, week: string): Kept {
  let outdated = false;
  if (!store) return { saved: null, outdated };
  try {
    for (const k of keysOf(store, tree, account)) {
      let s: SavedReign | null = null;
      try { s = JSON.parse(store.getItem(k) ?? 'null') as SavedReign | null; } catch { /* not a reign: let go below */ }
      const ours = !!s && s.run?.week === week && Array.isArray(s.moves) && typeof s.opKey === 'string';
      if (ours && playable(s!)) return { saved: s, outdated };
      if (ours) outdated = true;
      store.removeItem(k);
    }
  } catch { /* unreadable: nothing to resume */ }
  return { saved: null, outdated };
}

/** Forgets every reign this account keeps for this family. */
export function forgetReigns(store: Store | null, tree: string, account: string) {
  if (!store) return;
  try { for (const k of keysOf(store, tree, account)) store.removeItem(k); } catch { /* nothing to forget */ }
}

/**
 * Plays kept moves again from the start, position by position, as the board's undo needs them. A move the rules refuse
 * (a list kept by an older version) ends the replay there: what came before it is kept.
 */
export function restore(reign: Reign, start: State, moves: Move[]): { states: State[]; moves: Move[] } {
  const states = [openReign(start, reign)];
  const kept: Move[] = [];
  for (const m of moves) {
    try { states.push(play(states[states.length - 1], reign, m).state); } catch { break; }
    kept.push(m);
  }
  return { states, moves: kept };
}
