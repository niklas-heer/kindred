// A provider's structured output drops `maxLength`, `maxItems` and number bounds from the schema it is given, so the model
// never sees them. A limit that only lives in zod would refuse a whole good answer for being a little long. These helpers
// keep the limit in the schema (so the prompt can say it) but cut the value instead of refusing it. Pure; no imports.

/** Cuts a string to at most `n` characters. */
export const cutText = (n: number) => (s: string): string => (s.length <= n ? s : s.slice(0, n));

/** Keeps the first `n` items. */
export const firstOf = (n: number) => <T>(a: T[]): T[] => (a.length <= n ? a : a.slice(0, n));

/** Pulls a number into a range (and rounds it when asked). */
export const clampTo = (lo: number, hi: number, whole = false) => (x: number): number => {
  const n = whole ? Math.round(x) : x;
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
};
