/**
 * The browser's catalog, put in place of catalog.ts by vite.config.ts. All three languages together are about 210 kB
 * gzipped, so the browser ships English (the fallback, and the language server errors and the blazon are written in)
 * and fetches only the reader's other language, before hydration and when the picker changes it.
 */
import en from "virtual:kindred-locale/en";
import type { Locale, Message } from "./types.ts";

type Table = Partial<Record<string, Message>>;

/** No area modules: their words arrive as one generated table per language. */
export const AREAS = [] as const;

export const PRELOADED: Partial<Record<Locale, Table>> = { en };

const LOADERS: Record<Locale, () => Promise<{ default: Table }>> = {
  en: async () => ({ default: en }),
  de: () => import("virtual:kindred-locale/de"),
  af: () => import("virtual:kindred-locale/af"),
};

export async function loadTable(locale: Locale): Promise<Table> {
  return (await LOADERS[locale]()).default;
}
