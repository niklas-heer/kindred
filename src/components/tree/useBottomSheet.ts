// Phone: the person panel is a bottom sheet (peek, half, full) over the tree, resized by dragging its grip.
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

export type Snap = 'peek' | 'half' | 'full';
/** Peek height of the bottom sheet: its grip, a small portrait, the name and the life dates. */
export const PEEK_H = 76; // matches .panel-sheet[data-snap='peek'] in tree.css

/** `page` is the tree page, which the sheet can cover entirely. */
export function useBottomSheet({ page, phone, panel, setPanel }: { page: RefObject<HTMLDivElement | null>; phone: boolean; panel: boolean; setPanel: (open: boolean) => void }) {
  const [snap, setSnap] = useState<Snap>('peek');
  const sheet = useRef<HTMLDivElement>(null);
  const [pageH, setPageH] = useState(700);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPageH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);
  const snapH = (s: Snap) => (s === 'peek' ? PEEK_H : s === 'half' ? Math.round(pageH * 0.55) : pageH);
  const sheetH = phone && panel ? snapH(snap) : 0;
  // A closed sheet opens at peek again, so the tree stays in view.
  useEffect(() => { if (!panel) setSnap('peek'); }, [panel]);

  // Drag the grip (or the peek) to resize; it settles on the nearest height.
  const drag = useRef<{ y: number; h: number; t: number; v: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    if (!phone || !(e.target as HTMLElement).closest('.sheet-bar, .sheet-peek-hit')) return;
    if ((e.target as HTMLElement).closest('.sheet-back')) return;
    drag.current = { y: e.clientY, h: sheet.current!.getBoundingClientRect().height, t: performance.now(), v: 0, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    if (!d.moved) try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    d.moved = true;
    const h = Math.max(PEEK_H * 0.6, Math.min(pageH, d.h - dy));
    const now = performance.now();
    d.v = (d.h - dy - (parseFloat(el.style.height) || d.h)) / Math.max(1, now - d.t);
    d.t = now;
    el.style.transition = 'none';
    el.style.height = `${h}px`;
    page.current?.style.setProperty('--sheet-h', `${h}px`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    const el = sheet.current;
    drag.current = null;
    if (!d?.moved || !el) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    // Where it would come to rest, given the flick.
    const h = el.getBoundingClientRect().height + d.v * 180;
    const order: Snap[] = ['peek', 'half', 'full'];
    const best = order.reduce((a, b) => (Math.abs(snapH(b) - h) < Math.abs(snapH(a) - h) ? b : a));
    el.style.transition = '';
    el.style.height = '';
    page.current?.style.removeProperty('--sheet-h');
    if (h < PEEK_H * 0.55) setPanel(false);
    else setSnap(best);
  };
  /** The grip: a step up, and from full back to peek. A click that ends a drag does nothing. */
  const cycle = () => {
    if (justDragged.current) return;
    setSnap((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'));
  };
  return { snap, setSnap, sheet, sheetH, justDragged, cycle, drag: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

/**
 * A sheet opened fully on a phone is a dialog: it takes the focus (unless something inside already has it), and gives
 * it back to the selected card once it closes, when focus was left nowhere.
 */
export function useSheetFocus(sheetDialog: boolean, sheet: RefObject<HTMLDivElement | null>, page: RefObject<HTMLDivElement | null>, sel: string) {
  const wasDialog = useRef(false);
  useEffect(() => {
    if (sheetDialog === wasDialog.current) return;
    wasDialog.current = sheetDialog;
    if (sheetDialog) {
      // Unless something inside already has it (the editor focuses its first field).
      if (!sheet.current?.contains(document.activeElement)) sheet.current?.focus({ preventScroll: true });
    } else if (!document.activeElement || document.activeElement === document.body) {
      // Back on the tree: to the card the sheet was about, when focus was left nowhere.
      page.current?.querySelector<HTMLElement>(`.world [data-person="${CSS.escape(sel)}"]`)?.focus({ preventScroll: true });
    }
  }, [sheetDialog]); // eslint-disable-line react-hooks/exhaustive-deps
}
