// One running reply per chat, however many tabs, devices or chats a reader has open. Two chats run side by side; a second
// reply in the same chat is refused, because it would read a history the first is about to change and store turns out of order.
// The lease is a row kept alive while the turn runs, not a timer around it, so a Worker that dies mid-reply frees the chat quickly.
import { accounts } from '../auth/store.server';

/** How long a turn may go silent before its chat is free again. Longer than a model call may wait between two pieces of a reply. */
export const TURN_LEASE_MS = 90_000;
/** How often a running turn says it is still alive. */
const BEAT_MS = 15_000;

export interface TurnLease {
  /** Says the turn is still running. Cheap to call often: it writes at most every BEAT_MS. */
  beat(): Promise<void>;
  release(): Promise<void>;
}

/** Takes the chat for one turn, or null when another turn is running in it. One statement decides, on node:sqlite and D1 alike. */
export async function claimTurn(conv: string, now = Date.now()): Promise<TurnLease | null> {
  const claim = `${now}:${crypto.randomUUID()}`;
  const taken = await accounts().run(
    'INSERT INTO ai_turn (conv, claim, at) VALUES (?, ?, ?) ON CONFLICT (conv) DO UPDATE SET claim = excluded.claim, at = excluded.at WHERE ai_turn.at <= ?',
    conv, claim, now, now - TURN_LEASE_MS,
  );
  if (taken.changes !== 1) return null;
  let last = now;
  return {
    async beat() {
      const t = Date.now();
      if (t - last < BEAT_MS) return;
      last = t;
      await accounts().run('UPDATE ai_turn SET at = ? WHERE conv = ? AND claim = ?', t, conv, claim);
    },
    async release() {
      await accounts().run('DELETE FROM ai_turn WHERE conv = ? AND claim = ?', conv, claim);
    },
  };
}
