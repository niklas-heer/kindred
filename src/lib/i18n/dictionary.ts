/**
 * The dictionary: every area's English merged with each language's table, the typed key, translate() and the pure
 * formatters. No JSX and no React here, so the node test runner can load it. index.tsx re-exports all of it.
 */
import { AREAS, PRELOADED, loadTable } from "./catalog.ts";
import { LANGUAGES, LOCALES, type Locale, type PluralCategory } from "./languages.ts";
import type { Message, Vars } from "./types.ts";

export { LOCALES, isLocale, type Locale, type Message, type Plural, type Vars } from "./types.ts";
export { COMPLETE_LOCALES, LANGUAGES, negotiateLocale, offeredLocales, vocabularyLocale, type VocabularyLocale } from "./languages.ts";
export { kinshipLabel, yourKinship, yourKinshipParts, type KinshipView } from "./kinship.ts";
export { localizeTitle } from "./titles.ts";

type AreaModule = (typeof AREAS)[number];
type KeysOf<T> = T extends { en: infer E } ? keyof E : never;
/** The key type. English is the source, so every key exists in en. */
export type Key = KeysOf<AreaModule>;

type Table = Partial<Record<string, Message>>;
const tables = Object.fromEntries(LOCALES.map((l) => [l, {}])) as Record<Locale, Table>;
const duplicates: string[] = [];
const seen = new Set<string>();
for (const area of AREAS) {
  for (const [key, message] of Object.entries(area.en as Table)) {
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
    tables.en[key] = message;
  }
}

// The server has every language here (catalog.ts); the browser starts with English only (catalog.client.ts) and loads
// its own language before it hydrates.
for (const [locale, table] of Object.entries(PRELOADED) as [Locale, Table][]) tables[locale] = table;
// On the server every language is ready, even one with no words yet (it falls back to English); in the browser, the ones it has.
const ready = new Set<Locale>(seen.size ? LOCALES : LOCALES.filter((locale) => Object.keys(tables[locale]).length > 0));
const loading = new Map<Locale, Promise<void>>();

/** Whether a language's words are here, so translate() gives them rather than English. Always true on the server. */
export function hasLocale(locale: Locale): boolean {
  return ready.has(locale);
}

/**
 * Makes a language's words available. The server has every language from the start, so this resolves at once; the
 * browser fetches the language's chunk the first time. Await it before rendering in that language.
 */
export function loadLocale(locale: Locale): Promise<void> {
  if (ready.has(locale)) return Promise.resolve();
  let pending = loading.get(locale);
  if (!pending) {
    pending = loadTable(locale).then(
      (table) => {
        tables[locale] = table;
        ready.add(locale);
      },
      (error: unknown) => {
        // A failed chunk (offline, a deploy replaced it) may be retried on the next attempt.
        loading.delete(locale);
        throw error;
      },
    );
    loading.set(locale, pending);
  }
  return pending;
}

/** The English keys, in area order. In the browser, the keys of the English table it ships. */
export const KEYS = (seen.size ? [...seen] : Object.keys(tables.en)) as Key[];
/** Keys that appear in more than one area. Must be empty; the test checks it. */
export const DUPLICATE_KEYS: readonly string[] = duplicates;

/** Keys with no entry in a locale. English is complete by definition; a complete language must have none (the test). */
export function missingKeys(locale: Locale): Key[] {
  return KEYS.filter((key) => tables[locale][key] === undefined);
}

/** One language's own table, as the catalog holds it: for the checks (check.ts), which compare it with English. */
export function tableOf(locale: Locale): Readonly<Table> {
  return tables[locale];
}

/** The locale Intl formats with, for each language. */
export const locales = Object.fromEntries(LOCALES.map((l) => [l, LANGUAGES[l].intl])) as Record<Locale, string>;
/** Each language's own name, for the picker. */
export const LANGUAGE_NAME = Object.fromEntries(LOCALES.map((l) => [l, LANGUAGES[l].native])) as Record<Locale, string>;

const pluralRules = new Map<Locale, Intl.PluralRules>();
/** The CLDR plural category of a count in a language: "one", "few", "many", "other"… */
export function pluralCategory(locale: Locale, count: number): PluralCategory {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locales[locale])));
  return rules.select(count) as PluralCategory;
}

const warned = new Set<string>();
const DEV = typeof import.meta.env !== "undefined" && import.meta.env.DEV === true;

