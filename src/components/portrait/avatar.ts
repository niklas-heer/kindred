// The avatar drawing: a warm, flat illustration built from parts in one 100 × 100 space. Every
// part is a function of the resolved Appearance (src/lib/portrait-look.ts) and a Geo for the life stage, so a child
// has a rounder face and a bigger head, and the same parts dress any era.
//
// Style: flat fills, one soft shadow tone, outlines in a darker shade of each fill (never black). Hair and beards are
// the exception: flat masses with a rim only where they meet skin (hair.ts, beard.ts).
import type { ClothingStyle, HairStyle } from '~/lib/seed-format';
import { mixHex as mix, type Appearance, type Features, type LevelKey } from '../../lib/portrait-look';
import type { Dress } from './palette';
import { drawBeard, drawMoustache } from './beard';
import { drawHair } from './hair';
import { halfWidth, sampleClosed, type Head } from './ink';

export type Detail = 'sm' | 'md' | 'lg';

const DARK = '#2a170f';
const LINEN = '#f3ecdf';
const GOLD = '#e0b24a';
const n = (x: number) => String(Math.round(x * 100) / 100);
const shade = (c: string, t = 0.5) => mix(c, DARK, t);
const tint = (c: string, t = 0.3) => mix(c, '#fff8ee', t);

interface Geo {
  cx: number; cy: number; w: number; h: number;
  nw: number; ny: number; S: number;
  eyeY: number; dx: number; er: number; browY: number; noseY: number; mouthY: number;
  /** The face's 0–10 measures, as −1…1 offsets from the average (see `m`). */
  m: Record<LevelKey, number>;
  /** Shifts the hairline: negative lowers it. */
  hs: number;
  f: Features;
  /** Build as an offset: −1 slight, 0 average, +1 heavy. */
  b: number;
}

/** A measure as an offset: 0 at the average (5), −1 at 0, +1 at 10. */
const offset = (f: Features, k: LevelKey) => (f[k] - 5) / 5;

function geo(a: Appearance): Geo {
  const f = a.pres === 'f';
  const P = {
    baby: { cy: 50, w: 22.5, h: 21.5, nw: 6, ny: 80, S: 29, e: 0.2, er: 2.75, nose: 0.42, mouth: 0.63 },
    child: { cy: 47, w: 20.6, h: 22.4, nw: 6.4, ny: 78.5, S: 32, e: 0.14, er: 2.5, nose: 0.39, mouth: 0.62 },
    teen: { cy: 44.6, w: f ? 18.2 : 18.8, h: 23.4, nw: f ? 6.6 : 7.1, ny: 77.5, S: f ? 35 : 37.5, e: 0.08, er: 2.3, nose: 0.36, mouth: 0.6 },
    adult: { cy: 43.6, w: f ? 17.9 : 18.8, h: 24.2, nw: f ? 6.8 : 7.5, ny: 77, S: f ? 37 : 40.5, e: 0.06, er: 2.2, nose: 0.35, mouth: 0.6 },
  }[a.stage === 'baby' || a.stage === 'child' || a.stage === 'teen' ? a.stage : 'adult'];
  const { cy, w, h } = P;
  const m = Object.fromEntries((Object.keys(a.feat) as LevelKey[]).map((k) => [k, offset(a.feat, k)])) as Record<LevelKey, number>;
  const eyeY = cy + P.e * h;
  const er = P.er * 1.12 * (1 + 0.2 * m.eyeSize);
  // Build widens or narrows the neck and the shoulders (and the cheeks, in headPath). Average changes nothing.
  const b = (a.build - 5) / 5;
  return {
    cx: 50, cy, w, h, nw: P.nw * (1 + 0.16 * b), ny: P.ny, S: P.S * (1 + 0.06 * b), b,
    eyeY, dx: w * 0.42 * (1 + 0.14 * m.eyeSpacing), er,
    browY: eyeY - er * 2.05 - 0.7 - 1.4 * m.browHeight, noseY: cy + P.nose * h, mouthY: cy + P.mouth * h,
    m, hs: -0.025 * (a.feat.hairline - 5), f: a.feat,
  };
}

// ---------- Paint ----------

interface Paint {
  sw: number;
  skin: string; skinShade: string; skinLine: string; blush: string; lips: string;
  hair: string; hairShade: string; hairLine: string; hairLight: string;
  brow: string;
}

function paint(a: Appearance, detail: Detail): Paint {
  const sw = detail === 'sm' ? 1.5 : detail === 'md' ? 1.15 : 0.95;
  return {
    sw,
    skin: a.skin,
    skinShade: mix(a.skin, '#8a3f24', 0.2),
    skinLine: mix(a.skin, '#3a1d12', 0.55),
    blush: mix(a.skin, '#e2645a', 0.45),
    lips: a.lips ? mix(a.skin, a.lips, 0.8) : mix(a.skin, '#b5463e', 0.32),
    hair: a.hair,
    hairShade: shade(a.hair, 0.28),
    hairLine: shade(a.hair, 0.5),
    hairLight: tint(a.hair, 0.28),
    // Brows grey later than hair, and stay darker than it.
    brow: shade(mix(a.hairBase, a.hair, 0.55), 0.22),
  };
}

const filled = (fill: string, sw: number, line = shade(fill, 0.5)) =>
  `fill="${fill}" stroke="${line}" stroke-width="${n(sw)}" stroke-linejoin="round"`;
const stroked = (color: string, width: number, extra = '') =>
  `fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"${extra}`;

// ---------- Head ----------

/**
 * The outline of each face shape: the right half from the crown to the chin, as [x, y] in units of the
 * head's half-width and height from the centre (y down). The left half is its mirror.
 */
const OUTLINE: Record<Appearance['face'], [number, number][]> = {
  round: [[0, -1], [0.56, -1], [1, -0.6], [1.0, -0.05], [0.94, 0.42], [0.84, 0.74], [0.42, 0.93], [0, 1.05]],
  oval: [[0, -1], [0.54, -1], [0.96, -0.6], [0.98, -0.05], [0.84, 0.4], [0.66, 0.76], [0.34, 0.95], [0, 1.06]],
  square: [[0, -1], [0.64, -1], [0.98, -0.68], [1.0, -0.12], [0.99, 0.3], [0.94, 0.62], [0.74, 0.88], [0.46, 0.98], [0, 1.02]],
  long: [[0, -1], [0.5, -1], [0.9, -0.62], [0.92, -0.05], [0.8, 0.42], [0.62, 0.8], [0.32, 0.98], [0, 1.1]],
  heart: [[0, -1], [0.62, -1], [1.0, -0.6], [0.94, -0.1], [0.78, 0.3], [0.6, 0.6], [0.36, 0.84], [0.16, 0.98], [0, 1.06]],
  diamond: [[0, -1], [0.46, -1], [0.84, -0.64], [1.0, -0.04], [0.88, 0.4], [0.62, 0.76], [0.3, 0.97], [0, 1.07]],
  pear: [[0, -1], [0.5, -1], [0.88, -0.62], [0.93, -0.08], [1.0, 0.36], [0.92, 0.7], [0.58, 0.95], [0, 1.04]],
};

/** A closed smooth curve through the points (Catmull-Rom, as cubic Béziers). */
function smoothClosed(pts: [number, number][]): string {
  const N = pts.length;
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d + 'Z';
}

/** The points the head's outline passes through. */
function headPoints(g: Geo, a: Appearance): [number, number][] {
  const { cx, cy, w } = g;
  const h = a.face === 'long' ? g.h * 1.04 : g.h;
  // The jaw is the one measure that changes the outline: broad below the cheekbones, or narrow.
  const jawK = 1 + 0.16 * g.m.jaw;
  // A heavy build fills the cheeks out from the temples down, a slight one draws them in.
  const cheek = (y: number) => 1 + 0.08 * g.b * Math.max(0, Math.min(1, (y + 0.3) / 0.5));
  const right = OUTLINE[a.face].map(([x, y]) => [x * (y > 0.2 ? jawK : 1) * cheek(y), y] as [number, number]);
  const mirror = right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number]);
  return [...right, ...mirror].map(([x, y]) => [cx + x * w, cy + y * h] as [number, number]);
}

function neckAndChest(g: Geo, p: Paint): string {
  const { cx, cy, h, nw, ny } = g;
  const d =
    `M${n(cx - nw)} ${n(cy + 0.5 * h)}L${n(cx - nw)} ${n(ny - 2)}C${n(cx - nw)} ${n(ny + 2)} ${n(cx - nw - 6)} ${n(ny + 3)} ${n(cx - nw - 13)} ${n(ny + 5)}` +
    `L${n(cx - nw - 13)} 104L${n(cx + nw + 13)} 104L${n(cx + nw + 13)} ${n(ny + 5)}` +
    `C${n(cx + nw + 6)} ${n(ny + 3)} ${n(cx + nw)} ${n(ny + 2)} ${n(cx + nw)} ${n(ny - 2)}L${n(cx + nw)} ${n(cy + 0.5 * h)}Z`;
  // The head's shadow on the neck.
  const shadow = `M${n(cx - nw)} ${n(cy + 0.6 * h)}Q${n(cx)} ${n(cy + 1.28 * h)} ${n(cx + nw)} ${n(cy + 0.6 * h)}L${n(cx + nw)} ${n(cy + 0.5 * h)}L${n(cx - nw)} ${n(cy + 0.5 * h)}Z`;
  return `<path d="${d}" ${filled(p.skin, p.sw, p.skinLine)}/><path d="${shadow}" fill="${p.skinShade}"/>`;
}

function ears(g: Geo, p: Paint, a: Appearance): string {
  const y = g.eyeY + (a.stage === 'baby' ? 1.5 : 2.6);
  const k = 1 + 0.3 * g.m.earSize;
  const rx = (a.stage === 'baby' ? 3.1 : 2.8) * k;
  const ry = (a.stage === 'baby' ? 3.8 : 4.4) * k;
  const one = (s: number) => {
    const x = g.cx + s * (g.w - 0.3);
    return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" ${filled(p.skin, p.sw, p.skinLine)}/>` +
      `<path d="M${n(x + s * 0.9 * k)} ${n(y - 2 * k)}Q${n(x - s * 0.6 * k)} ${n(y - k)} ${n(x + s * 0.4 * k)} ${n(y + 2 * k)}" ${stroked(p.skinShade, 0.9)}/>`;
  };
  return one(-1) + one(1);
}

function face(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, cy, w, h, eyeY, dx, er } = g;
  const lg = detail !== 'sm';
  const kid = a.stage === 'baby' || a.stage === 'child';
  let s = '';
  // Shade the far side of the face, and the hair's shadow on the forehead (drawn with the hair).
  if (lg) s += `<ellipse cx="${n(cx + w * 0.98)}" cy="${n(cy + h * 0.15)}" rx="${n(w * 0.32)}" ry="${n(h * 0.95)}" fill="${p.skinShade}" opacity=".55" clip-path="url(#hc)"/>`;
  // Modelling: a soft shadow under the cheekbones and along the jaw, a light plane on the cheekbones,
  // and the sockets above the eyes. Flat tones only, so they stay cheap and print well.
  if (lg) {
    s += `<ellipse cx="${n(cx)}" cy="${n(cy + 0.9 * h)}" rx="${n(w * 0.78)}" ry="${n(h * 0.2)}" fill="${p.skinShade}" opacity=".16" clip-path="url(#hc)"/>`;
    for (const sx of [-1, 1]) {
      s += `<ellipse cx="${n(cx + sx * (dx + 0.6))}" cy="${n(eyeY - er * 1.5)}" rx="${n(dx * 0.42)}" ry="${n(er * 0.9)}" fill="${p.skinShade}" opacity=".13"/>`;
      s += `<ellipse cx="${n(cx + sx * w * 0.5)}" cy="${n(g.noseY - 1.5)}" rx="${n(w * 0.22)}" ry="${n(h * 0.1)}" fill="${tint(p.skin, 0.3)}" opacity=".3"/>`;
    }
  }

  // Cheeks.
  const blushO = a.marks.includes('blush') ? 0.6 : kid ? 0.45 : a.pres === 'f' ? 0.28 : 0.16;
  if (lg) for (const sx of [-1, 1]) s += `<ellipse cx="${n(cx + sx * w * 0.56)}" cy="${n(g.noseY + 1)}" rx="${n(kid ? 3.6 : 3.2)}" ry="${n(kid ? 2.4 : 2)}" fill="${p.blush}" opacity="${blushO}"/>`;

  // Lines with age: smile lines, then crow's feet and a brow line, then deeper.
  if (a.lines > 0 && lg) {
    const o = 0.3 + a.lines * 0.12;
    const L = (d: string, wd = 0.75) => `<path d="${d}" ${stroked(p.skinLine, wd)} opacity="${n(o)}"/>`;
    for (const sx of [-1, 1]) {
      s += L(`M${n(cx + sx * 4.6)} ${n(g.noseY - 1.6)}Q${n(cx + sx * 7.4)} ${n(g.noseY + 3.4)} ${n(cx + sx * 6)} ${n(g.mouthY + 1.4)}`);
      if (a.lines > 1) {
        s += L(`M${n(cx + sx * (dx + er * 1.7))} ${n(eyeY - 0.6)}l${n(sx * 1.8)} -0.9M${n(cx + sx * (dx + er * 1.7))} ${n(eyeY + 0.8)}l${n(sx * 1.8)} 0.7`, 0.6);
        s += L(`M${n(cx + sx * (dx - er))} ${n(eyeY + er * 1.45)}Q${n(cx + sx * dx)} ${n(eyeY + er * 2)} ${n(cx + sx * (dx + er))} ${n(eyeY + er * 1.3)}`, 0.6);
      }
      if (a.lines > 2) s += L(`M${n(cx + sx * w * 0.55)} ${n(g.mouthY + 2.5)}Q${n(cx + sx * w * 0.6)} ${n(g.mouthY + 6)} ${n(cx + sx * w * 0.42)} ${n(cy + h * 0.86)}`, 0.6);
    }
    if (a.lines > 1) s += L(`M${n(cx - 6)} ${n(g.browY - 4.4)}Q${n(cx)} ${n(g.browY - 5.6)} ${n(cx + 6)} ${n(g.browY - 4.4)}`, 0.6);
    if (a.lines > 2) s += L(`M${n(cx - 4.5)} ${n(g.browY - 6.6)}Q${n(cx)} ${n(g.browY - 7.6)} ${n(cx + 4.5)} ${n(g.browY - 6.6)}`, 0.55);
  }

  // Freckles across the nose and cheeks.
  if (a.marks.includes('freckles') && lg) {
    const fc = mix(a.skin, '#7a3a1c', 0.4);
    const pts = [[-7, 0], [-5.4, 1.4], [-8.4, 1.8], [-6.2, 3], [-3.6, 0.2], [3.6, 0.2], [5.4, 1.4], [7, 0], [8.4, 1.8], [6.2, 3], [-1.2, -1.6], [1.4, -1.4]];
    s += pts.map(([x, y]) => `<circle cx="${n(cx + x)}" cy="${n(g.noseY - 2 + y)}" r=".5" fill="${fc}" opacity=".75"/>`).join('');
  }
  if (a.marks.includes('mole')) s += `<circle cx="${n(cx + w * 0.4)}" cy="${n(g.mouthY - 2.5)}" r="${lg ? 0.7 : 0.9}" fill="${shade(a.skin, 0.6)}"/>`;
  if (a.marks.includes('scar') && lg) s += `<path d="M${n(cx - dx - 2.2)} ${n(g.browY - 2.6)}L${n(cx - dx + 1.2)} ${n(eyeY + er * 1.6)}" ${stroked(mix(a.skin, '#b05a50', 0.45), 0.8)}/>`;
  s += laterMarks(g, p, a, detail);

  s += eyes(g, p, a, detail);
  s += nose(g, p, a, detail);
  return s;
}

/** The marks and signs of build added with the editor's second version. Nothing here draws for a look that has none of them. */
function laterMarks(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, cy, w, h, eyeY, dx, er } = g;
  const lg = detail !== 'sm';
  let s = '';
  // A port-wine mark over one cheek and temple, in the skin's own red.
  if (a.marks.includes('birthmark')) {
    const c = mix(a.skin, '#8f2f45', 0.42);
    s += lg
      ? `<path d="M${n(cx - w * 1.02)} ${n(eyeY - 1)}C${n(cx - w * 0.7)} ${n(eyeY - 5)} ${n(cx - w * 0.3)} ${n(eyeY + 3.5)} ${n(cx - w * 0.36)} ${n(g.noseY + 1)}C${n(cx - w * 0.4)} ${n(g.noseY + 5.5)} ${n(cx - w * 0.9)} ${n(g.noseY + 7)} ${n(cx - w * 1.05)} ${n(g.noseY + 3)}Z" fill="${c}" opacity=".62" clip-path="url(#hc)"/>`
      : `<ellipse cx="${n(cx - w * 0.68)}" cy="${n(g.noseY)}" rx="${n(w * 0.3)}" ry="${n(h * 0.2)}" fill="${c}" opacity=".62" clip-path="url(#hc)"/>`;
  }
  // Vitiligo: paler patches around the eyes and the mouth, where it most often shows.
  if (a.marks.includes('vitiligo')) {
    const c = mix(a.skin, '#fff1e4', 0.62);
    const patch = (x: number, y: number, rx: number, ry: number, rot = 0) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}"${rot ? ` transform="rotate(${rot} ${n(x)} ${n(y)})"` : ''} fill="${c}" opacity=".85" clip-path="url(#hc)"/>`;
    s += patch(cx + dx + 0.6, eyeY + 0.4, er * 2.3, er * 1.9, -12) + patch(cx - 1, g.mouthY + 2.4, 6.4, 4);
    if (lg) s += patch(cx - dx - 2.4, eyeY + 1.6, er * 1.5, er * 1.9, 18) + patch(cx - w * 0.34, cy - h * 0.72, 4.4, 2.6, -14) + patch(cx + w * 0.7, g.noseY + 5.5, 2.4, 3.2, 10);
  }
  if (a.marks.includes('cleft') && lg) s += `<path d="M${n(cx)} ${n(cy + 0.86 * h)}q0.7 1.3 0 2.7" ${stroked(p.skinLine, 0.8)} opacity=".6"/>`;
  if (a.marks.includes('cheek-scar') && lg) s += `<path d="M${n(cx + w * 0.34)} ${n(g.noseY + 0.6)}l${n(w * 0.26)} 4.4" ${stroked(mix(a.skin, '#b05a50', 0.45), 0.85)}/>`;
  // A heavy build: the fold of a second chin. A slight one: the hollow under the cheekbones.
  if (lg && g.b >= 0.6) s += `<path d="M${n(cx - w * 0.42)} ${n(cy + 0.9 * h)}Q${n(cx)} ${n(cy + (0.98 + 0.05 * g.b) * h)} ${n(cx + w * 0.42)} ${n(cy + 0.9 * h)}" ${stroked(p.skinLine, 0.75)} opacity=".4"/>`;
  if (lg && g.b <= -0.6) for (const sx of [-1, 1]) s += `<ellipse cx="${n(cx + sx * w * 0.6)}" cy="${n(g.mouthY - 1.5)}" rx="${n(w * 0.16)}" ry="${n(h * 0.2)}" fill="${p.skinShade}" opacity=".3" clip-path="url(#hc)"/>`;
  return s;
}

/**
 * One eye opening. A round eye is an ellipse; an almond eye has its outer corner lifted; a hooded eye
 * has the upper lid lowered over the iris. `lid` is the top edge alone, `open` the whole opening.
 */
function eyeShapes(x: number, y: number, sx: number, rx: number, ry: number, shape: Appearance['eyeShape']) {
  if (shape === 'round') {
    return {
      lid: `M${n(x - rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x + rx)} ${n(y)}`,
      low: `M${n(x + rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x - rx)} ${n(y)}`,
      open: `M${n(x - rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 1 1 ${n(x + rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 1 1 ${n(x - rx)} ${n(y)}Z`,
    };
  }
  // A monolid's upper lid is flatter and runs down into the inner corner; a downturned eye drops its outer corner.
  const lift = shape === 'hooded' ? 0.55 : shape === 'monolid' ? 0.74 : 1;
  const ix = x - sx * rx;
  const iy = y + (shape === 'monolid' ? 0.3 : shape === 'downturned' ? -0.1 : 0.15) * ry;
  const ox = x + sx * rx;
  const oy = y + (shape === 'monolid' ? -0.34 : shape === 'downturned' ? 0.3 : -0.22) * ry;
  const lid = `M${n(ix)} ${n(iy)}C${n(x - sx * rx * 0.35)} ${n(y - ry * 1.25 * lift)} ${n(x + sx * rx * 0.55)} ${n(y - ry * 1.15 * lift)} ${n(ox)} ${n(oy)}`;
  const low = `M${n(ox)} ${n(oy)}C${n(x + sx * rx * 0.5)} ${n(y + ry * 0.9)} ${n(x - sx * rx * 0.3)} ${n(y + ry * 1.0)} ${n(ix)} ${n(iy)}`;
  return { lid, low, open: `${lid}${low.slice(low.indexOf('C'))}Z` };
}

