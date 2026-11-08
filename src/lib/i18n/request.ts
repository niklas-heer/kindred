import { createServerFn } from "@tanstack/react-start";
import { negotiateLocale, type Locale } from "./index";
/** A per-request value, serialized by the root route for identical SSR and hydration. */
export const requestLocale = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { currentSession } = await import("../auth/guard.server");
    const { user } = await currentSession();
    const cookie = getRequestHeader("cookie") ?? "";
    const key = `kindred_locale_${encodeURIComponent(user?.id ?? "guest")}`;
    const chosen = cookie
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(key + "="))
      ?.slice(key.length + 1);
    return (
      (chosen === "en" || chosen === "de" ? chosen : undefined) ??
      negotiateLocale(getRequestHeader("accept-language"))
    );
  },
);
