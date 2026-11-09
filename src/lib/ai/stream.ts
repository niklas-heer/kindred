// What the chat's streaming route sends to the browser: server-sent events, one JSON object each. Read by both sides, and by
// the adapters for the providers' own streams, so nothing here may need the server.
import type { Key } from '../i18n';
import type { ChatItem } from './types';

export type ChatStreamEvent =
  /** The model called these tools. Any text it wrote before them was not its answer, so what is on screen is cleared. */
  | { type: 'step'; tools: string[] }
  | { type: 'delta'; text: string }
  /** The turn is stored. These are its stored items. */
  | { type: 'done'; items: ChatItem[] }
  /** The turn failed and nothing was stored. `message` is written for the reader, or a dictionary key. */
  | { type: 'error'; message: string; code?: string; retryAfter?: number };

export const encodeEvent = (e: ChatStreamEvent): string => `data: ${JSON.stringify(e)}\n\n`;
/** Keeps an idle connection open while a model thinks: a proxy closes one that says nothing for long. Readers skip it. */
export const KEEP_ALIVE = ': keep-alive\n\n';

/** The JSON of each `data:` line of a server-sent stream. Every read counts as activity, a comment line too, and yields nothing. */
export async function* sseData(body: ReadableStream<Uint8Array>, onActivity: () => void = () => {}): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      onActivity();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        yield json;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** What the reader is told a tool is doing. A tool added later reads as plain "working" until it gets a line of its own. */
export function stepLabel(tool: string | undefined): Key {
  if (!tool) return 'ai.sending';
  if (tool === 'web_lookup') return 'ai.stepWeb';
  if (tool === 'missing_info') return 'ai.stepMissing';
  if (tool === 'list_houses') return 'ai.stepHouses';
  if (tool === 'list_photos' || tool === 'describe_photo') return 'ai.stepPhotos';
  if (tool === 'search_people' || tool === 'read_person' || tool === 'relatives' || tool === 'find_relatives') return 'ai.stepFamily';
  if (tool.startsWith('propose_')) return 'ai.stepProposing';
  return 'ai.stepWorking';
}