function eyes(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, eyeY: y, dx, er } = g;
  const kid = a.stage === 'baby' || a.stage === 'child';
  const iris = mix(a.eyes, '#120a06', 0.12);
  const rx = er * (a.eyeShape === 'round' ? 0.86 : a.eyeShape === 'monolid' ? 1.08 : 1.02);
  const ry = er * (kid ? 0.98 : 0.92);
  const lg = detail === 'lg';
  let s = '';
  for (const sx of [-1, 1]) {
    const x = cx + sx * dx;
    const e = eyeShapes(x, y, sx, rx, ry, a.eyeShape);
    if (detail === 'sm') {
      // At list size an eye is a dark shape, with a light gleam so it still reads as an eye.
      s += `<path d="${e.open}" fill="${mix(iris, '#120a06', 0.45)}"/>`;
      s += `<circle cx="${n(x + er * 0.3)}" cy="${n(y - er * 0.35)}" r="${n(er * 0.26)}" fill="#fff" opacity=".9"/>`;
      continue;
    }
    const id = sx < 0 ? 'el' : 'er';
    const ir = er * (kid ? 0.56 : 0.5);
    // The sclera, the iris and pupil clipped to the opening, the lid's shadow over the top of the eye.
    s += `<clipPath id="${id}"><path d="${e.open}"/></clipPath>`;
    s += `<path d="${e.open}" fill="#f4eee5"/>`;
    s += `<g clip-path="url(#${id})">` +
      `<circle cx="${n(x)}" cy="${n(y + 0.1 * ry)}" r="${n(ir)}" fill="${iris}" stroke="${shade(iris, 0.5)}" stroke-width="${lg ? 0.35 : 0}"/>` +
      `<circle cx="${n(x)}" cy="${n(y + 0.1 * ry)}" r="${n(ir * 0.5)}" fill="#120a06"/>` +
      `<circle cx="${n(x + ir * 0.36)}" cy="${n(y + 0.1 * ry - ir * 0.36)}" r="${n(ir * 0.28)}" fill="#fff"/>` +
      (lg ? `<circle cx="${n(x - ir * 0.4)}" cy="${n(y + 0.1 * ry + ir * 0.4)}" r="${n(ir * 0.14)}" fill="#fff" opacity=".6"/>` : '') +
      `<ellipse cx="${n(x)}" cy="${n(y - ry * 1.05)}" rx="${n(rx * 1.1)}" ry="${n(ry * 0.48)}" fill="${p.skinShade}" opacity="${a.eyeShape === 'hooded' ? 0.6 : 0.42}"/>` +
      `</g>`;
    // The lids: a dark upper line, a fainter lower one, and a crease over a hooded eye.
    const heavy = a.eyeShape === 'hooded' || a.lines > 1;
    s += `<path d="${e.lid}" ${stroked(shade(p.skinLine, 0.25), lg ? 1.05 : 1.2)}/>`;
    if (lg) s += `<path d="${e.low}" ${stroked(p.skinShade, 0.45)} opacity=".6"/>`;
    if (a.eyeShape === 'hooded' && lg) {
      s += `<path d="M${n(x - sx * rx * 0.9)} ${n(y - ry * 1.5)}Q${n(x + sx * 0.2)} ${n(y - ry * 2.0)} ${n(x + sx * rx * 0.95)} ${n(y - ry * 1.4)}" ${stroked(p.skinShade, 0.7)} opacity=".7"/>`;
    }
    if (heavy && !lg) s += `<path d="${e.lid}" ${stroked(shade(p.skinLine, 0.25), 1.6)}/>`;
    // Lashes flick out at the outer corner for a feminine face.
    if (a.pres === 'f' && !kid && lg) {
      const ox = x + sx * rx;
      const oy = y - 0.22 * ry;
      s += `<path d="M${n(ox)} ${n(oy)}l${n(sx * 1.2)} -0.9" ${stroked(shade(p.skinLine, 0.25), 0.8)}/>`;
    }
    // Long lashes, for anyone: two more along the upper lid.
    if (a.marks.includes('lashes')) {
      const ox = x + sx * rx * 0.96;
      s += `<path d="M${n(ox)} ${n(y - 0.3 * ry)}l${n(sx * 1.5)} -1.3M${n(x + sx * rx * 0.55)} ${n(y - 0.86 * ry)}l${n(sx * 0.9)} -1.5" ${stroked(shade(p.skinLine, 0.25), 0.75)}/>`;
    }
    // Smiling eyes: a grin lifts the cheeks under them.
    if (a.expression === 'grin' && lg) s += `<path d="M${n(x - rx * 0.9)} ${n(y + ry * 1.5)}Q${n(x)} ${n(y + ry * 0.95)} ${n(x + rx * 0.9)} ${n(y + ry * 1.5)}" ${stroked(p.skinShade, 0.7)} opacity=".7"/>`;
  }
  return s + brows(g, p, a, detail);
}

function brows(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, dx, browY: y } = g;
  const kid = a.stage === 'baby' || a.stage === 'child';
  const k = kid ? 0.85 : 1;
  // A tapered brow: thick towards the nose, thinning to the outer end. `arch` lifts the middle,
  // `tilt` drops the outer end, `thick` is the brow's depth at its middle.
  const B = {
    soft: { arch: 1.0, thick: 0.9, tilt: 0.5, inner: 1.5 },
    straight: { arch: 0.2, thick: 0.75, tilt: 0.2, inner: 1.2 },
    arched: { arch: 2.1, thick: 0.6, tilt: 0.9, inner: 1.1 },
    thick: { arch: 0.9, thick: 1.45, tilt: 0.3, inner: 2.1 },
    thin: { arch: 1.2, thick: 0.45, tilt: 0.5, inner: 0.8 },
    bushy: { arch: 1.5, thick: 2.0, tilt: 0.4, inner: 2.6 },
  }[a.brows];
  const len = (kid ? 2.8 : 3.3) * (detail === 'sm' ? 1.1 : 1);
  let s = '';
  for (const sx of [-1, 1]) {
    const X = (u: number) => n(cx + sx * (dx + u));
    const Y = (v: number) => n(v);
    // A stern look draws the brows down towards the nose.
    const y0 = y + 0.6 + (a.expression === 'stern' ? 1.1 : 0);
    const y1 = y + B.tilt * k;
    const mid = (y0 + y1) / 2;
    const thick = B.thick * k * (detail === 'sm' ? 1.3 : 1);
    const inner = B.inner * k * (detail === 'sm' ? 1.3 : 1);
    const d =
      `M${X(-1)} ${Y(y0)}Q${X(len * 0.45)} ${Y(mid - B.arch)} ${X(len)} ${Y(y1)}` +
      `Q${X(len * 0.4)} ${Y(mid - B.arch + thick)} ${X(-1)} ${Y(y0 + inner)}Z`;
    s += `<path d="${d}" fill="${p.brow}"${detail === 'lg' ? ` stroke="${shade(p.brow, 0.2)}" stroke-width=".3"` : ''}/>`;
    if (a.brows === 'bushy' && detail === 'lg') {
      s += `<path d="M${X(len * 0.2)} ${Y(mid - B.arch)}l${n(sx * 1.2)} -1.1M${X(len * 0.6)} ${Y(mid - B.arch + 0.3)}l${n(sx * 1.2)} -0.9" ${stroked(p.brow, 0.5)}/>`;
    }
  }
  return s;
}

function nose(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, noseY: y } = g;
  const line = stroked(p.skinLine, detail === 'sm' ? 1.2 : 0.95);
  if (a.stage === 'baby' || a.stage === 'child') {
    return `<path d="M${n(cx - 1.5)} ${n(y)}Q${n(cx)} ${n(y + 1.4)} ${n(cx + 1.5)} ${n(y)}" ${line}/>`;
  }
  // Size scales the whole nose about its root, so a large nose keeps its shape.
  const k = 1 + 0.3 * g.m.noseSize;
  const lg = detail !== 'sm';
  const shadowLine = lg ? `<path d="M${n(cx + 1.4)} ${n(y - 4.6)}Q${n(cx + 2.6)} ${n(y - 1.2)} ${n(cx + 1.8)} ${n(y + 0.8)}" ${stroked(p.skinShade, 0.9)} opacity=".55"/>` : '';
  const under = lg ? `<ellipse cx="${n(cx)}" cy="${n(y + 1.9)}" rx="2.7" ry=".75" fill="${p.skinShade}" opacity=".75"/>` : '';
  let body: string;
  switch (a.noseShape) {
    case 'straight':
      body = `<path d="M${n(cx + 0.9)} ${n(y - 5.4)}Q${n(cx + 1.8)} ${n(y - 2)} ${n(cx + 1.7)} ${n(y + 0.3)}" ${stroked(p.skinShade, 0.7)}/>` +
        `<path d="M${n(cx - 2.4)} ${n(y + 0.2)}Q${n(cx - 2.3)} ${n(y + 2)} ${n(cx - 0.6)} ${n(y + 1.9)}Q${n(cx)} ${n(y + 1.4)} ${n(cx + 0.6)} ${n(y + 1.9)}Q${n(cx + 2.3)} ${n(y + 2)} ${n(cx + 2.4)} ${n(y + 0.2)}" ${line}/>`;
      break;
    case 'aquiline':
      body = `<path d="M${n(cx + 0.5)} ${n(y - 5.6)}Q${n(cx + 2.5)} ${n(y - 2.6)} ${n(cx + 1.5)} ${n(y + 0.2)}" ${stroked(p.skinShade, 0.8)}/>` +
        `<path d="M${n(cx - 2.2)} ${n(y + 0.4)}Q${n(cx - 2.4)} ${n(y + 2.2)} ${n(cx - 0.6)} ${n(y + 2)}Q${n(cx)} ${n(y + 1.6)} ${n(cx + 0.6)} ${n(y + 2)}Q${n(cx + 2.4)} ${n(y + 2.2)} ${n(cx + 2.2)} ${n(y + 0.4)}" ${line}/>`;
      break;
    case 'broad':
      body = `<path d="M${n(cx + 0.8)} ${n(y - 4.5)}Q${n(cx + 1.4)} ${n(y - 1.5)} ${n(cx + 1.6)} ${n(y + 0.4)}" ${stroked(p.skinShade, 0.7)}/>` +
        `<path d="M${n(cx - 3.4)} ${n(y + 0.4)}Q${n(cx - 3.7)} ${n(y + 2.4)} ${n(cx - 1.4)} ${n(y + 2.2)}Q${n(cx)} ${n(y + 2.8)} ${n(cx + 1.4)} ${n(y + 2.2)}Q${n(cx + 3.7)} ${n(y + 2.4)} ${n(cx + 3.4)} ${n(y + 0.4)}" ${line}/>`;
      break;
    case 'round':
      body = `<path d="M${n(cx + 0.7)} ${n(y - 4)}Q${n(cx + 1.5)} ${n(y - 1.6)} ${n(cx + 2)} ${n(y + 0.1)}" ${stroked(p.skinShade, 0.7)}/>` +
        `<path d="M${n(cx - 2.8)} ${n(y + 0.3)}Q${n(cx - 3.2)} ${n(y + 2.5)} ${n(cx - 1.2)} ${n(y + 2.2)}Q${n(cx)} ${n(y + 3.1)} ${n(cx + 1.2)} ${n(y + 2.2)}Q${n(cx + 3.2)} ${n(y + 2.5)} ${n(cx + 2.8)} ${n(y + 0.3)}" ${line}/>` +
        (lg ? `<ellipse cx="${n(cx - 0.3)}" cy="${n(y + 0.3)}" rx="1.5" ry="1.1" fill="${tint(p.skin, 0.4)}" opacity=".45"/>` : '');
      break;
    case 'narrow':
      body = `<path d="M${n(cx + 0.5)} ${n(y - 6.2)}Q${n(cx + 1.3)} ${n(y - 2.2)} ${n(cx + 1.1)} ${n(y + 0.5)}" ${stroked(p.skinShade, 0.75)}/>` +
        `<path d="M${n(cx - 1.7)} ${n(y + 0.5)}Q${n(cx - 1.7)} ${n(y + 2)} ${n(cx - 0.5)} ${n(y + 1.9)}Q${n(cx)} ${n(y + 1.5)} ${n(cx + 0.5)} ${n(y + 1.9)}Q${n(cx + 1.7)} ${n(y + 2)} ${n(cx + 1.7)} ${n(y + 0.5)}" ${line}/>`;
      break;
    default:
      body = `<path d="M${n(cx + 0.6)} ${n(y - 2.6)}Q${n(cx + 1)} ${n(y - 0.8)} ${n(cx + 1.2)} ${n(y + 0.2)}" ${stroked(p.skinShade, 0.6)}/>` +
        `<path d="M${n(cx - 1.8)} ${n(y + 0.9)}Q${n(cx - 1.5)} ${n(y + 2.3)} ${n(cx)} ${n(y + 2)}Q${n(cx + 1.5)} ${n(y + 2.3)} ${n(cx + 1.8)} ${n(y + 0.9)}" ${line}/>`;
  }
  const nostrils = lg ? `<ellipse cx="${n(cx - 1.1)}" cy="${n(y + 1.3)}" rx=".55" ry=".3" fill="${p.skinLine}" opacity=".8"/><ellipse cx="${n(cx + 1.1)}" cy="${n(y + 1.3)}" rx=".55" ry=".3" fill="${p.skinLine}" opacity=".8"/>` : '';
  return `<g transform="translate(${n(cx)} ${n(y)}) scale(${n(k)}) translate(${n(-cx)} ${n(-y)})">${under}${shadowLine}${body}${nostrils}</g>`;
}

/** Half the mouth's width at rest: what the lips, the beard and the moustache all measure from. */
function mouthHalf(g: Geo, a: Appearance): number {
  const kid = a.stage === 'baby' || a.stage === 'child';
  const base = kid ? 3.2 : a.stage === 'elder' ? 3.4 : 3.8;
  return base * (1 + 0.24 * g.m.mouthWidth);
}

function mouth(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, mouthY: y } = g;
  const kid = a.stage === 'baby' || a.stage === 'child';
  const wd = mouthHalf(g, a);
  // Fuller lips for a feminine face, and whatever the measure says.
  const fu = Math.max(0.5, 1 + 0.5 * g.m.mouthFullness) * (a.pres === 'f' && !kid ? 1.12 : 1);
  const style = kid ? (a.mouth % 2 ? 2 : 0) : a.mouth;
  const L = cx - wd;
  const R = cx + wd;
  const line = stroked(shade(p.lips, 0.45), detail === 'sm' ? 1.2 : 0.95);
  if (a.expression) return expression(g, p, a, detail, wd, fu);
  let s = '';
  if (a.lips && detail === 'sm') s += `<ellipse cx="${n(cx)}" cy="${n(y + 0.7)}" rx="${n(wd * 0.82)}" ry="1.5" fill="${p.lips}"/>`;
  if (style === 2 && detail !== 'sm') {
    // An open smile: the dark inside, and the teeth along the top.
    s += `<path d="M${n(L)} ${n(y - 0.4)}Q${n(cx)} ${n(y + 4.6 * fu)} ${n(R)} ${n(y - 0.4)}Q${n(cx)} ${n(y + 0.9)} ${n(L)} ${n(y - 0.4)}Z" fill="#7a2c26" stroke="${shade(p.lips, 0.5)}" stroke-width=".7"/>`;
    s += `<path d="M${n(cx - wd * 0.75)} ${n(y + 0.25)}Q${n(cx)} ${n(y + 1.3)} ${n(cx + wd * 0.75)} ${n(y + 0.25)}L${n(cx + wd * 0.6)} ${n(y + 1.2)}Q${n(cx)} ${n(y + 2)} ${n(cx - wd * 0.6)} ${n(y + 1.2)}Z" fill="#fff"/>`;
    return s;
  }
  if (detail !== 'sm') {
    // Both lips are filled shapes, so the mouth reads as lips and not a line; a thin mouth keeps them pale.
    const upper = style === 3 ? 0.3 : 0.78;
    const lower = style === 3 ? 0.28 : 0.85;
    s += `<path d="M${n(L)} ${n(y)}Q${n(cx - wd * 0.5)} ${n(y - 1.4 * fu)} ${n(cx - 0.6)} ${n(y - 0.9)}Q${n(cx)} ${n(y - 0.1)} ${n(cx + 0.6)} ${n(y - 0.9)}Q${n(cx + wd * 0.5)} ${n(y - 1.4 * fu)} ${n(R)} ${n(y)}Q${n(cx)} ${n(y + 1.2)} ${n(L)} ${n(y)}Z" fill="${p.lips}" opacity="${upper}"/>`;
    s += `<path d="M${n(L + 0.6)} ${n(y + 0.2)}Q${n(cx)} ${n(y + 1.5 + 1.1 * fu)} ${n(R - 0.6)} ${n(y + 0.2)}Q${n(cx)} ${n(y + 1.4)} ${n(L + 0.6)} ${n(y + 0.2)}Z" fill="${p.lips}" opacity="${lower}"/>`;
    if (style !== 3) s += `<path d="M${n(cx - wd * 0.2)} ${n(y + 1.2 + 0.4 * fu)}Q${n(cx)} ${n(y + 1.8 + 0.6 * fu)} ${n(cx + wd * 0.2)} ${n(y + 1.2 + 0.4 * fu)}" ${stroked('#fff8f0', 0.6)} opacity=".35"/>`;
  }
  // The line between the lips: a smile, or straight for a thin mouth.
  s += style === 3
    ? `<path d="M${n(L)} ${n(y)}Q${n(cx)} ${n(y + 1.2)} ${n(R)} ${n(y)}" ${line}/>`
    : `<path d="M${n(L)} ${n(y)}Q${n(cx)} ${n(y + 1.8)} ${n(R)} ${n(y)}" ${line}/>`;
  if (a.marks.includes('dimples') && detail !== 'sm') {
    for (const sx of [-1, 1]) s += `<path d="M${n(cx + sx * (wd + 1.2))} ${n(y - 0.8)}q${n(sx * 0.6)} 1 0 2" ${stroked(p.skinLine, 0.6)} opacity=".6"/>`;
  }
  return s;
}

/**
 * A chosen expression: calm, a smile, a grin or stern. `wd` is the mouth's half-width and `fu` the fullness of the lips, as
 * the automatic mouth uses them, so the same person keeps the same mouth whatever they do with it.
 */
function expression(g: Geo, p: Paint, a: Appearance, detail: Detail, wd0: number, fu: number): string {
  const { cx, mouthY: y } = g;
  const e = a.expression!;
  const sm = detail === 'sm';
  const wd = wd0 * (e === 'grin' ? 1.16 : e === 'smile' ? 1.06 : e === 'stern' ? 0.94 : 1);
  const L = cx - wd;
  const R = cx + wd;
  const line = stroked(shade(p.lips, 0.45), sm ? 1.2 : 0.95);
  if (e === 'grin') {
    // Open, with the teeth showing along the top, and the corners pulled up.
    const open = `M${n(L)} ${n(y - 0.9)}Q${n(cx)} ${n(y + 5 * Math.max(0.85, fu))} ${n(R)} ${n(y - 0.9)}Q${n(cx)} ${n(y + 0.8)} ${n(L)} ${n(y - 0.9)}Z`;
    const teeth = `M${n(cx - wd * 0.78)} ${n(y - 0.2)}Q${n(cx)} ${n(y + 1.2)} ${n(cx + wd * 0.78)} ${n(y - 0.2)}L${n(cx + wd * 0.62)} ${n(y + 1.1)}Q${n(cx)} ${n(y + 2.2)} ${n(cx - wd * 0.62)} ${n(y + 1.1)}Z`;
    return `<path d="${open}" fill="#7a2c26" stroke="${shade(p.lips, 0.5)}" stroke-width="${sm ? 0.9 : 0.7}"/><path d="${teeth}" fill="#fff"/>` +
      (sm ? '' : [-1, 1].map((sx) => `<path d="M${n(cx + sx * (wd + 1))} ${n(y - 2.2)}q${n(sx * 1.2)} 1.4 ${n(sx * 0.3)} 3" ${stroked(p.skinLine, 0.6)} opacity=".5"/>`).join(''));
  }
  // The line between the lips: how far its middle sinks below the corners (a smile), or rises above them (stern).
  const bow = e === 'smile' ? 2.9 : e === 'calm' ? 0.9 : -0.9;
  const cornerY = y + (e === 'smile' ? -0.7 : e === 'stern' ? 0.5 : 0);
  let s = '';
  if (!sm) {
    const upper = e === 'stern' ? 0.6 : 0.78;
    s += `<path d="M${n(L)} ${n(cornerY)}Q${n(cx - wd * 0.5)} ${n(y - 1.4 * fu)} ${n(cx - 0.6)} ${n(y - 0.9)}Q${n(cx)} ${n(y - 0.1)} ${n(cx + 0.6)} ${n(y - 0.9)}Q${n(cx + wd * 0.5)} ${n(y - 1.4 * fu)} ${n(R)} ${n(cornerY)}Q${n(cx)} ${n(cornerY + bow * 0.7)} ${n(L)} ${n(cornerY)}Z" fill="${p.lips}" opacity="${upper}"/>`;
    s += `<path d="M${n(L + 0.6)} ${n(cornerY + 0.2)}Q${n(cx)} ${n(cornerY + Math.max(bow, 0.2) + 1 + 1.1 * fu)} ${n(R - 0.6)} ${n(cornerY + 0.2)}Q${n(cx)} ${n(cornerY + bow * 0.8)} ${n(L + 0.6)} ${n(cornerY + 0.2)}Z" fill="${p.lips}" opacity=".85"/>`;
  } else if (a.lips) {
    s += `<ellipse cx="${n(cx)}" cy="${n(y + 0.7)}" rx="${n(wd * 0.82)}" ry="1.5" fill="${p.lips}"/>`;
  }
  s += `<path d="M${n(L)} ${n(cornerY)}Q${n(cx)} ${n(cornerY + bow)} ${n(R)} ${n(cornerY)}" ${line}/>`;
  // A smile makes creases at the corners; a stern mouth sets a line between the brows.
  if (e === 'smile' && !sm) for (const sx of [-1, 1]) s += `<path d="M${n(cx + sx * (wd + 0.9))} ${n(cornerY - 1.3)}q${n(sx * 0.9)} 1 ${n(sx * 0.2)} 2.2" ${stroked(p.skinLine, 0.6)} opacity=".5"/>`;
  if (e === 'stern' && detail === 'lg') s += `<path d="M${n(cx - 0.9)} ${n(g.browY - 0.8)}l0.3 2.6M${n(cx + 0.9)} ${n(g.browY - 0.8)}l-0.3 2.6" ${stroked(p.skinLine, 0.55)} opacity=".5"/>`;
  if (a.marks.includes('dimples') && !sm) for (const sx of [-1, 1]) s += `<path d="M${n(cx + sx * (wd + 1.6))} ${n(y - 0.8)}q${n(sx * 0.6)} 1 0 2" ${stroked(p.skinLine, 0.6)} opacity=".6"/>`;
  return s;
}

