/** The shared types of the dictionary. Kept apart from index.tsx so area files can import them without a cycle. */
import type { LANGUAGES, Locale, PluralCategory } from "./languages.ts";

export { LOCALES, isLocale, type Locale, type PluralCategory } from "./languages.ts";

/**
 * A plural message: a form for each CLDR category the language needs, chosen by `Intl.PluralRules` from `count`.
 * `other` is always there; English and German give `one` too, Polish `one`, `few` and `many`, Japanese only `other`.
 */
export type Plural = { other: string } & Partial<Record<Exclude<PluralCategory, "other">, string>>;
/** One entry of the dictionary: a sentence, or its plural forms. */
export type Message = string | Plural;
export type Vars = Record<string, string | number>;

/**
 * The type of one language's file for an area: every English key for a complete language (so `tsc` finds a gap), any of
 * them for one still being translated. `export default { … } satisfies Strings<typeof en, "fr">`.
 */
export type Strings<E, L extends Locale> = (typeof LANGUAGES)[L]["complete"] extends true
  ? Record<keyof E, Message>
  : Partial<Record<keyof E, Message>>;
