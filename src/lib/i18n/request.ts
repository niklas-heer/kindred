import { createServerFn } from "@tanstack/react-start";
import { negotiateLocale, isLocale, type Locale } from "./dictionary.ts";

/**
 * The locale for this request, serialized by the root route so the server render and the hydration agree.
 * Order: the signed-in reader's saved account language, then the browser's cookie for that reader (or for
 * a guest), then Accept-Language, then English.
 */
export const requestLocale = createServerFn({ method: "GET" }).handler(async (): Promise<Locale> => {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const { currentSession } = await import("../auth/guard.server");
  const { user } = await currentSession();
  if (isLocale(user?.locale)) return user.locale;
  const cookie = getRequestHeader("cookie") ?? "";
  const key = `kindred_locale_${encodeURIComponent(user?.id ?? "guest")}`;
  const chosen = cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(key + "="))
    ?.slice(key.length + 1);
  return isLocale(chosen) ? chosen : negotiateLocale(getRequestHeader("accept-language") ?? "");
});
