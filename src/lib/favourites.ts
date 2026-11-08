// What the favourites offer: colours with their swatches, and the usual choices for each kind of favourite. Named in
// English, German and Afrikaans. Anything else can always be typed.
import { foldText } from './address.ts';
import type { FaithLocale as L } from './faiths.ts';

export interface Colour { id: string; hex: string; en: string; de: string; af: string; aliases?: readonly string[] }

export const COLOURS: readonly Colour[] = [
  { id: 'red', hex: '#c8102e', en: 'Red', de: 'Rot', af: 'Rooi' },
  { id: 'burgundy', hex: '#7a1f3d', en: 'Burgundy', de: 'Bordeaux', af: 'Wynrooi', aliases: ['weinrot'] },
  { id: 'coral', hex: '#ff7f6a', en: 'Coral', de: 'Koralle', af: 'Koraal' },
  { id: 'orange', hex: '#f28c28', en: 'Orange', de: 'Orange', af: 'Oranje' },
  { id: 'yellow', hex: '#f5d90a', en: 'Yellow', de: 'Gelb', af: 'Geel' },
  { id: 'gold', hex: '#d4af37', en: 'Gold', de: 'Gold', af: 'Goud', aliases: ['golden'] },
  { id: 'olive', hex: '#75773a', en: 'Olive', de: 'Oliv', af: 'Olyf', aliases: ['olivgrün'] },
  { id: 'green', hex: '#2e8b57', en: 'Green', de: 'Grün', af: 'Groen' },
  { id: 'mint', hex: '#98e0c0', en: 'Mint', de: 'Mintgrün', af: 'Kruisement', aliases: ['mint green', 'mintgroen'] },
  { id: 'teal', hex: '#0f7c7c', en: 'Teal', de: 'Petrol', af: 'Blougroen', aliases: ['blaugrün'] },
  { id: 'turquoise', hex: '#30b8c0', en: 'Turquoise', de: 'Türkis', af: 'Turkoois' },
  { id: 'sky', hex: '#87ceeb', en: 'Sky blue', de: 'Himmelblau', af: 'Hemelsblou', aliases: ['light blue', 'hellblau', 'ligblou'] },
  { id: 'blue', hex: '#1f6fd1', en: 'Blue', de: 'Blau', af: 'Blou' },
  { id: 'navy', hex: '#1b2a5b', en: 'Navy', de: 'Marineblau', af: 'Vlootblou', aliases: ['navy blue', 'dunkelblau', 'donkerblou', 'dark blue'] },
  { id: 'violet', hex: '#8a4fff', en: 'Violet', de: 'Violett', af: 'Violet' },
  { id: 'purple', hex: '#7b3fa0', en: 'Purple', de: 'Lila', af: 'Pers' },
  { id: 'lilac', hex: '#c8a2d8', en: 'Lilac', de: 'Flieder', af: 'Lila', aliases: ['fliederfarben'] },
  { id: 'magenta', hex: '#d6007f', en: 'Magenta', de: 'Magenta', af: 'Magenta', aliases: ['fuchsia'] },
  { id: 'pink', hex: '#f28cb1', en: 'Pink', de: 'Rosa', af: 'Pienk' },
  { id: 'brown', hex: '#7b4f2c', en: 'Brown', de: 'Braun', af: 'Bruin' },
  { id: 'beige', hex: '#dcc9a6', en: 'Beige', de: 'Beige', af: 'Beige' },
  { id: 'cream', hex: '#f5efdc', en: 'Cream', de: 'Creme', af: 'Room', aliases: ['cremefarben'] },
  { id: 'white', hex: '#ffffff', en: 'White', de: 'Weiß', af: 'Wit' },
  { id: 'silver', hex: '#c0c0c0', en: 'Silver', de: 'Silber', af: 'Silwer' },
  { id: 'grey', hex: '#8a8a8a', en: 'Grey', de: 'Grau', af: 'Grys', aliases: ['gray'] },
  { id: 'black', hex: '#111111', en: 'Black', de: 'Schwarz', af: 'Swart' },
];