// The hair, the beard and the moustache are drawn in hair.ts and beard.ts, with the pen in ink.ts.

// ---------- Shapes the headwear is built from ----------

/** A dome over the head, expanded by `v`, from the left side at `y0` to the right: what hats and hoods are built on. */
function dome(g: Geo, v: number, y0: number, lift = 1.25): string {
  const { cx, cy, w, h } = g;
  return (
    `M${n(cx - w - v)} ${n(cy + y0 * h)}` +
    `C${n(cx - w - v)} ${n(cy - 0.62 * h - v)} ${n(cx - 0.56 * w - v * 0.7)} ${n(cy - h - v * lift)} ${n(cx)} ${n(cy - h - v * lift)}` +
    `C${n(cx + 0.56 * w + v * 0.7)} ${n(cy - h - v * lift)} ${n(cx + w + v)} ${n(cy - 0.62 * h - v)} ${n(cx + w + v)} ${n(cy + y0 * h)}`
  );
}

function curls(cxs: number[][], r: number, fill: string, line: string, sw: number): string {
  return cxs.map(([x, y, rr]) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(rr ?? r)}" fill="${fill}" stroke="${line}" stroke-width="${n(sw)}"/>`).join('');
}


/** Points along an ellipse arc (degrees, 0 = right, 90 = down). */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, count: number): number[][] {
  return Array.from({ length: count }, (_, i) => {
    const t = ((from + ((to - from) * i) / (count - 1)) * Math.PI) / 180;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  });
}

// ---------- Glasses ----------

