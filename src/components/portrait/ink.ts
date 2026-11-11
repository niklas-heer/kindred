// The pen the portrait's hair and beard are drawn with: shapes given as a few points in units of the head, joined by
// smooth curves that come to a point where a lock ends. avatar.ts draws the rest of the portrait and hands these
// modules the head it drew, so hair sits on any face shape.
import { mixHex as mix } from '../../lib/portrait-look';

export type Detail = 'sm' | 'md' | 'lg';

const DARK = '#2a170f';
/** One decimal: a tenth of a unit is a fifth of a pixel on the largest portrait. */
export const n1 = (x: number) => String(Math.round(x * 10) / 10);
export const shade = (c: string, t = 0.5) => mix(c, DARK, t);
export const tint = (c: string, t = 0.3) => mix(c, '#fff8ee', t);

/**
 * A point of a shape: across and down in units of the head (0, 0 is its middle; ±1 across is its edge at that height,
 * −1 down is the crown and about 1.05 the chin), and what kind of point it is:
 * `c` a corner, where two locks meet or one ends; `h` a point of the hairline, which the hairline measure moves.
 */
export type Pt = readonly [u: number, v: number, kind?: string];

export interface XY { x: number; y: number; c: boolean }

/** The head the hair and the beard sit on. */
export interface Head {
  cx: number; cy: number;
  /** Half the head's width and height. */
  w: number; h: number;
  /** Half the head's width at this height on the page: the face's own outline, whatever its shape, jaw and build. */
  halfAt: (y: number) => number;
  /** How far the hairline measure moves the hairline, in head units (negative lowers it). */
  hs: number;
}

/** Where a point of a shape falls on the page. Across is measured in the head's width at that height, so hair hugs any face. */
export function place(head: Head, [u, v, kind = '']: Pt): XY {
  const vv = kind.includes('h') ? v - head.hs : v;
  const k = head.halfAt(head.cy + Math.max(-0.62, Math.min(0.3, vv)) * head.h) / head.w;
  return { x: head.cx + u * head.w * k, y: head.cy + vv * head.h, c: kind.includes('c') };
}

/**
 * The curves from each point to the next (Catmull-Rom, as cubic Béziers). A corner takes no tangent, so a curve arrives
 * at it straight: between two corners it is a line, and a smooth point between two corners makes one lobe.
 */
export function segments(P: XY[], closed: boolean): string[] {
  const N = P.length;
  const out: string[] = [];
  for (let i = 0; i < (closed ? N : N - 1); i++) {
    const p1 = P[i];
    const p2 = P[(i + 1) % N];
    const p0 = closed ? P[(i - 1 + N) % N] : P[i - 1] ?? p1;
    const p3 = closed ? P[(i + 2) % N] : P[i + 2] ?? p2;
    if (p1.c && p2.c) {
      out.push(`L${n1(p2.x)} ${n1(p2.y)}`);
      continue;
    }
    const a = p1.c ? p1 : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const b = p2.c ? p2 : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    out.push(`C${n1(a.x)} ${n1(a.y)} ${n1(b.x)} ${n1(b.y)} ${n1(p2.x)} ${n1(p2.y)}`);
  }
  return out;
}

const start = (p: XY) => `M${n1(p.x)} ${n1(p.y)}`;
/** A closed shape through the points. */
export const closedPath = (P: XY[]) => start(P[0]) + segments(P, true).join('') + 'Z';
/** A line through the points. */
export const openPath = (P: XY[]) => start(P[0]) + segments(P, false).join('');

/**
 * A shape with two edges: the outer one, and the inner one where it lies on the skin. Returns the whole shape and the
 * inner edge alone, as the same curves, so a rim drawn along it lies exactly on the shape's edge.
 */
export function twoEdged(outer: XY[], inner: XY[]): { d: string; rim: string } {
  const all = [...outer, ...inner];
  const segs = segments(all, true);
  return {
    d: start(all[0]) + segs.join('') + 'Z',
    rim: start(inner[0]) + segs.slice(outer.length, outer.length + inner.length - 1).join(''),
  };
}

/** The same points on the other side of the face, in the opposite order. */
export const mirrored = (pts: readonly Pt[]): Pt[] => pts.map(([u, v, k]) => [-u, v, k] as Pt).reverse();

/** Points along a closed smooth outline, a few to each curve: enough to ask how wide the head is at a height. */
export function sampleClosed(pts: [number, number][], per = 8): [number, number][] {
  const N = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const m = 1 - t;
      out.push([
        m * m * m * p1[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * p2[0],
        m * m * m * p1[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  return out;
}

/** Half the width of a closed outline at each height, from its sampled points: the widest point at or near that height. */
export function halfWidth(samples: [number, number][], cx: number): (y: number) => number {
  // The right-hand side from the top down, as a list of (y, x) to interpolate in.
  const right = samples.filter(([x]) => x >= cx).sort((a, b) => a[1] - b[1]);
  return (y: number) => {
    if (y <= right[0][1]) return right[0][0] - cx;
    for (let i = 1; i < right.length; i++) {
      if (right[i][1] >= y) {
        const [x0, y0] = right[i - 1];
        const [x1, y1] = right[i];
        const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
        return x0 + (x1 - x0) * t - cx;
      }
    }
    return right[right.length - 1][0] - cx;
  };
}
