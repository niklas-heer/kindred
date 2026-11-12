import { createServerFn } from "@tanstack/react-start";
import { negotiateLocale, type Locale } from "./dictionary.ts";

/** What the root route serialises so the server render and the hydration agree: the reader's language, and the instance's. */
export interface RequestLanguages {
  locale: Locale;
  /** The languages this instance offers (operator's choice, complete ones only), English first: the picker lists these. */
  offered: Locale[];
}

/**
 * The locale for this request. Order: the signed-in reader's saved account language, then the browser's cookie for that
 * reader (or for a guest), then Accept-Language, then English; a language the instance does not offer (the operator turned
 * it off, or it is not complete) is skipped, so a reader whose language was turned off gets the next one in that order.
 */
export const requestLocale = createServerFn({ method: "GET" }).handler(async (): Promise<RequestLanguages> => {
  const [{ getRequestHeader }, { currentSession }, { offeredLanguages }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("../auth/guard.server"),
    import("../operator/settings.server"),
  ]);
  const [{ user }, offered] = await Promise.all([currentSession(), offeredLanguages()]);
  const pick = (value: unknown): Locale | null => (offered.includes(value as Locale) ? (value as Locale) : null);
  const cookie = getRequestHeader("cookie") ?? "";
  const key = `kindred_locale_${encodeURIComponent(user?.id ?? "guest")}`;
  const chosen = cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(key + "="))
    ?.slice(key.length + 1);
  const locale = pick(user?.locale) ?? pick(chosen) ?? negotiateLocale(getRequestHeader("accept-language") ?? "", offered);
  return { locale, offered };
});