function glasses(g: Geo, a: Appearance, detail: Detail): string {
  if (a.glasses === 'none') return '';
  const { cx, eyeY: y, dx, w } = g;
  const wire = a.frames ?? (a.era === 'c19' || a.era === 'c1900' ? '#a8802f' : '#3a2a22');
  const fw = detail === 'sm' ? 1.1 : 0.85;
  const F = stroked(wire, fw);
  const L = `fill="#fff" fill-opacity="${detail === 'sm' ? 0 : 0.14}" stroke="${wire}" stroke-width="${n(fw)}"`;
  // One glass, or two that pinch the nose: no sides to hook over the ears, and a cord to keep them from falling.
  if (a.glasses === 'monocle' || a.glasses === 'pince-nez') {
    const mono = a.glasses === 'monocle';
    const r = mono ? 4.5 : 3.5;
    const x = cx + dx;
    const cord = detail === 'sm' ? '' : `<path d="M${n(x + r * 0.9)} ${n(y + r * 0.5)}C${n(x + r + 5)} ${n(y + 9)} ${n(x + 3)} ${n(g.ny - 4)} ${n(x + 1.5)} ${n(g.ny + 8)}" ${stroked(mono ? wire : '#2a1f16', 0.5)}/>`;
    return (
      cord + `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" ${L}/>` +
      (mono ? '' : `<circle cx="${n(cx - dx)}" cy="${n(y)}" r="${r}" ${L}/><path d="M${n(cx - dx + r)} ${n(y - 0.8)}Q${n(cx)} ${n(y - 3.4)} ${n(cx + dx - r)} ${n(y - 0.8)}" ${F}/>`)
    );
  }
  const lens = (x: number) => {
    // The outer side of this lens: −1 on the left, +1 on the right.
    const o = x < cx ? -1 : 1;
    switch (a.glasses) {
      case 'cat-eye':
        return `<path d="M${n(x - o * 4.5)} ${n(y - 2.3)}L${n(x + o * 5.8)} ${n(y - 4.2)}Q${n(x + o * 5.2)} ${n(y + 2.2)} ${n(x + o * 1.6)} ${n(y + 3.2)}Q${n(x - o * 3.4)} ${n(y + 3.6)} ${n(x - o * 4.6)} ${n(y + 0.8)}Z" ${L}/>` +
          `<path d="M${n(x - o * 4.5)} ${n(y - 2.3)}L${n(x + o * 5.8)} ${n(y - 4.2)}" ${stroked(wire, 1.7)}/>`;
      case 'aviator':
        return `<path d="M${n(x - 4.8)} ${n(y - 3)}L${n(x + 4.8)} ${n(y - 3)}Q${n(x + 5.6)} ${n(y + 3.4)} ${n(x)} ${n(y + 4.4)}Q${n(x - 5.6)} ${n(y + 3.4)} ${n(x - 4.8)} ${n(y - 3)}Z" ${L}/>`;
      case 'rimless':
        return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="4.6" ry="3.4" fill="#fff" fill-opacity="${detail === 'sm' ? 0.1 : 0.16}" stroke="${wire}" stroke-width=".4" stroke-opacity=".6"/>`;
      case 'horn':
        return `<rect x="${n(x - 4.8)}" y="${n(y - 3.5)}" width="9.6" height="7.2" rx="2" ${L.replace(/stroke-width="[^"]+"/, `stroke-width="${detail === 'sm' ? 1.9 : 1.7}"`)}/>`;
      case 'sunglasses':
        return `<rect x="${n(x - 4.9)}" y="${n(y - 3.3)}" width="9.8" height="7" rx="2.4" fill="#1b181d" fill-opacity=".93" stroke="${wire}" stroke-width="${n(fw)}"/>` +
          (detail === 'lg' ? `<path d="M${n(x - 3)} ${n(y - 1.6)}l2.4 -1" ${stroked('#fff', 0.7)} opacity=".4"/>` : '');
      case 'round': return `<circle cx="${n(x)}" cy="${n(y)}" r="4" ${L}/>`;
      case 'oval': return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="4.5" ry="3.4" ${L}/>`;
      case 'square': return `<rect x="${n(x - 4.7)}" y="${n(y - 3.4)}" width="9.4" height="7" rx="1.6" ${L}/>`;
      case 'browline': return `<rect x="${n(x - 4.6)}" y="${n(y - 3.3)}" width="9.2" height="6.8" rx="2.2" ${L.replace(/stroke-width="[^"]+"/, 'stroke-width=".6"')}/><path d="M${n(x - 4.8)} ${n(y - 2.2)}Q${n(x)} ${n(y - 4.4)} ${n(x + 4.8)} ${n(y - 2.2)}" ${stroked('#2a1a14', 1.8)}/>`;
      default: return `<path d="M${n(x - 4.5)} ${n(y + 0.6)}Q${n(x)} ${n(y + 5)} ${n(x + 4.5)} ${n(y + 0.6)}Z" ${L}/>`;
    }
  };
  const r = a.glasses === 'round' ? 4 : 4.6;
  const by = a.glasses === 'half' ? y + 0.8 : a.glasses === 'aviator' ? y - 2.2 : y - 0.6;
  return (
    lens(cx - dx) + lens(cx + dx) +
    `<path d="M${n(cx - dx + r)} ${n(by)}Q${n(cx)} ${n(by - 1.6)} ${n(cx + dx - r)} ${n(by)}" ${F}/>` +
    `<path d="M${n(cx - dx - r)} ${n(by)}L${n(cx - w + 0.4)} ${n(by - 0.6)}M${n(cx + dx + r)} ${n(by)}L${n(cx + w - 0.4)} ${n(by - 0.6)}" ${F}/>`
  );
}

// ---------- Headwear ----------

/** What headwear leaves of the hair: all of it, the sides only (hats), a fringe, or none. */
const HAIR_UNDER: Record<string, 'all' | 'fringe' | 'none'> = {
  veil: 'fringe', coif: 'fringe', bonnet: 'fringe', headscarf: 'fringe', mobcap: 'fringe', wimple: 'none', hood: 'none',
  hijab: 'none', turban: 'none', headwrap: 'none',
};
/** Headwear that is worn in the hair and not over it: the hair keeps its style. */
const IN_THE_HAIR = new Set(['none', 'crown', 'circlet', 'tiara', 'headband', 'bow', 'flower-crown', 'bridal-veil', 'kippah']);
/** Styles that stand too tall for a hat, and what is worn under one instead. */
const UNDER_A_HAT: Record<string, HairStyle> = { bun: 'short', quiff: 'short', afro: 'curly', beehive: 'bob', 'space-buns': 'short', 'crown-braid': 'chignon' };

/** Where a hat sits, in head units from the middle of the head: hair shows below this line only. Most sit just above the temples. */
const HAT_LINE: Record<string, number> = { beret: -0.94, mortarboard: -0.9, kufi: -0.86 };

function headwear(g: Geo, p: Paint, a: Appearance, dress: Dress, detail: Detail): { back: string; front: string } {
  const { cx, cy, w, h, ny } = g;
  const sw = p.sw;
  const lg = detail === 'lg';
  const gold = filled(GOLD, sw * 0.9, '#8a6418');
  const linen = filled(LINEN, sw, '#a89b84');
  const cloth = filled(dress.cloth, sw);
  const none = { back: '', front: '' };
  const jewel = (x: number, y: number, c: string, r = 1.2) => `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="${c}" stroke="${shade(c)}" stroke-width=".5"/>`;
  // A cloth that frames the face and falls to the shoulders: the outer edge, then the face opening.
  const drape = (out: number, top: number, open: number, foreheadY: number, bottom: number) =>
    `M${n(cx - w - out)} ${n(bottom)}C${n(cx - w - out - 1)} ${n(cy)} ${n(cx - w - out + 1)} ${n(cy - h - top)} ${n(cx)} ${n(cy - h - top)}` +
    `C${n(cx + w + out - 1)} ${n(cy - h - top)} ${n(cx + w + out + 1)} ${n(cy)} ${n(cx + w + out)} ${n(bottom)}` +
    `L${n(cx + w * open)} ${n(bottom)}C${n(cx + w * open + 1)} ${n(cy + 0.3 * h)} ${n(cx + w * 0.95)} ${n(foreheadY)} ${n(cx)} ${n(foreheadY)}` +
    `C${n(cx - w * 0.95)} ${n(foreheadY)} ${n(cx - w * open - 1)} ${n(cy + 0.3 * h)} ${n(cx - w * open)} ${n(bottom)}Z`;

  switch (a.headwear) {
    case 'none':
      return none;
    case 'crown': {
      const by = cy - 0.66 * h;
      const L = cx - w - 1.6;
      const R = cx + w + 1.6;
      const pts = [L, cx - w * 0.5, cx, cx + w * 0.5, R];
      const tips = pts.map((x, i) => `<circle cx="${n(x)}" cy="${n(by - (i === 0 || i === 4 ? 4 : i === 2 ? 11 : 9.5))}" r="1.5" ${gold}/>`).join('');
      const body = `M${n(L)} ${n(by + 1)}L${n(L)} ${n(by - 4)}` +
        pts.slice(1).map((x, i) => {
          const prev = pts[i];
          const mid = (prev + x) / 2;
          return `L${n(mid)} ${n(by - 2)}L${n(x)} ${n(by - (i === 1 ? 11 : i === 3 ? 4 : 9.5))}`;
        }).join('') + `L${n(R)} ${n(by + 1)}Q${n(cx)} ${n(by + 3.5)} ${n(L)} ${n(by + 1)}Z`;
      return {
        back: '',
        front: `<path d="${body}" ${gold}/>` + tips +
          `<path d="M${n(L)} ${n(by - 1.2)}Q${n(cx)} ${n(by + 1.6)} ${n(R)} ${n(by - 1.2)}L${n(R)} ${n(by + 1)}Q${n(cx)} ${n(by + 3.5)} ${n(L)} ${n(by + 1)}Z" fill="${shade(GOLD, 0.2)}"/>` +
          jewel(cx, by + 0.3, '#b3283a', 1.5) + jewel(cx - w * 0.55, by - 0.4, '#2b5fa8') + jewel(cx + w * 0.55, by - 0.4, '#2b5fa8'),
      };
    }
    case 'circlet': {
      const by = cy - 0.52 * h;
      return {
        back: '',
        front: `<path d="M${n(cx - w - 0.6)} ${n(by - 0.6)}Q${n(cx)} ${n(by + 2.6)} ${n(cx + w + 0.6)} ${n(by - 0.6)}" ${stroked('#8a6418', 2.6)}/>` +
          `<path d="M${n(cx - w - 0.6)} ${n(by - 0.6)}Q${n(cx)} ${n(by + 2.6)} ${n(cx + w + 0.6)} ${n(by - 0.6)}" ${stroked(GOLD, 1.6)}/>` +
          `<path d="M${n(cx)} ${n(by - 2.4)}L${n(cx + 2)} ${n(by + 0.9)}L${n(cx)} ${n(by + 3.2)}L${n(cx - 2)} ${n(by + 0.9)}Z" ${gold}/>` + jewel(cx, by + 0.9, '#2f7a52', 1),
      };
    }
    case 'mitre': {
      const by = cy - 0.55 * h;
      const shape = `M${n(cx - w * 0.86)} ${n(by)}L${n(cx - w * 0.72)} ${n(cy - h - 6)}Q${n(cx - w * 0.3)} ${n(cy - h - 16)} ${n(cx)} ${n(cy - h - 21)}Q${n(cx + w * 0.3)} ${n(cy - h - 16)} ${n(cx + w * 0.72)} ${n(cy - h - 6)}L${n(cx + w * 0.86)} ${n(by)}Q${n(cx)} ${n(by + 2.5)} ${n(cx - w * 0.86)} ${n(by)}Z`;
      return {
        back: '',
        front: `<path d="${shape}" ${linen}/>` +
          `<path d="M${n(cx - 2)} ${n(by + 1.6)}L${n(cx - 2)} ${n(cy - h - 18)}L${n(cx)} ${n(cy - h - 20.5)}L${n(cx + 2)} ${n(cy - h - 18)}L${n(cx + 2)} ${n(by + 1.6)}Z" ${gold}/>` +
          `<path d="M${n(cx - w * 0.86)} ${n(by)}Q${n(cx)} ${n(by + 2.5)} ${n(cx + w * 0.86)} ${n(by)}L${n(cx + w * 0.82)} ${n(by - 3.4)}Q${n(cx)} ${n(by - 0.9)} ${n(cx - w * 0.82)} ${n(by - 3.4)}Z" ${gold}/>` +
          jewel(cx, cy - h - 8, '#b3283a', 1.4),
      };
    }
    case 'veil': {
      const c = mix(dress.trim, LINEN, 0.55);
      return {
        back: `<path d="M${n(cx - w - 6)} ${n(ny + 12)}C${n(cx - w - 7)} ${n(cy)} ${n(cx - w - 5)} ${n(cy - h - 4)} ${n(cx)} ${n(cy - h - 4)}C${n(cx + w + 5)} ${n(cy - h - 4)} ${n(cx + w + 7)} ${n(cy)} ${n(cx + w + 6)} ${n(ny + 12)}Z" ${filled(c, sw)}/>`,
        front: `<path d="${drape(4.5, 3.6, 0.98, cy - 0.58 * h, ny + 12)}" ${filled(c, sw)}/>` +
          (detail === 'sm' ? '' : `<path d="M${n(cx - w - 1.5)} ${n(cy + 0.2 * h)}q-1.6 ${n(h * 0.5)} -0.6 ${n(h * 0.9)}M${n(cx + w + 1.5)} ${n(cy + 0.2 * h)}q1.6 ${n(h * 0.5)} 0.6 ${n(h * 0.9)}" ${stroked(shade(c, 0.25), 0.8)}/>`),
      };
    }
    case 'wimple': {
      const veil = mix(dress.cloth, '#1d1a1f', 0.25);
      const chin = `M${n(cx - w + 0.6)} ${n(cy + 0.15 * h)}C${n(cx - w + 0.6)} ${n(cy + 1.1 * h)} ${n(cx + w - 0.6)} ${n(cy + 1.1 * h)} ${n(cx + w - 0.6)} ${n(cy + 0.15 * h)}L${n(cx + w + 3)} ${n(cy + 0.15 * h)}L${n(cx + w + 5)} ${n(ny + 9)}L${n(cx - w - 5)} ${n(ny + 9)}L${n(cx - w - 3)} ${n(cy + 0.15 * h)}Z`;
      return {
        back: `<path d="M${n(cx - w - 7)} ${n(ny + 14)}C${n(cx - w - 8)} ${n(cy)} ${n(cx - w - 5)} ${n(cy - h - 4)} ${n(cx)} ${n(cy - h - 4)}C${n(cx + w + 5)} ${n(cy - h - 4)} ${n(cx + w + 8)} ${n(cy)} ${n(cx + w + 7)} ${n(ny + 14)}Z" ${filled(veil, sw)}/>`,
        front: `<path d="${chin}" ${linen}/>` +
          `<path d="M${n(cx - w - 2.2)} ${n(cy + 0.2 * h)}C${n(cx - w - 2.4)} ${n(cy - h)} ${n(cx + w + 2.4)} ${n(cy - h)} ${n(cx + w + 2.2)} ${n(cy + 0.2 * h)}L${n(cx + w - 0.4)} ${n(cy + 0.2 * h)}C${n(cx + w - 0.6)} ${n(cy - 0.3 * h)} ${n(cx + w * 0.6)} ${n(cy - 0.5 * h)} ${n(cx)} ${n(cy - 0.5 * h)}C${n(cx - w * 0.6)} ${n(cy - 0.5 * h)} ${n(cx - w + 0.6)} ${n(cy - 0.3 * h)} ${n(cx - w + 0.4)} ${n(cy + 0.2 * h)}Z" ${linen}/>` +
          `<path d="${drape(5.2, 4, 1.08, cy - 0.66 * h, ny + 14)}" ${filled(veil, sw)}/>`,
      };
    }
    case 'hood': {
      const c = dress.cloth;
      return {
        back: '',
        front: `<path d="${drape(4.5, 5, 0.92, cy - 0.55 * h, ny + 9)}" ${cloth}/>` +
          `<path d="M${n(cx - w - 9)} ${n(ny + 16)}Q${n(cx - w - 8)} ${n(ny + 2)} ${n(cx - w * 0.9)} ${n(ny + 6)}L${n(cx + w * 0.9)} ${n(ny + 6)}Q${n(cx + w + 8)} ${n(ny + 2)} ${n(cx + w + 9)} ${n(ny + 16)}Q${n(cx)} ${n(ny + 21)} ${n(cx - w - 9)} ${n(ny + 16)}Z" ${filled(c, sw)}/>` +
          (lg ? `<path d="M${n(cx - w * 0.92)} ${n(cy + 0.3 * h)}C${n(cx - w * 0.9)} ${n(cy - 0.5 * h)} ${n(cx + w * 0.9)} ${n(cy - 0.5 * h)} ${n(cx + w * 0.92)} ${n(cy + 0.3 * h)}" ${stroked(shade(c, 0.35), 1.6)}/>` : ''),
      };
    }
    case 'coif': {
      const tie = `<path d="M${n(cx - w * 0.75)} ${n(cy + 0.5 * h)}Q${n(cx - w * 0.5)} ${n(cy + 1.15 * h)} ${n(cx)} ${n(cy + 1.1 * h)}Q${n(cx + w * 0.5)} ${n(cy + 1.15 * h)} ${n(cx + w * 0.75)} ${n(cy + 0.5 * h)}" ${stroked('#a89b84', 0.9)}/>`;
      // A Renaissance lady's coif becomes a French hood: a jewelled band and a dark veil behind.
      const french = a.era === 'renaissance' && a.pres === 'f';
      return {
        back: french ? `<path d="M${n(cx - w - 4)} ${n(ny + 8)}L${n(cx - w - 4)} ${n(cy + 0.1 * h)}C${n(cx - w - 5)} ${n(cy - h - 6)} ${n(cx + w + 5)} ${n(cy - h - 6)} ${n(cx + w + 4)} ${n(cy + 0.1 * h)}L${n(cx + w + 4)} ${n(ny + 8)}Z" ${filled('#2a2228', sw, '#120e12')}/>` : '',
        front: `<path d="${dome(g, 2.2, 0.48)}L${n(cx + w * 0.98)} ${n(cy + 0.48 * h)}C${n(cx + w * 0.86)} ${n(cy)} ${n(cx + w * 0.8)} ${n(cy - 0.55 * h)} ${n(cx)} ${n(cy - 0.58 * h)}C${n(cx - w * 0.8)} ${n(cy - 0.55 * h)} ${n(cx - w * 0.86)} ${n(cy)} ${n(cx - w * 0.98)} ${n(cy + 0.48 * h)}Z" ${linen}/>` +
          (french ? `<path d="M${n(cx - w - 2.4)} ${n(cy + 0.1 * h)}C${n(cx - w - 3)} ${n(cy - h - 3.5)} ${n(cx + w + 3)} ${n(cy - h - 3.5)} ${n(cx + w + 2.4)} ${n(cy + 0.1 * h)}" ${stroked(GOLD, 2)}/>` +
            (lg ? arc(cx, cy - 0.32 * h, w + 2.6, h * 0.72, 190, 350, 7).map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r=".8" fill="#f6f0e4"/>`).join('') : '') : tie),
      };
    }
    case 'beret': {
      const y = cy - h + 3;
      return {
        back: '',
        front: `<path d="M${n(cx - w - 4)} ${n(y + 2)}C${n(cx - w - 4)} ${n(y - 7)} ${n(cx + w + 6)} ${n(y - 8)} ${n(cx + w + 6)} ${n(y + 1)}Q${n(cx + 2)} ${n(y + 6)} ${n(cx - w - 4)} ${n(y + 2)}Z" ${filled(mix(dress.cloth, '#1a1418', 0.45), sw)}/>` +
          `<path d="M${n(cx - w - 1)} ${n(y + 3.4)}Q${n(cx + 2)} ${n(y + 6.6)} ${n(cx + w + 3)} ${n(y + 2.6)}" ${stroked(dress.trim, 1.5)}/>` +
          (lg ? `<path d="M${n(cx + w * 0.6)} ${n(y - 2)}C${n(cx + w + 6)} ${n(y - 10)} ${n(cx + w + 10)} ${n(y - 6)} ${n(cx + w + 9)} ${n(y - 1)}" ${stroked(LINEN, 1.6)}/>` : '') + jewel(cx + w * 0.55, y + 1, GOLD, 1),
      };
    }
    case 'mobcap': {
      const scallops = arc(cx, cy - 0.52 * h, w * 0.95, 2.2, 180, 360, 9).map(([x, y]) => [x, y, 1.9]);
      return {
        back: '',
        front: `<path d="${dome(g, 5, -0.25)}Q${n(cx)} ${n(cy - 0.62 * h)} ${n(cx - w - 5)} ${n(cy - 0.25 * h)}Z" ${linen}/>` +
          curls(scallops, 1.9, LINEN, '#a89b84', sw * 0.7) + `<path d="M${n(cx - w - 3)} ${n(cy - 0.62 * h)}Q${n(cx)} ${n(cy - 0.78 * h)} ${n(cx + w + 3)} ${n(cy - 0.62 * h)}" ${stroked(dress.trim, 1.6)}/>`,
      };
    }
    case 'tricorn': {
      const y = cy - 0.6 * h;
      const c = '#2a2228';
      return {
        back: '',
        front: `<path d="M${n(cx - w - 7.5)} ${n(y - 1)}Q${n(cx - w - 3)} ${n(cy - h - 8)} ${n(cx)} ${n(cy - h - 5)}Q${n(cx + w + 3)} ${n(cy - h - 8)} ${n(cx + w + 7.5)} ${n(y - 1)}Q${n(cx + w * 0.5)} ${n(y - 1)} ${n(cx)} ${n(y + 3.5)}Q${n(cx - w * 0.5)} ${n(y - 1)} ${n(cx - w - 7.5)} ${n(y - 1)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w - 7.5)} ${n(y - 1)}Q${n(cx - w * 0.5)} ${n(y - 1)} ${n(cx)} ${n(y + 3.5)}Q${n(cx + w * 0.5)} ${n(y - 1)} ${n(cx + w + 7.5)} ${n(y - 1)}" ${stroked(GOLD, 1.1)}/>`,
      };
    }
    case 'tophat': {
      const y = cy - 0.6 * h;
      const c = '#221d22';
      return {
        back: '',
        front: `<path d="M${n(cx - w * 0.78)} ${n(y)}L${n(cx - w * 0.84)} ${n(cy - h - 16)}Q${n(cx)} ${n(cy - h - 18)} ${n(cx + w * 0.84)} ${n(cy - h - 16)}L${n(cx + w * 0.78)} ${n(y)}Z" ${filled(c, sw, '#000')}/>` +
          `<path d="M${n(cx - w * 0.8)} ${n(y - 4)}L${n(cx + w * 0.8)} ${n(y - 4)}L${n(cx + w * 0.79)} ${n(y - 0.6)}L${n(cx - w * 0.79)} ${n(y - 0.6)}Z" fill="${shade(dress.trim, 0.3)}"/>` +
          `<path d="M${n(cx - w - 5)} ${n(y + 0.4)}Q${n(cx)} ${n(y - 3)} ${n(cx + w + 5)} ${n(y + 0.4)}Q${n(cx)} ${n(y + 3.6)} ${n(cx - w - 5)} ${n(y + 0.4)}Z" ${filled(c, sw, '#000')}/>`,
      };
    }
    case 'bonnet': {
      const c = a.stage === 'baby' ? LINEN : mix(dress.trim, LINEN, 0.4);
      return {
        back: '',
        front: `<path d="${drape(5.5, 5, 0.94, cy - 0.52 * h, cy + 0.55 * h)}" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w * 0.85)} ${n(cy + 0.55 * h)}Q${n(cx - w * 0.6)} ${n(cy + 1.12 * h)} ${n(cx)} ${n(cy + 1.1 * h)}Q${n(cx + w * 0.6)} ${n(cy + 1.12 * h)} ${n(cx + w * 0.85)} ${n(cy + 0.55 * h)}" ${stroked(shade(dress.trim, 0.1), 1.3)}/>` +
          `<path d="M${n(cx)} ${n(cy + 1.1 * h)}l-3.6 -1.8l0 3.6zM${n(cx)} ${n(cy + 1.1 * h)}l3.6 -1.8l0 3.6z" ${filled(dress.trim, sw * 0.7)}/>`,
      };
    }
    case 'flatcap': {
      const c = mix(dress.cloth, '#6b6157', 0.5);
      return {
        back: '',
        front: `<path d="M${n(cx - w - 2.4)} ${n(cy - 0.35 * h)}C${n(cx - w - 3)} ${n(cy - h - 6)} ${n(cx + w + 3)} ${n(cy - h - 6)} ${n(cx + w + 2.4)} ${n(cy - 0.4 * h)}Q${n(cx)} ${n(cy - 0.62 * h)} ${n(cx - w - 2.4)} ${n(cy - 0.35 * h)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w * 0.8)} ${n(cy - 0.5 * h)}Q${n(cx)} ${n(cy - 0.75 * h)} ${n(cx + w * 0.85)} ${n(cy - 0.52 * h)}Q${n(cx + w * 0.4)} ${n(cy - 0.3 * h)} ${n(cx - w * 0.8)} ${n(cy - 0.5 * h)}Z" ${filled(shade(c, 0.15), sw)}/>`,
      };
    }
    case 'fedora': {
      const y = cy - 0.58 * h;
      const c = mix(dress.cloth, '#4a4038', 0.55);
      return {
        back: '',
        front: `<path d="M${n(cx - w * 0.84)} ${n(y)}C${n(cx - w * 0.9)} ${n(cy - h - 11)} ${n(cx - 2)} ${n(cy - h - 9)} ${n(cx)} ${n(cy - h - 6)}C${n(cx + 2)} ${n(cy - h - 9)} ${n(cx + w * 0.9)} ${n(cy - h - 11)} ${n(cx + w * 0.84)} ${n(y)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w * 0.84)} ${n(y - 3.4)}Q${n(cx)} ${n(y - 4.6)} ${n(cx + w * 0.84)} ${n(y - 3.4)}L${n(cx + w * 0.84)} ${n(y - 0.4)}Q${n(cx)} ${n(y - 1.6)} ${n(cx - w * 0.84)} ${n(y - 0.4)}Z" fill="${shade(c, 0.5)}"/>` +
          `<path d="M${n(cx - w - 8)} ${n(y + 1.5)}Q${n(cx)} ${n(y - 4)} ${n(cx + w + 8)} ${n(y + 1.5)}Q${n(cx)} ${n(y + 2.8)} ${n(cx - w - 8)} ${n(y + 1.5)}Z" ${filled(c, sw)}/>`,
      };
    }
    case 'cloche': {
      const c = mix(dress.trim, '#7a6a72', 0.35);
      return {
        back: '',
        front: `<path d="${dome(g, 3.2, -0.2)}Q${n(cx + w + 6)} ${n(cy - 0.05 * h)} ${n(cx + w + 1)} ${n(cy - 0.08 * h)}Q${n(cx)} ${n(cy - 0.42 * h)} ${n(cx - w - 1)} ${n(cy - 0.08 * h)}Q${n(cx - w - 6)} ${n(cy - 0.05 * h)} ${n(cx - w - 3.2)} ${n(cy - 0.2 * h)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w - 2.6)} ${n(cy - 0.42 * h)}Q${n(cx)} ${n(cy - 0.7 * h)} ${n(cx + w + 2.6)} ${n(cy - 0.42 * h)}" ${stroked(shade(dress.cloth, 0.2), 2.2)}/>` +
          (lg ? `<circle cx="${n(cx + w * 0.7)}" cy="${n(cy - 0.52 * h)}" r="2.2" ${filled(dress.cloth, sw * 0.8)}/>` : ''),
      };
    }
    case 'headscarf': {
      const c = mix(dress.trim, '#c9774f', 0.3);
      return {
        back: '',
        front: `<path d="${drape(3.4, 3.6, 0.96, cy - 0.5 * h, cy + 0.7 * h)}" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w * 0.9)} ${n(cy + 0.7 * h)}Q${n(cx - 4)} ${n(cy + 1.12 * h)} ${n(cx)} ${n(cy + 1.12 * h)}Q${n(cx + 4)} ${n(cy + 1.12 * h)} ${n(cx + w * 0.9)} ${n(cy + 0.7 * h)}" ${stroked(shade(c, 0.4), 1.4)}/>` +
          `<path d="M${n(cx - 1.5)} ${n(cy + 1.1 * h)}l-3 5l4 -1zM${n(cx + 1.5)} ${n(cy + 1.1 * h)}l3 5l-4 -1z" ${filled(c, sw * 0.7)}/>` +
          (lg ? arc(cx, cy - 0.35 * h, w * 0.9, h * 0.6, 200, 340, 6).map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r=".9" fill="${LINEN}" opacity=".8"/>`).join('') : ''),
      };
    }
    case 'beanie': {
      const c = dress.trim;
      return {
        back: '',
        front: `<path d="${dome(g, 3, -0.4)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w - 3.2)} ${n(cy - 0.5 * h)}Q${n(cx)} ${n(cy - 0.72 * h)} ${n(cx + w + 3.2)} ${n(cy - 0.5 * h)}L${n(cx + w + 3)} ${n(cy - 0.22 * h)}Q${n(cx)} ${n(cy - 0.44 * h)} ${n(cx - w - 3)} ${n(cy - 0.22 * h)}Z" ${filled(shade(c, 0.12), sw)}/>` +
          `<circle cx="${n(cx)}" cy="${n(cy - h - 4.4)}" r="3.4" ${filled(tint(c, 0.4), sw)}/>`,
      };
    }
    default:
      return laterHeadwear(g, p, a, dress, detail, drape);
  }
}

/**
 * The headwear added with the editor's second version. `a.hat` is the colour the person chose; without one each piece
 * has the colour it most often has, or the house's.
 */
function laterHeadwear(g: Geo, p: Paint, a: Appearance, dress: Dress, detail: Detail, drape: (out: number, top: number, open: number, foreheadY: number, bottom: number) => string): { back: string; front: string } {
  const { cx, cy, w, h, ny } = g;
  const sw = p.sw;
  const lg = detail === 'lg';
  const fine = detail !== 'sm';
  const hat = (fallback: string) => a.hat ?? fallback;
  const none = { back: '', front: '' };
  const X = (s: number, u: number) => n(cx + s * u);
  const top = cy - h;
  // A round crown from temple to temple, closed along the forehead: the body of a cap.
  const crown = (v: number, y0: number, dip: number) => `${dome(g, v, y0)}Q${n(cx)} ${n(cy + (y0 - dip) * h)} ${n(cx - w - v)} ${n(cy + y0 * h)}Z`;
  // A brim seen from the front: a flat lens across the forehead.
  const brim = (out: number, y: number, up: number, down: number) => `M${n(cx - w - out)} ${n(y)}Q${n(cx)} ${n(y - up)} ${n(cx + w + out)} ${n(y)}Q${n(cx)} ${n(y + down)} ${n(cx - w - out)} ${n(y)}Z`;
  switch (a.headwear) {
    case 'hijab': {
      const c = hat(mix(dress.cloth, LINEN, 0.3));
      // The cloth under the chin and over the neck first, then the cloth that frames the face and falls to the shoulders.
      const wrap = `M${n(cx - w * 0.94)} ${n(cy + 0.4 * h)}C${n(cx - w * 0.82)} ${n(cy + 1.28 * h)} ${n(cx + w * 0.82)} ${n(cy + 1.28 * h)} ${n(cx + w * 0.94)} ${n(cy + 0.4 * h)}L${n(cx + w + 3)} ${n(ny + 11)}L${n(cx - w - 3)} ${n(ny + 11)}Z`;
      return {
        back: '',
        front: `<path d="${wrap}" ${filled(c, sw)}/>` + `<path d="${drape(3.8, 3.4, 0.9, cy - 0.6 * h, ny + 11)}" ${filled(c, sw)}/>` +
          (fine ? `<path d="M${n(cx - w * 0.86)} ${n(cy + 0.1 * h)}C${n(cx - w * 0.84)} ${n(cy - 0.46 * h)} ${n(cx + w * 0.84)} ${n(cy - 0.46 * h)} ${n(cx + w * 0.86)} ${n(cy + 0.1 * h)}" ${stroked(shade(c, 0.22), 1.4)}/>` +
            `<path d="M${n(cx - w - 1.6)} ${n(cy + 0.3 * h)}q-1.4 ${n(h * 0.5)} 0.6 ${n(h * 0.86)}M${n(cx + w * 0.3)} ${n(cy + 1.16 * h)}q3.4 3 2.4 9" ${stroked(shade(c, 0.25), 0.8)}/>` : ''),
      };
    }
    case 'kippah': {
      const c = hat('#27304a');
      return {
        back: '',
        front: `<path d="M${n(cx - w * 0.7)} ${n(top + 1.6)}Q${n(cx)} ${n(top - 10.6)} ${n(cx + w * 0.7)} ${n(top + 1.6)}Q${n(cx)} ${n(top + 4.4)} ${n(cx - w * 0.7)} ${n(top + 1.6)}Z" ${filled(c, sw)}/>` +
          (fine ? `<path d="M${n(cx - w * 0.62)} ${n(top + 1.2)}Q${n(cx)} ${n(top + 3.8)} ${n(cx + w * 0.62)} ${n(top + 1.2)}" ${stroked(dress.metal, 0.7)}/>` : ''),
      };
    }
    case 'kufi': {
      const c = hat('#ece4d0');
      return {
        back: '',
        front: `<path d="${crown(2.4, -0.46, 0.24)}" ${filled(c, sw)}/>` +
          (fine ? `<path d="M${n(cx - w - 1.4)} ${n(cy - 0.6 * h)}Q${n(cx)} ${n(cy - 0.86 * h)} ${n(cx + w + 1.4)} ${n(cy - 0.6 * h)}" ${stroked(shade(c, 0.3), 0.9, ' stroke-dasharray="1.6 1.4"')}/>` : ''),
      };
    }
    case 'turban': {
      const c = hat(mix(dress.cloth, '#2c3a5a', 0.3));
      // Wound high over the hair, meeting in a point above the brow.
      const shape = `M${n(cx - w - 2.6)} ${n(cy - 0.16 * h)}C${n(cx - w - 7)} ${n(top - 3)} ${n(cx - w * 0.4)} ${n(top - 12.5)} ${n(cx)} ${n(top - 11.5)}C${n(cx + w * 0.4)} ${n(top - 12.5)} ${n(cx + w + 7)} ${n(top - 3)} ${n(cx + w + 2.6)} ${n(cy - 0.16 * h)}` +
        `L${n(cx + w * 0.92)} ${n(cy - 0.26 * h)}Q${n(cx + w * 0.5)} ${n(cy - 0.6 * h)} ${n(cx)} ${n(cy - 0.78 * h)}Q${n(cx - w * 0.5)} ${n(cy - 0.6 * h)} ${n(cx - w * 0.92)} ${n(cy - 0.26 * h)}Z`;
      const folds = [0.34, 0.62, 0.9].map((t) => `M${n(cx - w - 3.6 + t * 2)} ${n(cy - (0.3 + t * 0.5) * h)}Q${n(cx - w * 0.4)} ${n(cy - (0.62 + t * 0.56) * h)} ${n(cx)} ${n(cy - (0.84 + t * 0.52) * h)}Q${n(cx + w * 0.4)} ${n(cy - (0.62 + t * 0.56) * h)} ${n(cx + w + 3.6 - t * 2)} ${n(cy - (0.3 + t * 0.5) * h)}`).join('');
      return { back: '', front: `<path d="${shape}" ${filled(c, sw)}/>` + (fine ? `<path d="${folds}" ${stroked(shade(c, 0.28), 0.8)}/>` : '') };
    }
    case 'headwrap': {
      const c = hat(mix(dress.trim, '#c9703a', 0.4));
      // Wrapped up and tied high, with the knot standing at the front.
      const shape = `M${n(cx - w - 2.2)} ${n(cy - 0.22 * h)}C${n(cx - w - 6)} ${n(top - 3)} ${n(cx - w * 0.5)} ${n(top - 11)} ${n(cx + 1)} ${n(top - 10)}C${n(cx + w * 0.7)} ${n(top - 11)} ${n(cx + w + 6.5)} ${n(top - 3)} ${n(cx + w + 2.2)} ${n(cy - 0.22 * h)}Q${n(cx)} ${n(cy - 0.74 * h)} ${n(cx - w - 2.2)} ${n(cy - 0.22 * h)}Z`;
      const knot = `M${n(cx)} ${n(top - 6)}C${n(cx - 11)} ${n(top - 17)} ${n(cx - 1)} ${n(top - 21)} ${n(cx + 2.6)} ${n(top - 10)}C${n(cx + 6)} ${n(top - 21)} ${n(cx + 17)} ${n(top - 15)} ${n(cx + 6)} ${n(top - 5)}Z`;
      return {
        back: '',
        front: `<path d="${knot}" ${filled(shade(c, 0.1), sw)}/><path d="${shape}" ${filled(c, sw)}/>` +
          (fine ? `<path d="M${n(cx - w - 2)} ${n(cy - 0.5 * h)}Q${n(cx - 2)} ${n(cy - 1.1 * h)} ${n(cx + w + 3)} ${n(cy - 0.62 * h)}M${n(cx - w * 0.9)} ${n(cy - 0.86 * h)}Q${n(cx)} ${n(cy - 1.3 * h)} ${n(cx + w + 1)} ${n(cy - 0.96 * h)}" ${stroked(tint(c, 0.45), 1.1)}/>` : ''),
      };
    }
    case 'peaked-cap': {
      const c = hat(a.cloth ?? '#39435c');
      const by = cy - 0.56 * h;
      return {
        back: '',
        front: `<path d="M${n(cx - w - 0.6)} ${n(by)}L${n(cx - w - 5)} ${n(top - 3.4)}Q${n(cx)} ${n(top - 10)} ${n(cx + w + 5)} ${n(top - 3.4)}L${n(cx + w + 0.6)} ${n(by)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w - 0.8)} ${n(by - 3.6)}Q${n(cx)} ${n(by - 7.6)} ${n(cx + w + 0.8)} ${n(by - 3.6)}L${n(cx + w + 0.6)} ${n(by)}Q${n(cx)} ${n(by - 4)} ${n(cx - w - 0.6)} ${n(by)}Z" fill="${shade(c, 0.3)}"/>` +
          `<path d="M${n(cx - w * 0.92)} ${n(by - 0.4)}Q${n(cx)} ${n(by - 4.6)} ${n(cx + w * 0.92)} ${n(by - 0.4)}Q${n(cx)} ${n(by + 3.4)} ${n(cx - w * 0.92)} ${n(by - 0.4)}Z" ${filled('#1c1a1f', sw, '#0c0b0d')}/>` +
          `<circle cx="${n(cx)}" cy="${n(by - 6.6)}" r="${fine ? 1.9 : 2.3}" ${filled(dress.metal, sw * 0.6)}/>`,
      };
    }
    case 'bowler': {
      const c = hat('#27232a');
      const y = cy - 0.6 * h;
      return {
        back: '',
        front: `<path d="M${n(cx - w * 0.88)} ${n(y)}C${n(cx - w * 1.02)} ${n(top - 13.5)} ${n(cx + w * 1.02)} ${n(top - 13.5)} ${n(cx + w * 0.88)} ${n(y)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w * 0.88)} ${n(y - 3.6)}Q${n(cx)} ${n(y - 5.2)} ${n(cx + w * 0.88)} ${n(y - 3.6)}L${n(cx + w * 0.88)} ${n(y - 0.6)}Q${n(cx)} ${n(y - 2.2)} ${n(cx - w * 0.88)} ${n(y - 0.6)}Z" fill="${shade(c, 0.45)}"/>` +
          `<path d="${brim(4.6, y + 0.6, 3.4, 3)}" ${filled(c, sw)}/>`,
      };
    }
    case 'boater': {
      const c = hat('#e4d199');
      const y = cy - 0.6 * h;
      return {
        back: '',
        front: `<path d="M${n(cx - w * 0.82)} ${n(y)}L${n(cx - w * 0.84)} ${n(top - 5.6)}Q${n(cx)} ${n(top - 7.4)} ${n(cx + w * 0.84)} ${n(top - 5.6)}L${n(cx + w * 0.82)} ${n(y)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w * 0.83)} ${n(y - 4.6)}Q${n(cx)} ${n(y - 6.2)} ${n(cx + w * 0.83)} ${n(y - 4.6)}L${n(cx + w * 0.82)} ${n(y - 0.8)}Q${n(cx)} ${n(y - 2.4)} ${n(cx - w * 0.82)} ${n(y - 0.8)}Z" fill="${shade(dress.trim, 0.25)}"/>` +
          `<path d="${brim(7.4, y + 0.8, 3, 2.6)}" ${filled(c, sw)}/>`,
      };
    }
    case 'sunhat': {
      const c = hat('#e8d6a4');
      const y = cy - 0.5 * h;
      return {
        back: `<path d="M${n(cx - w - 13)} ${n(y + 2)}Q${n(cx)} ${n(top - 9)} ${n(cx + w + 13)} ${n(y + 2)}Q${n(cx)} ${n(y + 8)} ${n(cx - w - 13)} ${n(y + 2)}Z" ${filled(shade(c, 0.12), sw)}/>`,
        front: `<path d="${crown(2.6, -0.44, 0.22)}" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w - 2)} ${n(cy - 0.56 * h)}Q${n(cx)} ${n(cy - 0.8 * h)} ${n(cx + w + 2)} ${n(cy - 0.56 * h)}" ${stroked(dress.trim, 2)}/>` +
          `<path d="${brim(13, y + 1.6, 6.5, 0.6)}" ${filled(c, sw)}/>`,
      };
    }
    case 'cap': {
      const c = hat(dress.cloth);
      return {
        back: '',
        front: `<path d="${crown(2.4, -0.44, 0.2)}" ${filled(c, sw)}/>` +
          (lg ? `<path d="M${n(cx)} ${n(top - 3.4)}L${n(cx)} ${n(cy - 0.66 * h)}" ${stroked(shade(c, 0.3), 0.7)}/>` : '') +
          `<path d="M${n(cx - w * 0.96)} ${n(cy - 0.52 * h)}Q${n(cx)} ${n(cy - 0.84 * h)} ${n(cx + w * 0.96)} ${n(cy - 0.52 * h)}Q${n(cx + w * 0.74)} ${n(cy - 0.3 * h)} ${n(cx)} ${n(cy - 0.27 * h)}Q${n(cx - w * 0.74)} ${n(cy - 0.3 * h)} ${n(cx - w * 0.96)} ${n(cy - 0.52 * h)}Z" ${filled(shade(c, 0.22), sw)}/>` +
          `<circle cx="${n(cx)}" cy="${n(top - 3.6)}" r="1.3" fill="${shade(c, 0.3)}"/>`,
      };
    }
    case 'tiara': {
      const by = cy - 0.6 * h;
      const metal = hat('#ece6d6');
      const band = `M${n(cx - w * 0.86)} ${n(by + 0.6)}Q${n(cx)} ${n(by - 3.2)} ${n(cx + w * 0.86)} ${n(by + 0.6)}`;
      const peaks = [-0.56, -0.28, 0, 0.28, 0.56].map((u) => `M${n(cx + u * w - 1.7)} ${n(by - 1.6 + Math.abs(u) * 2.6)}L${n(cx + u * w)} ${n(by - 7.4 + Math.abs(u) * 6)}L${n(cx + u * w + 1.7)} ${n(by - 1.6 + Math.abs(u) * 2.6)}Z`).join('');
      return {
        back: '',
        front: `<path d="${peaks}" ${filled(metal, sw * 0.7, '#8f8a7c')}/><path d="${band}" ${stroked('#8f8a7c', 2.4)}/><path d="${band}" ${stroked(metal, 1.5)}/>` +
          `<circle cx="${n(cx)}" cy="${n(by - 3.4)}" r="1.2" fill="#7fb2d9" stroke="#3f6a8a" stroke-width=".4"/>`,
      };
    }
    case 'bridal-veil': {
      const c = hat('#fffaf0');
      const sheer = `fill="${c}" fill-opacity=".5" stroke="#cfc6b2" stroke-width="${n(sw * 0.7)}"`;
      return {
        back: `<path d="M${n(cx - w - 11)} 104C${n(cx - w - 12)} ${n(cy)} ${n(cx - w - 5)} ${n(top - 5)} ${n(cx)} ${n(top - 5)}C${n(cx + w + 5)} ${n(top - 5)} ${n(cx + w + 12)} ${n(cy)} ${n(cx + w + 11)} 104Z" ${sheer}/>`,
        front: `<path d="M${n(cx - w - 2)} ${n(cy - 0.5 * h)}C${n(cx - w - 2.4)} ${n(top - 3.4)} ${n(cx + w + 2.4)} ${n(top - 3.4)} ${n(cx + w + 2)} ${n(cy - 0.5 * h)}" ${stroked('#cfc6b2', 2.6)}/>` +
          `<path d="M${n(cx - w - 2)} ${n(cy - 0.5 * h)}C${n(cx - w - 2.4)} ${n(top - 3.4)} ${n(cx + w + 2.4)} ${n(top - 3.4)} ${n(cx + w + 2)} ${n(cy - 0.5 * h)}" ${stroked('#fffaf0', 1.6)}/>` +
          (fine ? arc(cx, cy - 0.36 * h, w + 2.1, h * 0.72, 205, 335, 6).map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r=".9" fill="#f6f0e4" stroke="#b8ad98" stroke-width=".3"/>`).join('') : ''),
      };
    }
    case 'flower-crown': {
      const petals = ['#e58aa0', '#f6f0e4', '#e9c44a', '#8fb0e0'];
      const at = arc(cx, cy - 0.36 * h, w + 1.6, h * 0.74, 198, 342, detail === 'sm' ? 5 : 7);
      return {
        back: '',
        front: (fine ? `<path d="M${n(at[0][0])} ${n(at[0][1])}C${n(cx - w - 1)} ${n(top - 4.6)} ${n(cx + w + 1)} ${n(top - 4.6)} ${n(at[at.length - 1][0])} ${n(at[at.length - 1][1])}" ${stroked('#4f7a45', 2.2)}/>` : '') +
          at.map(([x, y], i) => `<circle cx="${n(x)}" cy="${n(y)}" r="${fine ? 2.5 : 3}" fill="${petals[i % 4]}" stroke="${shade(petals[i % 4], 0.35)}" stroke-width=".5"/>` + (lg ? `<circle cx="${n(x)}" cy="${n(y)}" r=".9" fill="${i % 4 === 2 ? '#b8762a' : '#e9c44a'}"/>` : '')).join(''),
      };
    }
    case 'mortarboard': {
      const c = hat('#27232a');
      return {
        back: '',
        front: `<path d="M${n(cx - w * 0.84)} ${n(cy - 0.58 * h)}Q${n(cx)} ${n(cy - 0.84 * h)} ${n(cx + w * 0.84)} ${n(cy - 0.58 * h)}L${n(cx + w * 0.76)} ${n(top - 2)}L${n(cx - w * 0.76)} ${n(top - 2)}Z" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w - 8)} ${n(top - 3.4)}L${n(cx)} ${n(top - 9.4)}L${n(cx + w + 8)} ${n(top - 3.4)}L${n(cx)} ${n(top + 2.2)}Z" ${filled(tint(c, 0.12), sw)}/>` +
          `<path d="M${n(cx)} ${n(top - 3.6)}L${n(cx + w + 4.6)} ${n(top - 2.2)}l0 ${fine ? 8 : 7}" ${stroked(dress.metal, fine ? 0.9 : 1.2)}/>` + (fine ? `<path d="M${n(cx + w + 4.6)} ${n(top + 5.4)}l-1 3.4l2 0z" fill="${dress.metal}"/>` : '') +
          `<circle cx="${n(cx)}" cy="${n(top - 3.6)}" r="1.2" fill="${dress.metal}"/>`,
      };
    }
    case 'hard-hat': {
      const c = hat('#e3b53a');
      return {
        back: '',
        front: `<path d="${crown(3.6, -0.42, 0.2)}" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - 2.2)} ${n(cy - 0.6 * h)}L${n(cx - 2)} ${n(top - 5)}Q${n(cx)} ${n(top - 6.6)} ${n(cx + 2)} ${n(top - 5)}L${n(cx + 2.2)} ${n(cy - 0.6 * h)}Z" fill="${tint(c, 0.35)}"/>` +
          `<path d="${brim(5.4, cy - 0.44 * h, 6.4, -3.6)}" ${filled(shade(c, 0.12), sw)}/>`,
      };
    }
    case 'ushanka': {
      const c = hat('#5b4636');
      const fur = tint(c, 0.3);
      const flap = (s: number) => `<path d="M${X(s, w - 1.4)} ${n(cy - 0.34 * h)}L${X(s, w + 5)} ${n(cy - 0.34 * h)}Q${X(s, w + 6)} ${n(cy + 0.44 * h)} ${X(s, w + 1.6)} ${n(cy + 0.64 * h)}Q${X(s, w - 1.8)} ${n(cy + 0.4 * h)} ${X(s, w - 1.4)} ${n(cy - 0.34 * h)}Z" ${filled(c, sw)}/>`;
      return {
        back: '',
        front: flap(-1) + flap(1) + `<path d="${crown(4.2, -0.3, 0.3)}" ${filled(c, sw)}/>` +
          `<path d="M${n(cx - w - 4.4)} ${n(cy - 0.3 * h)}Q${n(cx)} ${n(cy - 0.58 * h)} ${n(cx + w + 4.4)} ${n(cy - 0.3 * h)}L${n(cx + w + 4.6)} ${n(cy - 0.74 * h)}Q${n(cx)} ${n(cy - 1.02 * h)} ${n(cx - w - 4.6)} ${n(cy - 0.74 * h)}Z" ${filled(fur, sw)}/>`,
      };
    }
    case 'headband': {
      const c = hat(dress.trim);
      const d = `M${n(cx - w - 1.8)} ${n(cy - 0.2 * h)}C${n(cx - w - 2.4)} ${n(top - 4.6)} ${n(cx + w + 2.4)} ${n(top - 4.6)} ${n(cx + w + 1.8)} ${n(cy - 0.2 * h)}`;
      return { back: '', front: `<path d="${d}" ${stroked(shade(c, 0.5), 3.4)}/><path d="${d}" ${stroked(c, 2.2)}/>` };
    }
    case 'bow': {
      const c = hat('#b8343a');
      const x = cx + w * 0.5;
      const y = top - 1.4;
      return {
        back: '',
        front: `<path d="M${n(x)} ${n(y)}l-6.4 -3.8q-1.4 3.8 0 7.6zM${n(x)} ${n(y)}l6.4 -3.8q1.4 3.8 0 7.6z" ${filled(c, sw * 0.8)}/><circle cx="${n(x)}" cy="${n(y)}" r="1.7" ${filled(shade(c, 0.15), sw * 0.7)}/>`,
      };
    }
    default:
      return none;
  }
}

