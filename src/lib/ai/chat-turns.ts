// Rules about a chat's stored turns that the assistant window applies: which answers can be asked again, and which of a
// reply's sources are shown as links. Pure, so they can be tested alone.
import type { ChatItem } from './types.ts';

/**
 * Whether the answer at `i` can be asked again: it answers a message in words, not a decision (a continuation), a family
 * session or pictures that were not kept. An alternate answer is asked again from the question its first answer replied to.
 */
export function retryable(items: readonly ChatItem[], i: number): boolean {
  const m = items[i];
  if (m.role !== 'assistant' || m.continuation) return false;
  const before = items.slice(0, i).reverse().find((x) => !x.alternateOf);
  const base = m.alternateOf ? items.find((x) => x.id === m.alternateOf) : m;
  const question = base ? items[items.indexOf(base) - 1] : before;
  return !!question && question.role === 'user' && !question.session && !question.images;
}

/** A link a reader can follow: http(s) only. The model's own sources are shown as links, so nothing else is. */
export const webUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/** A source's host, without "www.", for a link with no title. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
