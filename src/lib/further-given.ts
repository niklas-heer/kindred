// A person's further given names (second name, third name, and so on): kept in order after `given`, stored as a JSON
// array in person.further_given (migration 0021). Pure, so the server, the exchange code and the browser share it.

/** At most this many further names, each at most this long: what the Edit tab and the server accept. */
export const MAX_FURTHER = 10;
export const MAX_FURTHER_LENGTH = 120;

/** The names a stored column holds: blank entries and anything that is not a list of text are dropped. */
export function parseFurther(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const v: unknown = JSON.parse(stored);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [];
  } catch { return []; }
}

/** What a list of names is stored as: null when there is none, so an empty list and no list are the same. */
export function storeFurther(list: readonly string[] | null | undefined): string | null {
  const names = (list ?? []).map((x) => x.trim()).filter(Boolean);
  return names.length ? JSON.stringify(names) : null;
}

/** A person's given names as one string: the given name, then the further ones in order. */
export const allGiven = (given: string, further?: readonly string[]) => [given, ...(further ?? [])].filter(Boolean).join(' ');
