import { useSyncExternalStore } from 'react';

/** A media query, live. False on the server and during hydration. */
export function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(q).matches,
    () => false,
  );
}
