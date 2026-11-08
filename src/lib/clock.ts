// The reader's calendar day, for anything counted from today: countdowns, ages, the almanac's dates.
//
// The server and the reader's browser can be in different time zones (a Cloudflare Worker runs in UTC), so
// on the days when the two disagree, a day count or a date drawn from "today" differs between the server's
// HTML and the first render in the browser, and hydration fails. So these values are client-only: the server
// draws nothing for them and the browser fills them in as soon as the page is running there (the same
// pattern as usePref and useIsClient).
import { useMemo, useSyncExternalStore } from 'react';

const never = () => () => {};
/** The reader's local midnight today, as a timestamp (a number, so the store can compare it cheaply). */
const dayStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** The start of the reader's day, or undefined on the server and during hydration. */
export function useToday(): Date | undefined {
  const stamp = useSyncExternalStore(never, dayStart, () => undefined);
  return useMemo(() => (stamp === undefined ? undefined : new Date(stamp)), [stamp]);
}
