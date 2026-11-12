/**
 * The languages Kindred knows: one entry per locale, with what the app needs to write in it. Safe to import anywhere
 * (no React, no dictionary). Adding a language starts here; see docs/translating.md.
 *
 * `complete` is the switch that lets a language be offered. Set it to `true` only once `node scripts/i18n-check.ts <locale>`
 * reports no errors: from then on `npx tsc --noEmit` demands every key in every file of `locales/<locale>/`, and the i18n
 * tests run every check on it. An incomplete language is never offered (the picker, an account, Accept-Language), whatever
 * the operator enables.
 */

/** Every locale, in the order the picker lists them. The tag is also `<html lang>` and the folder under `locales/`. */
export const LOCALES = ["en", "de", "af", "es", "fr", "it", "nl", "pl", "pt-BR", "ja", "zh-Hans"] as const;
export type Locale = (typeof LOCALES)[number];

/** CLDR's plural categories, as `Intl.PluralRules` names them. */
export const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

export interface Language {
  /** The language's own name, for the picker: "Deutsch", "日本語". */
  native: string;
  /** Its English name, for instructions to the assistant and for docs: "German". */
  english: string;
  /** The locale Intl formats dates, numbers and sorting with. */
  intl: string;
  /** The flag the picker shows (a code `components/heraldry/Flag.tsx` draws). */
  flag: string;
  /** `Intl.PluralRules(intl).resolvedOptions().pluralCategories`; a test keeps it so. */
  plurals: readonly PluralCategory[];
  /** How the app addresses the reader (docs/translating.md, "Tone"). */
  address: string;
  /** How an instruction to the assistant names the language it answers in. */
  assistant: string;
  /** The language tag the browser's speech recognition listens in (dictating to the assistant). */
  speech: string;
  /**
   * For a language that names a job differently for a man and a woman: one example, "masculine/feminine", which the
   * assistant is shown when it translates an occupation. Absent for a language with one form.
   */
  jobForms?: string;
  /**
   * The Accept-Language tags this locale answers, lower case; a tag also matches its longer forms ("pt" matches "pt-pt").
   * `not` lists longer forms that must not match ("zh-tw" is Traditional Chinese, not zh-Hans).
   */
  accepts: readonly string[];
  not?: readonly string[];
  /** Abbreviated month names inside a date (format context), Kindred's own so the server and every browser agree. */
  shortMonths: readonly string[];
  /** Whether the language may be offered. See the comment at the top. */
  complete: boolean;
}

export const LANGUAGES = {
  en: {
    native: "English",
    english: "English",
    intl: "en-GB",
    flag: "gb",
    plurals: ["one", "other"],
    address: "you",
    assistant: "English",
    speech: "en-US",
    accepts: ["en"],
    shortMonths: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    complete: true,
  },
  de: {
    native: "Deutsch",
    english: "German",
    intl: "de-DE",
    flag: "de",
    plurals: ["one", "other"],
    address: "du",
    assistant: "German, in the informal \"du\" form",
    speech: "de-DE",
    jobForms: "Bäcker/Bäckerin",
    accepts: ["de"],
    shortMonths: ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."],
    complete: true,
  },
  af: {
    native: "Afrikaans",
    english: "Afrikaans",
    intl: "af-ZA",
    flag: "za",
    plurals: ["one", "other"],
    address: "jy",
    assistant: "Afrikaans, in the informal \"jy\" form",
    speech: "af-ZA",
    accepts: ["af"],
    shortMonths: ["Jan.", "Feb.", "Mrt.", "Apr.", "Mei", "Jun.", "Jul.", "Aug.", "Sep.", "Okt.", "Nov.", "Des."],
    complete: true,
  },
  es: {
    native: "Español",
    english: "Spanish",
    intl: "es",
    flag: "es",
    plurals: ["one", "many", "other"],
    address: "tú",
    assistant: "Spanish, addressing the reader with \"tú\"",
    speech: "es-ES",
    jobForms: "panadero/panadera",
    accepts: ["es"],
    shortMonths: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"],
    complete: false,
  },
  fr: {
    native: "Français",
    english: "French",
    intl: "fr-FR",
    flag: "fr",
    plurals: ["one", "many", "other"],
    address: "tu",
    assistant: "French, addressing the reader with \"tu\"",
    speech: "fr-FR",
    jobForms: "boulanger/boulangère",
    accepts: ["fr"],
    shortMonths: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    complete: false,
  },
  it: {
    native: "Italiano",
    english: "Italian",
    intl: "it-IT",
    flag: "it",
    plurals: ["one", "many", "other"],
    address: "tu",
    assistant: "Italian, addressing the reader with \"tu\"",
    speech: "it-IT",
    jobForms: "fornaio/fornaia",
    accepts: ["it"],
    shortMonths: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
    complete: false,
  },
  nl: {
    native: "Nederlands",
    english: "Dutch",
    intl: "nl-NL",
    flag: "nl",
    plurals: ["one", "other"],
    address: "je/jij",
    assistant: "Dutch, addressing the reader with \"je\" and \"jij\"",
    speech: "nl-NL",
    accepts: ["nl"],
    shortMonths: ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
    complete: false,
  },
  pl: {
    native: "Polski",
    english: "Polish",
    intl: "pl-PL",
    flag: "pl",
    plurals: ["one", "few", "many", "other"],
    address: "ty",
    assistant: "Polish, addressing the reader with \"ty\"",
    speech: "pl-PL",
    jobForms: "piekarz/piekarka",
    accepts: ["pl"],
    shortMonths: ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
    complete: false,
  },
  "pt-BR": {
    native: "Português (Brasil)",
    english: "Brazilian Portuguese",
    intl: "pt-BR",
    flag: "br",
    plurals: ["one", "many", "other"],
    address: "você",
    assistant: "Brazilian Portuguese, addressing the reader with \"você\"",
    speech: "pt-BR",
    jobForms: "padeiro/padeira",
    // The only Portuguese Kindred has, so a reader in Portugal gets it too rather than English.
    accepts: ["pt"],
    shortMonths: ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."],
    complete: false,
  },
  ja: {
    native: "日本語",
    english: "Japanese",
    intl: "ja-JP",
    flag: "jp",
    plurals: ["other"],
    address: "です/ます",
    assistant: "Japanese, in the polite です/ます form",
    speech: "ja-JP",
    accepts: ["ja"],
    // A Japanese date writes its month as a number ("9月"), so these are never put into one; kept for completeness.
    shortMonths: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    complete: false,
  },
  "zh-Hans": {
    native: "简体中文",
    english: "Simplified Chinese",
    intl: "zh-Hans-CN",
    flag: "cn",
    plurals: ["other"],
    address: "你",
    assistant: "Simplified Chinese, addressing the reader with 你",
    speech: "zh-CN",
    // Simplified Chinese: mainland China, Singapore, Malaysia, and a bare "zh". Taiwan, Hong Kong and Macau read Traditional.
    accepts: ["zh"],
    not: ["zh-tw", "zh-hk", "zh-mo", "zh-hant"],
    shortMonths: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    complete: false,
  },
} as const satisfies Record<Locale, Language>;

