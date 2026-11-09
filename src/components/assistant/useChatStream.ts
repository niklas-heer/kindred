// A reply being written, one per chat. The reading lives here, outside any component: it goes on while its tab is in the
// background or the window is minimized, two chats stream side by side, and only an explicit Stop ends one. Each chat's
// state is in chat-runs.ts, so a tab that comes back finds it. Closing the page ends the reply and stores nothing;
// the message is then offered again after the reload.
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { errorText } from '~/lib/errortext';
import { sseData, stepLabel, type ChatStreamEvent } from '~/lib/ai/stream';
import { translate, type Key, type Locale } from '~/lib/i18n';
import type { ChatItem } from '~/lib/ai/types';
import { finishRun, getRun, patchRun, useRun, type Unsent } from './chat-runs';
import type { Attached } from './attachments';

/** The reply on screen while it is written: its text so far, and what the assistant is doing while there is none. */
export interface LiveReply { text: string; step: Key }

const FLUSH_MS = 50;
/** A reader who asked for less motion gets the words in calmer steps. */
const CALM_FLUSH_MS = 400;

/** How a turn ended, from what came over the connection. */
export type TurnOutcome =
  | { kind: 'done'; items: ChatItem[] }
  | { kind: 'error'; message: string }
  /** The connection ended without saying how the turn ended. */
  | { kind: 'lost' };

/** Reads a turn's events. `live` gets the text, in steps at most `flushMs` apart; a step's tools reset it. Stops at the turn's last event. */
export async function readTurn(body: ReadableStream<Uint8Array>, live: (reply: LiveReply) => void, flushMs = FLUSH_MS): Promise<TurnOutcome> {
  let text = '';
  let step: Key = stepLabel(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = () => {
    timer = undefined;
    live({ text, step });
  };
  try {
    for await (const e of sseData(body) as AsyncIterable<ChatStreamEvent>) {
      if (e.type === 'done') return { kind: 'done', items: e.items };
      if (e.type === 'error') return { kind: 'error', message: e.message };
      if (e.type === 'step') {
        text = '';
        step = stepLabel(e.tools[0]);
        clearTimeout(timer);
        show();
      } else if (e.type === 'delta') {
        text += e.text;
        timer ??= setTimeout(show, flushMs);
      }
    }
    return { kind: 'lost' };
  } finally {
    clearTimeout(timer);
  }
}

const flushGap = () => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? CALM_FLUSH_MS : FLUSH_MS);

// One controller per chat, so that Stop ends this chat's reply and no other.
const controllers = new Map<string, AbortController>();

export const stopRun = (conv: string) => controllers.get(conv)?.abort();

