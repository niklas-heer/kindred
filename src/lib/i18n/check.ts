/**
 * The checks a translation passes (docs/translating.md): run by `node scripts/i18n-check.ts [locale]` for a translator, and
 * by the i18n tests for every complete language. Node only (it reads the glossaries and the source), never in the app.
 *
 * An error keeps a language from being complete; a warning is for a person to look at (a long button, an English word left
 * behind, a glossary term rendered another way) and may be fine.
 */
import { parse } from "@babel/parser";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEYS, tableOf, type Key } from "./dictionary.ts";
import { kinshipIsStub } from "./kinship.ts";
import { LANGUAGES, LOCALES, countCategories, type Locale, type PluralCategory } from "./languages.ts";
import { TITLE_WORDS } from "./titles.ts";
import type { Message } from "./types.ts";

export type Severity = "error" | "warning";
export type CheckName =
  | "missing" | "extra" | "placeholders" | "plurals" | "english" | "address" | "kinship" | "titles"
  | "length" | "leftover" | "glossary";
export interface Finding {
  locale: Locale;
  check: CheckName;
  severity: Severity;
  key?: string;
  /** What is wrong, for the person fixing it. */
  detail: string;
}

/** What each check looks for, in the order the report lists them. */
export const CHECKS: Record<CheckName, { severity: Severity; what: string }> = {
  missing: { severity: "error", what: "keys English has and this language does not" },
  extra: { severity: "error", what: "keys this language has and English does not" },
  placeholders: { severity: "error", what: "{placeholders} that differ from the English" },
  plurals: { severity: "error", what: "plural forms missing for a category a count reaches in this language, or forms it never uses" },
  english: { severity: "error", what: "entries still the English text (allowed only for the keys in the glossary's sameAsEnglish)" },
  address: { severity: "error", what: "the formal address where the language is informal (docs/translating.md, Tone)" },
  kinship: { severity: "error", what: "kinship words still the neutral stand-in (src/lib/i18n/kinship/<locale>.ts)" },
  titles: { severity: "error", what: "page-title section words without this language (src/lib/i18n/titles.ts)" },
  length: { severity: "warning", what: "a button or tab label more than 1.6 times as long as the English (and 7 characters longer)" },
  leftover: { severity: "warning", what: "English words left in a translation" },
  glossary: { severity: "warning", what: "a glossary term rendered another way than glossary/<locale>.json says" },
};

const I18N = fileURLToPath(new URL("./", import.meta.url));

/**
 * The keys of the vocabularies (docs/translating.md, "Vocabularies"): names of faiths, occupations, colours, favourites and
 * heraldic charges, and the unit words a pasted recipe is read with. They are single names and short words, many the same in two languages, so a translator is held to
 * giving every one (missing, extra) but not to the prose checks (still English, leftover words, address, glossary, length).
 */
export const VOCABULARY_KEY = /^(?:(?:faith\.(?:name|tradition)|occupation|colour|favourite|heraldry\.library)\.|recipes\.unitWords$)/;

/** Kindred's terms (glossary/en.json): each with its meaning for translators and the pattern that finds it in English. */
export interface EnglishGlossary {
  about: string;
  terms: Record<string, { meaning: string; match: string; case?: boolean; keys?: string }>;
}
/**
 * One language's glossary (glossary/<locale>.json). `terms`: how each term is rendered (`use`, for people) and the stems a
 * translation of a key with that term contains (`accept`, lower case). `sameAsEnglish`: keys whose entry may stay the
 * English text, each a name, a brand or a cognate. `ownWords`: words of the language that look like English ones ("also",
 * "die"), so the leftover check leaves them alone.
 */
export interface LocaleGlossary {
  terms?: Record<string, { use: string; accept: string[] }>;
  sameAsEnglish?: string[];
  ownWords?: string[];
}

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
};
export const englishGlossary = (): EnglishGlossary => readJson(join(I18N, "glossary", "en.json"), { about: "", terms: {} });
export const glossaryOf = (locale: Locale): LocaleGlossary => readJson(join(I18N, "glossary", `${locale}.json`), {});

