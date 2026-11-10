// Where the thread is scrolled: at the newest message unless the reader has scrolled up to read, and per chat, where
// the reader left it.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { getTabs, updateTabs } from './chat-tabs';

/** What the thread holds and shows, as far as scrolling cares. `paused` while a family session hides the thread. */
interface ThreadContent { items: number; pending: string | null; busy: boolean; unsent: number; liveText: string | undefined; paused: boolean }

/**
 * `stick` says whether the thread follows its newest message; sending sets it. `away` is true when the reader has
 * scrolled away and new content waits behind "Jump to latest". `ready`: the chat's messages are here.
 */
export function useThreadScroll({ logRef, tree, conv, convRef, ready, content }: {
  logRef: RefObject<HTMLDivElement | null>; tree: string; conv: string | null; convRef: RefObject<string | null>; ready: boolean; content: ThreadContent;
}) {
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  // Resizing the window keeps the newest message in view, unless the reader has scrolled up.
  useEffect(() => {
    const el = logRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [logRef]);

  // Each chat comes back where the reader left it, once its messages are here.
  const placedConv = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || !conv || !ready || placedConv.current === conv) return;
    placedConv.current = conv;
    const spot = getTabs(tree).scroll[conv];
    stick.current = !spot || spot.atEnd;
    setAway(false);
    el.scrollTop = stick.current ? el.scrollHeight : spot.y;
  }, [logRef, conv, ready, tree]);

  // New content keeps the reader at the newest message, unless they have scrolled up to read; then it waits.
  const { items, pending, busy, unsent, liveText, paused } = content;
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || paused) return;
    // Instant, not smooth: a reply that lands mid-animation would leave the thread short of its newest message.
    if (items === 0 && pending === null && !busy && unsent === 0) el.scrollTop = 0;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    else setAway(true);
  }, [logRef, items, pending, busy, unsent, paused, liveText]);

  function onLogScroll() {
    const el = logRef.current;
    const c = convRef.current;
    if (!el || !c) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stick.current = near;
    if (near) setAway(false);
    updateTabs(tree, (s) => ({ ...s, scroll: { ...s.scroll, [c]: { y: el.scrollTop, atEnd: near } } }), true);
  }

  /** An instant jump: a smooth one can be cut short by the reply landing, and the reader would be left in the middle. */
  function jumpLatest() {
    const el = logRef.current;
    stick.current = true;
    setAway(false);
    if (el) el.scrollTop = el.scrollHeight;
  }

  return { stick, away, onLogScroll, jumpLatest };
}
