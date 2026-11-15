import { createServerFn } from "@tanstack/react-start";
import type { Locale } from "./dictionary.ts";

/** What the root route serialises so the server render and the hydration agree: the reader's language, and the instance's. */
export interface RequestLanguages {
  locale: Locale;
  /** The languages this instance offers (operator's choice, complete ones only), English first: the picker lists these. */
  offered: Locale[];
}

/** The locale for this request and the instance's languages (request.server.ts), for the root route to serialise. */
export const requestLocale = createServerFn({ method: "GET" }).handler(async (): Promise<RequestLanguages> =>
  (await import("./request.server")).localeOfRequest());
