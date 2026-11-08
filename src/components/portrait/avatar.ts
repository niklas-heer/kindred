// The avatar drawing: a warm, flat illustration built from parts in one 100 × 100 space. Every
// part is a function of the resolved Appearance (look.ts) and a Geo for the life stage, so a child
// has a rounder face and a bigger head, and the same parts dress any era.
//
// Style: flat fills, one soft shadow tone, outlines in a darker shade of each fill (never black).
import type { ClothingStyle, HairStyle } from '~/lib/seed-format';
import { mixHex as mix, type Appearance, type Features, type LevelKey } from './look';
import type { Dress } from './palette';

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
  return {
    cx: 50, cy, w, h, nw: P.nw, ny: P.ny, S: P.S,
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
    lips: mix(a.skin, '#b5463e', 0.32),
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

function headPath(g: Geo, a: Appearance): string {
  const { cx, cy, w } = g;
  const h = a.face === 'long' ? g.h * 1.04 : g.h;
  // The jaw is the one measure that changes the outline: broad below the cheekbones, or narrow.
  const jawK = 1 + 0.16 * g.m.jaw;
  const right = OUTLINE[a.face].map(([x, y]) => [x * (y > 0.2 ? jawK : 1), y] as [number, number]);
  const mirror = right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number]);
  const pts = [...right, ...mirror].map(([x, y]) => [cx + x * w, cy + y * h] as [number, number]);
  return smoothClosed(pts);
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

  s += eyes(g, p, a, detail);
  s += nose(g, p, a, detail);
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
  const lift = shape === 'hooded' ? 0.55 : 1;
  const ix = x - sx * rx;
  const iy = y + 0.15 * ry;
  const ox = x + sx * rx;
  const oy = y - 0.22 * ry;
  const lid = `M${n(ix)} ${n(iy)}C${n(x - sx * rx * 0.35)} ${n(y - ry * 1.25 * lift)} ${n(x + sx * rx * 0.55)} ${n(y - ry * 1.15 * lift)} ${n(ox)} ${n(oy)}`;
  const low = `M${n(ox)} ${n(oy)}C${n(x + sx * rx * 0.5)} ${n(y + ry * 0.9)} ${n(x - sx * rx * 0.3)} ${n(y + ry * 1.0)} ${n(ix)} ${n(iy)}`;
  return { lid, low, open: `${lid}${low.slice(low.indexOf('C'))}Z` };
}

function eyes(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, eyeY: y, dx, er } = g;
  const kid = a.stage === 'baby' || a.stage === 'child';
  const iris = mix(a.eyes, '#120a06', 0.12);
  const rx = er * (a.eyeShape === 'round' ? 0.86 : 1.02);
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
    const y0 = y + 0.6;
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
    default:
      body = `<path d="M${n(cx + 0.6)} ${n(y - 2.6)}Q${n(cx + 1)} ${n(y - 0.8)} ${n(cx + 1.2)} ${n(y + 0.2)}" ${stroked(p.skinShade, 0.6)}/>` +
        `<path d="M${n(cx - 1.8)} ${n(y + 0.9)}Q${n(cx - 1.5)} ${n(y + 2.3)} ${n(cx)} ${n(y + 2)}Q${n(cx + 1.5)} ${n(y + 2.3)} ${n(cx + 1.8)} ${n(y + 0.9)}" ${line}/>`;
  }
  const nostrils = lg ? `<ellipse cx="${n(cx - 1.1)}" cy="${n(y + 1.3)}" rx=".55" ry=".3" fill="${p.skinLine}" opacity=".8"/><ellipse cx="${n(cx + 1.1)}" cy="${n(y + 1.3)}" rx=".55" ry=".3" fill="${p.skinLine}" opacity=".8"/>` : '';
  return `<g transform="translate(${n(cx)} ${n(y)}) scale(${n(k)}) translate(${n(-cx)} ${n(-y)})">${under}${shadowLine}${body}${nostrils}</g>`;
}

function mouth(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, mouthY: y } = g;
  const kid = a.stage === 'baby' || a.stage === 'child';
  const base = kid ? 3.2 : a.stage === 'elder' ? 3.4 : 3.8;
  const wd = base * (1 + 0.24 * g.m.mouthWidth);
  // Fuller lips for a feminine face, and whatever the measure says.
  const fu = Math.max(0.5, 1 + 0.5 * g.m.mouthFullness) * (a.pres === 'f' && !kid ? 1.12 : 1);
  const style = kid ? (a.mouth % 2 ? 2 : 0) : a.mouth;
  const L = cx - wd;
  const R = cx + wd;
  const line = stroked(shade(p.lips, 0.45), detail === 'sm' ? 1.2 : 0.95);
  let s = '';
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

// ---------- Hair ----------

interface HairParts { back: string; front: string; overBody: string }

