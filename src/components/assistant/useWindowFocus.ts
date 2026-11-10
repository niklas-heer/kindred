// Where the reader is working: in the assistant's window or on the page behind it. The window is not modal, so while
// the reader is on the page the page's keys are the page's.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { isTopOverlay, useOverlayLayer } from '~/components/ui/overlay';
import { ASSISTANT_FOCUS, takeFocusRequest } from './store';

/**
 * Follows focus and pointer into and out of the window (`asideRef`), gives focus back to where it came from when the
 * window closes, and takes Esc (`onEscape`, while the reader is in the window and nothing is open over it) and F6
 * (between the window and the page). `phone`: the window covers the page, so the page's keys stay quiet.
 * The handlers are the ones of the first render, as the listeners are made once.
 */
export function useWindowFocus({ asideRef, areaRef, phone, onEscape }: {
  asideRef: RefObject<HTMLElement | null>; areaRef: RefObject<HTMLTextAreaElement | null>; phone: boolean; onEscape: () => void;
}) {
  const returnTo = useRef<Element | null>(document.activeElement);
  const [inside, setInside] = useState(true);
  const insideRef = useRef(true);

  // Page hotkeys stay quiet while the reader is in the window, and always on a phone, where the sheet covers the page (ui/overlay.ts).
  const layer = useOverlayLayer(phone || inside);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  useEffect(() => {
    // A window that a reload put back leaves the focus where it is.
    if (takeFocusRequest()) areaRef.current?.focus();
    const back = returnTo.current as HTMLElement | null;
    // Focus goes back only if it was in the window: a reader who has moved on to the page keeps their place.
    return () => { if (insideRef.current || document.activeElement === document.body) back?.focus?.(); };
    // Once, when the window opens: the refs passed in are read then, not watched.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Follows where the reader is working, by focus and by pointer (a click on empty page moves no focus).
  useEffect(() => {
    const track = (e: Event) => {
      const now = !!asideRef.current?.contains(e.target as Node);
      insideRef.current = now;
      setInside(now);
    };
    const enter = () => {
      insideRef.current = true;
      setInside(true);
      areaRef.current?.focus();
    };
    // Esc closes from anywhere in the window, the list of chats and a popover inside it first. F6 moves between the window and the page.
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented && insideRef.current && isTopOverlay(layerRef.current)) {
        e.preventDefault();
        onEscape();
      } else if (e.key === 'F6' && !e.defaultPrevented) {
        e.preventDefault();
        if (!insideRef.current) return enter();
        insideRef.current = false;
        setInside(false);
        const back = returnTo.current as HTMLElement | null;
        if (back && back !== document.body && back.isConnected) back.focus();
        else (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    document.addEventListener('focusin', track);
    document.addEventListener('pointerdown', track, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener(ASSISTANT_FOCUS, enter);
    return () => {
      document.removeEventListener('focusin', track);
      document.removeEventListener('pointerdown', track, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(ASSISTANT_FOCUS, enter);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
