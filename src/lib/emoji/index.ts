// The emoji palette's data and its search (docs/responses.md). The data is the app's own (scripts/emoji-data.ts made it
// from emojibase-data and Unicode CLDR), so opening the palette asks nobody else for anything. It loads only when the
// palette opens: `loadEmoji` imports the emoji and the names in the reader's language, and English beside them, so a
// German or Afrikaans reader finds "heart" as well as "Herz" or "hart".
import type { Locale } from '../i18n/types.ts';

/** The palette's tabs, in emojibase's order without the components. `emoji.json` numbers them by this list. */
export const GROUPS = ['smileys', 'people', 'nature', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags'] as const;
export type EmojiGroup = (typeof GROUPS)[number];

/** One emoji: itself, its tab, and what it is called and found by in the reader's language and in English. */
export interface Emoji { emoji: string; group: EmojiGroup; name: string; words: string; en: string }

/** Rows as `emoji.json` and `names.<lang>.json` hold them. */
export type EmojiRows = [string, number][];

/** The emoji with their names, from the generated files' rows. A missing name in a language falls back to English. */
export function emojiFrom(rows: EmojiRows, names: string[], english: string[]): Emoji[] {
  return rows.map(([emoji, g], i) => {
    const own = names[i] || english[i] || '';
    const [name = '', words = ''] = own.split('|');
    return { emoji, group: GROUPS[g] ?? 'symbols', name, words, en: english[i] ?? '' };
  });
}

const NAMES: Record<Locale, () => Promise<{ default: string[] }>> = {
  en: () => import('./names.en.json'),
  de: () => import('./names.de.json'),
  af: () => import('./names.af.json'),
};

const loaded = new Map<Locale, Promise<Emoji[]>>();
/** Every emoji of the palette, named in `locale`. Loaded once per language. */
export function loadEmoji(locale: Locale): Promise<Emoji[]> {
  let p = loaded.get(locale);
  if (!p) {
    p = Promise.all([import('./emoji.json'), NAMES[locale](), locale === 'en' ? null : NAMES.en()])
      .then(([rows, own, en]) => emojiFrom(rows.default as EmojiRows, own.default, (en ?? own).default));
    // A failed load (the network dropped) may be tried again.
    p.catch(() => loaded.delete(locale));
    loaded.set(locale, p);
  }
  return p;
}

/** Letters without their accents, in lower case: "Gesicht" and "gesicht", "café" and "cafe" are found alike. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The emoji that match what the reader typed, best first: every word typed must begin a word of the name or of the
 * keywords, in the reader's language or in English. A name that is a word typed comes first, then a name with that word,
 * then a name with a word that begins with it, then a keyword; among equals the shorter name (the plainer emoji) first.
 * At most `limit`.
 */
export function searchEmoji(all: readonly Emoji[], query: string, limit = 120): Emoji[] {
  const typed = fold(query).split(/[\s,]+/).filter(Boolean);
  if (!typed.length) return [];
  const wordsOf = (text: string) => text.split(/[\s:,-]+/).filter(Boolean);
  const scored: [number, number, number, Emoji][] = [];
  all.forEach((e, i) => {
    const name = fold(e.name);
    const nameWords = wordsOf(name);
    const other = [...wordsOf(fold(e.words)), ...wordsOf(fold(e.en.replace('|', ' ')))];
    let score = 0;
    for (const w of typed) {
      if (name === w) score += 6;
      else if (nameWords.includes(w)) score += 4;
      else if (nameWords.some((x) => x.startsWith(w))) score += 2;
      else if (other.some((x) => x.startsWith(w))) score += 1;
      else return;
    }
    scored.push([score, name.length, i, e]);
  });
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]).slice(0, limit).map(([, , , e]) => e);
}