// ---------- Clothing ----------

function body(g: Geo, p: Paint, a: Appearance, style: ClothingStyle, dress: Dress, detail: Detail): string {
  const { cx, ny, nw, S } = g;
  const sw = p.sw;
  const lg = detail !== 'sm';
  const fine = detail === 'lg';
  const F = (fill: string, line?: string) => filled(fill, sw, line);
  // The torso from the left shoulder to the right, open at the neck by the given neckline.
  const torso = (neck: string, l = nw + 3.5) =>
    `M${n(cx - S)} 104L${n(cx - S)} ${n(ny + 20)}C${n(cx - S)} ${n(ny + 9)} ${n(cx - S * 0.62)} ${n(ny + 3.5)} ${n(cx - l)} ${n(ny + 1)}${neck}` +
    `C${n(cx + S * 0.62)} ${n(ny + 3.5)} ${n(cx + S)} ${n(ny + 9)} ${n(cx + S)} ${n(ny + 20)}L${n(cx + S)} 104Z`;
  const crew = (d = 5, l = nw + 3.5) => `Q${n(cx)} ${n(ny + d)} ${n(cx + l)} ${n(ny + 1)}`;
  const vee = (d: number, l = nw + 3.5) => `L${n(cx)} ${n(ny + d)}L${n(cx + l)} ${n(ny + 1)}`;
  const high = `L${n(cx - nw - 0.6)} ${n(ny - 6)}Q${n(cx)} ${n(ny - 4)} ${n(cx + nw + 0.6)} ${n(ny - 6)}L${n(cx + nw + 3.5)} ${n(ny + 1)}`;
  const buttons = (ys: number[], x = cx, c = dress.metal) => (lg ? ys.map((y) => `<circle cx="${n(x)}" cy="${n(y)}" r="${fine ? 0.95 : 1.2}" ${filled(c, sw * 0.6)}/>`).join('') : '');
  const pair = (svg: (s: number) => string) => svg(-1) + svg(1);
  const X = (s: number, u: number) => n(cx + s * u);
  const necklace = (y: number, pearls: boolean) => {
    if (!lg) return '';
    if (!pearls) return `<path d="M${n(cx - nw - 1)} ${n(ny)}Q${n(cx)} ${n(y + 2)} ${n(cx + nw + 1)} ${n(ny)}" ${stroked(dress.metal, 0.8)}/><circle cx="${n(cx)}" cy="${n(y + 1.6)}" r="1.4" ${filled(dress.metal, sw * 0.6)}/>`;
    return arc(cx, ny - 1, nw + 1.6, y - ny + 2, 10, 170, 11).map(([x, yy]) => `<circle cx="${n(x)}" cy="${n(yy)}" r=".95" fill="#f6f0e4" stroke="#b8ad98" stroke-width=".4"/>`).join('');
  };
  const collarPoints = (c = LINEN, spread = 1) => pair((s) => `<path d="M${X(s, nw - 0.5)} ${n(ny - 3)}L${X(s, 0.8)} ${n(ny + 4.5)}L${X(s, nw + 1.5 + spread)} ${n(ny + 6)}Z" ${F(c, '#9e937f')}/>`);
  const lapels = (c: string, deep: number, wide = 1) => pair((s) => `<path d="M${X(s, nw + 3.2)} ${n(ny + 1)}L${X(s, nw + 6 * wide)} ${n(ny + 9)}L${X(s, nw + 3 * wide)} ${n(ny + 11)}L${X(s, 1.4)} ${n(ny + deep)}L${X(s, nw - 1)} ${n(ny + 1)}Z" ${F(c)}/>`);
  const tie = (c: string, slim = false) => {
    const tw = slim ? 1.3 : 2;
    return `<path d="M${n(cx - 1.5)} ${n(ny + 3.2)}L${n(cx + 1.5)} ${n(ny + 3.2)}L${n(cx + 1.1)} ${n(ny + 5.6)}L${n(cx + tw)} ${n(ny + 20)}L${n(cx)} ${n(ny + 22.5)}L${n(cx - tw)} ${n(ny + 20)}L${n(cx - 1.1)} ${n(ny + 5.6)}Z" ${F(c)}/>`;
  };
  const suitCloth = mix(dress.cloth, '#1f1c22', 0.5);
  const shirtFront = (d: number) => `<path d="M${n(cx - nw)} ${n(ny - 2)}L${n(cx + nw)} ${n(ny - 2)}L${n(cx + 4)} ${n(ny + d)}L${n(cx - 4)} ${n(ny + d)}Z" ${F(LINEN, '#9e937f')}/>`;
  const casual = mix(dress.cloth, LINEN, 0.12);

  switch (style) {
    case 'tunic': {
      const cloak = mix(dress.cloth, DARK, 0.2);
      return `<path d="${torso(crew(5))}" ${F(dress.trim)}/>` +
        (lg ? `<path d="M${n(cx - nw - 3.2)} ${n(ny + 1.6)}Q${n(cx)} ${n(ny + 6.6)} ${n(cx + nw + 3.2)} ${n(ny + 1.6)}" ${stroked(dress.metal, 1.6)}/>` : '') +
        pair((s) => `<path d="M${X(s, S + 1)} 104L${X(s, S + 1)} ${n(ny + 19)}C${X(s, S + 1)} ${n(ny + 8)} ${X(s, S * 0.6)} ${n(ny + 2.5)} ${X(s, nw + 4)} ${n(ny + 0.6)}C${X(s, nw + 3)} ${n(ny + 8)} ${X(s, nw + (s > 0 ? 3 : 7))} ${n(ny + 16)} ${X(s, nw + (s > 0 ? 6 : 11))} 104Z" ${F(cloak)}/>`) +
        `<circle cx="${n(cx + nw + 5)}" cy="${n(ny + 9)}" r="${lg ? 3.2 : 3.6}" ${F(dress.metal)}/>` + (lg ? `<circle cx="${n(cx + nw + 5)}" cy="${n(ny + 9)}" r="1.3" fill="${dress.trim}"/>` : '');
    }
    case 'cotehardie': {
      const cape = dress.trim;
      const scallop = Array.from({ length: 8 }, (_, i) => {
        const x0 = cx + S * 0.8 - (i * S * 1.6) / 8;
        const x1 = x0 - (S * 1.6) / 8;
        return `Q${n((x0 + x1) / 2)} ${n(ny + 16)} ${n(x1)} ${n(ny + 11.5)}`;
      }).join('');
      return `<path d="${torso(crew(4))}" ${F(dress.cloth)}/>` + buttons([ny + 16, ny + 20, ny + 24]) +
        `<path d="M${n(cx - S * 0.8)} ${n(ny + 11.5)}C${n(cx - S * 0.7)} ${n(ny + 2)} ${n(cx - nw - 2)} ${n(ny - 1)} ${n(cx - nw - 1)} ${n(ny - 3)}Q${n(cx)} ${n(ny - 1)} ${n(cx + nw + 1)} ${n(ny - 3)}C${n(cx + nw + 2)} ${n(ny - 1)} ${n(cx + S * 0.7)} ${n(ny + 2)} ${n(cx + S * 0.8)} ${n(ny + 11.5)}${scallop}Z" ${F(cape)}/>`;
    }
    case 'gown':
      return `<path d="${torso(crew(11, nw + 8), nw + 8)}" ${F(dress.cloth)}/>` +
        `<path d="M${n(cx - nw - 8)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 11)} ${n(cx + nw + 8)} ${n(ny + 1)}" ${stroked(dress.trim, lg ? 2.2 : 2.6)}/>` +
        (fine ? `<path d="M${n(cx - nw - 8)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 11)} ${n(cx + nw + 8)} ${n(ny + 1)}" ${stroked(dress.metal, 0.6, ' stroke-dasharray="1 1.6"')}/>` : '') +
        necklace(ny + 6, false);
    case 'doublet': {
      const ruff = arc(cx, ny - 4.6, nw + 1.4, 1.6, 180, 360, 8).map(([x, y]) => [x, y, 1.7]);
      return `<path d="${torso(high)}" ${F(dress.cloth)}/>` +
        pair((s) => `<path d="M${X(s, S * 0.62)} ${n(ny + 3.6)}C${X(s, S + 1.5)} ${n(ny + 5)} ${X(s, S + 1.5)} ${n(ny + 16)} ${X(s, S + 0.2)} ${n(ny + 19)}C${X(s, S * 0.86)} ${n(ny + 16)} ${X(s, S * 0.7)} ${n(ny + 9)} ${X(s, S * 0.62)} ${n(ny + 3.6)}Z" ${F(dress.trim)}/>`) +
        `<path d="M${n(cx)} ${n(ny - 3)}L${n(cx)} 104" ${stroked(shade(dress.cloth, 0.45), sw)}/>` + buttons([ny + 4, ny + 9, ny + 14, ny + 19]) +
        (lg ? curls(ruff, 1.7, LINEN, '#a89b84', sw * 0.6) : `<path d="M${n(cx - nw - 2)} ${n(ny - 5)}Q${n(cx)} ${n(ny - 2)} ${n(cx + nw + 2)} ${n(ny - 5)}" ${stroked(LINEN, 2)}/>`);
    }
    case 'bodice': {
      const sq = `L${n(cx - nw - 7)} ${n(ny + 11)}L${n(cx + nw + 7)} ${n(ny + 11)}L${n(cx + nw + 8)} ${n(ny + 1)}`;
      return `<path d="M${n(cx - nw - 8)} ${n(ny + 1)}L${n(cx - nw - 7)} ${n(ny + 11)}L${n(cx + nw + 7)} ${n(ny + 11)}L${n(cx + nw + 8)} ${n(ny + 1)}Z" fill="${LINEN}" opacity=".55"/>` +
        `<path d="${torso(sq, nw + 8)}" ${F(dress.cloth)}/>` +
        `<path d="M${n(cx - nw - 8)} ${n(ny + 1)}L${n(cx - nw - 7)} ${n(ny + 11)}L${n(cx + nw + 7)} ${n(ny + 11)}L${n(cx + nw + 8)} ${n(ny + 1)}" ${stroked(dress.metal, lg ? 1.8 : 2.2)}/>` +
        (fine ? [-1, 1].map((s) => [3, 7.5].map((u) => `<circle cx="${X(s, u)}" cy="${n(ny + 11)}" r=".9" fill="#f6f0e4"/>`).join('')).join('') : '') + necklace(ny + 7, true);
    }
    case 'ruff': {
      const pleats = arc(cx, ny - 1.4, nw + 9.5, 5.4, 0, 360, 22).map(([x, y]) => [x, y, 2.3]);
      return `<path d="${torso(crew(4))}" ${F(mix(dress.cloth, '#1a1418', 0.45))}/>` + buttons([ny + 10, ny + 15, ny + 20, ny + 25]) +
        `<ellipse cx="${n(cx)}" cy="${n(ny - 1.4)}" rx="${n(nw + 10)}" ry="6" ${F(LINEN, '#a89b84')}/>` +
        (lg ? curls(pleats, 2.3, LINEN, '#a89b84', sw * 0.55) + `<ellipse cx="${n(cx)}" cy="${n(ny - 1.6)}" rx="${n(nw + 7.5)}" ry="3.8" fill="${LINEN}"/>` + `<ellipse cx="${n(cx)}" cy="${n(ny - 2.6)}" rx="${n(nw + 0.4)}" ry="2.2" fill="${mix(LINEN, '#a89b84', 0.4)}"/>` : '');
    }
    case 'lace-collar': {
      if (a.pres === 'f') {
        const lace = arc(cx, ny + 2, nw + 13, 9, 15, 165, 13).map(([x, y]) => [x, y, 1.5]);
        return `<path d="${torso(crew(11, nw + 12), nw + 12)}" ${F(dress.cloth)}/>` +
          (lg ? curls(lace, 1.5, LINEN, '#a89b84', sw * 0.5) : '') +
          `<path d="M${n(cx - nw - 12)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 11)} ${n(cx + nw + 12)} ${n(ny + 1)}" ${stroked(LINEN, 2)}/>` + necklace(ny + 5, true);
      }
      const lace = (s: number) => arc(cx + s * (nw + 7), ny + 3, 10, 6.5, s > 0 ? -10 : 190, s > 0 ? 100 : 80, 7).map(([x, y]) => [x, y, 1.3]);
      return `<path d="${torso(crew(4))}" ${F(mix(dress.cloth, '#1a1418', 0.35))}/>` + buttons([ny + 15, ny + 20, ny + 25]) +
        pair((s) => `<path d="M${X(s, 0.2)} ${n(ny - 3.5)}L${X(s, nw + 1)} ${n(ny - 4.4)}C${X(s, nw + 9)} ${n(ny)} ${X(s, nw + 15)} ${n(ny + 3)} ${X(s, nw + 16)} ${n(ny + 7)}C${X(s, nw + 10)} ${n(ny + 11)} ${X(s, 4)} ${n(ny + 12)} ${X(s, 0.2)} ${n(ny + 10)}Z" ${F(LINEN, '#a89b84')}/>`) +
        (fine ? curls([...lace(-1), ...lace(1)], 1.3, LINEN, '#a89b84', 0.4) : '');
    }
    case 'coat': {
      const waist = dress.trim;
      return `<path d="${torso(vee(20))}" ${F(dress.cloth)}/>` +
        `<path d="M${n(cx - nw)} ${n(ny + 2)}L${n(cx + nw)} ${n(ny + 2)}L${n(cx + 5)} 104L${n(cx - 5)} 104Z" ${F(waist)}/>` + buttons([ny + 15, ny + 20, ny + 25], cx + 1.6) +
        lapels(shade(dress.cloth, 0.12), 21, 1.2) +
        `<path d="M${n(cx - nw + 1)} ${n(ny - 5)}Q${n(cx)} ${n(ny - 3)} ${n(cx + nw - 1)} ${n(ny - 5)}L${n(cx + nw - 0.5)} ${n(ny + 0.5)}Q${n(cx)} ${n(ny + 2)} ${n(cx - nw + 0.5)} ${n(ny + 0.5)}Z" ${F(LINEN, '#a89b84')}/>` +
        [0, 1, 2].map((i) => `<path d="M${n(cx - 3.4 + i * 0.4)} ${n(ny + 1 + i * 3.6)}Q${n(cx)} ${n(ny + 5.2 + i * 3.6)} ${n(cx + 3.4 - i * 0.4)} ${n(ny + 1 + i * 3.6)}L${n(cx)} ${n(ny + 3 + i * 3.6)}Z" ${F(LINEN, '#a89b84')}/>`).join('');
    }
    case 'stays': {
      const neck = `L${n(cx - nw - 9)} ${n(ny + 6)}Q${n(cx)} ${n(ny + 16)} ${n(cx + nw + 9)} ${n(ny + 6)}L${n(cx + nw + 9)} ${n(ny + 1)}`;
      return `<path d="${torso(neck, nw + 9)}" ${F(dress.cloth)}/>` +
        pair((s) => `<path d="M${X(s, nw + 0.5)} ${n(ny - 0.5)}C${X(s, nw + 8)} ${n(ny + 2)} ${X(s, nw + 9)} ${n(ny + 6)} ${X(s, nw + 8)} ${n(ny + 8)}C${X(s, 6)} ${n(ny + 11)} ${X(s, 1)} ${n(ny + 14)} ${X(s, -2)} ${n(ny + 17)}L${X(s, -0.5)} ${n(ny + 13)}C${X(s, 2)} ${n(ny + 9)} ${X(s, nw - 1)} ${n(ny + 4)} ${X(s, nw + 0.5)} ${n(ny - 0.5)}Z" ${F(LINEN, '#a89b84')}/>`) +
        `<path d="M${n(cx - nw + 0.4)} ${n(ny - 3.4)}Q${n(cx)} ${n(ny - 1.6)} ${n(cx + nw - 0.4)} ${n(ny - 3.4)}" ${stroked(dress.trim, 1.5)}/>`;
    }
    case 'frock': {
      const coat = mix(dress.cloth, '#1c1a20', 0.6);
      return `<path d="${torso(vee(18))}" ${F(coat)}/>` +
        `<path d="M${n(cx - nw + 1)} ${n(ny)}L${n(cx + nw - 1)} ${n(ny)}L${n(cx + 4)} 104L${n(cx - 4)} 104Z" ${F(mix(dress.trim, '#3a3238', 0.45))}/>` + buttons([ny + 16, ny + 21], cx, '#d8c9a6') +
        shirtFront(9) + lapels(shade(coat, 0.15), 18) +
        pair((s) => `<path d="M${X(s, nw - 0.4)} ${n(ny - 6)}L${X(s, nw - 0.2)} ${n(ny - 0.4)}L${X(s, 2)} ${n(ny + 1)}Z" ${F(LINEN, '#9e937f')}/>`) +
        `<path d="M${n(cx)} ${n(ny + 2)}l-4.2 -2.4l0 4.8zM${n(cx)} ${n(ny + 2)}l4.2 -2.4l0 4.8z" ${F(shade(dress.trim, 0.55))}/>` + `<circle cx="${n(cx)}" cy="${n(ny + 2)}" r="1.1" fill="${shade(dress.trim, 0.6)}"/>`;
    }
    case 'victorian': {
      const lace = arc(cx, ny - 5.6, nw + 1.2, 1.4, 180, 360, 7).map(([x, y]) => [x, y, 1.3]);
      const dressC = mix(dress.cloth, '#2a2028', 0.35);
      return `<path d="${torso(high)}" ${F(dressC)}/>` +
        (fine ? pair((s) => `<path d="M${X(s, S * 0.6)} ${n(ny + 4)}Q${X(s, S * 0.75)} ${n(ny + 12)} ${X(s, S * 0.68)} ${n(ny + 22)}" ${stroked(shade(dressC, 0.3), 0.8)}/>`) : '') +
        (lg ? curls(lace, 1.3, LINEN, '#a89b84', sw * 0.5) : `<path d="M${n(cx - nw)} ${n(ny - 5)}Q${n(cx)} ${n(ny - 3)} ${n(cx + nw)} ${n(ny - 5)}" ${stroked(LINEN, 1.8)}/>`) +
        `<ellipse cx="${n(cx)}" cy="${n(ny + 1.5)}" rx="2.6" ry="3.2" ${F(dress.metal)}/>` + (lg ? `<ellipse cx="${n(cx)}" cy="${n(ny + 1.5)}" rx="1.5" ry="2" fill="#f2e6d4"/>` : '');
    }
    case 'suit':
      return `<path d="${torso(vee(17))}" ${F(suitCloth)}/>` +
        `<path d="M${n(cx - nw + 0.5)} ${n(ny + 1)}L${n(cx + nw - 0.5)} ${n(ny + 1)}L${n(cx + 4.6)} 104L${n(cx - 4.6)} 104Z" ${F(shade(suitCloth, -0.1))}/>` +
        shirtFront(10) + tie(dress.trim) + collarPoints() + lapels(shade(suitCloth, 0.15), 17) + buttons([ny + 15.5, ny + 19.5], cx + 3.2, shade(suitCloth, 0.4));
    case 'suit-slim':
      return `<path d="${torso(vee(20))}" ${F(mix(dress.cloth, '#2a2a30', 0.42))}/>` +
        shirtFront(20) + tie(shade(dress.trim, 0.25), true) + collarPoints(LINEN, 0) + lapels(shade(mix(dress.cloth, '#2a2a30', 0.42), 0.15), 20, 0.75) +
        (fine ? `<path d="M${n(cx + S * 0.4)} ${n(ny + 13.4)}l1 -1.6l1 1l1 -1.2l0.6 1.8Z" fill="${LINEN}"/>` : '');
    case 'blouse': {
      const c = mix(dress.trim, LINEN, 0.55);
      return `<path d="${torso(crew(4))}" ${F(c)}/>` +
        pair((s) => `<path d="M${X(s, 0.3)} ${n(ny + 3)}C${X(s, 2)} ${n(ny + 8)} ${X(s, nw + 5)} ${n(ny + 7.5)} ${X(s, nw + 4.2)} ${n(ny + 0.8)}Q${X(s, nw)} ${n(ny + 3.4)} ${X(s, 0.3)} ${n(ny + 3)}Z" ${F(LINEN, '#a89b84')}/>`) +
        `<circle cx="${n(cx)}" cy="${n(ny + 4)}" r="1.3" ${F(dress.metal)}/>` + buttons([ny + 11, ny + 16, ny + 21], cx, LINEN);
    }
    case 'pearls':
      return `<path d="${torso(crew(7, nw + 7), nw + 7)}" ${F(dress.cloth)}/>` + necklace(ny + 4, true);
    case 'shirt': {
      const c = casual;
      return `<path d="${torso(vee(12, nw + 1.5), nw + 1.5)}" ${F(c)}/>` +
        pair((s) => `<path d="M${X(s, nw + 0.2)} ${n(ny - 3.4)}L${X(s, nw + 9.5)} ${n(ny + 6)}L${X(s, nw + 1)} ${n(ny + 5)}L${X(s, 0.4)} ${n(ny + 12)}Z" ${F(shade(c, -0.05))}/>`) + buttons([ny + 17, ny + 23], cx, tint(c, 0.4));
    }
    case 'turtleneck': {
      const c = mix(dress.cloth, '#2b2a2e', 0.25);
      return `<path d="${torso(high)}" ${F(c)}/>` +
        `<path d="M${n(cx - nw - 1)} ${n(ny - 7.5)}Q${n(cx)} ${n(ny - 5.5)} ${n(cx + nw + 1)} ${n(ny - 7.5)}L${n(cx + nw + 1.6)} ${n(ny)}Q${n(cx)} ${n(ny + 2.4)} ${n(cx - nw - 1.6)} ${n(ny)}Z" ${F(shade(c, 0.08))}/>` +
        (fine ? [-4, -1.4, 1.4, 4].map((u) => `<path d="M${n(cx + u)} ${n(ny - 6)}l0 6.6" ${stroked(shade(c, 0.3), 0.5)}/>`).join('') : '');
    }
    case 'sweater': {
      const c = casual;
      const older = a.stage === 'elder' || a.stage === 'middle' || a.era === 'c1900';
      return `<path d="${torso(crew(5))}" ${F(c)}/>` + (older ? collarPoints(LINEN, 0.4) : '') +
        `<path d="M${n(cx - nw - 3.5)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 6)} ${n(cx + nw + 3.5)} ${n(ny + 1)}" ${stroked(shade(c, 0.2), 2.2)}/>`;
    }
    case 'tshirt': {
      const c = mix(dress.trim, LINEN, 0.15);
      return `<path d="${torso(crew(4.5))}" ${F(c)}/>` + `<path d="M${n(cx - nw - 3.5)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 5.5)} ${n(cx + nw + 3.5)} ${n(ny + 1)}" ${stroked(shade(c, 0.2), 1.2)}/>`;
    }
    case 'hoodie': {
      const c = mix(dress.cloth, '#5b6470', 0.3);
      return `<path d="${torso(crew(5))}" ${F(c)}/>` +
        `<path d="M${n(cx - nw - 9)} ${n(ny + 5)}C${n(cx - nw - 8)} ${n(ny - 4)} ${n(cx - nw - 2)} ${n(ny - 2)} ${n(cx - nw)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 8)} ${n(cx + nw)} ${n(ny + 1)}C${n(cx + nw + 2)} ${n(ny - 2)} ${n(cx + nw + 8)} ${n(ny - 4)} ${n(cx + nw + 9)} ${n(ny + 5)}Q${n(cx)} ${n(ny + 14)} ${n(cx - nw - 9)} ${n(ny + 5)}Z" ${F(shade(c, 0.1))}/>` +
        (lg ? `<path d="M${n(cx - 2.4)} ${n(ny + 8)}l0 9M${n(cx + 2.4)} ${n(ny + 8)}l0 9" ${stroked(LINEN, 0.9)}/>` : '');
    }
    case 'cardigan': {
      const c = mix(dress.cloth, '#7a6a5a', 0.3);
      const top = a.pres === 'm' ? LINEN : mix(dress.trim, LINEN, 0.5);
      return `<path d="${torso(crew(4))}" ${F(top)}/>` +
        pair((s) => `<path d="M${X(s, S)} 104L${X(s, S)} ${n(ny + 20)}C${X(s, S)} ${n(ny + 9)} ${X(s, S * 0.62)} ${n(ny + 3.5)} ${X(s, nw + 3.5)} ${n(ny + 1)}L${X(s, 1.4)} ${n(ny + 20)}L${X(s, 1.4)} 104Z" ${F(c)}/>`) +
        buttons([ny + 22, ny + 27], cx - 2.4, tint(c, 0.3)) + (a.pres === 'm' ? collarPoints(LINEN, 0) : '');
    }
    case 'smock': {
      const c = mix(LINEN, dress.trim, 0.12);
      return `<path d="${torso(crew(5))}" ${F(c, '#a89b84')}/>` +
        (lg ? [-3, -1, 1, 3].map((u) => `<path d="M${n(cx + u * 1.5)} ${n(ny + 4.5)}l0 5" ${stroked('#b8ab92', 0.6)}/>`).join('') : '') +
        `<path d="M${n(cx - nw - 3.5)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 6)} ${n(cx + nw + 3.5)} ${n(ny + 1)}" ${stroked(dress.trim, 1.2)}/>`;
    }
    case 'sailor': {
      const navy = '#2c3a5a';
      return `<path d="${torso(vee(13))}" ${F(navy)}/>` +
        `<path d="M${n(cx - nw - 3.5)} ${n(ny + 1)}L${n(cx - S * 0.86)} ${n(ny + 6)}L${n(cx - S * 0.8)} ${n(ny + 14)}L${n(cx)} ${n(ny + 16)}L${n(cx + S * 0.8)} ${n(ny + 14)}L${n(cx + S * 0.86)} ${n(ny + 6)}L${n(cx + nw + 3.5)} ${n(ny + 1)}L${n(cx)} ${n(ny + 13)}Z" ${F(LINEN, '#9e937f')}/>` +
        (lg ? `<path d="M${n(cx - S * 0.76)} ${n(ny + 12)}L${n(cx)} ${n(ny + 14)}L${n(cx + S * 0.76)} ${n(ny + 12)}" ${stroked(navy, 0.8)}/>` : '') +
        `<path d="M${n(cx)} ${n(ny + 13)}l-3 -2.5l-1 4.5zM${n(cx)} ${n(ny + 13)}l3 -2.5l1 4.5zM${n(cx - 1)} ${n(ny + 14)}l-2 7l2.4 -1zM${n(cx + 1)} ${n(ny + 14)}l2 7l-2.4 -1z" ${F('#b8343a')}/>`;
    }
    case 'pinafore': {
      return `<path d="${torso(crew(5))}" ${F(dress.cloth)}/>` +
        `<path d="M${n(cx - 6)} ${n(ny + 8)}L${n(cx + 6)} ${n(ny + 8)}L${n(cx + 7)} 104L${n(cx - 7)} 104Z" ${F(LINEN, '#a89b84')}/>` +
        pair((s) => `<path d="M${X(s, 5)} ${n(ny + 8)}L${X(s, nw + 5)} ${n(ny + 1.5)}C${X(s, nw + 10)} ${n(ny + 1)} ${X(s, nw + 12)} ${n(ny + 5)} ${X(s, nw + 11)} ${n(ny + 8)}L${X(s, 7)} ${n(ny + 10)}Z" ${F(LINEN, '#a89b84')}/>`);
    }
    case 'knit': {
      const c = mix(dress.trim, '#8a3a32', 0.25);
      return `<path d="${torso(crew(5))}" ${F(c)}/>` + collarPoints(LINEN, 0) +
        (lg ? arc(cx, ny + 2, S * 0.75, 12, 25, 155, 9).map(([x, y]) => `<path d="M${n(x)} ${n(y - 1.2)}l1.2 1.2l-1.2 1.2l-1.2 -1.2z" fill="${LINEN}" opacity=".85"/>`).join('') : '');
    }
    case 'stripes': {
      const c = LINEN;
      const st = mix(dress.cloth, '#2c3a5a', 0.3);
      return `<clipPath id="tc"><path d="${torso(crew(4.5))}"/></clipPath><path d="${torso(crew(4.5))}" ${F(c, '#a89b84')}/>` +
        `<g clip-path="url(#tc)">${[6, 12, 18, 24].map((d) => `<rect x="0" y="${n(ny + d)}" width="100" height="3" fill="${st}"/>`).join('')}</g>` +
        `<path d="${torso(crew(4.5))}" fill="none" stroke="#a89b84" stroke-width="${n(sw)}"/>`;
    }
    case 'onesie': {
      const c = mix(dress.trim, LINEN, 0.6);
      return `<path d="${torso(crew(4))}" ${F(c)}/>` +
        pair((s) => `<path d="M${X(s, 0.3)} ${n(ny + 3)}C${X(s, 1.5)} ${n(ny + 7)} ${X(s, nw + 4)} ${n(ny + 6.5)} ${X(s, nw + 3.4)} ${n(ny + 0.8)}Q${X(s, nw)} ${n(ny + 3.4)} ${X(s, 0.3)} ${n(ny + 3)}Z" ${F(LINEN, '#a89b84')}/>`) +
        buttons([ny + 10, ny + 15], cx, LINEN);
    }

    // ----- The clothes added with the editor's second version. `a.cloth` is a colour the person chose; where a piece
    // has a colour of its own (a white coat, a wedding dress, denim) that colour is used until one is chosen. -----
    case 'dress': {
      const c = dress.cloth;
      return `<path d="${torso(crew(10, nw + 6.5), nw + 6.5)}" ${F(c)}/>` +
        `<path d="M${n(cx - nw - 6.5)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 10)} ${n(cx + nw + 6.5)} ${n(ny + 1)}" ${stroked(dress.trim, lg ? 1.5 : 2)}/>` +
        (fine ? pair((s) => `<path d="M${X(s, S * 0.56)} ${n(ny + 6)}Q${X(s, S * 0.7)} ${n(ny + 13)} ${X(s, S * 0.62)} ${n(ny + 23)}" ${stroked(shade(c, 0.28), 0.8)}/>`) : '');
    }
    case 'polo': {
      const c = casual;
      return `<path d="${torso(vee(9, nw + 1.5), nw + 1.5)}" ${F(c)}/>` +
        pair((s) => `<path d="M${X(s, nw + 0.2)} ${n(ny - 3)}L${X(s, nw + 7.4)} ${n(ny + 4.6)}L${X(s, nw + 1.2)} ${n(ny + 5.4)}L${X(s, 0.4)} ${n(ny + 9)}Z" ${F(shade(c, 0.1))}/>`) +
        (lg ? `<path d="M${n(cx)} ${n(ny + 9)}l0 7" ${stroked(shade(c, 0.35), 0.8)}/>` : '') + buttons([ny + 11.5, ny + 15], cx, tint(c, 0.45));
    }
    case 'plaid': {
      // A checked shirt: bands across and down, in the trim's colour, clipped to the cloth.
      const c = casual;
      const check = mix(dress.trim, DARK, 0.15);
      const bands = lg
        ? `<clipPath id="tc"><path d="${torso(vee(12, nw + 1.5), nw + 1.5)}"/></clipPath><g clip-path="url(#tc)" fill="${check}" opacity=".5">` +
          [5, 12, 19, 26].map((d) => `<rect x="0" y="${n(ny + d)}" width="100" height="2.2"/>`).join('') +
          [-30, -20, -10, 10, 20, 30].map((u) => `<rect x="${n(cx + u - 1.1)}" y="${n(ny)}" width="2.2" height="30"/>`).join('') + `</g>`
        : '';
      return `<path d="${torso(vee(12, nw + 1.5), nw + 1.5)}" ${F(lg ? c : mix(c, check, 0.3))}/>` + bands +
        pair((s) => `<path d="M${X(s, nw + 0.2)} ${n(ny - 3.4)}L${X(s, nw + 9)} ${n(ny + 5.6)}L${X(s, nw + 1)} ${n(ny + 5)}L${X(s, 0.4)} ${n(ny + 12)}Z" ${F(shade(c, 0.12))}/>`) + buttons([ny + 17, ny + 23], cx, tint(c, 0.4));
    }
    case 'jacket': {
      // Worn open over a plain top: denim, leather or cloth, as its colour says.
      const c = dress.cloth;
      const under = mix(dress.trim, LINEN, 0.55);
      return `<path d="${torso(crew(4.5))}" ${F(under)}/>` +
        pair((s) => `<path d="M${X(s, S)} 104L${X(s, S)} ${n(ny + 20)}C${X(s, S)} ${n(ny + 9)} ${X(s, S * 0.62)} ${n(ny + 3.5)} ${X(s, nw + 3.5)} ${n(ny + 1)}L${X(s, 3.6)} ${n(ny + 21)}L${X(s, 3.6)} 104Z" ${F(c)}/>`) +
        pair((s) => `<path d="M${X(s, nw + 3.2)} ${n(ny + 0.6)}L${X(s, nw + 9)} ${n(ny + 7)}L${X(s, 5.6)} ${n(ny + 15)}L${X(s, 3.9)} ${n(ny + 19.6)}L${X(s, nw + 0.4)} ${n(ny + 3)}Z" ${F(shade(c, 0.16))}/>`) +
        (fine ? pair((s) => `<path d="M${X(s, 6)} ${n(ny + 22)}l0 8" ${stroked(tint(c, 0.35), 0.6, ' stroke-dasharray="1.2 1"')}/>`) : '');
    }
    case 'waistcoat': {
      // Shirtsleeves, a tie and a buttoned waistcoat, with a watch chain across it.
      const vest = mix(dress.cloth, '#1f1c22', 0.4);
      return `<path d="${torso(vee(13))}" ${F(LINEN, '#9e937f')}/>` + tie(dress.trim) +
        `<path d="M${n(cx - nw - 2.4)} ${n(ny + 2)}L${n(cx)} ${n(ny + 14)}L${n(cx + nw + 2.4)} ${n(ny + 2)}L${n(cx + S * 0.56)} ${n(ny + 6.6)}L${n(cx + S * 0.52)} 104L${n(cx - S * 0.52)} 104L${n(cx - S * 0.56)} ${n(ny + 6.6)}Z" ${F(vest)}/>` +
        collarPoints(LINEN, 0.6) + buttons([ny + 17.5, ny + 22, ny + 26.5], cx, shade(vest, 0.4)) +
        (fine ? `<path d="M${n(cx + 0.8)} ${n(ny + 22)}Q${n(cx + 7)} ${n(ny + 27)} ${n(cx + 12)} ${n(ny + 22.6)}" ${stroked(dress.metal, 0.8)}/>` : '');
    }
    case 'tuxedo': {
      const c = a.cloth ?? '#211e25';
      const bow = shade(c, 0.3);
      return `<path d="${torso(vee(20))}" ${F(c)}/>` + shirtFront(20) + buttons([ny + 8.5, ny + 13, ny + 17.5], cx, '#2a2730') +
        collarPoints(LINEN, 0) + lapels(tint(c, 0.16), 20, 0.9) +
        `<path d="M${n(cx)} ${n(ny + 3)}l-4.6 -2.6l0 5.2zM${n(cx)} ${n(ny + 3)}l4.6 -2.6l0 5.2z" ${F(bow)}/><circle cx="${n(cx)}" cy="${n(ny + 3)}" r="1.2" fill="${bow}"/>`;
    }
    case 'wedding-dress': {
      const c = a.cloth ?? '#f8f3e7';
      const neck = `L${n(cx - nw - 8)} ${n(ny + 7)}Q${n(cx - nw * 0.6)} ${n(ny + 13.5)} ${n(cx)} ${n(ny + 9.6)}Q${n(cx + nw * 0.6)} ${n(ny + 13.5)} ${n(cx + nw + 8)} ${n(ny + 7)}L${n(cx + nw + 9)} ${n(ny + 1)}`;
      const lace = [...arc(cx - nw * 0.62, ny + 8.4, nw * 0.82, 4.6, 20, 160, 5), ...arc(cx + nw * 0.62, ny + 8.4, nw * 0.82, 4.6, 20, 160, 5)].map(([x, y]) => [x, y, 1.3]);
      return `<path d="${torso(neck, nw + 9)}" ${F(c, '#b9af98')}/>` +
        (lg ? curls(lace, 1.3, '#fffaf0', '#b9af98', sw * 0.45) : `<path d="M${n(cx - nw - 8)} ${n(ny + 7)}Q${n(cx - nw * 0.6)} ${n(ny + 13.5)} ${n(cx)} ${n(ny + 9.6)}Q${n(cx + nw * 0.6)} ${n(ny + 13.5)} ${n(cx + nw + 8)} ${n(ny + 7)}" ${stroked('#fffaf0', 1.6)}/>`) +
        (fine ? pair((s) => `<path d="M${X(s, S * 0.5)} ${n(ny + 9)}Q${X(s, S * 0.6)} ${n(ny + 16)} ${X(s, S * 0.52)} ${n(ny + 25)}" ${stroked('#cfc6b2', 0.7)}/>`) : '');
    }
    case 'apron': {
      const bib = a.trim ?? LINEN;
      return `<path d="${torso(crew(5))}" ${F(casual)}/>` +
        `<path d="M${n(cx - 7.4)} ${n(ny + 9.6)}L${n(cx - nw - 3)} ${n(ny + 1.4)}M${n(cx + 7.4)} ${n(ny + 9.6)}L${n(cx + nw + 3)} ${n(ny + 1.4)}" ${stroked(shade(bib, 0.3), 2.6)}/>` +
        `<path d="M${n(cx - 8.4)} ${n(ny + 9)}L${n(cx + 8.4)} ${n(ny + 9)}L${n(cx + 12)} 104L${n(cx - 12)} 104Z" ${F(bib, shade(bib, 0.35))}/>` +
        (fine ? `<path d="M${n(cx - 5)} ${n(ny + 17)}l10 0l-0.6 6l-8.8 0z" ${stroked(shade(bib, 0.3), 0.7)}/>` : '');
    }
    case 'overalls': {
      const c = a.cloth ?? '#4f6d96';
      const tee = mix(dress.trim, LINEN, 0.5);
      return `<path d="${torso(crew(4.5))}" ${F(tee)}/>` +
        pair((s) => `<path d="M${X(s, 6.6)} ${n(ny + 11.6)}L${X(s, nw + 6.6)} ${n(ny + 2.2)}L${X(s, nw + 10.4)} ${n(ny + 3.6)}L${X(s, 9.8)} ${n(ny + 13)}Z" ${F(c)}/>`) +
        `<path d="M${n(cx - 10)} ${n(ny + 11)}L${n(cx + 10)} ${n(ny + 11)}L${n(cx + 11.5)} 104L${n(cx - 11.5)} 104Z" ${F(c)}/>` +
        pair((s) => `<circle cx="${X(s, 8)}" cy="${n(ny + 13)}" r="${lg ? 1.2 : 1.5}" ${filled(dress.metal, sw * 0.6)}/>`) +
        (fine ? `<path d="M${n(cx - 4.6)} ${n(ny + 16.5)}l9.2 0l-0.8 5.6l-7.6 0z" ${stroked(shade(c, 0.35), 0.7)}/>` : '');
    }
    case 'white-coat': {
      const c = a.cloth ?? '#f3f0e8';
      return `<path d="${torso(vee(18))}" ${F(c, '#a59e8c')}/>` +
        `<path d="M${n(cx - nw)} ${n(ny - 1)}L${n(cx + nw)} ${n(ny - 1)}L${n(cx + 4.4)} ${n(ny + 17)}L${n(cx - 4.4)} ${n(ny + 17)}Z" ${F(mix(dress.cloth, LINEN, 0.35))}/>` +
        lapels(shade(c, 0.07), 18) +
        (fine ? `<path d="M${n(cx + S * 0.3)} ${n(ny + 14)}l7.6 0.6l-0.4 6.4l-7 -0.4z" ${stroked('#a59e8c', 0.7)}/><path d="M${n(cx + S * 0.36)} ${n(ny + 14.2)}l0 -3M${n(cx + S * 0.42)} ${n(ny + 14.6)}l0 -2.6" ${stroked(dress.trim, 0.9)}/>` : '');
    }
    case 'uniform': {
      // A service tunic: a stand collar with tabs, shoulder boards, and buttons down the front.
      const c = a.cloth ?? '#5f6b58';
      return `<path d="${torso(high)}" ${F(c)}/>` +
        pair((s) => `<path d="M${X(s, S * 0.46)} ${n(ny + 3.2)}L${X(s, S * 0.9)} ${n(ny + 8)}L${X(s, S * 0.86)} ${n(ny + 11.6)}L${X(s, S * 0.42)} ${n(ny + 6.6)}Z" ${F(shade(c, 0.22))}/>` + (lg ? `<circle cx="${X(s, S * 0.5)}" cy="${n(ny + 5.6)}" r=".9" fill="${dress.metal}"/>` : '')) +
        `<path d="M${n(cx - nw - 0.8)} ${n(ny - 6.4)}Q${n(cx)} ${n(ny - 4.4)} ${n(cx + nw + 0.8)} ${n(ny - 6.4)}L${n(cx + nw + 2)} ${n(ny - 0.6)}Q${n(cx)} ${n(ny + 1.8)} ${n(cx - nw - 2)} ${n(ny - 0.6)}Z" ${F(shade(c, 0.14))}/>` +
        pair((s) => `<path d="M${X(s, 1.2)} ${n(ny - 4.6)}L${X(s, 5.4)} ${n(ny - 5.2)}L${X(s, 5.8)} ${n(ny + 0.2)}L${X(s, 1.4)} ${n(ny + 0.9)}Z" fill="${dress.trim}"/>`) +
        `<path d="M${n(cx)} ${n(ny + 1.6)}L${n(cx)} 104" ${stroked(shade(c, 0.4), sw)}/>` + buttons([ny + 6, ny + 12, ny + 18, ny + 24]) +
        (fine ? pair((s) => `<path d="M${X(s, 8)} ${n(ny + 13)}l${n(s * 9)} 0.8l${n(s * -0.4)} 2.6l${n(s * -8.4)} -0.6z" ${stroked(shade(c, 0.4), 0.7)}/>`) : '');
    }
    case 'clerical': {
      const c = a.cloth ?? '#26242c';
      return `<path d="${torso(high)}" ${F(c)}/>` +
        `<path d="M${n(cx - nw - 0.8)} ${n(ny - 6.6)}Q${n(cx)} ${n(ny - 4.6)} ${n(cx + nw + 0.8)} ${n(ny - 6.6)}L${n(cx + nw + 1.8)} ${n(ny - 1)}Q${n(cx)} ${n(ny + 1.4)} ${n(cx - nw - 1.8)} ${n(ny - 1)}Z" ${F(shade(c, 0.12))}/>` +
        `<path d="M${n(cx - 2.6)} ${n(ny - 4.9)}L${n(cx + 2.6)} ${n(ny - 4.9)}L${n(cx + 2.7)} ${n(ny + 0.6)}L${n(cx - 2.7)} ${n(ny + 0.6)}Z" fill="#fbf8f0" stroke="#9e937f" stroke-width=".5"/>`;
    }
    case 'dirndl': {
      // A white blouse, a laced bodice in the house's colour, and the apron's band below it.
      const c = dress.cloth;
      return `<path d="${torso(crew(11, nw + 8.5), nw + 8.5)}" ${F(LINEN, '#a89b84')}/>` +
        `<path d="M${n(cx - nw - 9.5)} ${n(ny + 3)}L${n(cx - nw - 5.6)} ${n(ny + 2)}Q${n(cx - 6)} ${n(ny + 17)} ${n(cx)} ${n(ny + 14.4)}Q${n(cx + 6)} ${n(ny + 17)} ${n(cx + nw + 5.6)} ${n(ny + 2)}L${n(cx + nw + 9.5)} ${n(ny + 3)}L${n(cx + S * 0.6)} ${n(ny + 9)}L${n(cx + S * 0.56)} 104L${n(cx - S * 0.56)} 104L${n(cx - S * 0.6)} ${n(ny + 9)}Z" ${F(c)}/>` +
        (fine ? `<path d="M${n(cx - 2.6)} ${n(ny + 17)}l5.2 3l-5.2 3l5.2 3M${n(cx + 2.6)} ${n(ny + 17)}l-5.2 3l5.2 3l-5.2 3" ${stroked(dress.metal, 0.6)}/>` : `<path d="M${n(cx)} ${n(ny + 16)}L${n(cx)} 104" ${stroked(dress.metal, 1.2)}/>`) +
        `<path d="M${n(cx - nw - 5.6)} ${n(ny + 2)}Q${n(cx - 6)} ${n(ny + 17)} ${n(cx)} ${n(ny + 14.4)}Q${n(cx + 6)} ${n(ny + 17)} ${n(cx + nw + 5.6)} ${n(ny + 2)}" ${stroked(dress.trim, fine ? 1.3 : 1.8)}/>`;
    }
    case 'folk-vest': {
      // A white shirt under an open vest with a bright border and a silver clasp: bunad, Tracht, and their cousins.
      const c = dress.cloth;
      return `<path d="${torso(crew(4))}" ${F(LINEN, '#a89b84')}/>` + collarPoints(LINEN, 0.3) +
        pair((s) => `<path d="M${X(s, S)} 104L${X(s, S * 0.78)} ${n(ny + 9)}C${X(s, S * 0.7)} ${n(ny + 5.4)} ${X(s, nw + 8)} ${n(ny + 2.4)} ${X(s, nw + 4.4)} ${n(ny + 1.6)}Q${X(s, 2.6)} ${n(ny + 12)} ${X(s, 4.4)} 104Z" ${F(c)}/>` +
          `<path d="M${X(s, nw + 4.4)} ${n(ny + 1.6)}Q${X(s, 2.6)} ${n(ny + 12)} ${X(s, 4.4)} 104" ${stroked(dress.trim, fine ? 1.6 : 2)}/>`) +
        (fine ? `<path d="M${n(cx - 4)} ${n(ny + 16)}L${n(cx + 4)} ${n(ny + 16)}M${n(cx - 4.4)} ${n(ny + 22)}L${n(cx + 4.4)} ${n(ny + 22)}" ${stroked(dress.metal, 0.7)}/>` + pair((s) => `<circle cx="${X(s, 4)}" cy="${n(ny + 16)}" r="1.1" ${filled(dress.metal, sw * 0.5)}/><circle cx="${X(s, 4.4)}" cy="${n(ny + 22)}" r="1.1" ${filled(dress.metal, sw * 0.5)}/>`) : '');
    }
    case 'kimono': {
      // Wrapped left over right, with the under-collar showing white at the neck.
      const c = dress.cloth;
      const band = dress.trim;
      return `<path d="${torso(vee(15, nw + 3), nw + 3)}" ${F(c)}/>` +
        `<path d="M${n(cx - nw - 0.4)} ${n(ny - 1.6)}L${n(cx + 1)} ${n(ny + 12)}L${n(cx + nw + 0.4)} ${n(ny - 1.6)}L${n(cx + nw - 1.4)} ${n(ny - 2.2)}L${n(cx + 1)} ${n(ny + 8.6)}L${n(cx - nw + 1.4)} ${n(ny - 2.2)}Z" ${F('#fbf8f0', '#9e937f')}/>` +
        `<path d="M${n(cx + nw + 3.6)} ${n(ny + 0.8)}L${n(cx - 2.6)} ${n(ny + 19)}L${n(cx - 6.4)} ${n(ny + 19)}L${n(cx + nw + 0.4)} ${n(ny - 1.6)}Z" ${F(band)}/>` +
        `<path d="M${n(cx - nw - 3.6)} ${n(ny + 0.8)}L${n(cx + 6)} ${n(ny + 26)}L${n(cx + 10)} ${n(ny + 26)}L${n(cx - nw - 0.4)} ${n(ny - 1.6)}Z" ${F(band)}/>`;
    }
    case 'sari': {
      // A fitted blouse, and the sari's end drawn up across the body and over one shoulder, its border catching the light.
      const c = dress.cloth;
      const pallu = `M${n(cx - S)} 104L${n(cx - S)} ${n(ny + 20)}C${n(cx - S)} ${n(ny + 9)} ${n(cx - S * 0.62)} ${n(ny + 3.5)} ${n(cx - nw - 5.4)} ${n(ny + 1.2)}L${n(cx - nw + 1.6)} ${n(ny + 3)}L${n(cx + S * 0.74)} 104Z`;
      return `<path d="${torso(crew(8.5, nw + 6), nw + 6)}" ${F(mix(dress.trim, DARK, 0.1))}/>` + `<path d="${pallu}" ${F(c)}/>` +
        `<path d="M${n(cx - nw + 1.6)} ${n(ny + 3)}L${n(cx + S * 0.74)} 104" ${stroked(dress.metal, fine ? 2 : 2.6)}/>` +
        (lg ? `<path d="M${n(cx - nw + 3.6)} ${n(ny + 2.4)}L${n(cx + S * 0.74 + 2.6)} 103" ${stroked(shade(c, 0.3), 0.6, ' stroke-dasharray="1 1.5"')}/>` : '');
    }
    case 'kurta': {
      // A long shirt with a band collar and a buttoned opening down the chest.
      const c = mix(dress.cloth, LINEN, 0.3);
      return `<path d="${torso(high)}" ${F(c)}/>` +
        `<path d="M${n(cx - nw - 0.6)} ${n(ny - 6)}Q${n(cx)} ${n(ny - 4)} ${n(cx + nw + 0.6)} ${n(ny - 6)}L${n(cx + nw + 1.4)} ${n(ny - 2.4)}Q${n(cx)} ${n(ny - 0.2)} ${n(cx - nw - 1.4)} ${n(ny - 2.4)}Z" ${F(dress.trim)}/>` +
        `<path d="M${n(cx - 2)} ${n(ny - 1)}L${n(cx - 2)} ${n(ny + 17)}Q${n(cx)} ${n(ny + 18.6)} ${n(cx + 2)} ${n(ny + 17)}L${n(cx + 2)} ${n(ny - 1)}" ${F(shade(c, 0.07))}/>` + buttons([ny + 3, ny + 8, ny + 13], cx, dress.metal);
    }
    case 'kaftan': {
      // A wide robe with an embroidered yoke at the neck.
      const c = dress.cloth;
      const yoke = `M${n(cx - nw - 5)} ${n(ny + 1)}Q${n(cx)} ${n(ny + 8)} ${n(cx + nw + 5)} ${n(ny + 1)}L${n(cx + nw + 7.4)} ${n(ny + 6)}Q${n(cx + 6)} ${n(ny + 23)} ${n(cx)} ${n(ny + 25)}Q${n(cx - 6)} ${n(ny + 23)} ${n(cx - nw - 7.4)} ${n(ny + 6)}Z`;
      return `<path d="${torso(crew(7, nw + 5), nw + 5)}" ${F(c)}/>` + `<path d="${yoke}" ${F(dress.trim)}/>` +
        (fine ? `<path d="M${n(cx - nw - 4)} ${n(ny + 5.6)}Q${n(cx - 5)} ${n(ny + 20)} ${n(cx)} ${n(ny + 21.6)}Q${n(cx + 5)} ${n(ny + 20)} ${n(cx + nw + 4)} ${n(ny + 5.6)}" ${stroked(dress.metal, 0.8, ' stroke-dasharray="1.4 1.2"')}/><path d="M${n(cx)} ${n(ny + 7.6)}l0 9" ${stroked(shade(dress.trim, 0.4), 0.8)}/>` : '');
    }
  }
}