const BY_NAME = new Map<string, Colour>();
for (const c of COLOURS) for (const n of [c.en, c.de, c.af, c.id, ...(c.aliases ?? [])]) { const k = foldText(n); if (!BY_NAME.has(k)) BY_NAME.set(k, c); }

/** What a colour favourite is usually labelled, so a family's own "Farbe" gets swatches too. */
const COLOUR_LABELS = new Set(['colour', 'color', 'colours', 'colors', 'farbe', 'farben', 'kleur', 'kleure', 'favourite colour', 'favorite color', 'lieblingsfarbe', 'gunstelingkleur'].map(foldText));
export const isColourLabel = (label: string) => COLOUR_LABELS.has(foldText(label));

export interface ColourToken { text: string; colour?: Colour }

/** "Blau & Türkis" → its colours, each with a swatch when the name is known. A colour no one named stays as written. */
export function parseColours(text: string): ColourToken[] {
  return text
    .split(/\s*(?:[,;/&+\n]|\s(?:and|und|en|or|oder|of)\s)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => { const colour = BY_NAME.get(foldText(t)); return colour ? { text: t, colour } : { text: t }; });
}

/** Adds the colour to the text, or takes it out when it is already there. Other colours keep their wording. */
export function toggleColour(text: string, c: Colour, locale: L): string {
  const tokens = parseColours(text);
  const kept = tokens.filter((t) => t.colour?.id !== c.id);
  const names = kept.map((t) => t.text);
  if (kept.length === tokens.length) names.push(c[locale]);
  return names.join(', ');
}

