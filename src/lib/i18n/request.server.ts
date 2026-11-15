import { negotiateLocale, type Locale } from "./dictionary.ts";
import type { RequestLanguages } from "./request.ts";

/**
 * The locale for this request (inside a server function). Order: the signed-in reader's saved account language, then the
 * browser's cookie for that reader (or for a guest), then Accept-Language, then English; a language the instance does not
 * offer (the operator turned it off, or it is not complete) is skipped, so a reader whose language was turned off gets the
 * next one in that order. The page is rendered in it (`requestLocale`), and a read that writes words for the reader (an arms
 * vote's question) uses it too.
 */
export async function localeOfRequest(): Promise<RequestLanguages> {
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
}
