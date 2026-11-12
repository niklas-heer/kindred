/**
 * CONTRIBUTING: English is the source of truth. Add a namespaced key to the area file that owns the screen
 * (src/lib/i18n/areas/<area>.ts) and its words to src/lib/i18n/locales/<locale>/<area>.ts for de and af. Then use:
 * const t = useT(); t('shell.tree', {count: 2}). Plurals give a form per CLDR category ({one, other}; Polish adds few
 * and many) and use count. German uses warm, consistent "du". Afrikaans uses "jy". See docs/translating.md.
 * Never translate names or user-written archive content. Pass locale explicitly to pure formatters on the
 * server; never keep request locale in globals. See README.md.
 */
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { loadLocale, translate, translateParts, type Key, type Locale, type Vars } from "./dictionary";
import { localizeTitle } from "./titles";

export * from "./dictionary";

const Context = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** The languages this instance offers, English first (requestLocale); the pickers list only these. */
  offered: readonly Locale[];
}>({ locale: "en", setLocale: () => {}, offered: ["en"] });

/**
 * The language provider. Guests keep their choice in localStorage and a cookie. A signed-in reader's choice is
 * also saved on the account through `saveRemote`, and the server renders that stored value first on the next visit.
 */
export function I18nProvider({
  initialLocale,
  offered = [initialLocale],
  account,
  saveRemote,
  children,
}: {
  initialLocale: Locale;
  offered?: readonly Locale[];
  account?: string;
  saveRemote?: (locale: Locale) => Promise<unknown>;
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
    // A signed-in reader's stored locale is what the server rendered, so only guests reconcile with localStorage.
    if (account !== undefined) {
      update(initialLocale);
      return;
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {}
    // A language the instance no longer offers (or that was never one) is forgotten: the server's choice stands.
    if (!offered.includes(saved as Locale)) {
      update(initialLocale);
      return;
    }
    // The page was hydrated in initialLocale; another saved language has to arrive before the switch.
    let current = true;
    const next = saved as Locale;
    loadLocale(next).then(
      () => {
        if (!current) return;
        update(next);
        persist(next);
      },
      (error: unknown) => console.warn(`[i18n] The ${saved} words did not load`, error),
    );
    return () => {
      current = false;
    };
  // persist is recreated on every render but only reads key and account, which are already listed; offered is the
  // server's list, as constant as initialLocale, and its identity changes with each navigation's context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, initialLocale, account, offered.join()]);
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
        "gallery",
        "houses",
        "needed",
        "people",
      ].includes(segments[1] ?? "");
      if (!["signin", "setup"].includes(segments[0] ?? "") && !(segments.length === 2 && section)) return;
      const next = localizeTitle(document.title, locale);
      if (next !== document.title) document.title = next;
    };
    updateTitle();
    const observer = new MutationObserver(updateTitle);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);
  return (
    <Context.Provider
      value={{
        locale,
        offered,
        setLocale(next) {
          // The browser holds English and the language it was rendered in; any other is fetched before switching,
          // so the page never shows a mix of two languages.
          loadLocale(next).then(
            () => {
              persist(next);
              update(next);
              saveRemote?.(next).catch((error) => console.warn("[i18n] The language did not save to the account", error));
            },
            (error: unknown) => console.warn(`[i18n] The ${next} words did not load`, error),
          );
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useT() {
  const { locale, setLocale, offered } = useContext(Context);
  return Object.assign((key: Key, vars?: Vars) => translate(locale, key, vars), { locale, setLocale, offered });
}

/** The type of what useT() returns, for helpers that take the translator as an argument. */
export type Translator = ReturnType<typeof useT>;

/**
 * A whole sentence with React parts placed where the language puts them:
 * richText(t, 'chronicle.line.quote', { author: <b>…</b>, subject: <PersonLink … /> }).
 */
export function richText(t: Translator, key: Key, parts: Record<string, ReactNode>, vars?: Vars): ReactNode {
  return translateParts(t.locale, key, Object.keys(parts), vars).map((part, i) =>
    typeof part === "string" ? part : <Fragment key={i}>{parts[part.slot]}</Fragment>,
  );
}

// The language picker itself (the flag in the top bar and on sign-in pages) is in components/LanguagePicker.tsx.
