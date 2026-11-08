/** The shared types of the dictionary. Kept apart from index.tsx so area files can import them without a cycle. */
export const LOCALES = ["en", "de", "af"] as const;
export type Locale = (typeof LOCALES)[number];
export type Message = string | { one: string; other: string };
export type Vars = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