// ---------- What is worn with the clothes, and what is behind them ----------

/** A necklace, a scarf, and what is pinned to the chest. Drawn over the clothes and under the hair that falls on them. */
function onTheChest(g: Geo, p: Paint, a: Appearance, dress: Dress, detail: Detail): string {
  const { cx, ny, nw, S } = g;
  const fine = detail !== 'sm';
  const lg = detail === 'lg';
  let s = '';
  if (a.necklace !== 'none') {
    const drop = a.necklace === 'pearls' || a.necklace === 'beads' ? 6.4 : 8.6;
    const d = `M${n(cx - nw - 0.6)} ${n(ny - 0.4)}Q${n(cx)} ${n(ny + drop * 1.9)} ${n(cx + nw + 0.6)} ${n(ny - 0.4)}`;
    const low = ny + drop * 0.74;
    if (a.necklace === 'pearls' || a.necklace === 'beads') {
      const bead = a.necklace === 'pearls' ? ['#f6f0e4'] : [dress.trim, dress.metal, mix(dress.cloth, '#fff8ee', 0.4)];
      s += fine
        ? arc(cx, ny - 0.6, nw + 1, drop + 0.4, 12, 168, a.necklace === 'pearls' ? 11 : 8).map(([x, y], i) => `<circle cx="${n(x)}" cy="${n(y)}" r="${a.necklace === 'pearls' ? 0.95 : 1.35}" fill="${bead[i % bead.length]}" stroke="${shade(bead[i % bead.length], 0.4)}" stroke-width=".35"/>`).join('')
        : `<path d="${d}" ${stroked(bead[0], 1.8)}/>`;
    } else {
      s += `<path d="${d}" ${stroked(dress.metal, fine ? 0.7 : 1.1)}/>`;
      if (a.necklace === 'pendant') s += `<ellipse cx="${n(cx)}" cy="${n(low + 2.4)}" rx="1.5" ry="1.9" ${filled(dress.metal, p.sw * 0.5)}/>`;
      if (a.necklace === 'cross') s += `<path d="M${n(cx)} ${n(low + 0.6)}l0 4.6M${n(cx - 1.5)} ${n(low + 2)}l3 0" ${stroked(dress.metal, fine ? 1 : 1.3)}/>`;
    }
  }
  if (a.extras.includes('scarf')) {
    const c = a.trim ?? dress.trim;
    s += `<path d="M${n(cx + 1)} ${n(ny + 3.4)}l6.4 0.4l1.2 14l-6.6 0.8Z" ${filled(shade(c, 0.1), p.sw)}/>` +
      `<path d="M${n(cx - nw - 3.4)} ${n(ny - 5.4)}Q${n(cx)} ${n(ny + 0.6)} ${n(cx + nw + 3.4)} ${n(ny - 5.4)}L${n(cx + nw + 4.2)} ${n(ny + 2.2)}Q${n(cx)} ${n(ny + 8.4)} ${n(cx - nw - 4.2)} ${n(ny + 2.2)}Z" ${filled(c, p.sw)}/>` +
      (lg ? `<path d="M${n(cx - nw - 2)} ${n(ny - 1.4)}Q${n(cx)} ${n(ny + 4.6)} ${n(cx + nw + 2)} ${n(ny - 1.4)}" ${stroked(shade(c, 0.3), 0.7)}/>` : '');
  }
  if (a.extras.includes('brooch')) s += `<ellipse cx="${n(cx)}" cy="${n(ny + 3.2)}" rx="2.2" ry="2.7" ${filled(dress.metal, p.sw * 0.7)}/>` + (fine ? `<ellipse cx="${n(cx)}" cy="${n(ny + 3.2)}" rx="1.1" ry="1.5" fill="#8a2f45"/>` : '');
  const px = cx + S * 0.34;
  if (a.extras.includes('flower')) {
    const c = '#c8434f';
    s += fine
      ? [0, 72, 144, 216, 288].map((deg) => `<circle cx="${n(px + 1.5 * Math.cos((deg * Math.PI) / 180))}" cy="${n(ny + 8.6 + 1.5 * Math.sin((deg * Math.PI) / 180))}" r="1.25" fill="${c}"/>`).join('') + `<circle cx="${n(px)}" cy="${n(ny + 8.6)}" r=".9" fill="#e9c44a"/><path d="M${n(px - 0.4)} ${n(ny + 10.6)}l-1.2 3.4" ${stroked('#4f7a45', 0.8)}/>`
      : `<circle cx="${n(px)}" cy="${n(ny + 8.6)}" r="2.4" fill="${c}"/>`;
  }
  if (a.extras.includes('medal')) {
    const mx = a.extras.includes('flower') ? cx - S * 0.34 : px;
    s += `<path d="M${n(mx - 1.6)} ${n(ny + 6.4)}l3.2 0l0 4.4l-1.6 1.2l-1.6 -1.2z" fill="${dress.trim}" stroke="${shade(dress.trim, 0.4)}" stroke-width=".4"/>` +
      `<circle cx="${n(mx)}" cy="${n(ny + 13.8)}" r="${fine ? 2 : 2.4}" ${filled(dress.metal, p.sw * 0.6)}/>`;
  }
  return s;
}

