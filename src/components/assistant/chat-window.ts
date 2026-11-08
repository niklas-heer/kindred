// Where the assistant's window sits on a desktop screen: the arithmetic for moving, resizing, docking and keeping it on
// screen, and what is remembered in this browser. No React and no DOM here, so the limits can be tested on their own.

export interface Rect { x: number; y: number; w: number; h: number }
export interface WindowLayout extends Rect { docked: boolean }
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const MIN_W = 320;
export const MIN_H = 420;
/** The gap a floating window keeps from the edges of the screen. */
export const MARGIN = 8;
const DEFAULT_W = 440;
const DEFAULT_H = 640;
export const STORAGE_KEY = 'kindred:assistant-window';

const limit = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
/** The largest a floating window can be on this screen, and the smallest (less than MIN on a very small screen). */
const maxW = (vw: number) => Math.max(0, vw - MARGIN * 2);
const maxH = (vh: number) => Math.max(0, vh - MARGIN * 2);
const minW = (vw: number) => Math.min(MIN_W, maxW(vw));
const minH = (vh: number) => Math.min(MIN_H, maxH(vh));

/** A window at the lower right, where a chat usually sits. */
export function defaultLayout(vw: number, vh: number): WindowLayout {
  const w = limit(DEFAULT_W, minW(vw), maxW(vw));
  const h = limit(DEFAULT_H, minH(vh), maxH(vh));
  return { x: vw - w - MARGIN, y: vh - h - MARGIN, w, h, docked: false };
}

/** The same window, made to fit: its size within the limits, and all of it on the screen. */
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = limit(r.w, minW(vw), maxW(vw));
  const h = limit(r.h, minH(vh), maxH(vh));
  return { x: limit(r.x, MARGIN, vw - MARGIN - w), y: limit(r.y, MARGIN, vh - MARGIN - h), w, h };
}

/** Where the window is really drawn: a docked one takes the full height against the right edge, at its own width. */
export function visibleRect(l: WindowLayout, vw: number, vh: number): Rect {
  if (!l.docked) return clampRect(l, vw, vh);
  const w = limit(l.w, Math.min(MIN_W, vw), vw - MARGIN);
  return { x: vw - w, y: 0, w, h: vh };
}

export const moveRect = (start: Rect, dx: number, dy: number, vw: number, vh: number): Rect =>
  clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh);

/** Drags one edge or corner: the opposite side stays where it is, even when the size reaches a limit. */
export function resizeRect(start: Rect, edge: Edge, dx: number, dy: number, vw: number, vh: number): Rect {
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let { x, y, w, h } = start;
  if (edge.includes('e')) w = limit(start.w + dx, minW(vw), vw - MARGIN - start.x);
  if (edge.includes('s')) h = limit(start.h + dy, minH(vh), vh - MARGIN - start.y);
  if (edge.includes('w')) {
    w = limit(start.w - dx, minW(vw), right - MARGIN);
    x = right - w;
  }
  if (edge.includes('n')) {
    h = limit(start.h - dy, minH(vh), bottom - MARGIN);
    y = bottom - h;
  }
  return { x, y, w, h };
}

/** A remembered layout, or null when what is stored is not one: it may be old, cut off, or edited by hand. */
export function parseLayout(raw: string | null): WindowLayout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WindowLayout>;
    if (![v.x, v.y, v.w, v.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return { x: v.x!, y: v.y!, w: v.w!, h: v.h!, docked: v.docked === true };
  } catch {
    return null;
  }
}