/**
 * The formal address, where a language addresses the reader informally (docs/translating.md, "Tone"). A capital mid-sentence
 * is German's polite form; a sentence may still begin with "Sie" or "Ihre" for "they" and "their".
 */
const FORMAL: Partial<Record<Locale, RegExp>> = {
  de: /[\p{Ll},] (?:Sie|Ihr|Ihre[mnrs]?|Ihnen)\b/u,
  af: /(?:^|[\s(])[Uu](?:[\s.,!?)]|$)/u,
  es: /\b(?:usted(?:es)?|Ud|Uds)\b/iu,
  fr: /\bvous\b/iu,
  it: /[\p{Ll},] (?:Lei|La|Le|Suo|Sua|Suoi|Sue)\b/u,
  nl: /(?:^|[\s(])(?:[Uu]|[Uu]w)(?:[\s.,!?)]|$)/u,
  pl: /\b(?:Pan(?:i|a|u|em|ią)?|Państw(?:o|a)?)\b/u,
  // Brazilian Portuguese says "você"; "o senhor" and "a senhora" are the formal address.
  "pt-BR": /\b(?:[Oo] senhor|[Aa] senhora)\b/u,
  // Simplified Chinese addresses the reader with 你, not the honorific 您.
  "zh-Hans": /您/u,
};

/** Interface words that are never the same in another language, so one alone is enough to call an entry untranslated. */
const NEVER_THE_SAME = new Set(["save", "cancel", "delete", "remove", "edit", "add", "close", "open", "back", "next", "previous", "search", "loading", "retry", "confirm", "share", "download", "upload", "settings", "help", "yes", "no", "done", "error", "warning"]);

/** English words that, found in a translation and in that key's English, are probably left over. */
const ENGLISH_WORDS = new Set([
  "the", "and", "your", "you", "with", "from", "this", "that", "these", "those", "have", "has", "would", "been", "were", "which", "what",
  "when", "where", "who", "they", "their", "there", "into", "about", "after", "before", "could", "should", "not", "only", "than",
  "then", "them", "some", "any", "each", "every", "other", "more", "just", "still", "already", "again", "please", "family",
  "people", "tree", "story", "stories", "house", "houses", "steward", "stewards", "add", "added", "save",
  "saved", "cancel", "delete", "edit", "remove", "search", "settings", "nobody", "someone", "everyone", "nothing", "something", "today",
  "yesterday", "tomorrow", "month", "year", "years", "born", "died", "married", "children", "child", "parents", "father", "mother",
]);

