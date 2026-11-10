import { useEffect, type RefObject } from 'react';

/** On a phone the sheet follows the visible part of the screen, so the composer stays above the on-screen keyboard. */
export function useViewportFit(asideRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = asideRef.current;
    if (!vv || !el) return;
    const fit = () => {
      if (window.matchMedia('(max-width: 640px)').matches) {
        el.style.height = `${vv.height}px`;
        el.style.top = `${vv.offsetTop}px`;
      } else {
        el.style.height = '';
        el.style.top = '';
      }
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, [asideRef]);
}