/** The message for a key, or English when this locale has none yet. */
function messageFor(locale: Locale, key: Key): Message {
  const entry = tables[locale][key];
  if (entry !== undefined) return entry;
  if (DEV && locale !== "en" && ready.has(locale) && !warned.has(`${locale}:${key}`)) {
    warned.add(`${locale}:${key}`);
    console.warn(`[i18n] Missing ${locale} key: ${key}`);
  }
  return tables.en[key] ?? key;
}

export function translate(locale: Locale, key: Key, vars: Vars = {}): string {
  const entry = messageFor(locale, key);
  // A plural gives the forms its language needs; a category it leaves out takes `other`.
  const text = typeof entry === "string" ? entry : (entry[pluralCategory(locale, Number(vars.count ?? 0))] ?? entry.other);
  return text.replace(/\{(\w+)\}/g, (all, k) =>
    // A year is a name for a time, not a quantity: "1985", never "1,985" or "1.985".
    vars[k] === undefined ? all : typeof vars[k] === "number" && !/year|decade/i.test(k) ? formatNumber(vars[k] as number, locale) : String(vars[k]),
  );
}

/**
 * A whole sentence split around the parts a screen fills in itself, so each language keeps its own word order:
 * "{author} hat einen Spruch von {subject} festgehalten" gives ["", {slot:"author"}, " hat einen Spruch von ", …].
 */
export function translateParts(locale: Locale, key: Key, slots: readonly string[], vars: Vars = {}): (string | { slot: string })[] {
  const marked: Vars = { ...vars };
  for (const s of slots) marked[s] = `\u0000${s}\u0000`;
  return translate(locale, key, marked)
    .split("\u0000")
    .map((part, i) => (i % 2 ? { slot: part } : part))
    .filter((part) => part !== "");
}

/**
 * Translates a message the server threw as English text. An exact English match wins; otherwise a key whose English
 * has {placeholders} matches the text with those parts filled in ("Birthday · 3 years" in any language).
 */
export function translateMessage(message: string, locale: Locale): string {
  const found = matchMessage(message);
  return found ? translate(locale, found.key, found.vars) : message;
}

/** Whether a thrown message is one written for readers: a key of the dictionary, or the English of one, filled in or not. */
export function isKnownMessage(message: string): boolean {
  return Object.hasOwn(tables.en, message) || matchMessage(message) !== null;
}

function matchMessage(message: string): { key: Key; vars?: Vars } | null {
  const key = KEYS.find((k) => tables.en[k] === message);
  if (key) return { key };
  for (const k of KEYS) {
    const english = tables.en[k];
    if (english === undefined) continue;
    // A plural entry is matched by any of its forms, so "1 house …" and "3 houses …" both find their key.
    for (const form of typeof english === "string" ? [english] : Object.values(english)) {
      if (!form?.includes("{")) continue;
      const matched = fillTemplate(form, message);
      if (matched) return { key: k, vars: matched };
    }
  }
  return null;
}

/** The placeholder values when `message` is the English `template` with its parts filled in, else null. */
function fillTemplate(template: string, message: string): Vars | null {
    const names: string[] = [];
    let literal = 0;
    const pattern = template
      .split(/(\{\w+\})/)
      .map((part) => {
        const named = /^\{(\w+)\}$/.exec(part);
        if (named) {
          names.push(named[1]);
          return "(.+?)";
        }
        literal += part.length;
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    // Templates with only a little fixed text would match too much; leave those alone.
    if (literal < 8) return null;
    const match = new RegExp(`^${pattern}$`, "s").exec(message);
    return match ? Object.fromEntries(names.map((n, i) => [n, match[i + 1]])) : null;
}

const collators = new Map<Locale, Intl.Collator>();
/**
 * Compares two names or places the way the reader's language sorts them: "Öberg" with the Os, "Müller" before
 * "Muzzy", "Anna 2" before "Anna 10". Use it for every list sorted for display.
 */
export function compareText(locale: Locale = "en"): (a: string, b: string) => number {
  let c = collators.get(locale);
  if (!c) collators.set(locale, (c = new Intl.Collator(locales[locale], { numeric: true })));
  return c.compare;
}

export function formatNumber(value: number, locale: Locale = "en", options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locales[locale], options).format(value);
}

// Engines disagree on abbreviated months: for British English Node and Workers say "Sept" and Safari says "Sep". A page drawn
// on the server must read the same in the browser, or React throws that page's text away and draws it again (error #418), so
// the abbreviated months are Kindred's own. Everything else about a date (order, punctuation) is left to Intl.
// The lists are in languages.ts (`shortMonths`).

/**
 * A date or time as Intl writes it for the reader's language, with an abbreviated month from Kindred's own list. Use it
 * wherever a date has `month: 'short'` or `dateStyle: 'medium'`, instead of Intl or toLocaleDateString (a test keeps it so).
 */
export function dateText(value: Date | number, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  const format = new Intl.DateTimeFormat(locales[locale], options);
  if (options.month !== "short" && options.dateStyle !== "medium") return format.format(value);
  const month = Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: format.resolvedOptions().timeZone }).format(value)) - 1;
  // A medium date is all numbers in German: only a month written in letters is replaced.
  return format.formatToParts(value).map((part) => (part.type === "month" && !/^\d+$/.test(part.value) ? LANGUAGES[locale].shortMonths[month] : part.value)).join("");
}