/** The hair's outer dome over the head, expanded by `v`, from the left side at `y0` to the right. */
function dome(g: Geo, v: number, y0: number, lift = 1.25): string {
  const { cx, cy, w, h } = g;
  return (
    `M${n(cx - w - v)} ${n(cy + y0 * h)}` +
    `C${n(cx - w - v)} ${n(cy - 0.62 * h - v)} ${n(cx - 0.56 * w - v * 0.7)} ${n(cy - h - v * lift)} ${n(cx)} ${n(cy - h - v * lift)}` +
    `C${n(cx + 0.56 * w + v * 0.7)} ${n(cy - h - v * lift)} ${n(cx + w + v)} ${n(cy - 0.62 * h - v)} ${n(cx + w + v)} ${n(cy + y0 * h)}`
  );
}

/** A plain hairline back from the right temple to the left one, through the forehead at `fh`. */
function hairline(g: Geo, fh0: number, side: number, part = 0): string {
  const { cx, cy, w, h } = g;
  const fh = fh0 + g.hs;
  return (
    `L${n(cx + w * 0.97)} ${n(cy + side * h)}` +
    `C${n(cx + w * 0.95)} ${n(cy - 0.22 * h)} ${n(cx + 0.58 * w)} ${n(cy - fh * h)} ${n(cx + part)} ${n(cy - fh * h + Math.abs(part) * 0.1)}` +
    `C${n(cx - 0.58 * w)} ${n(cy - fh * h)} ${n(cx - w * 0.95)} ${n(cy - 0.22 * h)} ${n(cx - w * 0.97)} ${n(cy + side * h)}Z`
  );
}

/**
 * A fill for hair that sits on the whole crown: an ellipse that holds the head's top corners, with the
 * face cut out by the hairline. A plain dome is narrower than the head at the temples, so it leaves the
 * skin of the head showing as a thin curved line at the top of the hair. Used with fill-rule evenodd.
 */
function crownCap(g: Geo, fh: number): string {
  const { cx, cy, w, h } = g;
  const rx = w + 2;
  const ry = h + 1.5;
  const cyc = cy - 0.2 * h;
  const yb = cy + 0.15 * h;
  const xb = rx * Math.sqrt(1 - ((yb - cyc) / ry) ** 2);
  return `M${n(cx - xb)} ${n(yb)}A${n(rx)} ${n(ry)} 0 1 1 ${n(cx + xb)} ${n(yb)}Z` + hairline(g, fh, 0.15).replace(/^L/, 'M');
}

