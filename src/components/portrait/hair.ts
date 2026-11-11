// Hair, drawn as silhouettes. Each style is its own shape in units of the head (see ink.ts): an outer edge with a few
// uneven lobes, and an inner edge where the hair lies on the skin, with the temple and the sideburn drawn in. The first
// drawing built every style from one dome and one hairline with the same dark outline all round, and they read as
// helmets. Here a style is a flat mass of colour; the larger sizes add a rim where hair meets skin, the shadow the
// fringe casts on the forehead, a highlight or two and a few lines of flow. The list size is the silhouette alone.
//
import type { HairStyle } from '~/lib/seed-format';
import { closedPath, mirrored, n1, openPath, place, segments, twoEdged, type Detail, type Head, type Pt, type XY } from './ink';

export interface HairParts { back: string; front: string; overBody: string }
/** The hair's colours: its fill, a shadow, the rim and a highlight, and the skin's shadow for what the fringe casts. */
export interface HairInk { hair: string; shade: string; line: string; light: string; skinShade: string; sw: number }

/** A mass of hair: its outer edge, and the inner edge that lies on skin (absent for hair that touches none). */
interface Mass {
  o: XY[];
  i?: XY[];
  /** Drawn thin, with the scalp showing through: shaved sides. */
  thin?: boolean;
  /** False for hair that does not cross the forehead, and so casts nothing on it. */
  cast?: boolean;
  /** Hair lying on hair (a plait over the crown, a roll at the temple): its whole outline is drawn, or it would not show. */
  edge?: boolean;
}
interface Line { at: XY[]; w: number }
interface Art {
  /** Behind the head and the shoulders. */
  back?: Mass[];
  /** Over the shoulders, behind the head. */
  body?: Mass[];
  /** Over the face. */
  front: Mass[];
  /** A highlight or two, following the hair's direction. */
  lights?: Line[];
  /** Lines of flow: a parting, the break between two locks. */
  flow?: Line[];
  /** Lines of flow on the hair behind the head and over the shoulders. */
  backFlow?: Line[];
  /** The shine of a bare scalp. */
  gleam?: Line[];
}

interface Kit {
  /** Places points given in head units. */
  at: (pts: readonly Pt[]) => XY[];
  /**
   * A run of lobes along a line: curls, or (`sharp`) the pointed ends of a choppy cut. `amp` is how far they stand out
   * in drawing units, to the left of the line's direction when positive.
   */
  lobes: (pts: readonly Pt[], count: number, amp: number, sharp?: boolean) => XY[];
  /** A plait along a line: a ribbon with a link at each step. */
  plait: (pts: readonly Pt[], links: number, width: number) => Mass;
  sm: boolean;
  lg: boolean;
}

// ---------- lobes ----------

