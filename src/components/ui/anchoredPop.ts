// Keeps a popover list anchored to its field: below it, or above when there is more room there, and never over it. Placed
// straight on the element every frame while open, so it follows the field through scrolling, a panel sliding in, a note
// appearing above or a phone keyboard opening, without re-rendering. In the top layer, so a dialog or a sticky bar never
// clips or covers it.
import { useLayoutEffect, type RefObject } from 'react';

function place(box: HTMLElement, el: HTMLElement) {
  const b = box.getBoundingClientRect();
  const vv = window.visualViewport;
  const top0 = vv ? vv.offsetTop : 0, bottom0 = vv ? vv.offsetTop + vv.height : innerHeight;
  const gap = 4, margin = 8;
  const below = bottom0 - b.bottom - gap - margin, above = b.top - top0 - gap - margin;
  const want = Math.min(380, el.scrollHeight || 380);
  const up = below < Math.min(want, 220) && above > below;
  // The list may be no taller than the room on its side; above the field it hangs from its bottom
  // edge, so however tall the content grows it never reaches down over the field.
  const room = Math.floor(Math.max(48, Math.min(380, up ? above : below)));
  const width = Math.min(Math.max(b.width, 300), innerWidth - 16);
  const left = Math.max(8, Math.min(b.left, innerWidth - width - 8));
  const next: Record<'top' | 'bottom' | 'left' | 'width' | 'maxHeight', string> = {
    top: up ? 'auto' : `${Math.round(b.bottom + gap)}px`,
    bottom: up ? `${Math.round(innerHeight - b.top + gap)}px` : 'auto',
    left: `${Math.round(left)}px`, width: `${Math.round(width)}px`, maxHeight: `${room}px`,
  };
  for (const [k, v] of Object.entries(next) as [keyof typeof next, string][]) if (el.style[k] !== v) el.style[k] = v;
  el.dataset.side = up ? 'above' : 'below';
}

/** While `shown`, shows `pop` as a popover and keeps it anchored to `box`. */
export function useAnchoredPop(shown: boolean, box: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = pop.current;
    if (!shown || !el) return;
    try { if (!el.matches(':popover-open')) el.showPopover(); } catch {}
    const follow = () => { if (box.current) place(box.current, el); raf = requestAnimationFrame(follow); };
    let raf = requestAnimationFrame(follow);
    if (box.current) place(box.current, el);
    return () => { cancelAnimationFrame(raf); try { el.hidePopover(); } catch {} };
  }, [shown, box, pop]);
}
