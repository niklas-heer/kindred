// What the favourites offer: colours with their swatches, and the usual choices for each kind of favourite. The names
// are in the dictionary (src/lib/i18n/areas/favourites.ts, a file per language); this holds the ids, hexes and aliases.
// Anything else can always be typed.
import { foldText } from './address.ts';
import { namesInEveryLanguage, tablesVersion, translate, type Key, type Locale } from './i18n/dictionary.ts';

export interface Colour { id: string; hex: string; aliases?: readonly string[] }

export const COLOURS: readonly Colour[] = [
  { id: 'red', hex: '#c8102e' },
  { id: 'burgundy', hex: '#7a1f3d', aliases: ['weinrot'] },
  { id: 'coral', hex: '#ff7f6a' },
  { id: 'orange', hex: '#f28c28' },
  { id: 'yellow', hex: '#f5d90a' },
  { id: 'gold', hex: '#d4af37', aliases: ['golden'] },
  { id: 'olive', hex: '#75773a', aliases: ['olivgrün'] },
  { id: 'green', hex: '#2e8b57' },
  { id: 'mint', hex: '#98e0c0', aliases: ['mint green', 'mintgroen'] },
  { id: 'teal', hex: '#0f7c7c', aliases: ['blaugrün'] },
  { id: 'turquoise', hex: '#30b8c0' },
  { id: 'sky', hex: '#87ceeb', aliases: ['light blue', 'hellblau', 'ligblou'] },
  { id: 'blue', hex: '#1f6fd1' },
  { id: 'navy', hex: '#1b2a5b', aliases: ['navy blue', 'dunkelblau', 'donkerblou', 'dark blue'] },
  { id: 'violet', hex: '#8a4fff' },
  { id: 'purple', hex: '#7b3fa0' },
  { id: 'lilac', hex: '#c8a2d8', aliases: ['fliederfarben'] },
  { id: 'magenta', hex: '#d6007f', aliases: ['fuchsia'] },
  { id: 'pink', hex: '#f28cb1' },
  { id: 'brown', hex: '#7b4f2c' },
  { id: 'beige', hex: '#dcc9a6' },
  { id: 'cream', hex: '#f5efdc', aliases: ['cremefarben'] },
  { id: 'white', hex: '#ffffff' },
  { id: 'silver', hex: '#c0c0c0' },
  { id: 'grey', hex: '#8a8a8a', aliases: ['gray'] },
  { id: 'black', hex: '#111111' },
];

/** A colour's name in a language (English where that language has not named it yet). */
export const colourName = (c: Colour, locale: Locale) => translate(locale, `colour.${c.id}` as Key);

/**
 * What is built from the names of every language this page has: it is rebuilt when a language arrives (in the browser,
 * English and the reader's language; on the server, all of them).
 */
let built: { version: number; byName: Map<string, Colour>; labels: Set<string>; split: RegExp } | undefined;
function vocabulary() {
  const version = tablesVersion();
  if (built?.version === version) return built;
  const byName = new Map<string, Colour>();
  for (const c of COLOURS) for (const n of [...namesInEveryLanguage(`colour.${c.id}` as Key), c.id, ...(c.aliases ?? [])]) { const k = foldText(n); if (!byName.has(k)) byName.set(k, c); }
  const words = (key: Key) => namesInEveryLanguage(key).flatMap((s) => s.split(',')).map((w) => w.trim()).filter(Boolean);
  const joiners = words('favourite.joiners').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return (built = {
    version,
    byName,
    // What a colour favourite is usually labelled, so a family's own "Farbe" gets swatches too.
    labels: new Set(words('favourite.colourLabels').map(foldText)),
    split: new RegExp(`\\s*(?:[,;/&+\\n]|\\s(?:${joiners.join('|')})\\s)\\s*`, 'i'),
  });
}

export const isColourLabel = (label: string) => vocabulary().labels.has(foldText(label));

export interface ColourToken { text: string; colour?: Colour }

/** "Blau & Türkis" → its colours, each with a swatch when the name is known. A colour no one named stays as written. */
export function parseColours(text: string): ColourToken[] {
  const { byName, split } = vocabulary();
  return text
    .split(split)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => { const colour = byName.get(foldText(t)); return colour ? { text: t, colour } : { text: t }; });
}

/** Adds the colour to the text, or takes it out when it is already there. Other colours keep their wording. */
export function toggleColour(text: string, c: Colour, locale: Locale): string {
  const tokens = parseColours(text);
  const kept = tokens.filter((t) => t.colour?.id !== c.id);
  const names = kept.map((t) => t.text);
  if (kept.length === tokens.length) names.push(colourName(c, locale));
  return names.join(', ');
}

/** The usual choices for each kind of favourite, by the word's id: "favourite.<kind>.<id>" holds its name. */
export const FAVOURITE_WORDS: Record<string, readonly string[]> = {
  food: ['pasta', 'pizza', 'roast', 'soup', 'stew', 'curry', 'fish', 'salad', 'cake', 'chocolate', 'barbecue', 'ice-cream'],
  drink: ['coffee', 'tea', 'rooibos', 'water', 'juice', 'wine', 'beer', 'hot-chocolate', 'lemonade', 'whisky'],
  music: ['classical', 'jazz', 'rock', 'pop', 'folk', 'country', 'blues', 'opera', 'hymns', 'schlager', 'hip-hop'],
  book: ['novels', 'crime', 'history', 'biographies', 'poetry', 'fantasy', 'science-fiction', 'cookbooks', 'travel', 'children-s-books'],
  film: ['comedy', 'drama', 'romance', 'thriller', 'western', 'documentary', 'animation', 'musical', 'adventure', 'science-fiction'],
  sport: ['football', 'rugby', 'cricket', 'tennis', 'golf', 'swimming', 'running', 'cycling', 'hiking', 'skiing', 'handball', 'sailing'],
  flower: ['rose', 'tulip', 'sunflower', 'lily', 'daisy', 'orchid', 'lavender', 'protea', 'peony', 'forget-me-not'],
  place: ['the-sea', 'the-mountains', 'the-forest', 'the-lake', 'the-garden', 'home', 'the-countryside', 'the-city', 'the-bushveld', 'the-desert'],
  gift: ['books', 'flowers', 'chocolates', 'wine', 'a-photo-album', 'tickets', 'time-together', 'something-handmade', 'a-voucher', 'garden-plants'],
};

/** The usual choices for a kind of favourite, in the reader's language; none for a kind it does not know. */
export function favouriteWords(kind: string, locale: Locale): string[] {
  return (FAVOURITE_WORDS[kind] ?? []).map((id) => translate(locale, `favourite.${kind}.${id}` as Key));
}
