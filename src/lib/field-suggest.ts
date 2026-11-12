// What the field editor suggests as someone types a language, a country and the like. Each list puts what the family
// already uses first, then the common choices; typing searches everything, in English, German and Afrikaans alike, so
// "Ger" finds Deutsch for a German reader. Free text is always allowed: these are only suggestions.
import { countryCodes, foldText } from './address.ts';
import { LANGUAGES, LOCALES } from './i18n/languages.ts';

export interface Suggestion {
  value: string;
  label: string;
  /** Another name it was found by, shown small. */
  hint?: string;
  /** Already used in this family. */
  used?: boolean;
  /** The heading it is listed under. */
  group?: string;
}
export interface Used { value: string; n: number }
interface Item { value: string; aliases?: readonly string[]; common?: boolean }

const LIMIT = 10;

function rank(query: string, items: readonly Item[], used: readonly Used[]): Suggestion[] {
  const q = foldText(query);
  const uses = new Map<Item, number>();
  const all = [...items];
  for (const u of used) {
    const f = foldText(u.value);
    if (!f) continue;
    let item = all.find((i) => foldText(i.value) === f || i.aliases?.some((a) => foldText(a) === f));
    // A word only this family uses ("Schwäbisch") is suggested as they wrote it.
    if (!item) { item = { value: u.value }; all.push(item); }
    uses.set(item, (uses.get(item) ?? 0) + u.n);
  }
  const score = (i: Item) => {
    const name = foldText(i.value);
    if (!q) return 0;
    if (name.startsWith(q)) return 0;
    if (name.includes(` ${q}`)) return 1;
    if (i.aliases?.some((a) => foldText(a).startsWith(q))) return 2;
    return name.includes(q) ? 3 : -1;
  };
  return all
    .map((i) => ({ i, s: score(i), n: uses.get(i) ?? 0 }))
    .filter(({ i, s, n }) => s >= 0 && (q ? true : n > 0 || i.common))
    .sort((a, b) => a.s - b.s || b.n - a.n || Number(!!b.i.common) - Number(!!a.i.common) || a.i.value.localeCompare(b.i.value))
    .slice(0, LIMIT)
    .map(({ i, s, n }) => {
      const hint = s === 2 ? i.aliases?.find((a) => foldText(a).startsWith(q)) : undefined;
      return { value: i.value, label: i.value, ...(hint && { hint }), ...(n > 0 && { used: true }) };
    });
}

const COMMON_LANGUAGES = ['en', 'de', 'af', 'fr', 'nl', 'es', 'it', 'pt', 'pl', 'ru', 'tr', 'zh'];
const MORE_LANGUAGES = [
  'ar', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'el', 'et', 'eu', 'fa', 'fi', 'ga', 'gl', 'gsw', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'is', 'ja', 'ka', 'kk',
  'ko', 'ku', 'la', 'lb', 'lt', 'lv', 'mk', 'ms', 'mt', 'nb', 'nds', 'ne', 'pa', 'ro', 'sk', 'sl', 'sq', 'sr', 'st', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tn', 'ts',
  'uk', 'ur', 'uz', 've', 'vi', 'xh', 'yi', 'zu',
];

function named(type: 'language' | 'region', codes: readonly string[], locale: string, common: ReadonlySet<string>): Item[] {
  const reader = new Intl.DisplayNames([locale], { type, fallback: 'none' });
  const others = LOCALES.map((l) => new Intl.DisplayNames([LANGUAGES[l].intl], { type, fallback: 'none' }));
  const english = others[0];
  const out: Item[] = [];
  for (const code of codes) {
    const value = reader.of(code) ?? english.of(code);
    if (!value) continue;
    const aliases = [...new Set(others.map((n) => n.of(code)).filter((a): a is string => !!a && a !== value))];
    out.push({ value, aliases, common: common.has(code) });
  }
  return out;
}

const COMMON_SET = new Set(COMMON_LANGUAGES);
const ALL_LANGUAGES = [...COMMON_LANGUAGES, ...MORE_LANGUAGES];

/** Languages: names in the reader's language (`locale` is a BCP 47 tag). */
export const languageSuggestions = (query: string, locale: string, used: readonly Used[] = []) =>
  rank(query, named('language', ALL_LANGUAGES, locale, COMMON_SET), used);

const COMMON_COUNTRIES = new Set(['DE', 'ZA', 'GB', 'AT', 'CH', 'NL', 'NA', 'US']);

/** Countries: names in the reader's language. */
export const countrySuggestions = (query: string, locale: string, used: readonly Used[] = []) =>
  rank(query, named('region', countryCodes(), locale, COMMON_COUNTRIES), used);

/** A short list of words in the reader's language (religions, language levels), with what the family already wrote. */
export const wordSuggestions = (query: string, words: readonly string[], used: readonly Used[] = []) =>
  rank(query, words.map((value) => ({ value, common: true })), used);
