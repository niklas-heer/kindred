// What a chat is called and how a search finds it. Pure, so the browser can name a chat before its first reply is stored
// and the rules can be tested alone. No model is ever asked for a title.

export const TITLE_CHARS = 48;

/** A chat's name from its first message: the first line with its markup taken off, cut at a word near the limit. */
export function threadTitle(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[#>*-]+\s+|\d+[.)]\s+)/, '').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim())
    .find(Boolean);
  if (!line) return '';
  const chars = Array.from(line);
  if (chars.length <= TITLE_CHARS) return line;
  const cut = chars.slice(0, TITLE_CHARS).join('');
  const space = cut.lastIndexOf(' ');
  // A word is kept whole unless that would throw away most of the line: one long word is simply cut.
  const whole = space >= TITLE_CHARS * 0.6 ? cut.slice(0, space) : cut;
  return `${whole.replace(/[\s,;:.!?–—-]+$/, '')}…`;
}

/** Text as a search compares it: ignoring case and accents, so "muller" finds "Müller". Keeps one character for each composed one. */
export const foldText = (s: string): string => s.normalize('NFC').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A few words around the first match, for the list. `at` is where the match starts in the folded text. */
export function snippetAround(text: string, at: number, length: number, room = 90): string {
  const flat = text.normalize('NFC');
  const from = Math.max(0, at - 30);
  const end = Math.min(flat.length, at + length + room);
  const body = flat.slice(from, end).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${end < flat.length ? '…' : ''}`;
}