/** Earrings and a hearing aid: drawn over the hair, so that what a person chose to wear shows. */
function atTheEars(g: Geo, a: Appearance, dress: Dress, detail: Detail): string {
  if (a.earrings === 'none' && !a.extras.includes('hearing-aid')) return '';
  const baby = a.stage === 'baby';
  const k = 1 + 0.3 * g.m.earSize;
  const ey = g.eyeY + (baby ? 1.5 : 2.6);
  const lobe = ey + (baby ? 3.8 : 4.4) * k * 0.86;
  const fine = detail !== 'sm';
  let s = '';
  for (const sx of [-1, 1]) {
    const x = g.cx + sx * (g.w + 0.5);
    switch (a.earrings) {
      case 'studs': s += `<circle cx="${n(x)}" cy="${n(lobe)}" r="${fine ? 1 : 1.3}" ${filled(dress.metal, 0.4)}/>`; break;
      case 'pearls': s += `<circle cx="${n(x)}" cy="${n(lobe + 0.6)}" r="${fine ? 1.4 : 1.6}" fill="#f6f0e4" stroke="#a89b84" stroke-width=".4"/>`; break;
      case 'hoops': s += `<circle cx="${n(x + sx * 0.3)}" cy="${n(lobe + 2.4)}" r="2.5" ${stroked(dress.metal, fine ? 0.9 : 1.2)}/>`; break;
      case 'drops': s += `<path d="M${n(x)} ${n(lobe)}l0 1.6" ${stroked(dress.metal, 0.6)}/><path d="M${n(x)} ${n(lobe + 1.4)}q1.6 2.8 0 3.8q-1.6 -1 0 -3.8Z" ${filled(dress.trim, 0.4)}/>`; break;
      default: break;
    }
    // Behind the ear, with its clear tube curving into it.
    if (a.extras.includes('hearing-aid')) {
      const hx = x + sx * 1.9 * k;
      s += `<path d="M${n(hx - sx * 0.6)} ${n(ey - 4.4 * k)}Q${n(hx + sx * 1.5)} ${n(ey - 3.6 * k)} ${n(hx + sx * 1)} ${n(ey + 0.4)}Q${n(hx + sx * 0.6)} ${n(ey + 2.2 * k)} ${n(hx - sx * 0.6)} ${n(ey + 1.8 * k)}" ${stroked('#8f877a', fine ? 2.3 : 2.6)}/>` +
        `<path d="M${n(hx - sx * 0.6)} ${n(ey - 4.4 * k)}Q${n(hx + sx * 1.5)} ${n(ey - 3.6 * k)} ${n(hx + sx * 1)} ${n(ey + 0.4)}Q${n(hx + sx * 0.6)} ${n(ey + 2.2 * k)} ${n(hx - sx * 0.6)} ${n(ey + 1.8 * k)}" ${stroked('#d8d0c2', fine ? 1.4 : 1.6)}/>` +
        (fine ? `<path d="M${n(hx - sx * 0.6)} ${n(ey - 4.4 * k)}Q${n(x - sx * 1.4)} ${n(ey - 4.6 * k)} ${n(x - sx * 1.2)} ${n(ey - 0.6)}" ${stroked('#f4efe6', 0.6)} opacity=".9"/>` : '');
    }
  }
  return s;
}

