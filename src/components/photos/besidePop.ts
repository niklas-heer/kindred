// Keeps a small panel beside the thing it is about: to its right, else its left, else under or over it, and always
// wholly inside the window. Placed on the element every frame while shown, so it follows a picture through scrolling
// and resizing. In the top layer (a popover), so the dialog it belongs to never clips it.
import { useLayoutEffect, type RefObject } from 'react';

function place(anchor: HTMLElement, el: HTMLElement) {
  const a = anchor.getBoundingClientRect();
  const vv = window.visualViewport;
  const top0 = vv ? vv.offsetTop : 0, height = vv ? vv.height : innerHeight;
  const gap = 10, margin = 8;
  const w = el.offsetWidth, h = el.offsetHeight;
  const fitsRight = a.right + gap + w + margin <= innerWidth;
  const fitsLeft = a.left - gap - w - margin >= 0;
  let left: number, top: number;
  if (fitsRight || fitsLeft) {
    left = fitsRight ? a.right + gap : a.left - gap - w;
    top = a.top;
  } else {
    // No room at either side (a phone): under the box, or over it when there is more room there.
    left = a.left + a.width / 2 - w / 2;
    const below = top0 + height - a.bottom, above = a.top - top0;
    top = below >= h + gap + margin || below >= above ? a.bottom + gap : a.top - gap - h;
  }
  left = Math.max(margin, Math.min(left, innerWidth - w - margin));
  top = Math.max(top0 + margin, Math.min(top, top0 + height - h - margin));
  const next = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
  if (el.style.left !== next.left) el.style.left = next.left;
  if (el.style.top !== next.top) el.style.top = next.top;
}

/** While `shown`, shows `pop` as a popover beside `anchor`. */
export function useBesidePop(shown: boolean, anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = pop.current;
    if (!shown || !el) return;
    try { if (!el.matches(':popover-open')) el.showPopover(); } catch {}
    const follow = () => { if (anchor.current) place(anchor.current, el); raf = requestAnimationFrame(follow); };
    if (anchor.current) place(anchor.current, el);
    let raf = requestAnimationFrame(follow);
    return () => { cancelAnimationFrame(raf); try { el.hidePopover(); } catch {} };
  }, [shown, anchor, pop]);
}