export function formatDate(
  value?: string | number | Date | null,
  locale: Locale = "en",
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^~?\d{4}(?:-\d{2}){0,2}$/.test(value)) {
    const [y, m, d] = value.replace(/^~/, "").split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(y, (m || 1) - 1, d || 1);
    const text = !m
      ? String(y)
      : dateText(date, locale, {
          year: "numeric",
          month: "long",
          ...(d ? { day: "numeric" as const } : {}),
          ...options,
          timeZone: "UTC",
        });
    return value.startsWith("~") ? translate(locale, "date.circa", { date: text }) : text;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : dateText(
        date,
        locale,
        // A date or time style cannot be mixed with the parts (Intl throws): a caller who gives one gets just that.
        options?.dateStyle || options?.timeStyle ? options : { day: "numeric", month: "long", year: "numeric", ...options },
      );
}

export function relativeTime(value: number | Date | null, locale: Locale = "en", now = Date.now()): string {
  if (value == null) return translate(locale, "time.never");
  const seconds = (Number(value) - now) / 1000;
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    Math.abs(seconds) < 60
      ? ["second", 1]
      : Math.abs(seconds) < 3600
        ? ["minute", 60]
        : Math.abs(seconds) < 86400
          ? ["hour", 3600]
          : Math.abs(seconds) < 2592000
            ? ["day", 86400]
            : Math.abs(seconds) < 31536000
              ? ["month", 2592000]
              : ["year", 31536000];
  return new Intl.RelativeTimeFormat(locales[locale], { numeric: "auto" }).format(Math.round(seconds / size), unit);
}

const EN_ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const DE_ORDINAL_WORDS = ["nullte", "erste", "zweite", "dritte", "vierte", "fünfte", "sechste", "siebte", "achte", "neunte", "zehnte"];
const AF_ORDINAL_WORDS = ["nulde", "eerste", "tweede", "derde", "vierde", "vyfde", "sesde", "sewende", "agste", "negende", "tiende"];

/**
 * Ordinals of the languages without a rule of their own here: a form for each of `Intl.PluralRules`' ordinal categories,
 * `{n}` the number. A translation lane confirms its language's line (docs/translating.md, "Numbers and dates").
 */
const ORDINAL_FORMS: Partial<Record<Locale, { other: string } & Partial<Record<PluralCategory, string>>>> = {
  es: { other: "{n}.º" },
  fr: { one: "{n}er", other: "{n}e" },
  it: { other: "{n}º" },
  nl: { other: "{n}e" },
  pl: { other: "{n}." },
  "pt-BR": { other: "{n}º" },
  ja: { other: "第{n}" },
  "zh-Hans": { other: "第{n}" },
};

export function ordinal(n: number, locale: Locale = "en"): string {
  const forms = ORDINAL_FORMS[locale];
  if (forms) {
    const category = new Intl.PluralRules(locales[locale], { type: "ordinal" }).select(n) as PluralCategory;
    return (forms[category] ?? forms.other).replace("{n}", String(n));
  }
  if (locale === "de") return `${n}.`;
  if (locale === "af") {
    // Afrikaans: eerste, agste and everything from twintigste up take -ste; past a hundred the last two digits
    // decide ("honderd-en-eerste", "honderd-en-tweede"), and a round hundred is "honderdste".
    const r = n >= 100 ? n % 100 : n;
    return `${n}${(n >= 100 && r === 0) || r === 1 || r === 8 || r >= 20 ? "ste" : "de"}`;
  }
  return (
    EN_ORDINALS[n] ??
    `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th")}`
  );
}

export const ordinalWord = (n: number, locale: Locale = "en") =>
  locale === "de"
    ? (DE_ORDINAL_WORDS[n] ?? `${n}.`)
    : locale === "af"
      ? (AF_ORDINAL_WORDS[n] ?? ordinal(n, locale))
      : ordinal(n, locale);
