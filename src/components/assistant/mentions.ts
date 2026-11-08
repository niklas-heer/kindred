// Links in what the assistant wrote: a name of someone in the tree becomes a link to that person, and a place from the
// tree's records becomes a link to the atlas at that place. Only plain text is changed. Links, code spans and bare
// addresses the model wrote stay as they are, and a name that two people share is left alone (the link would guess).
// The result is Markdown, so renderMarkdown still decides what is safe to show.

export interface MentionPerson { id: string; name: string }
export interface MentionTargets { tree: string; people: MentionPerson[]; places: string[] }

const WORD = '\\p{L}\\p{N}_';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A destination Markdown reads whole: encoded, with the brackets that would end it encoded too. */
const destination = (s: string) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');
/** Spans the linker must not touch: code, existing links, angle-bracket autolinks and bare addresses. */
const SKIP = /(`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]*>|https?:\/\/\S+)/;

/** The text to look for, and where each one leads. */
function targets({ tree, people, places }: MentionTargets): Map<string, { label: string; href: string }> {
  const out = new Map<string, { label: string; href: string }>();
  const count = new Map<string, number>();
  for (const p of people) {
    const name = p.name.trim();
    // A single word ("Ingrid") is too common to link on its own; a full name is.
    if (name.split(/\s+/).length < 2) continue;
    count.set(name.toLowerCase(), (count.get(name.toLowerCase()) ?? 0) + 1);
    out.set(name.toLowerCase(), { label: name, href: `/${tree}?focus=${destination(p.id)}` });
  }
  for (const key of [...count.keys()]) if (count.get(key)! > 1) out.delete(key);
  for (const place of places) {
    const name = place.trim();
    const key = name.toLowerCase();
    if (name.length < 3 || out.has(key)) continue;
    out.set(key, { label: name, href: `/${tree}/atlas?place=${destination(name)}` });
  }
  return out;
}

/** The assistant's text with names and places linked. Plain text only; everything else is returned unchanged. */
export function linkMentions(text: string, opts: MentionTargets): string {
  const found = targets(opts);
  if (found.size === 0 || !text) return text;
  const keys = [...found.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(?<![${WORD}])(${keys.join('|')})(?![${WORD}])`, 'giu');
  return text
    .split(SKIP)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, (match) => {
      const hit = found.get(match.toLowerCase());
      return hit ? `[${hit.label.replace(/[[\]\\]/g, '')}](${hit.href})` : match;
    })))
    .join('');
}
