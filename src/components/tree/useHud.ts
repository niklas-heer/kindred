import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { CanvasHandle } from '~/components/Canvas';

/**
 * The HUD over the tree (toolbar, banner, lens chip) wraps on narrow windows: this measures it, so centring and notices
 * clear it. Until the reader moves the camera (`camMoved`), a HUD that changes height (a lens chip, a late font) frames
 * the tree again, so the top generation always starts below it.
 */
export function useHud(hud: RefObject<HTMLDivElement | null>, canvas: RefObject<CanvasHandle | null>, camMoved: RefObject<boolean>, selNow: RefObject<string>) {
  const [hudH, setHudH] = useState(56);
  // The room the toolbar has (see useToolbarFit).
  const [hudW, setHudW] = useState(1200);
  const hudSeen = useRef<number | null>(null);
  useEffect(() => {
    const el = hud.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { height: h, width: w, bottom } = el.getBoundingClientRect();
      setHudH(h);
      setHudW(w);
      // Notices open just under the HUD, wherever the top bar puts it.
      document.documentElement.style.setProperty('--hud-bottom', `${Math.round(bottom + 8)}px`);
      if (hudSeen.current !== null && Math.abs(h - hudSeen.current) > 3 && !camMoved.current) {
        requestAnimationFrame(() => canvas.current?.frame(selNow.current, { animate: false }));
      }
      hudSeen.current = h;
    });
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--hud-bottom'); };
  // Once: the refs passed in are read when the HUD resizes, not watched.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { hudH, hudW };
}

/**
 * The toolbar is one row, whatever the language and typeface. It starts with everything named and in the row; while
 * that runs over the room it has, first the view buttons drop their names (1), then names and ages move behind the
 * Display button (2). Measured before paint, and again when the room, the words (`fit`) or the fonts change.
 */
export function useToolbarFit(toolbar: RefObject<HTMLDivElement | null>, phone: boolean, fit: unknown[]): 0 | 1 | 2 {
  const [tight, setTight] = useState<0 | 1 | 2>(0);
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    const bump = () => setFonts((n) => n + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    void document.fonts?.ready.then(bump);
    return () => mo.disconnect();
  }, []);
  const fitKey = [...fit, fonts].join('|');
  const fitFor = useRef('');
  // Deliberately after every render: the toolbar is measured again whenever its content or the room changes, and each
  // pass widens `tight` by one step at most, so it stops after two.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = toolbar.current;
    if (!el || phone) return;
    if (fitFor.current !== fitKey) {
      fitFor.current = fitKey;
      if (tight !== 0) { setTight(0); return; }
    }
    if (tight < 2 && el.scrollWidth > el.clientWidth) setTight((tight + 1) as 1 | 2);
  });
  return tight;
}
