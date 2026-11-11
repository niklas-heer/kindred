// Beards and moustaches. A beard is three choices: where it grows (its coverage), how long it is, and how it is cut at
// the chin. It follows the face's own outline, so it fits any jaw, and it is drawn behind the lips with the mouth left
// open in its shape: the first drawing painted a skin-coloured ellipse over the beard instead. A full beard stops at the
// corners of the mouth and under the lower lip. The upper lip belongs to the moustache, which is chosen on its own and
// drawn above the lips.
import type { MoustacheStyle } from '~/lib/seed-format';
import type { BeardCover, BeardShape } from '../../lib/portrait-look';
import { closedPath, n1, openPath, twoEdged, type Detail, type Head, type XY } from './ink';

export interface BeardInk { hair: string; shade: string; line: string; sw: number }
export interface BeardSpec { cover: BeardCover; /** 0 (close) to 10 (to the chest). */ length: number; shape: BeardShape }
/** The mouth the beard and the moustache are drawn around: its height on the page and half its width. */
export interface Mouth { y: number; wd: number }

const pt = (x: number, y: number, c = false): XY => ({ x, y, c });
/** The same points on the other side of the face, in the same order. */
const mirror = (P: XY[], cx: number): XY[] => P.map((p) => ({ ...p, x: 2 * cx - p.x }));
/** An edge given as its right half, from the top down to the middle of the chin: the whole of it, from the left top round to the right top. */
const around = (right: XY[], cx: number): XY[] => [...mirror(right, cx), ...right.slice(0, -1).reverse()];