/** Points along the smooth line through `P`, evenly spaced by length, each with the normal on its left. */
function along(P: XY[], count: number): { x: number; y: number; nx: number; ny: number }[] {
  // Sample the curve finely, then walk it.
  const fine: [number, number][] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let k = 0; k < 10; k++) {
      const t = k / 10;
      const m = 1 - t;
      fine.push([m * m * m * p1.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * p2.x, m * m * m * p1.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * p2.y]);
    }
  }
  const last = P[P.length - 1];
  fine.push([last.x, last.y]);
  const len = [0];
  for (let i = 1; i < fine.length; i++) len.push(len[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  const total = len[len.length - 1];
  const out = [];
  let j = 1;
  for (let s = 0; s < count; s++) {
    const want = (total * s) / (count - 1);
    while (j < fine.length - 1 && len[j] < want) j++;
    const t = len[j] === len[j - 1] ? 0 : (want - len[j - 1]) / (len[j] - len[j - 1]);
    const dx = fine[j][0] - fine[j - 1][0];
    const dy = fine[j][1] - fine[j - 1][1];
    const d = Math.hypot(dx, dy) || 1;
    out.push({ x: fine[j - 1][0] + dx * t, y: fine[j - 1][1] + dy * t, nx: dy / d, ny: -dx / d });
  }
  return out;
}

/** Uneven on purpose: no two neighbouring lobes the same size, and the same every time. */
const UNEVEN = [1, 0.72, 1.18, 0.86, 1.08, 0.78, 1.14, 0.92];

function lobesAlong(P: XY[], count: number, amp: number, sharp = false): XY[] {
  const pts = along(P, count * 2 + 1);
  return pts.map((p, i) => {
    if (i % 2 === 0) return { x: p.x, y: p.y, c: !sharp };
    const a = amp * UNEVEN[((i - 1) / 2) % UNEVEN.length];
    return { x: p.x + p.nx * a, y: p.y + p.ny * a, c: sharp };
  });
}

function plaitAlong(P: XY[], links: number, width: number): Mass {
  const down = lobesAlong(P, links, width / 2);
  const up = lobesAlong([...P].reverse(), links, width / 2);
  // The two sides share their first and last points: a plait is closed at both ends.
  return { o: [...down, ...up.slice(1, -1)] };
}

// ---------- the parts every style shares ----------

/** The right sideburn from its foot up to the temple, as the start of an inner edge. `foot` is how far down it comes. */
const burnUp = (foot = 0.1, inner = 0.86): Pt[] => [[inner + 0.01, foot, 'c'], [inner - 0.01, -0.16], [0.8, -0.38]];
/** The right side from above the ear down to the sideburn's foot, as the end of an outer edge. */
const sideDown = (foot = 0.1, out = 1.04): Pt[] => [[out + 0.01, -0.5], [out, -0.2], [0.995, foot + 0.02, 'c']];
/** A natural hairline from the right temple across the forehead to the left one: a little higher at each side of the middle. */
const HAIRLINE: Pt[] = [[0.62, -0.6, 'h'], [0.3, -0.66, 'h'], [0, -0.6, 'h'], [-0.32, -0.66, 'h'], [-0.63, -0.6, 'h']];
/** Hair drawn back off the forehead: a higher, rounder line. */
const DRAWN_BACK: Pt[] = [[0.56, -0.66, 'h'], [0.28, -0.74, 'h'], [0, -0.76, 'h'], [-0.28, -0.74, 'h'], [-0.56, -0.66, 'h']];
/** A close cap: the sides and the top of hair cut short, from the left sideburn over the crown to the right one. */
const cap = (top = 1.18, foot = 0.1, out = 1.04): Pt[] => [
  ...mirrored(sideDown(foot, out)), [-0.93, -0.9], [-0.56, -top + 0.06], [0, -top], [0.56, -top + 0.06], [0.93, -0.9], ...sideDown(foot, out),
];
/** Sides clipped so short the scalp shows through: what a fade, an undercut and a textured crop have under the top. */
const clipped = (at: Kit['at']): Mass => ({
  o: at([[-0.995, 0.08, 'c'], [-1.02, -0.2], [-1.02, -0.56], [-0.86, -0.92], [0, -1.04], [0.86, -0.92], [1.02, -0.56], [1.02, -0.2], [0.995, 0.08, 'c']]),
  i: at([[0.88, 0.06, 'c'], [0.85, -0.2], [0.78, -0.44], [0.4, -0.7], [-0.4, -0.7], [-0.78, -0.44], [-0.85, -0.2], [-0.88, 0.06, 'c']]),
  thin: true,
});
/** The crown of hair worn long, parted in the middle, with a curtain down each cheek to `tip`. */
const curtains = (tip: number, out = 1.16): { o: Pt[]; i: Pt[] } => ({
  o: [[-0.98, tip, 'c'], [-out - 0.01, tip - 0.4], [-out, -0.4], [-0.99, -0.92], [-0.56, -1.2], [-0.13, -1.26], [0, -1.2, 'c'], [0.13, -1.26], [0.56, -1.2], [0.99, -0.92], [out, -0.4], [out + 0.01, tip - 0.4], [0.98, tip, 'c']],
  i: [[0.9, tip - 0.3], [0.88, -0.1], [0.7, -0.42, 'h'], [0.36, -0.63, 'h'], [0, -0.75, 'ch'], [-0.36, -0.63, 'h'], [-0.7, -0.42, 'h'], [-0.88, -0.1], [-0.9, tip - 0.3]],
});
/** Hair hanging behind the head and the shoulders, down to `bottom`. */
const fall = (bottom: number, flare = 0): Pt[] => [
  [-0.6, -1.1], [-1.1, -0.3], [-1.22 - flare * 0.4, 0.5], [-1.32 - flare, bottom - 0.5], [-1.36 - flare, bottom, 'c'],
  [1.36 + flare, bottom, 'c'], [1.32 + flare, bottom - 0.5], [1.22 + flare * 0.4, 0.5], [1.1, -0.3], [0.6, -1.1],
];
/** A lock over the right shoulder, from under the ear down to `bottom`. */
const lock = (bottom: number): Pt[] => [[0.84, 0.3, 'c'], [1.2, 0.5], [1.34, 1.2], [1.28, bottom - 0.4], [1.02, bottom, 'c'], [0.74, bottom - 0.4], [0.66, 1.3], [0.74, 0.8]];
const leftOf = (pts: readonly Pt[]): Pt[] => pts.map(([u, v, k]) => [-u, v, k] as Pt);
/** Hair drawn back tight to the head: the cap of a ponytail, a bun, a plait. */
const drawnBack = (at: Kit['at']): Mass => ({ o: at(cap(1.16)), i: at([...burnUp(0.08), ...DRAWN_BACK, ...mirrored(burnUp(0.08))]) });
/** The lines of hair drawn back towards `u`, `v`. */
const pulled = (at: Kit['at'], u: number, v: number): Line[] => [
  { at: at([[-0.5, -0.68, 'h'], [(u - 0.5) / 2 - 0.1, (v - 0.68) / 2 - 0.1], [u - 0.1, v]]), w: 0.7 },
  { at: at([[0, -0.76, 'h'], [u / 2 + 0.05, (v - 0.76) / 2 - 0.08], [u, v]]), w: 0.7 },
  { at: at([[0.5, -0.68, 'h'], [(u + 0.5) / 2 + 0.1, (v - 0.68) / 2 - 0.06], [u + 0.1, v]]), w: 0.7 },
];
const SHEEN: Pt[] = [[-0.76, -0.84], [-0.44, -1.04], [0, -1.1]];

// ---------- the styles ----------

type Draw = (k: Kit) => Art;

const STYLES: Record<HairStyle, Draw> = {
  // A baby's first hair: a down over the crown, and one curl.
  tuft: ({ at }) => ({
    front: [
      { o: at([[-0.9, -0.5, 'c'], [-0.86, -0.92], [0, -1.03], [0.86, -0.92], [0.9, -0.5, 'c']]), i: at([[0.5, -0.72], [0, -0.66], [-0.5, -0.72]]), thin: true },
      { o: at([[-0.12, -0.96, 'c'], [-0.17, -1.2], [0.05, -1.31], [0.21, -1.18], [0.1, -1.09], [0.09, -0.96, 'c']]), edge: true },
    ],
  }),

  // ----- short -----

  // Cut close all over: it hugs the skull, and the hairline is a straight line with a square corner at each temple.
  cropped: ({ at }) => ({
    front: [{
      o: at(cap(1.11, 0, 1.02)),
      i: at([[0.875, -0.02, 'c'], [0.85, -0.2], [0.8, -0.42, 'c'], [0.67, -0.47, 'ch'], [0.63, -0.68, 'ch'], [0.3, -0.71, 'h'], [-0.3, -0.71, 'h'], [-0.63, -0.68, 'ch'], [-0.67, -0.47, 'ch'], [-0.8, -0.42, 'c'], [-0.85, -0.2], [-0.875, -0.02, 'c']]),
    }],
    lights: [{ at: at([[-0.74, -0.82], [-0.44, -0.98], [0, -1.03]]), w: 1.2 }],
  }),
  // The everyday short cut: full and round on top, with a soft fringe falling forward in two or three locks.
  short: ({ at, lobes, sm }) => ({
    front: [{
      o: at([...mirrored(sideDown(0.12, 1.06)), [-1.01, -0.9], [-0.66, -1.21], [-0.12, -1.31], [0.4, -1.28], [0.8, -1.12], [1.01, -0.86], ...sideDown(0.12, 1.06)]),
      i: [...at(burnUp(0.1)), ...lobes([[0.7, -0.6, 'h'], [0.3, -0.56, 'h'], [-0.2, -0.54, 'h'], [-0.68, -0.58, 'h']], sm ? 2 : 3, 2.3), ...at(mirrored(burnUp(0.1)))],
    }],
    lights: [{ at: at([[-0.72, -0.94], [-0.36, -1.14], [0.1, -1.2]]), w: 1.5 }],
    flow: [{ at: at([[0.24, -0.5, 'h'], [0.3, -0.8], [0.14, -1.06]]), w: 0.7 }, { at: at([[-0.22, -0.48, 'h'], [-0.3, -0.8], [-0.2, -1.04]]), w: 0.7 }],
  }),
  // Clipped at the sides, the top cut choppy: short spikes standing up, and a blunt fringe straight across.
  'textured-crop': ({ at, lobes, sm }) => ({
    front: [clipped(at), {
      o: [...at([[-0.92, -0.42, 'c'], [-1.02, -0.7]]), ...lobes([[-0.96, -0.92], [-0.5, -1.16], [0, -1.22], [0.5, -1.16], [0.96, -0.92]], sm ? 4 : 6, 3.4, true), ...at([[1.02, -0.7], [0.92, -0.42, 'c']])],
      i: lobes([[0.86, -0.5, 'h'], [0.45, -0.5, 'h'], [0, -0.48, 'h'], [-0.45, -0.5, 'h'], [-0.86, -0.5, 'h']], sm ? 3 : 5, 1.1, true),
    }],
    lights: [{ at: at([[-0.7, -0.9], [-0.36, -1.06], [0.06, -1.1]]), w: 1.5 }],
    flow: [{ at: at([[-0.3, -0.56, 'h'], [-0.24, -0.9]]), w: 0.7 }, { at: at([[0.14, -0.54, 'h'], [0.2, -0.92]]), w: 0.7 }, { at: at([[0.52, -0.58, 'h'], [0.54, -0.86]]), w: 0.7 }],
  }),
  // Short and tousled: locks that go their own way on top and fall unevenly on the forehead.
  messy: ({ at, lobes, sm }) => ({
    front: [{
      o: [...at(mirrored(sideDown(0.12, 1.06))), ...lobes([[-1.05, -0.74], [-0.82, -1.1], [-0.3, -1.26], [0.3, -1.26], [0.82, -1.1], [1.05, -0.74]], sm ? 4 : 6, 1.9), ...at(sideDown(0.12, 1.06))],
      i: [...at(burnUp(0.1)), ...lobes([[0.74, -0.54, 'h'], [0.3, -0.58, 'h'], [-0.2, -0.54, 'h'], [-0.72, -0.52, 'h']], sm ? 3 : 4, 2.5, true), ...at(mirrored(burnUp(0.1)))],
    }],
    lights: [{ at: at([[-0.74, -0.94], [-0.4, -1.12], [0, -1.18]]), w: 1.5 }],
    flow: [{ at: at([[-0.44, -0.62, 'h'], [-0.3, -0.9], [-0.5, -1.06]]), w: 0.7 }, { at: at([[0.06, -0.62, 'h'], [0.2, -0.9], [0.06, -1.1]]), w: 0.7 }, { at: at([[0.5, -0.64, 'h'], [0.62, -0.88]]), w: 0.7 }],
  }),
  // Parted at one side: the parting is a wedge of scalp, the hair rises high beside it and lies flat on the other side.
  'side-part': ({ at }) => ({
    front: [{
      o: at([...mirrored(sideDown(0.12, 1.08)), [-1.08, -0.86], [-0.84, -1.24], [-0.36, -1.41], [0.14, -1.38], [0.44, -1.27], [0.56, -1.15, 'c'], [0.8, -1.02], [0.98, -0.8], ...sideDown(0.12, 1.02)]),
      i: at([...burnUp(0.1), [0.7, -0.6, 'h'], [0.6, -0.7, 'h'], [0.54, -0.93, 'ch'], [0.43, -0.7, 'h'], [0.12, -0.6, 'h'], [-0.3, -0.52, 'h'], [-0.66, -0.5, 'h'], ...mirrored(burnUp(0.1))]),
    }],
    lights: [{ at: at([[-0.86, -0.86], [-0.5, -1.18], [0, -1.28]]), w: 1.6 }],
    flow: [{ at: at([[0.54, -0.93, 'h'], [0.56, -1.15]]), w: 1 }, { at: at([[0.36, -0.74, 'h'], [-0.1, -0.9], [-0.66, -0.8]]), w: 0.7 }, { at: at([[0.4, -0.96], [-0.1, -1.12], [-0.6, -1.04]]), w: 0.7 }],
  }),
  // A long fringe swept low across the forehead from one temple to the other brow, where it ends in a flick.
  swept: ({ at }) => ({
    front: [{
      o: at([[-0.9, 0.06, 'c'], [-1.12, -0.22, 'c'], [-1.1, -0.6], [-1.02, -0.92], [-0.66, -1.26], [-0.14, -1.35], [0.4, -1.3], [0.82, -1.12], [1.01, -0.82], ...sideDown(0.12)]),
      i: at([...burnUp(0.1), [0.72, -0.62, 'h'], [0.56, -0.78, 'ch'], [0.26, -0.56, 'h'], [-0.2, -0.4, 'h'], [-0.62, -0.31, 'h'], [-0.86, -0.28, 'c']]),
    }],
    lights: [{ at: at([[-0.66, -1.02], [-0.12, -1.23], [0.42, -1.19]]), w: 1.5 }],
    flow: [{ at: at([[0.56, -0.78, 'h'], [0.1, -0.9], [-0.56, -0.66]]), w: 0.7 }, { at: at([[0.3, -0.6, 'h'], [-0.14, -0.62], [-0.7, -0.44]]), w: 0.7 }],
  }),
  // Shaved at the sides, with a slab of long hair on top that is swept over and overhangs one side.
  undercut: ({ at }) => ({
    front: [clipped(at), {
      o: at([[-1.0, -0.44, 'c'], [-1.15, -0.74], [-0.94, -1.24], [-0.36, -1.44], [0.3, -1.4], [0.78, -1.18], [0.95, -0.86], [0.87, -0.62, 'c']]),
      i: at([[0.6, -0.7, 'h'], [0.2, -0.74, 'h'], [-0.3, -0.58, 'h'], [-0.74, -0.44, 'h']]),
    }],
    lights: [{ at: at([[-0.7, -1.1], [-0.16, -1.32], [0.36, -1.27]]), w: 1.6 }],
    flow: [{ at: at([[0.24, -0.76, 'h'], [-0.16, -1.0], [-0.76, -0.96]]), w: 0.7 }, { at: at([[0.62, -0.7, 'h'], [0.3, -1.06], [-0.24, -1.24]]), w: 0.7 }],
  }),
  // Medium length, combed back off the forehead and tucked behind the ears.
  'swept-back': ({ at }) => ({
    back: [{ o: at([[0, -0.9], [-1.06, -0.3], [-1.17, 0.2], [-1.12, 0.6], [-0.88, 0.8, 'c'], [-0.6, 0.56], [0.6, 0.56], [0.88, 0.8, 'c'], [1.12, 0.6], [1.17, 0.2], [1.06, -0.3]]) }],
    front: [{
      o: at([...mirrored(sideDown(0.16, 1.08)), [-1.04, -0.9], [-0.66, -1.24], [-0.1, -1.33], [0.5, -1.27], [0.96, -1.0], ...sideDown(0.16, 1.08)]),
      i: at([...burnUp(0.14), [0.66, -0.66, 'h'], [0.3, -0.77, 'h'], [0, -0.73, 'h'], [-0.3, -0.77, 'h'], [-0.66, -0.66, 'h'], ...mirrored(burnUp(0.14))]),
    }],
    lights: [{ at: at([[-0.8, -0.88], [-0.5, -1.12], [-0.08, -1.22]]), w: 1.5 }],
    flow: [{ at: at([[0.3, -0.78, 'h'], [0.38, -1.02], [0.22, -1.22]]), w: 0.7 }, { at: at([[-0.3, -0.78, 'h'], [-0.42, -1.02], [-0.28, -1.2]]), w: 0.7 }, { at: at([[0, -0.74, 'h'], [0.04, -1.0]]), w: 0.7 }],
  }),
  // Combed straight back from a high forehead, flat and glossy, the ends gathered at the nape.
  slicked: ({ at }) => ({
    back: [{ o: at([[0, -0.9], [-1.04, -0.2], [-1.1, 0.26], [-0.94, 0.52, 'c'], [-0.6, 0.3], [0.6, 0.3], [0.94, 0.52, 'c'], [1.1, 0.26], [1.04, -0.2]]) }],
    front: [{ o: at(cap(1.13, 0.12, 1.03)), i: at([...burnUp(0.1), [0.62, -0.68, 'h'], [0.32, -0.8, 'h'], [0, -0.84, 'h'], [-0.32, -0.8, 'h'], [-0.62, -0.68, 'h'], ...mirrored(burnUp(0.1))]) }],
    lights: [{ at: at([[-0.78, -0.8], [-0.46, -0.98], [-0.06, -1.05]]), w: 1.9 }, { at: at([[0.3, -1.02], [0.6, -0.94], [0.8, -0.78]]), w: 1.3 }],
    flow: [-0.52, -0.18, 0.18, 0.52].map((u) => ({ at: at([[u, -0.85 + Math.abs(u) * 0.14, 'h'], [u * 1.08, -0.97], [u * 0.96, -1.09 + Math.abs(u) * 0.1]]), w: 1 })),
  }),
  // Clipped at the sides, longer and neat on top.
  fade: ({ at }) => ({
    front: [clipped(at), {
      o: at([[-0.9, -0.46, 'c'], [-0.99, -0.74], [-0.85, -1.08], [-0.42, -1.21], [0.42, -1.21], [0.85, -1.08], [0.99, -0.74], [0.9, -0.46, 'c']]),
      i: at(HAIRLINE),
    }],
    lights: [{ at: at(SHEEN), w: 1.5 }],
  }),
  // Shaved close: the scalp shows through, so the hair is a tint and has no rim.
  buzz: ({ at }) => ({
    front: [{
      o: at([[-0.995, 0.06, 'c'], [-1.02, -0.25], [-1.02, -0.58], [-0.88, -0.93], [-0.5, -1.07], [0, -1.1], [0.5, -1.07], [0.88, -0.93], [1.02, -0.58], [1.02, -0.25], [0.995, 0.06, 'c']]),
      i: at([[0.88, 0.05, 'c'], [0.85, -0.2], [0.8, -0.42], ...HAIRLINE, [-0.8, -0.42], [-0.85, -0.2], [-0.88, 0.05, 'c']]),
      thin: true,
    }],
  }),
  // Short and soft: a choppy fringe swept across the forehead, and a pointed wisp in front of each ear.
  pixie: ({ at, lobes, sm }) => ({
    front: [{
      o: at([[-0.88, 0.46, 'c'], [-1.04, -0.05], [-1.09, -0.55], [-0.98, -0.97], [-0.6, -1.24], [-0.1, -1.31], [0.46, -1.25], [0.92, -1.0], [1.09, -0.55], [1.04, -0.05], [0.88, 0.46, 'c']]),
      i: [...at([[0.82, 0.02], [0.8, -0.4], [0.64, -0.62, 'h']]), ...lobes([[0.44, -0.74, 'h'], [0.02, -0.54, 'h'], [-0.44, -0.4, 'h'], [-0.8, -0.32, 'h']], sm ? 2 : 3, 2.4, true), ...at([[-0.82, 0.02]])],
    }],
    lights: [{ at: at([[-0.7, -1.0], [-0.3, -1.19], [0.2, -1.21]]), w: 1.5 }],
    flow: [{ at: at([[0.44, -0.75, 'h'], [0.02, -0.86], [-0.56, -0.64]]), w: 0.7 }],
  }),

  // The front brushed up and back into a wave that stands above the forehead.
  quiff: ({ at }) => ({
    front: [{
      o: at([...mirrored(sideDown(0.12)), [-0.98, -0.9], [-0.8, -1.22], [-0.4, -1.44], [0.15, -1.5], [0.62, -1.36], [0.97, -0.96], ...sideDown(0.12)]),
      i: at([...burnUp(0.1), [0.66, -0.62, 'h'], [0.3, -0.72, 'h'], [-0.1, -0.7, 'h'], [-0.5, -0.62, 'h'], ...mirrored(burnUp(0.1))]),
    }],
    lights: [{ at: at([[-0.62, -1.1], [-0.3, -1.34], [0.1, -1.42]]), w: 1.5 }],
    flow: [{ at: at([[-0.3, -0.71, 'h'], [-0.22, -1.1], [0.2, -1.36]]), w: 0.7 }, { at: at([[0.2, -0.73, 'h'], [0.4, -1.05], [0.56, -1.26]]), w: 0.7 }],
  }),
  // Cut round at the ears, with a straight fringe above the brows: the page's cut of the middle ages.
  bowl: ({ at }) => ({
    front: [{
      o: at([[-0.86, 0.56, 'c'], [-1.1, 0.44], [-1.16, 0], [-1.1, -0.56], [-0.9, -1.0], [-0.5, -1.2], [0, -1.25], [0.5, -1.2], [0.9, -1.0], [1.1, -0.56], [1.16, 0], [1.1, 0.44], [0.86, 0.56, 'c']]),
      i: at([[0.84, 0.2], [0.84, -0.3, 'c'], [0.5, -0.36], [0.15, -0.32], [-0.2, -0.37], [-0.55, -0.33], [-0.84, -0.3, 'c'], [-0.84, 0.2]]),
    }],
    lights: [{ at: at([[-0.8, -0.8], [-0.46, -1.04], [0, -1.12]]), w: 1.5 }],
    flow: [{ at: at([[0.2, -0.34], [0.16, -0.7]]), w: 0.7 }, { at: at([[-0.4, -0.36], [-0.44, -0.74]]), w: 0.7 }],
  }),

  // ----- medium and long -----

  // Cut at the chin, parted at one side, the ends turning in.
  bob: ({ at }) => ({
    back: [{ o: at([[0, -1], [-1.14, 0], [-1.2, 0.5], [-1.02, 0.84, 'c'], [0, 0.9], [1.02, 0.84, 'c'], [1.2, 0.5], [1.14, 0]]) }],
    front: [{
      o: at([[-0.78, 0.86, 'c'], [-1.12, 0.74], [-1.24, 0.3], [-1.2, -0.3], [-1.02, -0.9], [-0.6, -1.22], [-0.05, -1.3], [0.5, -1.24], [0.98, -0.94], [1.2, -0.3], [1.24, 0.3], [1.12, 0.74], [0.78, 0.86, 'c']]),
      i: at([[0.84, 0.5], [0.9, 0.05], [0.86, -0.28], [0.55, -0.5, 'h'], [0.1, -0.62, 'h'], [-0.25, -0.74, 'ch'], [-0.62, -0.56, 'h'], [-0.86, -0.28], [-0.9, 0.05], [-0.84, 0.5]]),
    }],
    lights: [{ at: at([[-0.9, -0.9], [-0.55, -1.14], [0, -1.22]]), w: 1.5 }],
    flow: [{ at: at([[-0.25, -0.74, 'h'], [-0.28, -1.0], [-0.2, -1.26]]), w: 1 }, { at: at([[1.08, -0.2], [1.13, 0.3], [1.0, 0.7]]), w: 0.7 }, { at: at([[-1.08, -0.2], [-1.13, 0.3], [-1.0, 0.7]]), w: 0.7 }],
  }),
  // To the shoulders, parted in the middle.
  shoulder: ({ at }) => {
    const c = curtains(0.66);
    return {
      back: [{ o: at([[-0.6, -1.1], [-1.1, -0.3], [-1.22, 0.4], [-1.3, 1.1], [-1.44, 1.52, 'c'], [-0.5, 1.56], [0.5, 1.56], [1.44, 1.52, 'c'], [1.3, 1.1], [1.22, 0.4], [1.1, -0.3], [0.6, -1.1]]) }],
      front: [{ o: at(c.o), i: at(c.i) }],
      lights: [{ at: at([[-0.9, -0.88], [-0.56, -1.12], [-0.14, -1.2]]), w: 1.5 }],
      flow: [{ at: at([[0, -0.75, 'h'], [0, -1.2]]), w: 1 }],
      backFlow: [{ at: at([[-1.2, 0.5], [-1.26, 1.0], [-1.34, 1.4]]), w: 0.7 }, { at: at([[1.2, 0.5], [1.26, 1.0], [1.34, 1.4]]), w: 0.7 }],
    };
  },
  // Long and straight, parted in the middle, a lock over each shoulder.
  long: ({ at }) => {
    const c = curtains(0.7);
    return {
      back: [{ o: at(fall(2.7)) }],
      body: [{ o: at(lock(2.3)) }, { o: at(leftOf(lock(2.3)).reverse()) }],
      front: [{ o: at(c.o), i: at(c.i) }],
      lights: [{ at: at([[-0.9, -0.88], [-0.56, -1.12], [-0.14, -1.2]]), w: 1.5 }],
      flow: [{ at: at([[0, -0.75, 'h'], [0, -1.2]]), w: 1 }],
    };
  },
  // Long, with a fringe cut straight across above the brows.
  fringe: ({ at, lobes, sm }) => {
    const c = curtains(0.7);
    return {
      back: [{ o: at(fall(2.7)) }],
      body: [{ o: at(lock(2.3)) }, { o: at(leftOf(lock(2.3)).reverse()) }],
      front: [{ o: at(c.o), i: [...at([[0.9, 0.4], [0.88, -0.1], [0.84, -0.3]]), ...lobes([[0.8, -0.34], [0.4, -0.3], [0, -0.29], [-0.4, -0.3], [-0.8, -0.34]], sm ? 3 : 5, 0.7), ...at([[-0.84, -0.3], [-0.88, -0.1], [-0.9, 0.4]])] }],
      lights: [{ at: at([[-0.7, -0.74], [-0.2, -0.86], [0.4, -0.84]]), w: 1.5 }],
      flow: [{ at: at([[-0.4, -0.34], [-0.42, -0.7]]), w: 0.7 }, { at: at([[0.1, -0.33], [0.12, -0.76]]), w: 0.7 }, { at: at([[0.56, -0.35], [0.54, -0.68]]), w: 0.7 }],
    };
  },
  // Long and wavy, parted at one side.
  wavy: ({ at, lobes, sm }) => ({
    back: [{
      o: [...at([[0.6, -1.1], [-0.6, -1.1]]), ...lobes([[-1.1, -0.3], [-1.3, 0.5], [-1.42, 1.4], [-1.46, 2.5]], sm ? 2 : 3, -2.6), ...at([[-1.3, 2.7, 'c'], [1.3, 2.7, 'c']]), ...lobes([[1.46, 2.5], [1.42, 1.4], [1.3, 0.5], [1.1, -0.3]], sm ? 2 : 3, -2.6)],
    }],
    body: [
      { o: [...at([[0.84, 0.3, 'c']]), ...lobes([[1.1, 0.4], [1.3, 1.1], [1.26, 1.8], [1.1, 2.2]], 2, 2.2), ...at([[0.76, 1.9], [0.84, 1.3], [0.7, 0.8]])] },
      { o: [...at([[-0.84, 0.3, 'c'], [-0.7, 0.8], [-0.84, 1.3], [-0.76, 1.9]]), ...lobes([[-1.1, 2.2], [-1.26, 1.8], [-1.3, 1.1], [-1.1, 0.4]], 2, 2.2)] },
    ],
    front: [{
      o: at([[-0.96, 0.72, 'c'], [-1.23, 0.45], [-1.1, 0.05], [-1.23, -0.4], [-1.02, -0.92], [-0.6, -1.24], [-0.05, -1.31], [0.5, -1.25], [1.0, -0.94], [1.23, -0.4], [1.1, 0.05], [1.23, 0.45], [0.96, 0.72, 'c']]),
      i: at([[0.86, 0.35], [0.9, -0.05], [0.8, -0.36], [0.6, -0.6, 'h'], [0.4, -0.72, 'ch'], [0.05, -0.56, 'h'], [-0.4, -0.42, 'h'], [-0.8, -0.3], [-0.9, 0], [-0.86, 0.35]]),
    }],
    lights: [{ at: at([[-0.7, -1.0], [-0.2, -1.2], [0.3, -1.17]]), w: 1.5 }],
    flow: [{ at: at([[0.4, -0.72, 'h'], [0.44, -0.98], [0.4, -1.24]]), w: 1 }, { at: at([[0.2, -0.62, 'h'], [-0.3, -0.7], [-0.8, -0.5]]), w: 0.7 }, { at: at([[-1.08, -0.1], [-1.0, 0.2], [-1.1, 0.5]]), w: 0.7 }, { at: at([[1.08, -0.1], [1.0, 0.2], [1.1, 0.5]]), w: 0.7 }],
  }),
  // Short at the front and the sides, long at the back.
  mullet: ({ at }) => ({
    back: [{ o: at([[0, -0.9], [-1.06, -0.3], [-1.2, 0.4], [-1.36, 1.2], [-1.3, 1.62, 'c'], [-0.9, 1.4], [0.9, 1.4], [1.3, 1.62, 'c'], [1.36, 1.2], [1.2, 0.4], [1.06, -0.3]]) }],
    front: [{
      o: at([...mirrored(sideDown(0.12)), [-0.97, -0.9], [-0.62, -1.19], [-0.15, -1.27], [0.32, -1.28], [0.72, -1.15], [0.97, -0.86], ...sideDown(0.12)]),
      i: at([...burnUp(0.1), [0.66, -0.62, 'h'], [0.42, -0.73, 'h'], [0.08, -0.67, 'h'], [-0.3, -0.61, 'h'], [-0.62, -0.56, 'h'], ...mirrored(burnUp(0.1))]),
    }],
    lights: [{ at: at([[-0.72, -0.9], [-0.36, -1.1], [0.1, -1.18]]), w: 1.5 }],
    flow: [{ at: at([[0.42, -0.74, 'h'], [0.3, -0.96], [0.04, -1.1]]), w: 0.7 }],
    backFlow: [{ at: at([[-1.14, 0.5], [-1.24, 1.0], [-1.2, 1.4]]), w: 0.7 }, { at: at([[1.14, 0.5], [1.24, 1.0], [1.2, 1.4]]), w: 0.7 }],
  }),

  // ----- curls and coils -----

  // A head of curls to the jaw.
  curly: ({ at, lobes, sm, lg }) => ({
    back: [{ o: lobes([[-1.0, 0.72], [-1.3, 0.2], [-1.26, -0.6], [-0.8, -1.24], [0, -1.42], [0.8, -1.24], [1.26, -0.6], [1.3, 0.2], [1.0, 0.72]], sm ? 7 : 11, 2.6) }],
    front: [{
      o: lobes([[-1.0, 0.16], [-1.2, -0.4], [-0.9, -1.1], [0, -1.36], [0.9, -1.1], [1.2, -0.4], [1.0, 0.16]], sm ? 5 : 8, 2.2),
      i: [...at([[0.88, 0.12, 'c'], [0.84, -0.2]]), ...lobes([[0.8, -0.38, 'h'], [0.4, -0.57, 'h'], [0, -0.61, 'h'], [-0.4, -0.57, 'h'], [-0.8, -0.38, 'h']], sm ? 3 : 4, 2.1), ...at([[-0.84, -0.2], [-0.88, 0.12, 'c']])],
    }],
    lights: [{ at: at([[-0.86, -0.86], [-0.6, -1.08], [-0.3, -1.16]]), w: 1.5 }],
    flow: lg ? CURLS.map((c) => ({ at: at(c), w: 0.8 })) : [],
  }),
  // Long curls: a cloud behind the shoulders.
  'curly-long': ({ at, lobes, sm, lg }) => ({
    back: [{ o: [...lobes([[-1.2, 2.3], [-1.6, 1.4], [-1.4, 0.2], [-1.26, -0.6], [-0.8, -1.24], [0, -1.42], [0.8, -1.24], [1.26, -0.6], [1.4, 0.2], [1.6, 1.4], [1.2, 2.3]], sm ? 7 : 15, 2.8)] }],
    body: [
      { o: [...at([[0.84, 0.3, 'c']]), ...lobes([[1.1, 0.4], [1.34, 1.1], [1.3, 1.7], [1.1, 2.1]], sm ? 2 : 3, 2.2), ...at([[0.78, 1.8], [0.86, 1.3], [0.72, 0.8]])] },
      { o: [...at([[-0.84, 0.3, 'c'], [-0.72, 0.8], [-0.86, 1.3], [-0.78, 1.8]]), ...lobes([[-1.1, 2.1], [-1.3, 1.7], [-1.34, 1.1], [-1.1, 0.4]], sm ? 2 : 3, 2.2)] },
    ],
    front: [{
      o: lobes([[-1.0, 0.16], [-1.2, -0.4], [-0.9, -1.1], [0, -1.36], [0.9, -1.1], [1.2, -0.4], [1.0, 0.16]], sm ? 5 : 8, 2.2),
      i: [...at([[0.88, 0.12, 'c'], [0.84, -0.2]]), ...lobes([[0.8, -0.38, 'h'], [0.4, -0.57, 'h'], [0, -0.61, 'h'], [-0.4, -0.57, 'h'], [-0.8, -0.38, 'h']], sm ? 3 : 4, 2.1), ...at([[-0.84, -0.2], [-0.88, 0.12, 'c']])],
    }],
    lights: [{ at: at([[-0.86, -0.86], [-0.6, -1.08], [-0.3, -1.16]]), w: 1.5 }],
    flow: lg ? CURLS.map((c) => ({ at: at(c), w: 0.8 })) : [],
  }),
  // Short, tight coils, close to the head, with a neat line at the forehead.
  coily: ({ at, lobes, sm, lg }) => ({
    front: [{
      o: [...at([[-0.99, 0.1, 'c']]), ...lobes([[-1.03, -0.1], [-1.1, -0.6], [-0.8, -1.1], [0, -1.25], [0.8, -1.1], [1.1, -0.6], [1.03, -0.1]], sm ? 8 : 13, 1.1), ...at([[0.99, 0.1, 'c']])],
      i: at([[0.87, 0.08, 'c'], [0.86, -0.3], [0.74, -0.53, 'h'], [0.4, -0.63, 'h'], [0, -0.65, 'h'], [-0.4, -0.63, 'h'], [-0.74, -0.53, 'h'], [-0.86, -0.3], [-0.87, 0.08, 'c']]),
    }],
    flow: lg ? COILS.map((c) => ({ at: at(c), w: 0.7 })) : [],
  }),
  // A full, round afro.
  afro: ({ at, lobes, sm, lg }) => ({
    back: [{ o: lobes([[-1.1, 0.35], [-1.5, -0.2], [-1.46, -0.95], [-0.86, -1.55], [0, -1.7], [0.86, -1.55], [1.46, -0.95], [1.5, -0.2], [1.1, 0.35]], sm ? 8 : 13, 2.4) }],
    front: [{
      o: at([[-1.0, 0, 'c'], [-1.2, -0.5], [-0.9, -1.2], [0, -1.4], [0.9, -1.2], [1.2, -0.5], [1.0, 0, 'c']]),
      i: at([[0.9, -0.02, 'c'], [0.86, -0.3], [0.72, -0.51, 'h'], [0.38, -0.61, 'h'], [0, -0.63, 'h'], [-0.38, -0.61, 'h'], [-0.72, -0.51, 'h'], [-0.86, -0.3], [-0.9, -0.02, 'c']]),
    }],
    lights: [{ at: at([[-1.06, -1.0], [-0.74, -1.34], [-0.3, -1.5]]), w: 1.5 }],
    flow: lg ? COILS.map((c) => ({ at: at(c.map(([u, v]) => [u * 1.25, v * 1.2 + 0.04] as Pt)), w: 0.7 })) : [],
  }),

  // Locs to the shoulders.
  locs: ({ at, sm }) => ({
    back: [{ o: at(fall(1.5, 0.1)) }],
    // At the list size the ropes are one lock a side: nobody can count them there.
    body: sm ? [{ o: at(lock(1.74)) }, { o: at(leftOf(lock(1.74)).reverse()) }] : ropes(at, 4, 0.2, 1.72),
    front: [{ o: at(cap(1.2, 0.3, 1.08)), i: at([[0.9, 0.28, 'c'], [0.88, -0.1], [0.8, -0.4], ...HAIRLINE, [-0.8, -0.4], [-0.88, -0.1], [-0.9, 0.28, 'c']]) }],
    flow: [{ at: at([[0, -0.61, 'h'], [0, -1.18]]), w: 1 }, { at: at([[-0.4, -0.66, 'h'], [-0.56, -0.9], [-0.5, -1.1]]), w: 1 }, { at: at([[0.4, -0.66, 'h'], [0.56, -0.9], [0.5, -1.1]]), w: 1 }],
  }),
  // Many thin braids, long over the shoulders.
  'box-braids': ({ at, sm }) => ({
    back: [{ o: at(fall(2.7)) }],
    body: sm ? [{ o: at(lock(2.3)) }, { o: at(leftOf(lock(2.3)).reverse()) }] : ropes(at, 5, 0.13, 2.4),
    front: [{ o: at(curtains(0.4, 1.12).o), i: at(curtains(0.4, 1.12).i) }],
    flow: [{ at: at([[0, -0.75, 'h'], [0, -1.2]]), w: 1 }, { at: at([[-0.42, -0.6, 'h'], [-0.6, -0.9], [-0.52, -1.12]]), w: 0.7 }, { at: at([[0.42, -0.6, 'h'], [0.6, -0.9], [0.52, -1.12]]), w: 0.7 }],
  }),
  // Rows braided flat to the scalp, running back from the hairline.
  cornrows: ({ at }) => ({
    front: [{ o: at(cap(1.1)), i: at([...burnUp(0.08), ...DRAWN_BACK, ...mirrored(burnUp(0.08))]) }],
    flow: [-0.6, -0.3, 0, 0.3, 0.6].map((u) => ({ at: at([[u, -0.76 + Math.abs(u) * 0.14, 'h'], [u * 1.16, -0.94], [u * 0.9, -1.1 + Math.abs(u) * 0.12]]), w: 1 })),
  }),

  // ----- tied and pinned up -----

  // Drawn back and tied: the tail swings down behind one shoulder.
  ponytail: ({ at }) => ({
    back: [{ o: at([[0.7, -0.7], [1.2, -0.62], [1.52, -0.1], [1.6, 0.6], [1.38, 1.36, 'c'], [1.18, 0.8], [1.14, 0.2], [0.9, -0.1]]) }],
    front: [drawnBack(at)],
    lights: [{ at: at(SHEEN), w: 1.5 }],
    flow: pulled(at, 0.8, -0.96),
    backFlow: [{ at: at([[1.26, -0.3], [1.4, 0.3], [1.34, 0.9]]), w: 0.7 }],
  }),
  // Drawn up into a knot on top of the head.
  bun: ({ at }) => ({
    back: [{ o: at([[-0.36, -1.08], [-0.5, -1.4], [-0.24, -1.68], [0.14, -1.71], [0.48, -1.46], [0.4, -1.08]]) }],
    front: [drawnBack(at)],
    lights: [{ at: at(SHEEN), w: 1.5 }],
    flow: pulled(at, 0, -1.12),
    backFlow: [{ at: at([[-0.26, -1.4], [0, -1.56], [0.26, -1.42]]), w: 0.7 }],
  }),
  // Two buns, high at each side.
  'space-buns': ({ at }) => ({
    back: [-1, 1].map((s) => ({ o: at(([[0.36, -1.0], [0.34, -1.3], [0.6, -1.5], [0.92, -1.4], [1.04, -1.1], [0.84, -0.9]] as Pt[]).map(([u, v]) => [u * s, v] as Pt)) })),
    front: [drawnBack(at)],
    lights: [{ at: at(SHEEN), w: 1.5 }],
    flow: [{ at: at([[0, -0.76, 'h'], [0, -1.14]]), w: 1 }, { at: at([[-0.4, -0.72, 'h'], [-0.56, -0.98]]), w: 0.7 }, { at: at([[0.4, -0.72, 'h'], [0.56, -0.98]]), w: 0.7 }],
  }),
  // Coiled low at the nape: it shows at both sides of the neck.
  chignon: ({ at }) => ({
    back: [{ o: at([[-0.7, 0.5], [-1.08, 0.5], [-1.14, 0.8], [-0.8, 1.04], [0, 1.06], [0.8, 1.04], [1.14, 0.8], [1.08, 0.5], [0.7, 0.5]]) }],
    front: [{ o: at(cap(1.18, 0.34, 1.05)), i: at([[0.88, 0.32, 'c'], [0.88, -0.1], [0.72, -0.42, 'h'], [0.36, -0.62, 'h'], [0, -0.72, 'ch'], [-0.36, -0.62, 'h'], [-0.72, -0.42, 'h'], [-0.88, -0.1], [-0.88, 0.32, 'c']]) }],
    lights: [{ at: at(SHEEN), w: 1.5 }],
    flow: [{ at: at([[0, -0.72, 'h'], [0, -1.16]]), w: 1 }],
  }),
  // Two plaits, one over each shoulder.
  braid: ({ at, plait, sm }) => ({
    body: [plait([[0.98, 0.3], [1.08, 1.0], [1.0, 1.9]], sm ? 3 : 4, 6.4), plait([[-0.98, 0.3], [-1.08, 1.0], [-1.0, 1.9]], sm ? 3 : 4, 6.4)],
    front: [{ o: at(cap(1.17, 0.34, 1.05)), i: at([[0.88, 0.32, 'c'], [0.88, -0.1], [0.72, -0.42, 'h'], [0.36, -0.62, 'h'], [0, -0.72, 'ch'], [-0.36, -0.62, 'h'], [-0.72, -0.42, 'h'], [-0.88, -0.1], [-0.88, 0.32, 'c']]) }],
    lights: [{ at: at(SHEEN), w: 1.5 }],
    flow: [{ at: at([[0, -0.72, 'h'], [0, -1.16]]), w: 1 }],
  }),
  // One plait over a shoulder.
  'side-braid': ({ at, plait, sm }) => ({
    body: [plait([[0.98, 0.3], [1.12, 1.0], [0.98, 2.1]], sm ? 3 : 5, 7)],
    front: [{ o: at(cap(1.17, 0.34, 1.05)), i: at([[0.88, 0.32, 'c'], [0.88, -0.1], [0.72, -0.42, 'h'], [0.36, -0.62, 'h'], [0, -0.72, 'ch'], [-0.36, -0.62, 'h'], [-0.72, -0.42, 'h'], [-0.88, -0.1], [-0.88, 0.32, 'c']]) }],
    lights: [{ at: at(SHEEN), w: 1.5 }],
    flow: [{ at: at([[0, -0.72, 'h'], [0, -1.16]]), w: 1 }],
  }),
  // Two tails, tied at the sides.
  pigtails: ({ at }) => ({
    back: [-1, 1].map((s) => ({ o: at(([[0.9, -0.3], [1.3, -0.36], [1.56, 0], [1.6, 0.5], [1.4, 0.92, 'c'], [1.16, 0.6], [1.1, 0.1]] as Pt[]).map(([u, v, k]) => [u * s, v, k] as Pt)) })),
    front: [{ o: at(cap(1.17, 0.12)), i: at([...burnUp(0.1), [0.7, -0.5, 'h'], [0.36, -0.64, 'h'], [0, -0.74, 'ch'], [-0.36, -0.64, 'h'], [-0.7, -0.5, 'h'], ...mirrored(burnUp(0.1))]) }],
    lights: [{ at: at(SHEEN), w: 1.5 }],
    flow: [{ at: at([[0, -0.74, 'h'], [0, -1.16]]), w: 1 }],
  }),

  // A plait laid over the head from ear to ear.
  'crown-braid': ({ at, plait, sm }) => ({
    front: [drawnBack(at), { ...plait([[-1.02, -0.36], [-0.82, -0.98], [0, -1.22], [0.82, -0.98], [1.02, -0.36]], sm ? 5 : 8, 5.6), edge: true }],
    lights: [{ at: at([[-0.5, -0.78], [-0.2, -0.9], [0.1, -0.92]]), w: 1.2 }],
  }),
  // Piled high and smooth, as in the sixties.
  beehive: ({ at }) => ({
    back: [{ o: at([[-1.0, -0.5], [-1.13, -1.1], [-0.8, -1.7], [0, -1.92], [0.8, -1.7], [1.13, -1.1], [1.0, -0.5]]) }],
    front: [{
      o: at(cap(1.2, 0.3, 1.06)),
      i: at([[0.88, 0.28, 'c'], [0.88, -0.1], [0.8, -0.36], [0.6, -0.6, 'h'], [0.4, -0.72, 'ch'], [0.05, -0.56, 'h'], [-0.4, -0.44, 'h'], [-0.8, -0.34], [-0.88, -0.1], [-0.88, 0.28, 'c']]),
    }],
    lights: [{ at: at([[-0.8, -1.2], [-0.5, -1.56], [-0.1, -1.74]]), w: 1.6 }],
    flow: [{ at: at([[0.4, -0.72, 'h'], [0.5, -1.0], [0.4, -1.3]]), w: 0.7 }],
    backFlow: [{ at: at([[-0.7, -1.2], [-0.2, -1.66], [0.4, -1.7]]), w: 0.7 }, { at: at([[0.8, -1.0], [0.84, -1.4], [0.5, -1.72]]), w: 0.7 }],
  }),

  // ----- wigs -----

  // The full-bottomed wig of the seventeenth century: a mass of curls to the chest.
  periwig: ({ at, lobes, sm }) => ({
    back: [{ o: lobes([[-1.3, 1.9], [-1.62, 1.2], [-1.42, 0.2], [-1.2, -0.6], [-0.8, -1.26], [0, -1.44], [0.8, -1.26], [1.2, -0.6], [1.42, 0.2], [1.62, 1.2], [1.3, 1.9]], sm ? 7 : 13, 2.6) }],
    body: [
      { o: [...at([[0.84, 0.2, 'c']]), ...lobes([[1.1, 0.3], [1.32, 0.9], [1.3, 1.5], [1.14, 1.9]], sm ? 2 : 3, 2.4), ...at([[0.8, 1.7], [0.86, 1.1], [0.74, 0.6]])] },
      { o: [...at([[-0.84, 0.2, 'c'], [-0.74, 0.6], [-0.86, 1.1], [-0.8, 1.7]]), ...lobes([[-1.14, 1.9], [-1.3, 1.5], [-1.32, 0.9], [-1.1, 0.3]], sm ? 2 : 3, 2.4)] },
    ],
    front: [{
      o: at([[-0.98, 0.3, 'c'], [-1.2, -0.1], [-1.18, -0.6], [-0.96, -1.0], [-0.5, -1.28], [-0.12, -1.34], [0, -1.26, 'c'], [0.12, -1.34], [0.5, -1.28], [0.96, -1.0], [1.18, -0.6], [1.2, -0.1], [0.98, 0.3, 'c']]),
      i: at([[0.88, 0.1], [0.84, -0.3], [0.6, -0.56, 'h'], [0.3, -0.66, 'h'], [0, -0.76, 'ch'], [-0.3, -0.66, 'h'], [-0.6, -0.56, 'h'], [-0.84, -0.3], [-0.88, 0.1]]),
    }],
    lights: [{ at: at([[-0.9, -0.84], [-0.56, -1.14], [-0.16, -1.24]]), w: 1.6 }],
    flow: [{ at: at([[0, -0.76, 'h'], [0, -1.26]]), w: 1 }],
  }),
  // The powdered wig of the eighteenth: brushed back from the forehead, with a roll or two over each ear.
  powdered: ({ at }) => ({
    front: [
      { o: at(cap(1.24, 0.06, 1.06)), i: at([...burnUp(0.04), ...DRAWN_BACK, ...mirrored(burnUp(0.04))]) },
      ...[-1, 1].flatMap((s) => [0, 0.3].map((v) => ({ o: at(([[0.9, -0.14], [1.32, -0.12], [1.34, 0.12], [0.92, 0.14]] as Pt[]).map(([u, w]) => [u * s, w + v] as Pt)), edge: true }))),
    ],
    lights: [{ at: at([[-0.76, -0.9], [-0.44, -1.1], [0, -1.16]]), w: 1.6 }],
    flow: [{ at: at([[0.28, -0.75, 'h'], [0.34, -0.98], [0.22, -1.16]]), w: 0.7 }, { at: at([[-0.28, -0.75, 'h'], [-0.36, -0.98], [-0.24, -1.16]]), w: 0.7 }],
  }),

  // ----- thinning and bald -----

  // Gone back at the temples, with a forelock in the middle.
  receding: ({ at }) => ({
    front: [{
      o: at(cap(1.14)),
      i: at([...burnUp(0.08), [0.76, -0.6, 'h'], [0.6, -0.87, 'h'], [0.3, -0.88, 'h'], [0, -0.75, 'h'], [-0.3, -0.88, 'h'], [-0.6, -0.87, 'h'], [-0.76, -0.6, 'h'], ...mirrored(burnUp(0.08))]),
    }],
    lights: [{ at: at([[-0.74, -0.92], [-0.4, -1.06]]), w: 1.5 }],
  }),
  // Still there on top, but thin: the scalp shows through, and the hair over the ears is full.
  thinning: ({ at }) => ({
    front: [
      { o: at([[-0.84, -0.6, 'c'], [-0.8, -0.96], [-0.4, -1.08], [0.4, -1.08], [0.8, -0.96], [0.84, -0.6, 'c']]), i: at([[0.5, -0.8, 'h'], [0, -0.74, 'h'], [-0.5, -0.8, 'h']]), thin: true },
      ...overEars(at),
    ],
  }),
  // Bald on top: what is left is the hair over each ear.
  bald: ({ at }) => ({ front: overEars(at), gleam: [{ at: at([[-0.52, -0.78], [-0.36, -0.87], [-0.16, -0.9]]), w: 2.4 }] }),
};

/** Ropes of hair over each shoulder: locs when thick, braids when thin. `count` a side, each `width` wide (in head units), down to `bottom`. */
function ropes(at: Kit['at'], count: number, width: number, bottom: number): Mass[] {
  const out: Mass[] = [];
  for (const s of [-1, 1]) for (let i = 0; i < count; i++) {
    // They start together under the hair at the temple and fan out over the shoulder.
    const u0 = 0.7 + i * 0.07;
    const u1 = 0.86 + i * (width + 0.05);
    const end = bottom - (i % 2) * 0.16;
    const one: Pt[] = [[u0, -0.2, 'c'], [u1 + 0.02, 0.7], [u1, end - 0.1], [u1 + width / 2, end], [u1 + width, end - 0.1], [u1 + width + 0.02, 0.7], [u0 + width, -0.2, 'c']];
    out.push({ o: at(one.map(([u, v, k]) => [u * s, v, k] as Pt)) });
  }
  return out;
}

/** The hair a bald head keeps over each ear. */
function overEars(at: Kit['at']): Mass[] {
  const right: { o: Pt[]; i: Pt[] } = { o: [[0.84, -0.66, 'c'], [1.0, -0.56], [1.05, -0.2], [0.995, 0.12, 'c']], i: [[0.87, 0.1, 'c'], [0.86, -0.2], [0.8, -0.46]] };
  return [{ o: at(right.o), i: at(right.i), cast: false }, { o: at(mirrored(right.o)), i: at(mirrored(right.i)), cast: false }];
}

/** A few curls drawn inside a head of them, at the largest size: each a small hook. */
const CURLS: Pt[][] = [
  [[-0.62, -0.96], [-0.46, -1.04], [-0.38, -0.92]], [[0.16, -1.1], [0.34, -1.14], [0.4, -1.0]], [[0.7, -0.78], [0.86, -0.8], [0.9, -0.64]],
  [[-0.2, -0.86], [-0.04, -0.92], [0.04, -0.8]], [[-0.98, -0.5], [-0.86, -0.6], [-0.78, -0.48]],
];
/** The same for tight coils: smaller, and more of them. */
const COILS: Pt[][] = [
  [[-0.6, -0.9], [-0.52, -0.96], [-0.46, -0.9]], [[-0.2, -1.0], [-0.12, -1.06], [-0.06, -1.0]], [[0.22, -1.0], [0.3, -1.06], [0.36, -1.0]],
  [[0.6, -0.88], [0.68, -0.94], [0.74, -0.88]], [[-0.38, -0.8], [-0.3, -0.86], [-0.24, -0.8]], [[0.02, -0.82], [0.1, -0.88], [0.16, -0.82]],
  [[0.4, -0.78], [0.48, -0.84], [0.54, -0.78]], [[-0.82, -0.64], [-0.74, -0.7], [-0.68, -0.64]],
];

// ---------- drawing ----------

const stroke = (d: string, colour: string, w: number, extra = '') =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${n1(w)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

function layer(masses: Mass[] | undefined, ink: HairInk, detail: Detail, head: Head, onSkin: boolean, lines: Line[] = [], lights: Line[] = []): string {
  if (!masses?.length) return '';
  const shapes = masses.map((m) => ({ m, ...(m.i ? twoEdged(m.o, m.i) : { d: closedPath(m.o), rim: '' }) }));
  const solid = shapes.filter((s) => !s.m.thin).map((s) => s.d).join('');
  const thin = shapes.filter((s) => s.m.thin).map((s) => s.d).join('');
  let s = '';
  if (detail !== 'sm' && onSkin) {
    // What the fringe casts on the forehead: everything above the inner edge moved down a little, clipped to the head.
    for (const { m } of shapes) {
      if (!m.i || m.thin || m.cast === false) continue;
      const first = m.i[0];
      const last = m.i[m.i.length - 1];
      const top = head.cy - head.h * 1.4;
      s += `<path d="M${n1(first.x)} ${n1(first.y)}${segments(m.i, false).join('')}L${n1(last.x - head.w)} ${n1(last.y)}L${n1(last.x - head.w)} ${n1(top)}L${n1(first.x + head.w)} ${n1(top)}L${n1(first.x + head.w)} ${n1(first.y)}Z" transform="translate(.3 1.5)" fill="${ink.skinShade}" opacity=".5" clip-path="url(#hc)"/>`;
    }
  }
  if (thin) s += `<path d="${thin}" fill="${ink.hair}" opacity=".42"/>`;
  if (solid) s += `<path d="${solid}" fill="${ink.hair}"/>`;
  if (detail === 'sm') return s;
  // The rim: only where hair meets skin, or (behind the head) where it lies on the clothes.
  const rim = shapes.map((x) => (x.m.thin ? '' : onSkin && !x.m.edge ? x.rim : x.d)).join('');
  if (rim) s += stroke(rim, ink.line, ink.sw * (onSkin ? 0.85 : 0.6), onSkin ? '' : ' opacity=".55"');
  // A highlight is a sliver: thick in the middle and pointed at both ends.
  for (const l of lights) s += `<path d="${sliver(l)}" fill="${ink.light}" opacity=".45"/>`;
  // A parting or a row (a line of full width) shows from the middle size up, in the rim's colour; the finer lines of flow only at the largest.
  for (const l of lines) {
    if (l.w >= 1) s += stroke(openPath(l.at), ink.line, l.w * 0.8, ' opacity=".7"');
    else if (detail === 'lg') s += stroke(openPath(l.at), ink.shade, l.w, ' opacity=".8"');
  }
  return s;
}

/** A line as a sliver of its width: out along the points, and back along the same ones moved aside in the middle. */
function sliver({ at, w }: Line): string {
  const a = at[0];
  const b = at[at.length - 1];
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Aside is the right of the direction of travel: below a line drawn left to right across the crown.
  const aside = (p: XY): XY => ({ x: p.x - ((b.y - a.y) / d) * w, y: p.y + ((b.x - a.x) / d) * w, c: false });
  return closedPath([{ ...a, c: true }, ...at.slice(1, -1), { ...b, c: true }, ...at.slice(1, -1).reverse().map(aside)]);
}

/** The hair in this style: behind the head, over the shoulders, and over the face. */
export function drawHair(style: HairStyle, head: Head, ink: HairInk, detail: Detail): HairParts {
  const draw = STYLES[style] ?? STYLES.short;
  const at = (pts: readonly Pt[]) => pts.map((p) => place(head, p));
  const art = draw({
    at,
    lobes: (pts, count, amp, sharp) => lobesAlong(at(pts), count, amp, sharp),
    plait: (pts, links, width) => plaitAlong(at(pts), links, width),
    sm: detail === 'sm', lg: detail === 'lg',
  });
  return {
    back: layer(art.back, ink, detail, head, false, art.backFlow),
    overBody: layer(art.body, ink, detail, head, false),
    front: layer(art.front, ink, detail, head, true, art.flow, art.lights) +
      (detail === 'lg' ? (art.gleam ?? []).map((l) => stroke(openPath(l.at), '#fff', l.w, ' opacity=".22"')).join('') : ''),
  };
}
