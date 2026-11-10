/**
 * The dictionary: every area's en, de and af tables merged, the typed key, translate() and the pure formatters.
 * No JSX and no React here, so the node test runner can load it. index.tsx re-exports all of it.
 */
import { AREAS, PRELOADED, loadTable } from "./catalog.ts";
import { LOCALES, type Locale, type Message, type Vars } from "./types.ts";

export { LOCALES, isLocale, type Locale, type Message, type Vars } from "./types.ts";
export { kinshipLabel, yourKinship, yourKinshipParts, type KinshipView } from "./kinship.ts";
export { localizeTitle } from "./titles.ts";

type AreaModule = (typeof AREAS)[number];
type KeysOf<T> = T extends { en: infer E } ? keyof E : never;
/** The key type. English is the source, so every key exists in en. */
export type Key = KeysOf<AreaModule>;

type Table = Partial<Record<string, Message>>;
const tables: Record<Locale, Table> = { en: {}, de: {}, af: {} };
const duplicates: string[] = [];
const seen = new Set<string>();
for (const area of AREAS) {
  for (const locale of LOCALES) {
    for (const [key, message] of Object.entries(area[locale] as Table)) {
      if (locale === "en") {
        if (seen.has(key)) duplicates.push(key);
        seen.add(key);
      }
      tables[locale][key] = message;
    }
  }
}

// The browser starts with English only (catalog.client.ts) and loads its own language before it hydrates.
for (const [locale, table] of Object.entries(PRELOADED) as [Locale, Table][]) tables[locale] = table;
const ready = new Set<Locale>(LOCALES.filter((locale) => Object.keys(tables[locale]).length > 0));
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

/** Keys with no entry in a locale. English is complete by definition; de should be, af may lag and falls back. */
export function missingKeys(locale: Locale): Key[] {
  return KEYS.filter((key) => tables[locale][key] === undefined);
}

export const locales: Record<Locale, string> = { en: "en-GB", de: "de-DE", af: "af-ZA" };
/** Each language's own name, for the picker. */
export const LANGUAGE_NAME: Record<Locale, string> = { en: "English", de: "Deutsch", af: "Afrikaans" };

export function negotiateLocale(header = ""): Locale {
  const languages = header
    .split(",")
    .map((part, i) => {
      const [tag, q] = part.trim().split(";q=");
      return {
        tag: tag.toLowerCase().split("-")[0],
        q: q === undefined ? 1 : Number(q),
        i,
      };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return (languages.find((x) => (LOCALES as readonly string[]).includes(x.tag))?.tag as Locale) ?? "en";
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
  const text =
    typeof entry === "string"
      ? entry
      : entry[new Intl.PluralRules(locales[locale]).select(Number(vars.count ?? 0)) === "one" ? "one" : "other"];
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
    // A plural entry is matched by either form, so "1 house …" and "3 houses …" both find their key.
    for (const form of typeof english === "string" ? [english] : [english.one, english.other]) {
      if (!form.includes("{")) continue;
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
      : new Intl.DateTimeFormat(locales[locale], {
          year: "numeric",
          month: "long",
          ...(d ? { day: "numeric" as const } : {}),
          ...options,
          timeZone: "UTC",
        }).format(date);
    const approx = locale === "de" ? "ca." : locale === "af" ? "ong." : "c.";
    return value.startsWith("~") ? `${approx} ${text}` : text;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(
        locales[locale],
        // A date or time style cannot be mixed with the parts (Intl throws): a caller who gives one gets just that.
        options?.dateStyle || options?.timeStyle ? options : { day: "numeric", month: "long", year: "numeric", ...options },
      ).format(date);
}

export function relativeTime(value: number | Date | null, locale: Locale = "en", now = Date.now()): string {
  if (value == null) return locale === "de" ? "nie" : locale === "af" ? "nooit" : "never";
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

export function ordinal(n: number, locale: Locale = "en"): string {
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
