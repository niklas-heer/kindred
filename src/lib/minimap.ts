// The minimap's arithmetic: how big it is, how world positions map onto it, how much each person may
// show at a given density, and the colours of the canvas's far-zoom shield (card.css) for a 2D context.
// No DOM here, so the rules are unit-tested (minimap.test.ts). components/Minimap.tsx does the painting.

/** How world units become minimap pixels: px = world * s + o. */
export interface MinimapFrame {
  width: number;
  height: number;
  s: number;
  ox: number;
  oy: number;
}

const MAX_W = 240, MAX_H = 180, MIN_W = 150, MIN_H = 72, PAD = 16;
/** Widest a card is ever drawn, so a family of three is a few shields rather than three posters. */
const MAX_CARD_PX = 30;

/** The map takes the tree's shape, within limits, so a tall dynasty is not a sliver in a wide box. */
export function minimapFrame(b: { x: number; y: number; w: number; h: number }, cardW: number): MinimapFrame {
  const cap = MAX_CARD_PX / cardW;
  const fit = Math.min((MAX_W - PAD) / b.w, (MAX_H - PAD) / b.h, cap);
  const width = Math.round(Math.max(MIN_W, b.w * fit + PAD));
  const height = Math.round(Math.max(MIN_H, b.h * fit + PAD));
  const s = Math.min((width - PAD) / b.w, (height - PAD) / b.h, cap);
  return { width, height, s, ox: (width - b.w * s) / 2 - b.x * s, oy: (height - b.h * s) / 2 - b.y * s };
}

/** A point on the map, in map pixels, as a world position: what a click or drag jumps to. */
export function mapToWorld(f: MinimapFrame, px: number, py: number): { x: number; y: number } {
  return { x: (px - f.ox) / f.s, y: (py - f.oy) / f.s };
}

export function worldToMap(f: MinimapFrame, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * f.s + f.ox, y: wy * f.s + f.oy };
}

export type MinimapStep = 'initials' | 'shields' | 'small' | 'dots';

export interface MinimapDensity {
  step: MinimapStep;
  /** Width of one person's mark, in map pixels. */
  width: number;
  /** Family lines, in map pixels, and how strongly they show. */
  lineWidth: number;
  lineAlpha: number;
  /** The rim that tells the living from the dead, in map pixels; 0 when a mark is too small for one. */
  rim: number;
}

/** Below this a capital stops being readable, on a phone or otherwise. */
export const MIN_LETTER_PX = 7.5;
/** The initial's size against the shield, a little fuller than the canvas's so it holds up at this scale. */
const LETTER_RATIO = 0.58;
const INITIALS_FROM = MIN_LETTER_PX / LETTER_RATIO;
const SHIELDS_FROM = 7;
const SMALL_FROM = 3;
/** A dot stays visible however wide the tree gets. */
const MIN_DOT_PX = 2;

/** What one person may show when a card is `cardPx` wide on the map. The lines stay at every step. */
export function minimapDensity(cardPx: number): MinimapDensity {
  if (cardPx >= INITIALS_FROM) return { step: 'initials', width: cardPx, lineWidth: 1.25, lineAlpha: 0.9, rim: 1.25 };
  if (cardPx >= SHIELDS_FROM) return { step: 'shields', width: cardPx, lineWidth: 1, lineAlpha: 0.85, rim: 0.9 };
  if (cardPx >= SMALL_FROM) return { step: 'small', width: cardPx, lineWidth: 0.75, lineAlpha: 0.7, rim: 0 };
  return { step: 'dots', width: Math.max(MIN_DOT_PX, cardPx), lineWidth: 0.5, lineAlpha: 0.5, rim: 0 };
}

export const letterPx = (width: number) => Math.max(MIN_LETTER_PX, width * LETTER_RATIO);

/** Mix two #rrggbb colours: t = 1 is all `a`. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const x = h.replace('#', '');
    const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
  };
  const [ca, cb] = [p(a), p(b)];
  return '#' + ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}

export interface ShieldPaint {
  top: string;
  bottom: string;
  /** Paper's edge in the house's ink; the dark themes have none. */
  edge?: string;
  letter: string;
  letterAlpha: number;
  /** The flat fill of a mark too small for a rim, where colour alone has to tell the living from the dead. */
  dot: string;
}

/** The far-zoom shield of card.css, as colours. `house` and `ink` are the pair from shieldColours(). */
export function shieldPaint(light: boolean, house: string, ink: string, living: boolean, ground: string): ShieldPaint {
  if (light) {
    return living
      ? { top: mixHex(ink, '#ffffff', 0.22), bottom: mixHex(ink, '#ffffff', 0.22), edge: ink, letter: mixHex(ink, '#1f1d1a', 0.7), letterAlpha: 0.75, dot: ink }
      : { top: '#f7f5f1', bottom: '#f7f5f1', edge: mixHex(ink, '#ffffff', 0.62), letter: mixHex(ink, '#1f1d1a', 0.7), letterAlpha: 0.6, dot: mixHex(ink, '#ffffff', 0.6) };
  }
  // Sable has no contrast on a dark ground at dot size, where there is no rim to carry it.
  const lifted = isBlack(house) ? '#5a5650' : house;
  return living
    ? { top: house, bottom: mixHex(house, '#000000', 0.68), letter: '#fbf1d6', letterAlpha: 0.85, dot: mixHex(lifted, '#ffffff', 0.88) }
    : { top: mixHex(house, '#3b3428', 0.46), bottom: mixHex(house, '#1d1a14', 0.34), letter: '#e9dcb8', letterAlpha: 0.7, dot: mixHex(lifted, ground, 0.68) };
}

const isBlack = (hex: string) => {
  const x = hex.replace('#', '');
  return parseInt(x.slice(0, 2), 16) + parseInt(x.slice(2, 4), 16) + parseInt(x.slice(4, 6), 16) < 120;
};
