// The assistant as a window on a desktop screen: dragged by its header, resized from its edges and corners, remembered
// in this browser, and kept on screen when the viewport shrinks. On a phone none of this applies: it stays a sheet.
//
// While a pointer is down the position goes straight to CSS variables on the window, so a long conversation is not
// rendered again on every pixel of a drag.
import { Minus, Move, PanelRight, PictureInPicture2, RotateCcw } from 'lucide-react';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useT } from '~/lib/i18n';
import { minimizeAssistant } from './store';
import { defaultLayout, moveRect, parseLayout, resizeRect, STORAGE_KEY, visibleRect, type Edge, type Rect, type WindowLayout } from './chat-window';

const PHONE = '(max-width: 640px)';
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const STEP = 16;

const subscribePhone = (l: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener('change', l);
  return () => mq.removeEventListener('change', l);
};

/** Whether the screen is phone-sized: then the assistant is a sheet, and page hotkeys stand aside while it is open. */
export const useIsPhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);

const viewport = () => ({ vw: window.innerWidth, vh: window.innerHeight });

// Storage can be missing or refused (a private window, cleared site data); the window then simply starts at its default.
function loadLayout(): WindowLayout {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(STORAGE_KEY); } catch { /* the default below */ }
  const { vw, vh } = viewport();
  return parseLayout(raw) ?? defaultLayout(vw, vh);
}
function saveLayout(l: WindowLayout | null) {
  try {
    if (l) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* not remembered, but it still works */ }
}

export function useChatWindow(windowRef: RefObject<HTMLElement | null>) {
  const phone = useIsPhone();
  const layout = useRef<WindowLayout>(loadLayout());
  const [docked, setDocked] = useState(layout.current.docked);
  const [said, setSaid] = useState('');

  /** Draws the layout, clamped to the screen as it is now. What is remembered stays as the reader left it, so a viewport that grows back restores it. */
  function draw() {
    const el = windowRef.current;
    if (!el) return;
    const { vw, vh } = viewport();
    const r = visibleRect(layout.current, vw, vh);
    el.style.setProperty('--ai-x', `${r.x}px`);
    el.style.setProperty('--ai-y', `${r.y}px`);
    el.style.setProperty('--ai-w', `${r.w}px`);
    el.style.setProperty('--ai-h', `${r.h}px`);
  }

  useLayoutEffect(() => {
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [docked]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Follows a pointer from this element until it is let go, then remembers where the window ended up. */
  function track(e: PointerEvent<HTMLElement>, next: (start: Rect, dx: number, dy: number, vw: number, vh: number) => Rect) {
    const el = e.currentTarget;
    const { vw, vh } = viewport();
    const start = visibleRect(layout.current, vw, vh);
    const sx = e.clientX;
    const sy = e.clientY;
    const id = e.pointerId;
    e.preventDefault();
    el.setPointerCapture(id);
    windowRef.current?.classList.add('ai-dragging');
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== id) return;
      const now = viewport();
      layout.current = { ...next(start, ev.clientX - sx, ev.clientY - sy, now.vw, now.vh), docked: layout.current.docked };
      draw();
    };
    const end = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      windowRef.current?.classList.remove('ai-dragging');
      saveLayout(layout.current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** The header drags the window; its buttons stay buttons. */
  function onHeaderPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0 || phone || layout.current.docked) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    track(e, moveRect);
  }

  function onEdgePointerDown(e: PointerEvent<HTMLElement>, edge: Edge) {
    if (e.button !== 0 || phone) return;
    track(e, (start, dx, dy, vw, vh) => resizeRect(start, edge, dx, dy, vw, vh));
  }

  function setDock(next: boolean) {
    layout.current = { ...layout.current, docked: next };
    saveLayout(layout.current);
    setDocked(next);
    draw();
  }

  function reset() {
    const { vw, vh } = viewport();
    layout.current = defaultLayout(vw, vh);
    saveLayout(null);
    setDocked(false);
    draw();
  }

  /** The keyboard's way to do the same: arrows move, Shift and arrows resize. One stop in the tab order, for all eight handles. */
  function onGripKey(e: KeyboardEvent<HTMLButtonElement>, placed: (r: Rect) => string) {
    const dx = e.key === 'ArrowRight' ? STEP : e.key === 'ArrowLeft' ? -STEP : 0;
    const dy = e.key === 'ArrowDown' ? STEP : e.key === 'ArrowUp' ? -STEP : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const { vw, vh } = viewport();
    const start = visibleRect(layout.current, vw, vh);
    const isDocked = layout.current.docked;
    // A docked window has one edge to move, and nowhere to go.
    if (isDocked && !e.shiftKey) return;
    const next = e.shiftKey ? resizeRect(start, isDocked ? 'w' : 'se', dx, dy, vw, vh) : moveRect(start, dx, dy, vw, vh);
    layout.current = { ...next, docked: isDocked };
    saveLayout(layout.current);
    draw();
    setSaid(placed(visibleRect(layout.current, vw, vh)));
  }

  return { phone, docked, said, setDock, reset, onHeaderPointerDown, onEdgePointerDown, onGripKey };
}

export type ChatWindow = ReturnType<typeof useChatWindow>;

/** The window's own controls in its header: move and resize by keyboard, dock or float, and reset. Hidden on a phone. */
export function WindowControls({ win }: { win: ChatWindow }) {
  const t = useT();
  const placed = (r: Rect) => t('ai.winPlaced', { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  const dockLabel = t(win.docked ? 'ai.winFloat' : 'ai.winDock');
  return (
    <div className="ai-win-controls">
      <button type="button" className="btn ghost ai-icon ai-win-control ai-win-minimize" onClick={minimizeAssistant} aria-label={t('ai.winMinimize')} title={t('ai.winMinimize')}>
        <Minus size={15} aria-hidden />
      </button>
      <button type="button" className="btn ghost ai-icon ai-win-control ai-win-grip" onKeyDown={(e) => win.onGripKey(e, placed)} aria-label={t('ai.winMove')} title={t('ai.winMove')} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight">
        <Move size={15} aria-hidden />
      </button>
      <button type="button" className="btn ghost ai-icon ai-win-control" onClick={() => win.setDock(!win.docked)} aria-label={dockLabel} title={dockLabel}>
        {win.docked ? <PictureInPicture2 size={15} aria-hidden /> : <PanelRight size={15} aria-hidden />}
      </button>
      <button type="button" className="btn ghost ai-icon ai-win-control" onClick={win.reset} aria-label={t('ai.winReset')} title={t('ai.winReset')}>
        <RotateCcw size={15} aria-hidden />
      </button>
      <p className="ai-sr" role="status">{win.said}</p>
    </div>
  );
}

/** The strips along the window's edges and corners. Pointer only: the keyboard has the grip in the header. */
export function ResizeEdges({ win }: { win: ChatWindow }) {
  return (
    <>
      {EDGES.map((edge) => <div key={edge} className={`ai-rz ai-rz-${edge}`} aria-hidden onPointerDown={(e) => win.onEdgePointerDown(e, edge)} />)}
    </>
  );
}