/** The words of a message, without placeholders, numbers, symbols, addresses and web names. */
const wordsOf = (text: string) => text.replace(/\{\w+\}/g, " ").replace(/\S+[@.]\S+/g, " ").match(/\p{L}{2,}/gu) ?? [];
/** wordsOf() without quoted names ("Do Not Track"), settings (KINDRED_DEFAULT_TREE) and paths, which stay English. */
const proseWordsOf = (text: string) => wordsOf(text.replace(/[„“"«‘][^„“”"»’]*[“”"»’]/g, " ").replace(/\S*[_/]\S*/g, " "));
/** The placeholders of a text, sorted; {count} may be spelled out in a singular and {article} is English's "a" or "an". */
const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].filter((p) => p !== "count" && p !== "article").sort().join();
const formsOf = (m: Message): [PluralCategory | "text", string][] =>
  typeof m === "string" ? [["text", m]] : (Object.entries(m) as [PluralCategory, string][]).filter(([, v]) => typeof v === "string");
const enRules = new Intl.PluralRules(LANGUAGES.en.intl);
/** A whole number this language puts in a plural category, or null for one no whole number reaches. */
function sampleCount(locale: Locale, category: PluralCategory): number | null {
  const rules = new Intl.PluralRules(LANGUAGES[locale].intl);
  for (let n = 0; n <= 1000; n++) if (rules.select(n) === category) return n;
  return null;
}
/** The text a message shows for a count: its form for the count's category, else `other`. */
const textFor = (m: Message, category: PluralCategory) => (typeof m === "string" ? m : (m[category] ?? m.other));

/**
 * Keys whose words a button or a tab shows: `t('…')` written among the children of a `<button>`, a `*Button` component or a
 * `<Tab>`, anywhere under `src/`. The length check holds them to 1.6 times the English, since a label that grows breaks a
 * row of buttons or tabs. Attributes (`aria-label`, `title`, handlers) do not count: they are not drawn in the button.
 */
export function buttonKeys(src = fileURLToPath(new URL("../../", import.meta.url))): Set<string> {
  const found = new Set<string>();
  const files = readdirSync(src, { recursive: true }).map(String).filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f));
  type Node = { type: string; [k: string]: unknown };
  const isButton = (name: string) => name === "button" || name === "Tab" || /Button$/.test(name);
  const nameOf = (el: Node) => {
    const n = (el.openingElement as Node).name as Node;
    return n.type === "JSXIdentifier" ? (n.name as string) : n.type === "JSXMemberExpression" ? ((n.property as Node).name as string) : "";
  };
  for (const file of files) {
    const ast = parse(readFileSync(join(src, file), "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: true }) as unknown as Node;
    const walk = (node: unknown, inButton: boolean) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const n of node) walk(n, inButton);
        return;
      }
      const n = node as Node;
      if (n.type === "JSXElement") {
        const here = inButton || isButton(nameOf(n));
        // Attributes are not the label: walk them as outside any button.
        walk((n.openingElement as Node).attributes, false);
        walk(n.children, here);
        return;
      }
      if (inButton && n.type === "CallExpression") {
        const callee = n.callee as Node;
        const arg = (n.arguments as Node[])[0];
        if (callee.type === "Identifier" && /^(?:t|c|tr)$/.test(callee.name as string) && arg?.type === "StringLiteral") found.add(arg.value as string);
      }
      for (const [k, v] of Object.entries(n)) if (k !== "loc" && k !== "start" && k !== "end" && typeof v === "object") walk(v, inButton);
    };
    walk(ast, false);
  }
  return found;
}

/**
 * Every check on one language. `buttons` is buttonKeys(), passed in so a run over many languages scans the source once.
 * `fixture` replaces the language's table and glossary (and narrows the keys to its own), for the checks' own tests.
 */