/** A fringe swept from a parting on the right down across the forehead to the left temple. */
function sweptLine(g: Geo, side: number, depth0: number): string {
  const { cx, cy, w, h } = g;
  const depth = depth0 + g.hs;
  return (
    `L${n(cx + w * 0.97)} ${n(cy + side * h)}` +
    `C${n(cx + w * 0.95)} ${n(cy - 0.3 * h)} ${n(cx + 0.62 * w)} ${n(cy - 0.6 * h)} ${n(cx + 0.42 * w)} ${n(cy - 0.64 * h)}` +
    `C${n(cx + 0.1 * w)} ${n(cy - depth * h)} ${n(cx - 0.6 * w)} ${n(cy - (depth - 0.06) * h)} ${n(cx - w * 0.97)} ${n(cy + (side - 0.12) * h)}Z`
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

function hair(g: Geo, p: Paint, a: Appearance, style: HairStyle, detail: Detail): HairParts {
  const { cx, cy, w, h, ny } = g;
  const H = filled(p.hair, p.sw, p.hairLine);
  const path = (d: string, extra = '') => `<path d="${d}" ${H}${extra}/>`;
  const lg = detail === 'lg';
  // A highlight arc on the crown and a few strands, at the largest size only.
  const shine = (v: number) => (lg ? `<path d="M${n(cx - w * 0.55)} ${n(cy - h * 0.82 - v * 0.6)}Q${n(cx - w * 0.1)} ${n(cy - h - v * 1.05)} ${n(cx + w * 0.3)} ${n(cy - h * 0.93 - v)}" ${stroked(p.hairLight, 1.3)} opacity=".7"/>` : '');
  const strand = (d: string) => (detail === 'sm' ? '' : `<path d="${d}" ${stroked(p.hairShade, 0.8)}/>`);
  const none: HairParts = { back: '', front: '', overBody: '' };

  // Long hair falling behind the shoulders, to `bottom`, flaring by `flare`.
  const fall = (bottom: number, flare: number, v = 3) =>
    path(`${dome(g, v, 0.2)}C${n(cx + w + v + flare * 0.6)} ${n(cy + 0.9 * h)} ${n(cx + w + flare)} ${n(bottom - 8)} ${n(cx + w + flare)} ${n(bottom)}L${n(cx - w - flare)} ${n(bottom)}C${n(cx - w - flare)} ${n(bottom - 8)} ${n(cx - w - v - flare * 0.6)} ${n(cy + 0.9 * h)} ${n(cx - w - v)} ${n(cy + 0.2 * h)}Z`);
  // Locks framing the face and lying over the shoulders, from the temples down to `bottom`.
  const locks = (bottom: number, out: number, inner = 0.84) => {
    const one = (s: number) => {
      const X = (u: number) => n(cx + s * u);
      return path(
        `M${X(w * 0.62)} ${n(cy - 0.66 * h)}C${X(w + 4.5)} ${n(cy - 0.5 * h)} ${X(w + out + 0.8)} ${n(cy + 0.2 * h)} ${X(w + out)} ${n(bottom - 5)}` +
          `Q${X(w + out - 0.6)} ${n(bottom + 0.6)} ${X(w * inner + 2.4)} ${n(bottom)}` +
          `C${X(w * inner + 0.4)} ${n(cy + 0.9 * h)} ${X(w * inner - 0.4)} ${n(cy + 0.25 * h)} ${X(w * inner)} ${n(cy - 0.22 * h)}Z`,
      ) + strand(`M${X(w + out * 0.45)} ${n(cy + 0.1 * h)}Q${X(w + out * 0.7)} ${n(cy + 0.7 * h)} ${X(w + out * 0.5)} ${n(bottom - 4)}`);
    };
    return one(-1) + one(1);
  };
  // Centre-parted crown.
  const centre = (v: number, fh: number, side: number) =>
    path(`${dome(g, v, side)}${hairline(g, fh, side)}`) +
    strand(`M${n(cx)} ${n(cy - h - v)}Q${n(cx + 0.6)} ${n(cy - h * 0.8)} ${n(cx)} ${n(cy - fh * h)}`);

  switch (style) {
    case 'tuft':
      return {
        ...none,
        front:
          `<path d="${dome(g, 0.3, -0.25)}${hairline(g, 0.6, -0.25)}" fill="${p.hair}" opacity=".3"/>` +
          path(`M${n(cx - 2.2)} ${n(cy - h + 1)}Q${n(cx - 2)} ${n(cy - h - 5)} ${n(cx + 3)} ${n(cy - h - 4.4)}Q${n(cx + 0.6)} ${n(cy - h - 2.6)} ${n(cx + 1.6)} ${n(cy - h + 0.8)}Z`),
      };
    case 'cropped':
      return { ...none, front: path(`${dome(g, 1, 0.05)}${hairline(g, 0.5, 0.05)}`) + shine(1) };
    case 'short':
      return {
        ...none,
        front: path(`${dome(g, 2.3, 0.1)}${hairline(g, 0.46, 0.1, 2)}`) + strand(`M${n(cx + w * 0.3)} ${n(cy - h - 1.5)}Q${n(cx + w * 0.42)} ${n(cy - h * 0.7)} ${n(cx + w * 0.36)} ${n(cy - h * 0.5)}`) + shine(2.3),
      };
    case 'side-part':
      return {
        ...none,
        front: path(`${dome(g, 2.6, 0.1)}${sweptLine(g, 0.1, 0.42)}`) + strand(`M${n(cx + w * 0.42)} ${n(cy - h - 2)}Q${n(cx + w * 0.48)} ${n(cy - h * 0.8)} ${n(cx + w * 0.42)} ${n(cy - h * 0.64)}`) + shine(2.6),
      };
    case 'swept':
      return {
        ...none,
        front: path(`${dome(g, 3, 0.12)}${sweptLine(g, 0.12, 0.3)}`) + strand(`M${n(cx + w * 0.2)} ${n(cy - h * 0.62)}Q${n(cx - w * 0.2)} ${n(cy - h * 0.45)} ${n(cx - w * 0.6)} ${n(cy - h * 0.3)}`) + shine(3),
      };
    case 'quiff':
      return {
        ...none,
        front:
          path(`${dome(g, 2, 0.08)}${hairline(g, 0.5, 0.08)}`) +
          path(`M${n(cx - w * 0.78)} ${n(cy - 0.62 * h)}C${n(cx - w * 0.85)} ${n(cy - h - 9)} ${n(cx + w * 0.75)} ${n(cy - h - 11)} ${n(cx + w * 0.92)} ${n(cy - 0.62 * h)}C${n(cx + w * 0.4)} ${n(cy - 0.78 * h)} ${n(cx - w * 0.2)} ${n(cy - 0.6 * h)} ${n(cx - w * 0.78)} ${n(cy - 0.62 * h)}Z`) +
          strand(`M${n(cx - w * 0.5)} ${n(cy - h - 3)}Q${n(cx)} ${n(cy - h - 7)} ${n(cx + w * 0.6)} ${n(cy - h - 3)}`),
      };
    case 'curly': {
      const pts = arc(cx, cy - 0.12 * h, w + 1.2, h * 0.98, 172, 368, 11).map(([x, y]) => [x, y, 4.3]);
      const fr = arc(cx, cy - 0.12 * h, w * 0.78, h * 0.42, 200, 340, 5).map(([x, y]) => [x, y, 3.4]);
      return { ...none, front: path(`${dome(g, 2, 0.15)}${hairline(g, 0.44, 0.15)}`) + curls(pts, 4.3, p.hair, p.hairLine, p.sw) + curls(fr, 3.4, p.hair, p.hairLine, p.sw * 0.8) + `<path d="${dome(g, 1.4, 0.1)}${hairline(g, 0.5, 0.1)}" fill="${p.hair}"/>` };
    }
    case 'afro': {
      const ring = arc(cx, cy - 0.2 * h, w + 6.5, h + 4, 150, 390, 15).map(([x, y]) => [x, y, 5]);
      return {
        ...none,
        back: `<ellipse cx="${n(cx)}" cy="${n(cy - 0.2 * h)}" rx="${n(w + 7)}" ry="${n(h + 4.5)}" fill="${p.hair}"/>` + curls(ring, 5, p.hair, p.hairLine, p.sw) + `<ellipse cx="${n(cx)}" cy="${n(cy - 0.2 * h)}" rx="${n(w + 6)}" ry="${n(h + 3.5)}" fill="${p.hair}"/>`,
        front: `<path d="${crownCap(g, 0.46)}" fill="${p.hair}" fill-rule="evenodd"/>` + strand(`M${n(cx - w * 0.6)} ${n(cy - 0.5 * h)}Q${n(cx)} ${n(cy - 0.62 * h)} ${n(cx + w * 0.6)} ${n(cy - 0.5 * h)}`),
      };
    }
    case 'bowl': {
      // Not a helmet: the dome comes down to a hem that flares a little at the jaw, and the fringe is
      // cut in an uneven, soft line across the forehead, with the sides tucked in at the temples.
      const X = (u: number) => n(cx + u * w);
      const Y = (v: number) => n(cy + v * h);
      const right = `L${X(1.02)} ${Y(0.6)}Q${X(0.9)} ${Y(0.72)} ${X(0.74)} ${Y(0.62)}L${X(0.84)} ${Y(0.2)}` +
        `C${X(0.9)} ${Y(-0.08)} ${X(0.84)} ${Y(-0.24)} ${X(0.66)} ${Y(-0.36)}Q${X(0.56)} ${Y(-0.5)} ${X(0.34)} ${Y(-0.42)}`;
      const fringe = `Q${X(0.16)} ${Y(-0.34)} ${X(0)} ${Y(-0.44)}Q${X(-0.2)} ${Y(-0.55)} ${X(-0.38)} ${Y(-0.44)}`;
      const left = `Q${X(-0.6)} ${Y(-0.36)} ${X(-0.7)} ${Y(-0.34)}C${X(-0.84)} ${Y(-0.24)} ${X(-0.9)} ${Y(-0.08)} ${X(-0.84)} ${Y(0.2)}` +
        `L${X(-0.74)} ${Y(0.62)}Q${X(-0.9)} ${Y(0.72)} ${X(-1.02)} ${Y(0.6)}Z`;
      return {
        ...none,
        front: path(`${dome(g, 2.8, 0.38)}${right}${fringe}${left}`) +
          strand(`M${X(0.22)} ${Y(-0.44)}Q${X(0.14)} ${Y(-0.2)} ${X(0.2)} ${Y(0.08)}`) + shine(2.8),
      };
    }
    case 'pixie':
      return {
        ...none,
        front: path(`${dome(g, 2.4, 0.3)}L${n(cx + w * 0.97)} ${n(cy + 0.3 * h)}L${n(cx + w * 0.86)} ${n(cy - 0.1 * h)}C${n(cx + 0.7 * w)} ${n(cy - 0.5 * h)} ${n(cx + 0.2 * w)} ${n(cy - 0.62 * h)} ${n(cx - 0.1 * w)} ${n(cy - 0.62 * h)}C${n(cx - 0.4 * w)} ${n(cy - 0.45 * h)} ${n(cx - 0.7 * w)} ${n(cy - 0.3 * h)} ${n(cx - w * 0.8)} ${n(cy - 0.12 * h)}L${n(cx - w * 0.97)} ${n(cy + 0.3 * h)}Z`) + shine(2.4),
      };
    case 'bob':
      return {
        ...none,
        back: path(`${dome(g, 4, 0.2)}L${n(cx + w + 4)} ${n(cy + 0.8 * h)}L${n(cx - w - 4)} ${n(cy + 0.8 * h)}Z`),
        front: path(`${dome(g, 4, 0.8)}L${n(cx + w + 4)} ${n(cy + 0.8 * h)}Q${n(cx + w * 0.9)} ${n(cy + 0.84 * h)} ${n(cx + w * 0.8)} ${n(cy + 0.78 * h)}C${n(cx + w * 0.86)} ${n(cy + 0.2 * h)} ${n(cx + w * 0.9)} ${n(cy - 0.3 * h)} ${n(cx + w * 0.4)} ${n(cy - 0.36 * h)}Q${n(cx - w * 0.2)} ${n(cy - 0.28 * h)} ${n(cx - w * 0.7)} ${n(cy - 0.34 * h)}C${n(cx - w * 0.92)} ${n(cy - 0.2 * h)} ${n(cx - w * 0.86)} ${n(cy + 0.2 * h)} ${n(cx - w * 0.8)} ${n(cy + 0.78 * h)}Q${n(cx - w * 0.9)} ${n(cy + 0.84 * h)} ${n(cx - w - 4)} ${n(cy + 0.8 * h)}Z`) + shine(4),
      };
    case 'shoulder':
      return {
        ...none,
        back: fall(ny + 4, 3.5),
        front: centre(3, 0.48, 0.1) + locks(ny + 3, 3.4, 0.88),
      };
    case 'long':
      return {
        ...none,
        back: fall(104, 6),
        front: centre(3, 0.48, 0.1),
        overBody: locks(ny + 15, 5, 0.86),
      };
    case 'wavy': {
      const back = fall(102, 7.5, 3.6);
      const wave = (s: number) => {
        const X = (u: number) => n(cx + s * u);
        return path(`M${X(w * 0.6)} ${n(cy - 0.66 * h)}C${X(w + 6)} ${n(cy - 0.5 * h)} ${X(w + 2)} ${n(cy + 0.1 * h)} ${X(w + 5.5)} ${n(cy + 0.4 * h)}C${X(w + 9)} ${n(cy + 0.75 * h)} ${X(w + 3)} ${n(ny)} ${X(w + 7)} ${n(ny + 12)}L${X(w * 0.9)} ${n(ny + 10)}C${X(w * 0.7)} ${n(ny)} ${X(w * 0.95)} ${n(cy + 0.4 * h)} ${X(w * 0.84)} ${n(cy + 0.1 * h)}C${X(w * 0.78)} ${n(cy - 0.2 * h)} ${X(w * 0.3)} ${n(cy - 0.35 * h)} ${X(-w * 0.1)} ${n(cy - 0.5 * h)}Z`);
      };
      return { ...none, back, front: path(`${dome(g, 3.6, 0.1)}${sweptLine(g, 0.1, 0.45)}`) + shine(3.6), overBody: wave(-1) + wave(1) };
    }
    case 'braid': {
      const braid = (s: number) => {
        const x = cx + s * (w + 0.5);
        let out = '';
        for (let i = 0; i < 6; i++) out += `<ellipse cx="${n(x + s * (i % 2 ? 0.6 : -0.6))}" cy="${n(cy + 0.42 * h + i * 4.4)}" rx="3" ry="2.9" ${H}/>`;
        return out + `<circle cx="${n(x)}" cy="${n(cy + 0.42 * h + 26)}" r="1.4" fill="${GOLD}" stroke="${shade(GOLD)}" stroke-width=".6"/>`;
      };
      return { ...none, front: centre(1.6, 0.5, 0.3), overBody: braid(-1) + braid(1) };
    }
    case 'ponytail':
      return {
        ...none,
        back: path(`M${n(cx + w * 0.4)} ${n(cy - 0.75 * h)}C${n(cx + w + 12)} ${n(cy - 0.6 * h)} ${n(cx + w + 9)} ${n(cy + 0.6 * h)} ${n(cx + w + 4)} ${n(ny + 2)}C${n(cx + w + 2)} ${n(cy + 0.6 * h)} ${n(cx + w * 0.7)} ${n(cy)} ${n(cx + w * 0.5)} ${n(cy - 0.3 * h)}Z`),
        front: path(`${dome(g, 1.8, 0.1)}${hairline(g, 0.5, 0.1)}`) + strand(`M${n(cx - w * 0.5)} ${n(cy - 0.6 * h)}Q${n(cx)} ${n(cy - h - 1)} ${n(cx + w * 0.7)} ${n(cy - 0.7 * h)}`) + shine(1.8),
      };
    case 'pigtails': {
      const tail = (s: number) => {
        const x = cx + s * (w + 5);
        return `<ellipse cx="${n(x)}" cy="${n(cy + 0.2 * h)}" rx="4.6" ry="7.4" transform="rotate(${s * -18} ${n(x)} ${n(cy + 0.2 * h)})" ${H}/>` +
          `<circle cx="${n(cx + s * (w + 1.5))}" cy="${n(cy - 0.12 * h)}" r="1.7" fill="#d9534f" stroke="${shade('#d9534f')}" stroke-width=".6"/>`;
      };
      return { ...none, back: tail(-1) + tail(1), front: centre(2, 0.48, 0.1) };
    }
    case 'bun':
      return {
        ...none,
        back: `<circle cx="${n(cx + 1)}" cy="${n(cy - h - 3.5)}" r="6.8" ${H}/>` + (lg ? `<path d="M${n(cx - 3.5)} ${n(cy - h - 5)}Q${n(cx + 1)} ${n(cy - h - 9)} ${n(cx + 5)} ${n(cy - h - 4.5)}" ${stroked(p.hairShade, 0.8)}/>` : ''),
        front: path(`${dome(g, 1.8, 0.15)}${hairline(g, 0.5, 0.15)}`) + strand(`M${n(cx - w * 0.6)} ${n(cy - 0.5 * h)}Q${n(cx - w * 0.4)} ${n(cy - h)} ${n(cx)} ${n(cy - h - 1)}`) + shine(1.8),
      };
    case 'chignon':
      return {
        ...none,
        back: `<ellipse cx="${n(cx)}" cy="${n(cy + 0.42 * h)}" rx="${n(w + 4.5)}" ry="9" ${H}/>`,
        front: path(`${dome(g, 2.2, 0.36)}L${n(cx + w * 0.98)} ${n(cy + 0.36 * h)}C${n(cx + w * 0.92)} ${n(cy - 0.1 * h)} ${n(cx + 0.6 * w)} ${n(cy - 0.5 * h)} ${n(cx)} ${n(cy - 0.5 * h)}C${n(cx - 0.6 * w)} ${n(cy - 0.5 * h)} ${n(cx - w * 0.92)} ${n(cy - 0.1 * h)} ${n(cx - w * 0.98)} ${n(cy + 0.36 * h)}Z`) +
          strand(`M${n(cx)} ${n(cy - h - 2)}L${n(cx)} ${n(cy - 0.5 * h)}`) + shine(2.2),
      };
    case 'periwig': {
      const col = (s: number) => arc(cx + s * (w + 3.4), cy + 0.25 * h, 0.6, h * 0.95, -60, 80, 7).map(([x, y], i) => [x + s * (i % 2 ? 1 : -0.6), y, 4.4]);
      return {
        ...none,
        back: fall(ny + 14, 8, 4.5),
        front: centre(4.2, 0.5, 0.15),
        overBody: curls([...col(-1), ...col(1)], 4.4, p.hair, p.hairLine, p.sw),
      };
    }
    case 'powdered': {
      const rolls = (s: number) => [0.02, 0.3].map((t) => `<ellipse cx="${n(cx + s * (w + 1.6))}" cy="${n(cy + t * h)}" rx="3.9" ry="2.8" ${H}/>`).join('');
      return { ...none, front: path(`${dome(g, 2.6, 0.05)}${hairline(g, 0.56, 0.05)}`) + rolls(-1) + rolls(1) + shine(2.6) };
    }
    case 'receding':
      return {
        ...none,
        front:
          path(`${dome(g, 1.2, 0.12)}L${n(cx + w * 0.97)} ${n(cy + 0.12 * h)}C${n(cx + w * 0.95)} ${n(cy - 0.3 * h)} ${n(cx + 0.75 * w)} ${n(cy - 0.82 * h)} ${n(cx + 0.45 * w)} ${n(cy - 0.84 * h)}Q${n(cx + 0.2 * w)} ${n(cy - 0.72 * h)} ${n(cx)} ${n(cy - 0.76 * h)}Q${n(cx - 0.2 * w)} ${n(cy - 0.72 * h)} ${n(cx - 0.45 * w)} ${n(cy - 0.84 * h)}C${n(cx - 0.75 * w)} ${n(cy - 0.82 * h)} ${n(cx - w * 0.95)} ${n(cy - 0.3 * h)} ${n(cx - w * 0.97)} ${n(cy + 0.12 * h)}Z`),
      };
    case 'bald': {
      const side = (s: number) => {
        const X = (u: number) => n(cx + s * u);
        return path(`M${X(w * 0.82)} ${n(cy - 0.5 * h)}C${X(w + 2.5)} ${n(cy - 0.3 * h)} ${X(w + 2)} ${n(cy + 0.15 * h)} ${X(w + 0.5)} ${n(cy + 0.25 * h)}L${X(w * 0.94)} ${n(cy + 0.1 * h)}C${X(w * 0.96)} ${n(cy - 0.1 * h)} ${X(w * 0.92)} ${n(cy - 0.3 * h)} ${X(w * 0.82)} ${n(cy - 0.5 * h)}Z`);
      };
      const gleam = lg ? `<ellipse cx="${n(cx - w * 0.3)}" cy="${n(cy - h * 0.78)}" rx="4.5" ry="2.2" transform="rotate(-20 ${n(cx - w * 0.3)} ${n(cy - h * 0.78)})" fill="#fff" opacity=".22"/>` : '';
      return { ...none, front: side(-1) + side(1) + gleam };
    }
  }
}

// ---------- Beard and moustache ----------

function beard(g: Geo, p: Paint, a: Appearance, detail: Detail): string {
  const { cx, cy, w, h, mouthY } = g;
  const H = filled(p.hair, p.sw * 0.9, p.hairLine);
  const hole = `<ellipse cx="${n(cx)}" cy="${n(mouthY + 0.9)}" rx="4.6" ry="2.3" fill="${p.skin}"/>`;
  // The beard's outline: sideburns down the jaw to the chin, then back up along the cheeks.
  const full = (len: number, point = 0) =>
    `M${n(cx - w + 0.2)} ${n(cy + 0.02 * h)}L${n(cx - w + 0.4)} ${n(cy + 0.4 * h)}` +
    `C${n(cx - w + 0.8)} ${n(cy + 0.95 * h + len * 0.5)} ${n(cx - w * 0.45)} ${n(cy + 1.08 * h + len)} ${n(cx)} ${n(cy + 1.1 * h + len + point)}` +
    `C${n(cx + w * 0.45)} ${n(cy + 1.08 * h + len)} ${n(cx + w - 0.8)} ${n(cy + 0.95 * h + len * 0.5)} ${n(cx + w - 0.4)} ${n(cy + 0.4 * h)}` +
    `L${n(cx + w - 0.2)} ${n(cy + 0.02 * h)}L${n(cx + w - 2.6)} ${n(cy + 0.02 * h)}` +
    `C${n(cx + w - 2.8)} ${n(cy + 0.4 * h)} ${n(cx + 0.55 * w)} ${n(mouthY - 3.4)} ${n(cx + 0.3 * w)} ${n(mouthY - 2.4)}` +
    `Q${n(cx)} ${n(mouthY - 3.6)} ${n(cx - 0.3 * w)} ${n(mouthY - 2.4)}` +
    `C${n(cx - 0.55 * w)} ${n(mouthY - 3.4)} ${n(cx - w + 2.8)} ${n(cy + 0.4 * h)} ${n(cx - w + 2.6)} ${n(cy + 0.02 * h)}Z`;
  switch (a.beard) {
    case 'none':
      return '';
    case 'stubble':
      return `<path d="${full(0)}" fill="${p.hairShade}" opacity="${detail === 'sm' ? 0.3 : 0.24}"/>`;
    case 'short':
      return `<path d="${full(0.5)}" ${H}/>` + hole;
    case 'full':
      return `<path d="${full(4)}" ${H}/>` + hole + (detail === 'lg' ? `<path d="M${n(cx - 4)} ${n(cy + h + 3)}q1 2.4 0 4M${n(cx + 4)} ${n(cy + h + 3)}q-1 2.4 0 4M${n(cx)} ${n(cy + h + 4)}l0 4" ${stroked(p.hairShade, 0.8)}/>` : '');
    case 'long':
      return `<path d="${full(9, 5)}" ${H}/>` + hole + (detail === 'lg' ? `<path d="M${n(cx - 5)} ${n(cy + h + 2)}q1.4 5 0 10M${n(cx + 5)} ${n(cy + h + 2)}q-1.4 5 0 10M${n(cx)} ${n(cy + h + 4)}l0 10" ${stroked(p.hairShade, 0.8)}/>` : '');
    case 'goatee':
      return `<path d="M${n(cx - 4.4)} ${n(mouthY + 2.6)}Q${n(cx)} ${n(mouthY + 1.4)} ${n(cx + 4.4)} ${n(mouthY + 2.6)}Q${n(cx + 4.6)} ${n(cy + 1.06 * h)} ${n(cx)} ${n(cy + 1.12 * h)}Q${n(cx - 4.6)} ${n(cy + 1.06 * h)} ${n(cx - 4.4)} ${n(mouthY + 2.6)}Z" ${H}/>`;
    case 'vandyke':
      return `<path d="M${n(cx - 3.6)} ${n(mouthY + 2.8)}Q${n(cx)} ${n(mouthY + 1.8)} ${n(cx + 3.6)} ${n(mouthY + 2.8)}L${n(cx + 0.8)} ${n(cy + 1.2 * h)}L${n(cx)} ${n(cy + 1.26 * h)}L${n(cx - 0.8)} ${n(cy + 1.2 * h)}Z" ${H}/>`;
    case 'muttonchops': {
      const side = (s: number) => {
        const X = (u: number) => n(cx + s * u);
        return `<path d="M${X(w - 0.2)} ${n(cy + 0.02 * h)}L${X(w - 0.3)} ${n(cy + 0.55 * h)}C${X(w - 1)} ${n(cy + 0.8 * h)} ${X(w * 0.6)} ${n(mouthY + 2)} ${X(w * 0.4)} ${n(mouthY)}C${X(w * 0.55)} ${n(mouthY - 3)} ${X(w - 2.8)} ${n(cy + 0.3 * h)} ${X(w - 2.6)} ${n(cy + 0.02 * h)}Z" ${H}/>`;
      };
      return side(-1) + side(1);
    }
  }
}

function moustache(g: Geo, p: Paint, a: Appearance): string {
  const { cx, mouthY: y } = g;
  const H = filled(p.hair, p.sw * 0.8, p.hairLine);
  switch (a.moustache) {
    case 'none':
      return '';
    case 'thin':
      return `<path d="M${n(cx - 4.4)} ${n(y - 0.6)}Q${n(cx)} ${n(y - 3.2)} ${n(cx + 4.4)} ${n(y - 0.6)}" ${stroked(p.hair, 1.3)}/>`;
    case 'chevron':
      return `<path d="M${n(cx - 5)} ${n(y - 0.2)}Q${n(cx - 4.2)} ${n(y - 3.6)} ${n(cx)} ${n(y - 3.4)}Q${n(cx + 4.2)} ${n(y - 3.6)} ${n(cx + 5)} ${n(y - 0.2)}Q${n(cx)} ${n(y - 1.6)} ${n(cx - 5)} ${n(y - 0.2)}Z" ${H}/>`;
    case 'handlebar':
      return `<path d="M${n(cx)} ${n(y - 3.2)}Q${n(cx - 4.4)} ${n(y - 3.6)} ${n(cx - 6.4)} ${n(y - 1.2)}Q${n(cx - 7.6)} ${n(y - 3.4)} ${n(cx - 6)} ${n(y - 4.4)}Q${n(cx - 7)} ${n(y - 1.8)} ${n(cx - 4)} ${n(y - 1.4)}Q${n(cx)} ${n(y - 1.6)} ${n(cx + 4)} ${n(y - 1.4)}Q${n(cx + 7)} ${n(y - 1.8)} ${n(cx + 6)} ${n(y - 4.4)}Q${n(cx + 7.6)} ${n(y - 3.4)} ${n(cx + 6.4)} ${n(y - 1.2)}Q${n(cx + 4.4)} ${n(y - 3.6)} ${n(cx)} ${n(y - 3.2)}Z" ${H}/>`;
    case 'walrus':
      return `<path d="M${n(cx - 6)} ${n(y + 1.4)}Q${n(cx - 6.4)} ${n(y - 4.2)} ${n(cx)} ${n(y - 4)}Q${n(cx + 6.4)} ${n(y - 4.2)} ${n(cx + 6)} ${n(y + 1.4)}Q${n(cx + 3)} ${n(y - 0.2)} ${n(cx)} ${n(y + 0.2)}Q${n(cx - 3)} ${n(y - 0.2)} ${n(cx - 6)} ${n(y + 1.4)}Z" ${H}/>`;
  }
}

// ---------- Glasses ----------

function glasses(g: Geo, a: Appearance, detail: Detail): string {
  if (a.glasses === 'none') return '';
  const { cx, eyeY: y, dx, w } = g;
  const wire = a.era === 'c19' || a.era === 'c1900' ? '#a8802f' : '#3a2a22';
  const fw = detail === 'sm' ? 1.1 : 0.85;
  const F = stroked(wire, fw);
  const L = `fill="#fff" fill-opacity="${detail === 'sm' ? 0 : 0.14}" stroke="${wire}" stroke-width="${n(fw)}"`;
  const lens = (x: number) => {
    switch (a.glasses) {
      case 'round': return `<circle cx="${n(x)}" cy="${n(y)}" r="4" ${L}/>`;
      case 'oval': return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="4.5" ry="3.4" ${L}/>`;
      case 'square': return `<rect x="${n(x - 4.7)}" y="${n(y - 3.4)}" width="9.4" height="7" rx="1.6" ${L}/>`;
      case 'browline': return `<rect x="${n(x - 4.6)}" y="${n(y - 3.3)}" width="9.2" height="6.8" rx="2.2" ${L.replace(/stroke-width="[^"]+"/, 'stroke-width=".6"')}/><path d="M${n(x - 4.8)} ${n(y - 2.2)}Q${n(x)} ${n(y - 4.4)} ${n(x + 4.8)} ${n(y - 2.2)}" ${stroked('#2a1a14', 1.8)}/>`;
      default: return `<path d="M${n(x - 4.5)} ${n(y + 0.6)}Q${n(x)} ${n(y + 5)} ${n(x + 4.5)} ${n(y + 0.6)}Z" ${L}/>`;
    }
  };
  const r = a.glasses === 'round' ? 4 : 4.6;
  const by = a.glasses === 'half' ? y + 0.8 : y - 0.6;
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
};

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
  }
}

// ---------- The whole drawing ----------

/** Where the drawing sits: at list sizes the head is drawn larger, so a face still reads at 28px. */
const ZOOM: Record<Detail, string> = {
  sm: 'translate(50 47) scale(1.3) translate(-50 -47)',
  md: 'translate(50 50) scale(1.08) translate(-50 -50)',
  lg: 'translate(50 50) scale(1.08) translate(-50 -50)',
};

export function avatarSvg(a: Appearance, dress: Dress, detail: Detail): string {
  const g = geo(a);
  const p = paint(a, detail);
  const under = HAIR_UNDER[a.headwear] ?? 'all';
  // Hats sit on the hair; tall styles that would poke through are worn lower under them.
  let style = a.hairStyle;
  if (under !== 'all') style = under === 'fringe' ? 'chignon' : 'cropped';
  else if (a.headwear !== 'none' && a.headwear !== 'crown' && a.headwear !== 'circlet' && (style === 'bun' || style === 'quiff')) style = 'short';
  else if (a.headwear !== 'none' && a.headwear !== 'crown' && a.headwear !== 'circlet' && style === 'afro') style = 'curly';
  const hp = hair(g, p, a, style, detail);
  const hw = headwear(g, p, a, dress, detail);
  const head = headPath(g, a);
  const showHair = under !== 'none';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><clipPath id="hc"><path d="${head}"/></clipPath></defs>` +
    `<g${ZOOM[detail] ? ` transform="${ZOOM[detail]}"` : ''}>` +
    hw.back +
    (showHair && under === 'all' ? hp.back : '') +
    neckAndChest(g, p) +
    body(g, p, a, a.clothing, dress, detail) +
    (showHair && under === 'all' ? hp.overBody : '') +
    ears(g, p, a) +
    `<path d="${head}" ${filled(p.skin, p.sw, p.skinLine)}/>` +
    face(g, p, a, detail) +
    beard(g, p, a, detail) +
    mouth(g, p, a, detail) +
    moustache(g, p, a) +
    (showHair ? hp.front : '') +
    glasses(g, a, detail) +
    hw.front +
    `</g></svg>`
  );
}