/** A bindi and a nose stud. */
function onTheFace(g: Geo, a: Appearance, detail: Detail): string {
  let s = '';
  if (a.extras.includes('bindi')) s += `<circle cx="${n(g.cx)}" cy="${n(g.browY - 1.2)}" r="${detail === 'sm' ? 1.3 : 1}" fill="#b3283a"/>`;
  if (a.extras.includes('nose-stud') && detail !== 'sm') s += `<circle cx="${n(g.cx + 2.3 * (1 + 0.3 * g.m.noseSize))}" cy="${n(g.noseY + 0.9)}" r=".6" fill="${GOLD}" stroke="#8a6418" stroke-width=".25"/>`;
  return s;
}

/** A pipe, held in the corner of the mouth. */
function pipe(g: Geo, a: Appearance, detail: Detail): string {
  if (!a.extras.includes('pipe')) return '';
  const x = g.cx + 2.6;
  const y = g.mouthY + 0.9;
  return `<path d="M${n(x)} ${n(y)}L${n(x + 9)} ${n(y + 4.2)}" ${stroked('#2b1d14', detail === 'sm' ? 1.7 : 1.3)}/>` +
    `<path d="M${n(x + 8)} ${n(y + 1.2)}l5 0l-0.6 5.4q-1.9 1.3 -3.8 0z" ${filled('#6b3f24', detail === 'sm' ? 0.9 : 0.6)}/>`;
}

/**
 * What is behind them. It fills the whole picture, outside the zoom that enlarges small portraits, and it is flat
 * colour at list size, where a scene would only be noise. `plain` draws nothing: the roundel shows through.
 */
function backdrop(a: Appearance, dress: Dress, detail: Detail): string {
  const fine = detail !== 'sm';
  const rect = (fill: string, y = 0, hgt = 100) => `<rect y="${y}" width="100" height="${hgt}" fill="${fill}"/>`;
  switch (a.backdrop) {
    case 'plain':
      return '';
    case 'house':
      // The house's two colours side by side, as on a banner.
      return rect(dress.trim) + `<rect width="50" height="100" fill="${dress.cloth}"/>`;
    case 'rays': {
      // A sunburst behind the head in the house's colours.
      if (!fine) return rect(dress.cloth);
      let d = '';
      for (let i = 0; i < 12; i += 2) {
        const p0 = (i * Math.PI) / 6 - 0.26;
        const p1 = ((i + 1) * Math.PI) / 6 - 0.26;
        d += `M50 46L${n(50 + 90 * Math.cos(p0))} ${n(46 + 90 * Math.sin(p0))}L${n(50 + 90 * Math.cos(p1))} ${n(46 + 90 * Math.sin(p1))}Z`;
      }
      return rect(dress.cloth) + `<path d="${d}" fill="${dress.trim}" opacity=".85"/>`;
    }
    case 'drape': {
      // A photographer's studio: a dark cloth hung behind the sitter, and its folds at one side.
      const c = mix(dress.cloth, '#3a2c28', 0.6);
      return rect(c) + (fine ? `<path d="M0 0L22 0Q16 50 24 100L0 100Z" fill="${shade(c, 0.25)}"/><path d="M7 0Q4 50 9 100M15 0Q11 50 17 100" ${stroked(tint(c, 0.25), 1.2)} opacity=".6"/>` : '');
    }
    case 'books': {
      const wood = '#4a3426';
      if (!fine) return rect(wood) + `<path d="M0 30L100 30M0 62L100 62" ${stroked('#2c1e15', 2.4)}/>`;
      // The spines of one colour are one path, so three shelves of books cost seven paths and not fifty rectangles.
      const spines = ['#7a2f2f', '#2f4f6a', '#5f6b3a', '#b08a3c', '#5a3a5f', '#8a5a34', '#34504a'];
      const d = spines.map(() => '');
      let shelves = '';
      for (const [row, top] of [[0, 2], [1, 34], [2, 66]] as const) {
        let x = 1;
        for (let i = 0; x < 99; i++) {
          const wdt = 4 + ((i * 7 + row * 3) % 4);
          const hgt = 22 + ((i * 5 + row * 2) % 6);
          d[(i * 3 + row) % spines.length] += `M${x} ${top + 28 - hgt}h${n(wdt - 0.8)}v${hgt}h${n(0.8 - wdt)}z`;
          x += wdt;
        }
        shelves += `M0 ${top + 28}h100v3.4h-100z`;
      }
      return rect('#2c1e15') + spines.map((c, i) => `<path d="${d[i]}" fill="${c}"/>`).join('') + `<path d="${shelves}" fill="${wood}"/>`;
    }
    case 'sky':
      return rect('#8ebfe3') + (fine ? `<path d="M8 30a7 7 0 0 1 13 -3a6 6 0 0 1 9 5zM66 20a6 6 0 0 1 11 -3a7 7 0 0 1 14 4a4 4 0 0 1 3 4l-28 0z" fill="#f4f8fb" opacity=".9"/>` : '');
    case 'hills':
      return rect('#a9cfe6') + (fine ? `<circle cx="78" cy="22" r="8" fill="#f3d67a"/>` : '') +
        `<path d="M0 62Q22 40 48 58Q72 44 100 60L100 100L0 100Z" fill="#7fa665"/>` + (fine ? `<path d="M0 78Q30 60 60 76Q82 66 100 74L100 100L0 100Z" fill="#5f8a50"/>` : '');
    case 'garden':
      return rect('#a9cfe6', 0, 40) + rect('#4f7f49', 36, 64) +
        (fine ? `<path d="M0 40Q8 30 16 38Q26 28 36 38Q48 30 58 38Q70 28 80 38Q90 30 100 40L100 46L0 46Z" fill="#4f7f49"/>` +
          [[8, 52, 0], [22, 66, 1], [80, 56, 2], [92, 70, 0], [70, 80, 1], [14, 84, 2], [34, 48, 1], [62, 50, 0]].map(([x, y, i]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="${['#e58aa0', '#f6f0e4', '#e9c44a'][i]}"/>`).join('') : '');
    case 'sea':
      return rect('#a9cfe6', 0, 50) + rect('#3f7fa6', 48, 52) +
        (fine ? `<path d="M4 60q5 -3 10 0t10 0M70 58q5 -3 10 0t10 0M12 74q5 -3 10 0t10 0M64 76q5 -3 10 0t10 0" ${stroked('#cfe3ee', 1)} opacity=".7"/><path d="M84 47l0 -13l8 13z" fill="#f4f8fb"/><path d="M80 48l14 0l-2 3l-10 0z" fill="#6b3f24"/>` : '');
    case 'night':
      return rect('#1f2a4a') + `<path d="M80 12a9 9 0 1 0 8 14a7.4 7.4 0 0 1 -8 -14z" fill="#f1e3ad"/>` +
        (fine ? [[12, 14], [28, 30], [40, 10], [62, 26], [92, 44], [8, 48], [70, 8], [22, 8], [50, 22]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.8 : 1.2}" fill="#f6f0e4"/>`).join('') : '');
  }
}

// ---------- The whole drawing ----------

/** Where the drawing sits: at list sizes the head is drawn larger, so a face still reads at 28px. */
const ZOOM: Record<Detail, string> = {
  sm: 'translate(50 47) scale(1.3) translate(-50 -47)',
  md: 'translate(50 50) scale(1.08) translate(-50 -50)',
  lg: 'translate(50 50) scale(1.08) translate(-50 -50)',
};

/**
 * `bare` leaves out the hair, the beard and the moustache. Nothing on a page asks for it: it is how the frozen test
 * (src/lib/portrait-frozen.test.ts) shows that a redraw of those three moved nothing else.
 */
export function avatarSvg(a: Appearance, house: Dress, detail: Detail, bare = false): string {
  const g = geo(a);
  const p = paint(a, detail);
  // The colours someone chose for the clothes and the headwear go in place of the house's. The backdrop keeps the house's.
  const dress = a.cloth || a.trim ? { ...house, cloth: a.cloth ?? house.cloth, trim: a.trim ?? house.trim } : house;
  const hatDress = a.hat ? { ...dress, cloth: a.hat, trim: a.hat } : dress;
  const under = HAIR_UNDER[a.headwear] ?? 'all';
  // Hats sit on the hair; tall styles that would poke through are worn lower under them.
  let style = a.hairStyle;
  if (under !== 'all') style = under === 'fringe' ? 'chignon' : 'cropped';
  else if (!IN_THE_HAIR.has(a.headwear)) style = UNDER_A_HAT[style] ?? style;
  const outline = headPoints(g, a);
  const head = smoothClosed(outline);
  // The head as the hair and the beard see it: its middle, its size, and how wide it is at any height.
  const on: Head = { cx: g.cx, cy: g.cy, w: g.w, h: a.face === 'long' ? g.h * 1.04 : g.h, halfAt: halfWidth(sampleClosed(outline), g.cx), hs: g.hs };
  const hp = drawHair(style, on, { hair: p.hair, shade: p.hairShade, line: p.hairLine, light: p.hairLight, skinShade: p.skinShade, sw: p.sw }, detail);
  const hw = headwear(g, p, a, hatDress, detail);
  // The beard and the moustache share a colour: the hair's, or their own.
  const whiskers = { hair: a.beardColour, shade: shade(a.beardColour, 0.28), line: shade(a.beardColour, 0.5), sw: p.sw };
  const lips = { y: g.mouthY, wd: mouthHalf(g, a) };
  const showHair = under !== 'none' && !bare;
  // A hat presses the hair down: nothing of it shows above the line the hat sits on, whatever its volume.
  const hatted = under === 'all' && !IN_THE_HAIR.has(a.headwear);
  const pressed = (s: string) => (hatted && s ? `<g clip-path="url(#hh)">${s}</g>` : s);
  const hatLine = hatted && showHair ? `<clipPath id="hh"><rect y="${n(g.cy + (HAT_LINE[a.headwear] ?? -0.72) * g.h)}" width="100" height="110"/></clipPath>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><clipPath id="hc"><path d="${head}"/></clipPath>${hatLine}</defs>` +
    backdrop(a, house, detail) +
    `<g${ZOOM[detail] ? ` transform="${ZOOM[detail]}"` : ''}>` +
    hw.back +
    (showHair && under === 'all' ? pressed(hp.back) : '') +
    neckAndChest(g, p) +
    body(g, p, a, a.clothing, dress, detail) +
    onTheChest(g, p, a, dress, detail) +
    (showHair && under === 'all' ? hp.overBody : '') +
    ears(g, p, a) +
    `<path d="${head}" ${filled(p.skin, p.sw, p.skinLine)}/>` +
    face(g, p, a, detail) +
    onTheFace(g, a, detail) +
    (bare ? '' : drawBeard({ cover: a.beardCover, length: a.beardLength, shape: a.beardShape }, { ...on, chin: Math.max(...outline.map(([, y]) => y)) }, lips, whiskers, detail)) +
    mouth(g, p, a, detail) +
    pipe(g, a, detail) +
    (bare ? '' : drawMoustache(a.moustache, on, lips, whiskers, detail)) +
    (showHair ? pressed(hp.front) : '') +
    atTheEars(g, a, dress, detail) +
    glasses(g, a, detail) +
    hw.front +
    `</g></svg>`
  );
}
