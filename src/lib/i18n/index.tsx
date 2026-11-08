/**
 * CONTRIBUTING: English is the source of truth. Add a namespaced key to the area file that owns the screen,
 * in en, de and af (src/lib/i18n/areas/<area>.ts). Then use: const t = useT(); t('shell.tree', {count: 2}).
 * Plurals use {one, other} and count. German uses warm, consistent "du". Afrikaans uses "jy".
 * Never translate names or user-written archive content. Pass locale explicitly to pure formatters on the
 * server; never keep request locale in globals. See README.md.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isLocale, translate, type Key, type Locale, type Vars } from "./dictionary";
import { localizeTitle } from "./titles";

export * from "./dictionary";

const Context = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>({ locale: "en", setLocale: () => {} });

/**
 * The language provider. Guests keep their choice in localStorage and a cookie. A signed-in reader's choice is
 * also saved on the account through `saveRemote`, and the server renders that stored value first on the next visit.
 */
export function I18nProvider({
  initialLocale,
  account,
  saveRemote,
  children,
}: {
  initialLocale: Locale;
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
    if (isLocale(saved)) {
      update(saved);
      persist(saved);
    } else update(initialLocale);
  }, [key, initialLocale, account]);
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
        setLocale(next) {
          persist(next);
          update(next);
          saveRemote?.(next).catch((error) => console.warn("[i18n] The language did not save to the account", error));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useT() {
  const { locale, setLocale } = useContext(Context);
  return Object.assign((key: Key, vars?: Vars) => translate(locale, key, vars), { locale, setLocale });
}

/** The type of what useT() returns, for helpers that take the translator as an argument. */
export type Translator = ReturnType<typeof useT>;

// The language picker itself (the flag in the top bar and on sign-in pages) is in components/LanguagePicker.tsx.