const stroke = (d: string, colour: string, w: number, extra = '') =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${n1(w)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

/** How far a beard of this length hangs below the chin, in drawing units: a little at first, then quickly. */
const dropOf = (length: number) => 0.5 + 0.13 * length * length;

/**
 * The lower edge of a beard from the jaw to the middle of the chin, on the right: round, cut square, drawn to a point,
 * or forked. `xj`, `yj` is where it leaves the jaw; `low` is how far below the chin it reaches.
 */
function chinEdge(shape: BeardShape, cx: number, xj: number, yj: number, chin: number, low: number): XY[] {
  const dx = xj - cx;
  switch (shape) {
    case 'square':
      return [pt(xj, yj + low * 0.2), pt(cx + dx * 0.88, chin + low * 0.8), pt(cx + dx * 0.5, chin + low), pt(cx, chin + low * 0.98)];
    case 'pointed':
      return [pt(xj, yj), pt(cx + dx * 0.6, chin + low * 0.56), pt(cx + dx * 0.22, chin + low * 1.04), pt(cx, chin + low * 1.3, true)];
    case 'forked':
      return [pt(xj, yj), pt(cx + dx * 0.66, chin + low * 0.66), pt(cx + dx * 0.36, chin + low * 1.22, true), pt(cx + dx * 0.14, chin + low * 0.86), pt(cx, chin + low * 0.6, true)];
    default:
      return [pt(xj, yj), pt(cx + dx * 0.66, chin + low * 0.7), pt(cx + dx * 0.32, chin + low * 0.95), pt(cx, chin + low)];
  }
}

/** The beard, behind the lips. Empty for none. */
export function drawBeard(spec: BeardSpec, head: Head & { chin: number }, mouth: Mouth, ink: BeardInk, detail: Detail): string {
  if (spec.cover === 'none') return '';
  const { cx, cy, h, chin } = head;
  const { y: my, wd } = mouth;
  const L = Math.max(0, Math.min(10, spec.length));
  const fine = detail !== 'sm';
  /** A point on the face's edge at this height (in head units), `out` units beyond it. */
  const edge = (v: number, out = 0, c = false) => pt(cx + head.halfAt(cy + v * h) + out, cy + v * h, c);
  const fill = (d: string, extra = '') => `<path d="${d}" fill="${ink.hair}"${extra}/>`;
  const rim = (d: string) => (fine && d ? stroke(d, ink.line, ink.sw * 0.8) : '');
  // Under the lower lip, from the middle out to the corner of the mouth and a little above it.
  const underLip = [pt(cx, my + 3.2), pt(cx + wd * 0.6, my + 2.9), pt(cx + wd + 0.7, my + 1.3)];
  const top = -0.02;
  const half = (v: number) => head.halfAt(cy + v * h);
  // The cheek line: from beside the corner of the mouth, low across the cheek, up to the sideburn. `gap` is how far from the mouth it starts.
  const cheekLine = (gap: number) => [pt(cx + wd + gap, my - 0.9, true), pt(cx + half(0.56) * 0.54 + gap * 0.3, cy + 0.555 * h), pt(cx + half(0.46) * 0.76, cy + 0.45 * h), pt(cx + half(0.26) * 0.86, cy + 0.26 * h), pt(edge(top).x - 2.6, cy + top * h, true)];

  /** The whole jaw covered, from ear to ear: the shape of a full beard, and of stubble. */
  const full = (length: number, shape: BeardShape) => {
    const low = dropOf(length);
    const puff = 0.25 + 0.12 * length;
    const jaw = edge(0.78, puff);
    const right = [edge(top, 0, true), edge(0.25, puff * 0.4), edge(0.52, puff * 0.8), ...chinEdge(shape, cx, jaw.x, jaw.y + low * 0.3, chin, low)];
    const inner = [...underLip, ...cheekLine(1)];
    // The outer edge runs from the left sideburn round the chin to the right one; the inner one comes back.
    return twoEdged(around(right, cx), [...inner.slice().reverse(), ...mirror(inner, cx).slice(1)]);
  };

  switch (spec.cover) {
    case 'stubble': {
      // A day or two of growth: a shadow over the jaw and the upper lip, with no edge to it.
      const lip = closedPath([pt(cx - wd - 1.4, my - 0.4, true), pt(cx - wd * 0.7, my - 3), pt(cx, my - 3.7), pt(cx + wd * 0.7, my - 3), pt(cx + wd + 1.4, my - 0.4, true), pt(cx, my - 1.2)]);
      return `<path d="${full(0, 'round').d}${lip}" fill="${ink.shade}" opacity="${fine ? 0.26 : 0.3}"/>`;
    }
    case 'full': {
      const b = full(L, spec.shape);
      const low = dropOf(L);
      // Long enough to hang: a few lines of its fall, at the largest size.
      const fall = detail === 'lg' && L >= 4
        ? stroke(`M${n1(cx - 3.6)} ${n1(chin - 1)}q1 ${n1(low * 0.5)} .4 ${n1(low * 0.8)}M${n1(cx + 3.6)} ${n1(chin - 1)}q-1 ${n1(low * 0.5)} -.4 ${n1(low * 0.8)}${spec.shape === 'forked' ? '' : `M${n1(cx)} ${n1(chin)}l0 ${n1(low * 0.8)}`}`, ink.shade, 0.8)
        : '';
      return fill(b.d) + rim(b.rim) + fall;
    }
    case 'goatee':
    case 'circle': {
      const low = dropOf(L);
      const ring = spec.cover === 'circle';
      const xj = cx + wd + (ring ? 2.3 : 1.7);
      const lower = [pt(xj + 0.2, my + 2.6), ...chinEdge(spec.shape, cx, xj, chin - 1.6 + low * 0.2, chin, low)];
      if (!ring) {
        // On the chin alone: from under the corners of the mouth down.
        const d = closedPath([...around([pt(cx + wd + 0.9, my + 1.4, true), ...lower], cx), pt(cx + wd * 0.5, my + 2.9), pt(cx, my + 3.2), pt(cx - wd * 0.5, my + 2.9)]);
        return fill(d) + (fine ? stroke(d, ink.line, ink.sw * 0.6) : '');
      }
      // All the way round the mouth: the chin beard joined to a moustache, with the mouth left open in it.
      const right = [pt(cx, my - 3.8), pt(cx + wd + 1.2, my - 3.1), pt(cx + wd + 2.6, my - 0.4), ...lower];
      const outer = closedPath([...right, ...mirror(right, cx).reverse().slice(1, -1)]);
      const hole = closedPath([pt(cx - wd - 0.7, my - 0.3), pt(cx, my - 1.9), pt(cx + wd + 0.7, my - 0.3), pt(cx + wd * 0.6, my + 2.8), pt(cx, my + 3.2), pt(cx - wd * 0.6, my + 2.8)]);
      return fill(outer + hole, ' fill-rule="evenodd"') + (fine ? stroke(outer + hole, ink.line, ink.sw * 0.6) : '');
    }
    case 'chinstrap': {
      // A narrow line of beard along the jaw from ear to ear.
      const band = 1.8 + 0.22 * L;
      const side = (out: number, under: number) => {
        const right = [edge(top, out, true), edge(0.3, out), edge(0.56, out), edge(0.8, out), pt(cx + head.halfAt(cy + 0.8 * h) * 0.5, chin - 1.2 + under), pt(cx, chin + under)];
        return around(right, cx);
      };
      const s = twoEdged(side(0.3, 0.7), side(-band, -band).reverse());
      return fill(s.d) + rim(s.rim);
    }
    case 'sideburns':
    case 'muttonchops': {
      const chops = spec.cover === 'muttonchops';
      const puff = 0.3 + 0.14 * L;
      const len = 0.44 + 0.028 * L;
      const one = chops
        // Broad whiskers down the jaw and out over the cheek, stopping short of the chin.
        ? [edge(top, 0, true), edge(0.3, puff * 0.6), edge(0.6, puff), edge(0.86, puff * 0.7, true), pt(cx + wd + 2.8, my + 2.8), ...cheekLine(2.2)]
        : [edge(top, 0.1, true), edge(len * 0.5, 0.2), edge(len, 0.1, true), pt(edge(len).x - 2.7 - 0.1 * L, cy + (len - 0.03) * h, true), pt(edge(len * 0.5).x - 2.9, cy + len * 0.5 * h), pt(edge(top).x - 2.6, cy + top * h, true)];
      const d = closedPath(one) + closedPath(mirror(one, cx));
      // The rim is the edge on the cheek: everything after the jaw's own edge.
      const cut = chops ? 3 : 2;
      const inner = openPath(one.slice(cut)) + openPath(mirror(one.slice(cut), cx));
      return fill(d) + rim(inner);
    }
    case 'soul-patch': {
      const d = closedPath([pt(cx - 1.7, my + 3, true), pt(cx, my + 2.6), pt(cx + 1.7, my + 3, true), pt(cx, my + 3.8 + 2 + 0.34 * L, true)]);
      return fill(d) + (fine ? stroke(d, ink.line, ink.sw * 0.6) : '');
    }
  }
}

/** The moustache, over the lips. Its width follows the mouth's. */
export function drawMoustache(style: MoustacheStyle, head: Head, mouth: Mouth, ink: BeardInk, detail: Detail): string {
  if (style === 'none') return '';
  const { cx } = head;
  const y = mouth.y;
  // The drawings were made for an average mouth (3.8 half-width); a wider mouth has a wider moustache.
  const k = Math.max(0.8, Math.min(1.3, mouth.wd / 3.8));
  const P = (pts: [number, number, boolean?][]) => pts.map(([dx, dy, c]) => pt(cx + dx * k, y + dy, !!c));
  const fine = detail !== 'sm';
  const shape = (pts: [number, number, boolean?][]) => {
    const d = closedPath(P(pts));
    return `<path d="${d}" fill="${ink.hair}"/>` + (fine ? stroke(d, ink.line, ink.sw * 0.6) : '');
  };
  switch (style) {
    case 'pencil':
      // Two fine lines with a gap under the nose.
      return stroke(openPath(P([[-4.9, -1.2], [-2.7, -2.4], [-0.7, -2.1]])) + openPath(P([[0.7, -2.1], [2.7, -2.4], [4.9, -1.2]])), ink.hair, fine ? 1.1 : 1.4);
    case 'thin':
      return stroke(openPath(P([[-4.5, -0.7], [0, -2.6], [4.5, -0.7]])), ink.hair, fine ? 1.4 : 1.7);
    case 'chevron':
      return shape([[-5.4, -0.3, true], [-3.7, -3], [-1.3, -3.9], [0, -3.6], [1.3, -3.9], [3.7, -3], [5.4, -0.3, true], [2.7, -1.5], [0, -1.2], [-2.7, -1.5]]);
    case 'walrus':
      // Heavy, and hanging over the upper lip and the corners of the mouth.
      return shape([[-6.5, 1.7, true], [-5.7, -2.5], [-2.1, -4.3], [0, -4], [2.1, -4.3], [5.7, -2.5], [6.5, 1.7, true], [3.5, 0.2], [0, 0.7], [-3.5, 0.2]]);
    case 'handlebar':
      // Combed out to both sides and turned up at the ends.
      return shape([[-7.5, -4.4, true], [-6.9, -2.5], [-4.4, -3.1], [-1.3, -3.8], [0, -3.4], [1.3, -3.8], [4.4, -3.1], [6.9, -2.5], [7.5, -4.4, true], [8, -1.9], [5.7, -0.8], [2.6, -1.6], [0, -1.4], [-2.6, -1.6], [-5.7, -0.8], [-8, -1.9]]);
    case 'imperial':
      // Full, and waxed up into the cheeks at both ends.
      return shape([[-9.3, -7.2, true], [-8.9, -3.6], [-5.4, -3.6], [-1.4, -4.1], [0, -3.6], [1.4, -4.1], [5.4, -3.6], [8.9, -3.6], [9.3, -7.2, true], [10.4, -3.2], [7.6, -1], [3, -1.5], [0, -1.3], [-3, -1.5], [-7.6, -1], [-10.4, -3.2]]);
    case 'horseshoe':
      // Down past both corners of the mouth to the jaw.
      return shape([[-6, 6.4, true], [-6.3, -0.8], [-4.4, -3.4], [0, -3.7], [4.4, -3.4], [6.3, -0.8], [6, 6.4, true], [4, 6.4, true], [4.1, -0.3], [0, -1.5], [-4.1, -0.3], [-4, 6.4, true]]);
  }
}
