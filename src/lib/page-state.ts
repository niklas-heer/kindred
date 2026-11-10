// What a list page remembers for the reader: its filters (for the tab's session) and where it was scrolled to.
// Used by the almanac, chronicle, contacts, needed and people pages.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { translate, type Locale } from './i18n/dictionary';

/**
 * State that survives leaving the page and coming back in the same tab. Restored after hydration, so stored
 * preferences never change server-rendered markup.
 *
 * With `inAddress` the setting is also kept in the address (`?limit=50`, named by the last part of the key), so a link
 * carries it; a number read from the address is never below 100, the smallest page of rows. A value equal to
 * `fallback` leaves the address clean.
 */
export function useRememberedState<T>(key: string, fallback: T, { inAddress = false }: { inAddress?: boolean } = {}): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored) as T);
      if (inAddress) {
        const raw = new URLSearchParams(location.search).get(key.split(':').at(-1)!);
        if (raw !== null) setValue((typeof fallback === 'boolean' ? raw === 'true' : typeof fallback === 'number' ? Math.max(100, Number(raw) || fallback) : raw) as T);
      }
    } catch { /* Private browsing can disable storage. */ }
    setReady(true);
    // fallback is only the value before anything is restored; a new one must not restore again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      if (inAddress) {
        const url = new URL(location.href);
        const param = key.split(':').at(-1)!;
        if (value === fallback) url.searchParams.delete(param);
        else url.searchParams.set(param, String(value));
        history.replaceState(history.state, '', url);
      }
    } catch { /* Keeping filters in memory still works. */ }
    // fallback only decides whether the address carries the setting; the saved value is written when the value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, ready]);
  return [value, setValue];
}

/**
 * Puts the page back where it was scrolled to when the reader returns, and notes the last person opened from it
 * (`kindred:last-visit`, with the link's own words as the name, else "your family" in the reader's language).
 */
export function usePageTrail(page: string, tree: string, locale: Locale) {
  // Read when a link is clicked, so a change of language does not set the page up again and scroll it back.
  const language = useRef(locale);
  language.current = locale;
  useEffect(() => {
    const key = `kindred:scroll:${tree}:${page}`;
    const restore = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, number>;
        for (const selector of [':root', '.page', '.reg-scroll']) {
          const el = document.querySelector(selector);
          if (el) el.scrollTop = saved[selector] ?? 0;
        }
      } catch {}
    };
    const timer = window.setTimeout(() => { restore(); document.addEventListener('scroll', scroll, true); }, 450);
    const scroll = () => {
      try { sessionStorage.setItem(key, JSON.stringify(Object.fromEntries([':root', '.page', '.reg-scroll'].map((selector) => [selector, document.querySelector(selector)?.scrollTop ?? 0])))); } catch {}
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (!link) return;
      const url = new URL(link.href);
      const person = url.searchParams.get('focus');
      if (person && url.pathname === `/${tree}`) {
        try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree, person, name: link.textContent?.trim() || translate(language.current, 'chronicle.your_family') })); } catch {}
      }
    };
    document.addEventListener('click', click, true);
    return () => { clearTimeout(timer); document.removeEventListener('scroll', scroll, true); document.removeEventListener('click', click, true); };
  }, [page, tree]);
}