export function checkLocale(
  locale: Locale,
  buttons: ReadonlySet<string> = new Set(),
  fixture?: { table: Partial<Record<string, Message>>; glossary?: LocaleGlossary; keys: readonly Key[] },
): Finding[] {
  const out: Finding[] = [];
  const add = (check: CheckName, detail: string, key?: string) => out.push({ locale, check, severity: CHECKS[check].severity, key, detail });
  if (locale === "en") return out;
  const en = tableOf("en");
  const own = fixture?.table ?? tableOf(locale);
  const keys = fixture?.keys ?? KEYS;
  const glossary = fixture?.glossary ?? glossaryOf(locale);
  const same = new Set(glossary.sameAsEnglish ?? []);
  const ownWords = new Set((glossary.ownWords ?? []).map((w) => w.toLowerCase()));
  const needed = countCategories(locale);
  const allowed = new Set<string>(LANGUAGES[locale].plurals);
  const known = new Set<string>(KEYS);
  const terms = Object.entries(englishGlossary().terms).map(([term, t]) => ({
    term, match: new RegExp(t.match, t.case ? "u" : "iu"), keys: t.keys ? new RegExp(t.keys) : null, render: glossary.terms?.[term],
  }));

  for (const key of Object.keys(own)) if (!known.has(key)) add("extra", "not an English key", key);
  for (const key of keys.filter((k) => known.has(k))) {
    const english = en[key]!;
    const entry = own[key];
    if (entry === undefined) {
      add("missing", typeof english === "string" ? english : english.other, key);
      continue;
    }
    // Plurals: an English plural needs every category a count reaches here; a language with only `other` may give a string.
    if (typeof english !== "string") {
      const forms = typeof entry === "string" ? { other: entry } : entry;
      const lacking = needed.filter((c) => typeof (forms as Record<string, unknown>)[c] !== "string");
      if (typeof entry === "string" && needed.some((c) => c !== "other")) add("plurals", `a plain string where ${needed.join(", ")} are needed`, key);
      else if (lacking.length) add("plurals", `no ${lacking.join(", ")} form`, key);
    } else if (typeof entry !== "string") add("plurals", "plural forms where English has one sentence", key);
    if (typeof entry !== "string") {
      const unused = Object.keys(entry).filter((c) => !allowed.has(c));
      if (unused.length) add("plurals", `${unused.join(", ")}: not a category of this language`, key);
    }
    // Placeholders, form by form: each against the English form the same count shows ("one" in Polish for 1 against
    // English "one"; Polish "few" for 2 against English "other").
    for (const [form, text] of formsOf(entry)) {
      const n = form === "text" ? 2 : sampleCount(locale, form);
      const e = n === null ? english : textFor(english, enRules.select(n) as PluralCategory);
      const want = placeholders(typeof e === "string" ? e : e.other);
      const has = placeholders(text);
      if (has !== want) add("placeholders", `${form}: {${has}} where English has {${want}}`, key);
    }
    // Placeholders and plurals above hold for every key; the prose checks below are not for a vocabulary's names.
    if (VOCABULARY_KEY.test(key)) continue;
    // Still English: more than one word the same, or one everyday interface word.
    if (!same.has(key)) {
      for (const category of ["one", "other"] as const) {
        const e = textFor(english, category);
        if (textFor(entry, category) !== e) continue;
        const words = wordsOf(e);
        if (words.length > 1 || (words.length === 1 && NEVER_THE_SAME.has(words[0].toLowerCase()))) {
          add("english", e, key);
          break;
        }
      }
    }
    const texts = formsOf(entry).map(([, s]) => s);
    const formal = FORMAL[locale];
    if (formal && texts.some((s) => formal.test(s))) add("address", texts.join(" | "), key);
    // Buttons and tabs: no longer than 1.6 times the English.
    if (buttons.has(key)) {
      const e = textFor(english, "other").replace(/\{\w+\}/g, "").length;
      const t = textFor(entry, "other").replace(/\{\w+\}/g, "").length;
      if (e > 0 && t > e * 1.6 && t > e + 6) add("length", `${t} characters for English's ${e}: ${textFor(entry, "other")}`, key);
    }
    // English words left behind: an English word of this key's own English, in the translation.
    if (!same.has(key)) {
      const englishWords = new Set(formsOf(english).flatMap(([, s]) => wordsOf(s).map((w) => w.toLowerCase())));
      const left = [...new Set(texts.flatMap((s) => proseWordsOf(s).map((w) => w.toLowerCase())))].filter(
        (w) => ENGLISH_WORDS.has(w) && englishWords.has(w) && !ownWords.has(w),
      );
      if (left.length) add("leftover", `${left.join(", ")}: ${texts.join(" | ")}`, key);
    }
    // Glossary: a key whose English uses a term renders it as the glossary says.
    const englishText = formsOf(english).map(([, s]) => s).join(" ").replace(/\{\w+\}/g, " ");
    const lower = texts.join(" ").toLowerCase();
    for (const t of terms) {
      if (!t.match.test(englishText) || (t.keys && !t.keys.test(key))) continue;
      if (!t.render) continue;
      if (!t.render.accept.some((stem) => lower.includes(stem.toLowerCase()))) add("glossary", `"${t.term}" should be ${t.render.use}: ${texts.join(" | ")}`, key);
    }
  }
  // Every term has a rendering, so translators agree on it before the words are written.
  if (!fixture) for (const t of terms) if (!t.render) add("glossary", `no rendering of "${t.term}" in glossary/${locale}.json`);
  if (fixture) return out;
  if (kinshipIsStub(locale)) add("kinship", `src/lib/i18n/kinship/${locale}.ts is the neutral stand-in`);
  for (const [word, forms] of Object.entries(TITLE_WORDS)) if (!(forms as Record<string, string | undefined>)[locale]) add("titles", word);
  return out;
}

/** Every language's findings: all of them, or the ones given. */
export function checkAll(locales: readonly Locale[] = LOCALES.filter((l) => l !== "en")): Finding[] {
  const buttons = buttonKeys();
  return locales.flatMap((l) => checkLocale(l, buttons));
}
