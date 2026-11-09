// One chat turn as a stream of events. The turn runs while the connection is open: when the reader stops or the connection
// drops, the stream is cancelled, the signal aborts the provider's call, and the turn ends storing nothing.
import { AiError } from './adapters';
import { encodeEvent, KEEP_ALIVE, type ChatStreamEvent } from './stream';
import type { ChatItem } from './types';
import { publicError } from '../server-errors';
import { store } from '../store';

/** A whole turn's limit, under the continuation's lease (continuation.ts LEASE_MS). */
export const TURN_MS = 6 * 60_000;
const KEEP_ALIVE_MS = 20_000;

export interface TurnSink {
  emit(e: ChatStreamEvent): void;
  signal: AbortSignal;
}

export function chatEventStream(run: (sink: TurnSink) => Promise<{ items: ChatItem[] }>, o: { deadlineMs?: number; fn?: string } = {}): ReadableStream<Uint8Array> {
  const reader = new AbortController();
  const signal = AbortSignal.any([reader.signal, AbortSignal.timeout(o.deadlineMs ?? TURN_MS)]);
  const encoder = new TextEncoder();
  let closed = false;
  let ping: ReturnType<typeof setInterval> | undefined;
  let out: ReadableStreamDefaultController<Uint8Array>;
  const write = (s: string) => {
    if (closed) return;
    try {
      out.enqueue(encoder.encode(s));
    } catch {
      closed = true;
    }
  };
  const emit = (e: ChatStreamEvent) => write(encodeEvent(e));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      out = controller;
      ping = setInterval(() => write(KEEP_ALIVE), KEEP_ALIVE_MS);
      // A Worker stops a request's work the moment its client disconnects. The turn must get to its end regardless: that is what lets go of the chat.
      const work = run({ emit, signal })
        .then(
          ({ items }) => emit({ type: 'done', items }),
          (e: unknown) => {
            // The reader stopped: nobody is listening, and nothing failed.
            if (e instanceof AiError && e.code === 'aborted') return;
            const shown = publicError(e, { fn: o.fn ?? 'chat-stream' }) as Error;
            emit({ type: 'error', message: shown.message, ...(e instanceof AiError && { code: e.code, ...(e.retryAfter && { retryAfter: e.retryAfter }) }) });
          },
        )
        .finally(() => {
          clearInterval(ping);
          const open = !closed;
          closed = true;
          if (open) {
            try {
              controller.close();
            } catch {}
          }
        });
      store.keepAlive(work);
    },
    cancel() {
      closed = true;
      clearInterval(ping);
      reader.abort();
    },
  });
}