/** How an instruction to the assistant names each language: "German, in the informal \"du\" form". */
export const ASSISTANT_LANGUAGE = Object.fromEntries(LOCALES.map((l) => [l, LANGUAGES[l].assistant])) as Record<Locale, string>;

/** The languages that may be offered, English first. */
export const COMPLETE_LOCALES: readonly Locale[] = LOCALES.filter((l) => LANGUAGES[l].complete);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The locales an instance offers, from the operator's setting (a comma-separated list; missing means every complete
 * language). English is always offered; a language that is not complete never is.
 */
export function offeredLocales(setting?: string | null): Locale[] {
  const chosen = setting == null ? null : new Set(setting.split(",").map((s) => s.trim()));
  return LOCALES.filter((l) => l === "en" || (LANGUAGES[l].complete && (!chosen || chosen.has(l))));
}

/** Whether an Accept-Language tag (lower case) is one this locale answers. */
function accepts(locale: Locale, tag: string): boolean {
  const lang: Language = LANGUAGES[locale];
  const covers = (prefix: string) => tag === prefix || tag.startsWith(`${prefix}-`);
  return lang.accepts.some(covers) && !(lang.not ?? []).some(covers);
}

/**
 * The best of `offered` for an Accept-Language header, else English. Tags are tried in the reader's order of preference
 * (q, then position); "pt-PT" finds pt-BR, "zh-CN" and "zh-Hans" find zh-Hans, "zh-TW" finds nothing.
 */
export function negotiateLocale(header = "", offered: readonly Locale[] = COMPLETE_LOCALES): Locale {
  const tags = header
    .split(",")
    .map((part, i) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q), i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of tags) {
    const found = offered.find((l) => accepts(l, tag));
    if (found) return found;
  }
  return "en";
}

/** A language's plural categories that a whole number reaches (Polish: one, few, many; French: one, other). */
export function countCategories(locale: Locale): PluralCategory[] {
  const rules = new Intl.PluralRules(LANGUAGES[locale].intl);
  const found = new Set<PluralCategory>();
  for (let n = 0; n <= 1000; n++) found.add(rules.select(n) as PluralCategory);
  return PLURAL_CATEGORIES.filter((c) => found.has(c));
}

/** The languages the app's inline vocabularies are written in (faiths, colours, charges, occupations, AI instructions). */
export type VocabularyLocale = "en" | "de" | "af";
/**
 * The language a vocabulary written inline for English, German and Afrikaans uses for a reader: theirs, else English. A
 * translation lane extends those vocabularies (docs/translating.md, "Outside the dictionary").
 */
export const vocabularyLocale = (locale: Locale): VocabularyLocale => (locale === "de" || locale === "af" ? locale : "en");