/** A turn over the wire. A stop is returned as 'stopped'; anything else that goes wrong reads as a failed turn or a lost connection. */
async function runTurn(conv: string, tree: string, body: unknown): Promise<TurnOutcome | { kind: 'stopped' }> {
  const ac = new AbortController();
  controllers.set(conv, ac);
  try {
    const res = await fetch(`/api/ai-chat/${tree}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      return { kind: 'error', message: j?.error ?? 'common.err_network' };
    }
    return await readTurn(res.body, (reply) => patchRun(conv, { stream: reply }), flushGap());
  } catch {
    return ac.signal.aborted ? { kind: 'stopped' } : { kind: 'lost' };
  } finally {
    controllers.delete(conv);
  }
}

// ---------- a reload: what was on its way is offered again ----------

interface Interrupted { conv: string; id: string; text: string; keep?: boolean }
const storeKey = (tree: string) => `kindred.ai.inflight.${tree}`;
function readInterrupted(tree: string): Interrupted[] {
  try {
    return JSON.parse(sessionStorage.getItem(storeKey(tree)) ?? '[]') as Interrupted[];
  } catch {
    return [];
  }
}
function writeInterrupted(tree: string, list: Interrupted[]) {
  try {
    sessionStorage.setItem(storeKey(tree), JSON.stringify(list));
  } catch {}
}
const remember = (tree: string, entry: Interrupted) => writeInterrupted(tree, [...readInterrupted(tree).filter((x) => x.id !== entry.id), entry]);
const forget = (tree: string, id: string) => writeInterrupted(tree, readInterrupted(tree).filter((x) => x.id !== id));

/** After a reload: what was being written when the page went away comes back as a message to retry. Pictures do not survive it. */
export function restoreInterrupted(tree: string, locale: Locale): void {
  for (const e of readInterrupted(tree)) {
    if (!e.text) continue;
    const unsent: Unsent = { id: e.id, text: e.text, error: translate(locale, 'ai.interrupted'), keep: e.keep };
    patchRun(e.conv, (r) => ({ unsent: [...r.unsent.filter((u) => u.id !== e.id), unsent] }));
  }
  writeInterrupted(tree, []);
}

interface TurnContext { conv: string; tree: string; locale: Locale; qc: QueryClient; page?: { path: string; personId?: string } }

async function refresh({ conv, tree, qc }: TurnContext) {
  await Promise.all([qc.invalidateQueries({ queryKey: ['ai-chat', tree, conv] }), qc.invalidateQueries({ queryKey: ['ai-threads', tree] })]);
}

/** One message, from the composer or a Retry. Its text stays in the chat until it is stored, or until Edit or Retry takes it. */
export async function transmit(ctx: TurnContext, msg: string, images: Attached[], keep: boolean, opts: { retryId?: string; model?: { provider: string; model: string } } = {}): Promise<void> {
  const { conv, tree, locale } = ctx;
  const turnId = opts.retryId ?? crypto.randomUUID();
  patchRun(conv, (r) => ({ busy: true, error: null, pending: msg, pendingImages: images, stream: null, unsent: opts.retryId ? r.unsent.filter((x) => x.id !== opts.retryId) : r.unsent }));
  remember(tree, { conv, id: turnId, text: msg, keep });
  const out = await runTurn(conv, tree, {
    kind: 'message', conv, turnId, text: msg, locale, ...(opts.model && { model: opts.model }), ...(ctx.page && { page: ctx.page }),
    ...(images.length && { images: images.map((i) => ({ base64: i.base64 })), keepImages: keep }),
  });
  // A page going away ends its requests too, and reads here as a lost connection: that record is what the reload finds.
  if (out.kind !== 'lost') forget(tree, turnId);
  if (out.kind !== 'done') {
    const error = out.kind === 'stopped' ? translate(locale, 'ai.stoppedNote') : out.kind === 'lost' ? translate(locale, 'ai.connectionLost') : errorText(new Error(out.message), locale);
    patchRun(conv, (r) => ({ unsent: [...r.unsent.filter((x) => x.id !== turnId), { id: turnId, text: msg, error, images, keep }] }));
  }
  await end(ctx);
}

/** Ends a run: the stored turn is in place before the reply being written goes away, so the chat does not flicker. */
async function end(ctx: TurnContext) {
  await refresh(ctx).catch(() => {});
  patchRun(ctx.conv, { busy: false, pending: null, pendingImages: [], stream: null });
  finishRun(ctx.conv);
  if (getRun(ctx.conv).wantContinue) {
    patchRun(ctx.conv, { wantContinue: false });
    void carryOn(ctx);
  }
}

/** The assistant carries on after the reader's decisions. One decided while a reply is on its way waits for that reply to end. */
export async function carryOn(ctx: TurnContext): Promise<void> {
  const { conv, tree, locale } = ctx;
  if (getRun(conv).busy) {
    patchRun(conv, { wantContinue: true });
    return;
  }
  patchRun(conv, { busy: true, continueError: null, stream: null });
  const out = await runTurn(conv, tree, { kind: 'continue', conv, locale });
  // A stop leaves the decisions safe and the continuation still due, which the chat offers by itself.
  if (out.kind === 'error') patchRun(conv, { continueError: errorText(new Error(out.message), locale) });
  if (out.kind === 'lost') patchRun(conv, { continueError: translate(locale, 'ai.connectionLost') });
  await end(ctx);
}

/** What the drawer shows for one chat: the reply being written, and its Stop. Messages already stored stop being offered as unsent. */
export function useChatStream(conv: string, items: readonly ChatItem[] | undefined) {
  const run = useRun(conv);
  const unsent = run.unsent;
  useEffect(() => {
    if (!items || !unsent.some((u) => items.some((i) => i.id === u.id))) return;
    patchRun(conv, (r) => ({ unsent: r.unsent.filter((u) => !items.some((i) => i.id === u.id)) }));
  }, [conv, items, unsent]);
  return { live: (run.busy ? run.stream : null) as LiveReply | null, stop: () => stopRun(conv) };
}
