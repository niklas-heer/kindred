// Who is likely to be in a photograph, for the name picker that opens on a drawn face box: the people the family has
// already named in the same album, then those named in pictures from about the same time, then the reader's own
// family, then anyone alive when it was taken. Without this the picker opened on the family's oldest ancestors.
import type { MediaItem } from '../components/photos/types.ts';
import type { GPerson } from './types.ts';

/** Pictures this many years apart count as "about the same time". */
const NEAR_YEARS = 2;
const yearIn = (date: string | null | undefined) => {
  const y = date ? parseInt(date.replace(/^~/, ''), 10) : NaN;
  return Number.isFinite(y) ? y : null;
};

/** People named most often first; a tie keeps the order they were met in. */
function byCount(ids: string[]): string[] {
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * The ids to list first, most likely first. `near` is the reader and their closest family. People already named in
 * this picture are left out: they are in it once.
 */
export function photoSuggestions(item: MediaItem, all: MediaItem[], people: GPerson[], near: readonly string[] = []): string[] {
  const here = new Set(item.tags.map((t) => t.person));
  const others = all.filter((m) => m.key !== item.key);
  const named = (list: MediaItem[]) => list.flatMap((m) => m.tags.filter((t) => t.confirmed).map((t) => t.person));
  const year = yearIn(item.taken);
  const album = item.album ? byCount(named(others.filter((m) => m.album === item.album))) : [];
  const sameTime = year === null ? [] : byCount(named(others.filter((m) => {
    const y = yearIn(m.taken);
    return y !== null && Math.abs(y - year) <= NEAR_YEARS;
  })));
  const alive = year === null ? [] : people.filter((p) => {
    const born = yearIn(p.born), died = yearIn(p.died);
    return born !== null && born <= year && (died === null ? p.living || year - born < 100 : died >= year);
  }).map((p) => p.id);
  const known = new Set(people.map((p) => p.id));
  return [...new Set([...album, ...sameTime, ...near, ...alive])].filter((id) => known.has(id) && !here.has(id));
}
