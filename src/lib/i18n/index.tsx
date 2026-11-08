/** CONTRIBUTING: English is the source of truth. Add a namespaced key to en.ts, then de.ts.
 * Use const t = useT(); t('shell.tree', {count: 2}). Plurals use {one, other} and count.
 * German uses warm, consistent “du”. Never translate names or user-written archive content.
 * Pass locale explicitly to pure formatters on the server; never keep request locale in globals.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { en } from "./en";
import { de } from "./de";
import type { Kinship } from "../graph";
export type Locale = "en" | "de";
export type Key = keyof typeof en;
export type Message = string | { one: string; other: string };
export type Vars = Record<string, string | number>;
export const locales = { en: "en-GB", de: "de-DE" };
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
  return (
    (languages.find((x) => x.tag === "en" || x.tag === "de")?.tag as Locale) ??
    "en"
  );
}
const missing = new Set<string>();
export function translate(locale: Locale, key: Key, vars: Vars = {}): string {
  let entry: Message | undefined = locale === "de" ? de[key] : en[key];
  if (!entry) {
    if (import.meta.env.DEV && !missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] Missing German key: ${key}`);
    }
    entry = en[key];
  }
  const text =
    typeof entry === "string"
      ? entry
      : entry[
          new Intl.PluralRules(locales[locale]).select(
            Number(vars.count ?? 0),
          ) === "one"
            ? "one"
            : "other"
        ];
  return text.replace(/\{(\w+)\}/g, (all, k) =>
    vars[k] === undefined
      ? all
      : typeof vars[k] === "number"
        ? formatNumber(vars[k] as number, locale)
        : String(vars[k]),
  );
}
const Context = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>({ locale: "en", setLocale: () => {} });
export function I18nProvider({
  initialLocale,
  account,
  children,
}: {
  initialLocale: Locale;
  account?: string;
  children: ReactNode;
}) {
  const [locale, update] = useState(initialLocale);
  const key = `kindred:locale:${account ?? "guest"}`;
  function persist(next: Locale) {
    try {
      localStorage.setItem(key, next);
    } catch {}
    document.cookie = `kindred_locale_${encodeURIComponent(account ?? "guest")}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {}
    if (saved === "en" || saved === "de") {
      update(saved);
      persist(saved);
    } else update(initialLocale);
  }, [key, initialLocale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    const updateTitle = () => {
      const segments = window.location.pathname.split("/").filter(Boolean);
      const section = [
        "access",
        "almanac",
        "atlas",
        "chronicle",
        "contacts",
        "houses",
        "needed",
        "people",
      ].includes(segments[1] ?? "");
      if (
        !["signin", "setup"].includes(segments[0] ?? "") &&
        !(segments.length === 2 && section)
      )
        return;
      const next = localizeTitle(document.title, locale);
      if (next !== document.title) document.title = next;
    };
    updateTitle();
    const observer = new MutationObserver(updateTitle);
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [locale]);
  return (
    <Context.Provider
      value={{
        locale,
        setLocale(next) {
          persist(next);
          update(next);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useT() {
  const { locale, setLocale } = useContext(Context);
  return Object.assign(
    (key: Key, vars?: Vars) => translate(locale, key, vars),
    { locale, setLocale },
  );
}
export function LanguageSwitch() {
  const t = useT();
  return (
    <div className="seg" role="group" aria-label={t("common.language")}>
      {(["en", "de"] as const).map((l) => (
        <button
          type="button"
          className="btn"
          style={{ minHeight: 44, minWidth: 44 }}
          key={l}
          aria-label={l === "en" ? "English" : "Deutsch"}
          aria-pressed={t.locale === l}
          onClick={() => t.setLocale(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
export function formatNumber(
  value: number,
  locale: Locale = "en",
  options?: Intl.NumberFormatOptions,
) {
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
    return value.startsWith("~")
      ? `${locale === "de" ? "ca." : "c."} ${text}`
      : text;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(locales[locale], {
        day: "numeric",
        month: "long",
        year: "numeric",
        ...options,
      }).format(date);
}
export function relativeTime(
  value: number | Date | null,
  locale: Locale = "en",
  now = Date.now(),
): string {
  if (value == null) return locale === "de" ? "nie" : "never";
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
  return new Intl.RelativeTimeFormat(locales[locale], {
    numeric: "auto",
  }).format(Math.round(seconds / size), unit);
}
export function ordinal(n: number, locale: Locale = "en"): string {
  if (locale === "de") return `${n}.`;
  const words = [
    "zeroth",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
  ];
  return (
    words[n] ??
    `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th")}`
  );
}
export const ordinalWord = (n: number, locale: Locale = "en") =>
  locale === "de"
    ? ([
        "nullte",
        "erste",
        "zweite",
        "dritte",
        "vierte",
        "fünfte",
        "sechste",
        "siebte",
        "achte",
        "neunte",
        "zehnte",
      ][n] ?? `${n}.`)
    : ordinal(n, locale);
/** Accepts graph.kinship() without changing its backwards-compatible English label. */
export function kinshipLabel(
  k: Kinship | undefined | null,
  locale: Locale = "en",
): string {
  if (!k) return "";
  if (locale === "en") return k.label;
  const words: Record<string, string> = {
    you: "du",
    father: "Vater",
    mother: "Mutter",
    parent: "Elternteil",
    son: "Sohn",
    daughter: "Tochter",
    child: "Kind",
    grandfather: "Großvater",
    grandmother: "Großmutter",
    grandparent: "Großelternteil",
    grandson: "Enkel",
    granddaughter: "Enkelin",
    grandchild: "Enkelkind",
    brother: "Bruder",
    sister: "Schwester",
    sibling: "Geschwister",
    uncle: "Onkel",
    aunt: "Tante",
    pibling: "Onkel/Tante",
    nephew: "Neffe",
    niece: "Nichte",
    nibling: "Neffe/Nichte",
    husband: "Ehemann",
    wife: "Ehefrau",
    partner: "Partner/Partnerin",
    "father-in-law": "Schwiegervater",
    "mother-in-law": "Schwiegermutter",
    "parent-in-law": "Schwiegerelternteil",
    "son-in-law": "Schwiegersohn",
    "daughter-in-law": "Schwiegertochter",
    "child-in-law": "Schwiegerkind",
    "brother-in-law": "Schwager",
    "sister-in-law": "Schwägerin",
    "sibling-in-law": "Schwager/Schwägerin",
  };
  const render = (label: string): string => {
    if (words[label]) return words[label];
    const cousin = label.match(
      /^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/,
    );
    if (cousin) {
      const degree = cousin[2]
        ? [
            "",
            "first",
            "second",
            "third",
            "fourth",
            "fifth",
            "sixth",
            "seventh",
            "eighth",
            "ninth",
            "tenth",
          ].indexOf(cousin[2]) > 0
          ? [
              "",
              "first",
              "second",
              "third",
              "fourth",
              "fifth",
              "sixth",
              "seventh",
              "eighth",
              "ninth",
              "tenth",
            ].indexOf(cousin[2])
          : parseInt(cousin[2])
        : 1;
      return `${cousin[1] ? "Halb-" : ""}Cousin/Cousine${degree > 1 ? ` ${degree}. Grades` : ""}${cousin[3] ? `, ${cousin[3] === "once" ? "einmal" : cousin[3] === "twice" ? "zweimal" : `${parseInt(cousin[3])}-mal`} entfernt` : ""}`;
    }
    const great = label.match(/^(?:(\d+)× )?great-(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const base = render(great[2]);
      const collateral =
        /^(half-)?(uncle|aunt|pibling|nephew|niece|nibling)$/.test(great[2]);
      const count = collateral ? n - 1 : n;
      return `${count ? "Ur" + "ur".repeat(count - 1) : ""}${collateral ? (count ? "groß" : "Groß") : ""}${base.toLowerCase()}`;
    }
    if (label.startsWith("half-"))
      return `Halb${render(label.slice(5)).toLowerCase()}`;
    if (label.endsWith("-in-law"))
      return `${render(label.slice(0, -7))} (angeheiratet)`;
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) return `${render(spouse[2])} von ${render(spouse[1])}`;
    return label;
  };
  return render(k.label);
}

const titleWords: Record<string, string> = {
  "Sign in": "Anmelden",
  "Set up": "Einrichten",
  Invitation: "Einladung",
  Almanac: "Kalender",
  Contacts: "Kontakte",
  Register: "Verzeichnis",
  Houses: "Häuser",
  Needed: "Gesucht",
  Chronicle: "Chronik",
  Access: "Zugang",
  Tree: "Stammbaum",
};
export function localizeTitle(title: string, locale: Locale) {
  return title
    .split(" · ")
    .map((part, index) =>
      index > 0
        ? part
        : locale === "de"
          ? (titleWords[part] ?? part)
          : (Object.entries(titleWords).find(([, de]) => de === part)?.[0] ??
            part),
    )
    .join(" · ");
}

/** For legacy auth errors until the server returns message keys. Unknown diagnostics stay intact. */
export function translateMessage(message: string, locale: Locale): string {
  const key = (Object.keys(en) as Key[]).find((key) => en[key] === message);
  return key ? translate(locale, key) : message;
}
