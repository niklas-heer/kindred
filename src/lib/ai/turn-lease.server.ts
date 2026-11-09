// One running reply per chat, however many tabs, devices or chats a reader has open. Two chats run side by side; a second
// reply in the same chat is refused, because it would read a history the first is about to change and store turns out of order.
// The lease is a row kept alive while the turn runs, not a timer around it, so a Worker that dies mid-reply frees the chat quickly.
// A turn that stalls past the lease can be overtaken. It finds out on its next heartbeat, and its signal stops it; whatever it
// still tries to store carries `fence()`, so a stale turn can never write, however late it is told.
import { accounts, guard } from '../auth/store.server';
import type { Query } from '../store';
import { AiError } from './adapters';

/** How long a turn may go silent before its chat is free again. The lease renews itself on a timer, so only a stalled or dead turn goes silent. */
export const TURN_LEASE_MS = 90_000;
/** How often a running turn says it is still alive. */
const BEAT_MS = 15_000;

export interface TurnLease {
  /** Aborts, with an AiError `busy`, once another turn is found to hold the chat. */
  readonly signal: AbortSignal;
  /** Says the turn is still running. Cheap to call often: it writes at most every beat. */
  beat(): Promise<void>;
  /** Goes first in the batch that stores the turn: the batch fails as a whole unless this lease still holds the chat. */
  fence(): Query;
  /** Whether this lease still holds the chat. Says why a fenced batch failed. */
  held(): Promise<boolean>;
  release(): Promise<void>;
}

/** Takes the chat for one turn, or null when another turn is running in it. One statement decides, on node:sqlite and D1 alike. */
export async function claimTurn(conv: string, now = Date.now(), beatMs = BEAT_MS): Promise<TurnLease | null> {
  const claim = `${now}:${crypto.randomUUID()}`;
  const taken = await accounts().run(
    'INSERT INTO ai_turn (conv, claim, at) VALUES (?, ?, ?) ON CONFLICT (conv) DO UPDATE SET claim = excluded.claim, at = excluded.at WHERE ai_turn.at <= ?',
    conv, claim, now, now - TURN_LEASE_MS,
  );
  if (taken.changes !== 1) return null;
  const lost = new AbortController();
  let last = now;
  const renew = async () => {
    if (lost.signal.aborted) return;
    const t = Date.now();
    last = t;
    const updated = await accounts().run('UPDATE ai_turn SET at = ? WHERE conv = ? AND claim = ?', t, conv, claim);
    if (updated.changes === 0) lost.abort(new AiError('busy', 'ai.errTurnBusy'));
  };
  // A timer, because a turn can be busy for minutes without producing text: a tool call being written, a model reasoning, a
  // provider call that is not streamed. Every one of those is still a running turn.
  const timer = setInterval(() => void renew().catch(() => {}), beatMs);
  (timer as { unref?: () => void }).unref?.();
  return {
    signal: lost.signal,
    async beat() {
      if (Date.now() - last >= beatMs) await renew();
    },
    fence: () => guard('EXISTS (SELECT 1 FROM ai_turn WHERE conv = ? AND claim = ?)', conv, claim),
    async held() {
      return !!(await accounts().get('SELECT 1 AS yes FROM ai_turn WHERE conv = ? AND claim = ?', conv, claim));
    },
    async release() {
      clearInterval(timer);
      await accounts().run('DELETE FROM ai_turn WHERE conv = ? AND claim = ?', conv, claim);
    },
  };
}
