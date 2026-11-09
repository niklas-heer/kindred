/**
 * Builds the browser's per-language tables (catalog.client.ts) from the area files, for vite.config.ts. It runs in Node
 * at build time, never in the app.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isLocale, type Locale, type Message } from "./types.ts";

export const VIRTUAL_LOCALE = "virtual:kindred-locale/";

/** The area files, which a dev server watches so an edited string reaches the browser. */
export function areaFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Every area's entries in one language. Each file is imported under its modification time, so a dev server that
 * regenerates the table after an edit reads the new text rather than Node's cached module.
 */
export async function browserTable(dir: string, locale: Locale): Promise<Record<string, Message>> {
  const table: Record<string, Message> = {};
  for (const file of areaFiles(dir)) {
    const area = (await import(`${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`)) as Partial<Record<Locale, Record<string, Message>>>;
    Object.assign(table, area[locale]);
  }
  return table;
}

/** The module's source: JSON.parse of a string parses faster than an object literal of the same size. */
export function tableModule(table: Record<string, Message>): string {
  return `export default JSON.parse(${JSON.stringify(JSON.stringify(table))});\n`;
}

/** The language a virtual module id names, or null for any other id. */
export function localeOfId(id: string): Locale | null {
  const name = id.replace(/^\0/, "");
  if (!name.startsWith(VIRTUAL_LOCALE)) return null;
  const locale = name.slice(VIRTUAL_LOCALE.length);
  return isLocale(locale) ? locale : null;
}
