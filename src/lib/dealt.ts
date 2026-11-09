// "Cards are dealt": the class that lets a list's first eight cards rise and fade in, once, when the page arrives
// (styles/dealt.css). It is there from the first render, the server's too, and is taken away when the cards are down.
import { useEffect, useState } from 'react';
import '~/styles/dealt.css';

/** `'dealt'` for the list's first moments, then `''`. Pass `ready` as false while the list is still loading. */
export function useDealt(ready = true): string {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => setOn(false), 700);
    return () => window.clearTimeout(id);
  }, [ready]);
  return on ? 'dealt' : '';
}