type W = readonly [en: string, de: string, af: string];
export const FAVOURITE_WORDS: Record<string, readonly W[]> = {
  food: [['Pasta', 'Pasta', 'Pasta'], ['Pizza', 'Pizza', 'Pizza'], ['Roast', 'Braten', 'Braaivleis in die oond'], ['Soup', 'Suppe', 'Sop'], ['Stew', 'Eintopf', 'Bredie'], ['Curry', 'Curry', 'Kerrie'], ['Fish', 'Fisch', 'Vis'], ['Salad', 'Salat', 'Slaai'], ['Cake', 'Kuchen', 'Koek'], ['Chocolate', 'Schokolade', 'Sjokolade'], ['Barbecue', 'Grillen', 'Braai'], ['Ice cream', 'Eis', 'Roomys']],
  drink: [['Coffee', 'Kaffee', 'Koffie'], ['Tea', 'Tee', 'Tee'], ['Rooibos', 'Rooibos', 'Rooibos'], ['Water', 'Wasser', 'Water'], ['Juice', 'Saft', 'Sap'], ['Wine', 'Wein', 'Wyn'], ['Beer', 'Bier', 'Bier'], ['Hot chocolate', 'Heiße Schokolade', 'Warm sjokolade'], ['Lemonade', 'Limonade', 'Limonade'], ['Whisky', 'Whisky', 'Whisky']],
  music: [['Classical', 'Klassik', 'Klassiek'], ['Jazz', 'Jazz', 'Jazz'], ['Rock', 'Rock', 'Rock'], ['Pop', 'Pop', 'Pop'], ['Folk', 'Volksmusik', 'Volksmusiek'], ['Country', 'Country', 'Country'], ['Blues', 'Blues', 'Blues'], ['Opera', 'Oper', 'Opera'], ['Hymns', 'Kirchenlieder', 'Gesange'], ['Schlager', 'Schlager', 'Sokkiemusiek'], ['Hip hop', 'Hip-Hop', 'Hip-hop']],
  book: [['Novels', 'Romane', 'Romans'], ['Crime', 'Krimis', 'Misdaadverhale'], ['History', 'Geschichte', 'Geskiedenis'], ['Biographies', 'Biografien', 'Biografieë'], ['Poetry', 'Gedichte', 'Gedigte'], ['Fantasy', 'Fantasy', 'Fantasie'], ['Science fiction', 'Science-Fiction', 'Wetenskapfiksie'], ['Cookbooks', 'Kochbücher', 'Kookboeke'], ['Travel', 'Reiseberichte', 'Reisverhale'], ['Children’s books', 'Kinderbücher', 'Kinderboeke']],
  film: [['Comedy', 'Komödie', 'Komedie'], ['Drama', 'Drama', 'Drama'], ['Romance', 'Liebesfilm', 'Romanse'], ['Thriller', 'Thriller', 'Riller'], ['Western', 'Western', 'Cowboyfilm'], ['Documentary', 'Dokumentarfilm', 'Dokumentêr'], ['Animation', 'Zeichentrick', 'Animasie'], ['Musical', 'Musical', 'Musiekblyspel'], ['Adventure', 'Abenteuer', 'Avontuur'], ['Science fiction', 'Science-Fiction', 'Wetenskapfiksie']],
  sport: [['Football', 'Fußball', 'Sokker'], ['Rugby', 'Rugby', 'Rugby'], ['Cricket', 'Cricket', 'Krieket'], ['Tennis', 'Tennis', 'Tennis'], ['Golf', 'Golf', 'Gholf'], ['Swimming', 'Schwimmen', 'Swem'], ['Running', 'Laufen', 'Hardloop'], ['Cycling', 'Radfahren', 'Fietsry'], ['Hiking', 'Wandern', 'Stap'], ['Skiing', 'Skifahren', 'Ski'], ['Handball', 'Handball', 'Handbal'], ['Sailing', 'Segeln', 'Seil']],
  flower: [['Rose', 'Rose', 'Roos'], ['Tulip', 'Tulpe', 'Tulp'], ['Sunflower', 'Sonnenblume', 'Sonneblom'], ['Lily', 'Lilie', 'Lelie'], ['Daisy', 'Gänseblümchen', 'Madeliefie'], ['Orchid', 'Orchidee', 'Orgidee'], ['Lavender', 'Lavendel', 'Laventel'], ['Protea', 'Protea', 'Protea'], ['Peony', 'Pfingstrose', 'Pioenroos'], ['Forget-me-not', 'Vergissmeinnicht', 'Vergeet-my-nie']],
  place: [['The sea', 'Das Meer', 'Die see'], ['The mountains', 'Die Berge', 'Die berge'], ['The forest', 'Der Wald', 'Die bos'], ['The lake', 'Der See', 'Die meer'], ['The garden', 'Der Garten', 'Die tuin'], ['Home', 'Zu Hause', 'Tuis'], ['The countryside', 'Das Land', 'Die platteland'], ['The city', 'Die Stadt', 'Die stad'], ['The Bushveld', 'Der Busch', 'Die Bosveld'], ['The desert', 'Die Wüste', 'Die woestyn']],
  gift: [['Books', 'Bücher', 'Boeke'], ['Flowers', 'Blumen', 'Blomme'], ['Chocolates', 'Pralinen', 'Sjokolade'], ['Wine', 'Wein', 'Wyn'], ['A photo album', 'Ein Fotoalbum', '’n Fotoalbum'], ['Tickets', 'Eintrittskarten', 'Kaartjies'], ['Time together', 'Gemeinsame Zeit', 'Tyd saam'], ['Something handmade', 'Etwas Selbstgemachtes', 'Iets met die hand gemaak'], ['A voucher', 'Ein Gutschein', '’n Geskenkbewys'], ['Garden plants', 'Gartenpflanzen', 'Tuinplante']],
};

/** The usual choices for a kind of favourite, in the reader's language; none for a kind it does not know. */
export function favouriteWords(kind: string, locale: L): string[] {
  const i = locale === 'en' ? 0 : locale === 'de' ? 1 : 2;
  return (FAVOURITE_WORDS[kind] ?? []).map((w) => w[i]);
}
