// A post's text, cut into plain pieces and links. A post is the reader's input: it is never set as HTML. The page writes
// each piece as text (React escapes it) and each link as an <a> with rel="noopener noreferrer"; only http and https
// addresses become links, and everything else stays the text it was typed as. No React here, so the test runner loads it.

export type TextPiece = { text: string; href?: undefined } | { text: string; href: string };

// An address starts with its scheme or with "www."; it ends before whitespace, quotes and angle brackets.
const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
// Punctuation that ends a sentence rather than an address.
const TRAILING = /[.,;:!?…»”’]+$/;
const count = (s: string, ch: string) => s.split(ch).length - 1;

/** A safe absolute address for what was typed, or null when it is not an http(s) address with a host. */
export function safeHref(typed: string): string | null {
  let url: URL;
  try {
    url = new URL(/^www\./i.test(typed) ? `https://${typed}` : typed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // A host with a dot (or localhost never: a family's post links to the world, not to the reader's machine), and no login in it.
  if (!url.hostname.includes('.') || url.username || url.password) return null;
  return url.href;
}

/** The text as pieces in order: plain text, and the addresses in it as links. Joining the pieces' text gives the text back. */
export function linkify(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(ADDRESS)) {
    let typed = m[0];
    // The sentence's own punctuation is not the address's, and a closing bracket belongs to the address only when its
    // opening one does ("(see https://x.org/a_(b))" keeps "a_(b)" and gives the last bracket back).
    for (;;) {
      const before = typed;
      typed = typed.replace(TRAILING, '');
      const close = typed.at(-1);
      if ((close === ')' && count(typed, ')') > count(typed, '(')) || (close === ']' && count(typed, ']') > count(typed, '['))) typed = typed.slice(0, -1);
      if (typed === before) break;
    }
    const href = safeHref(typed);
    if (!href) continue;
    const start = m.index;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: typed, href });
    at = start + typed.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
