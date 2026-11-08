// The geometry of heraldry v2, in the v1 box: 100 wide, 120 tall, the fess point at 50,55.
// Shapes reach past the box and are clipped by the shield, so every shield shape can share them.
import type {
  ArmsLayer, ChargeArrangement, ChargeLayer, FieldDivision, OrdinaryKind, OrdinaryLayer, PartitionLine, ShieldShape,
} from '~/lib/seed-format';

export type Pt = [number, number];
const E = 14; // how far shapes reach past the box
export const BOX_W = 100;
export const BOX_H = 120;
export const CX = 50;
export const CY = 55;

// ---------- shields ----------

export const SHIELD_PATH: Record<ShieldShape, string> = {
  heater: 'M5 5H95V62C95 92 77 107 50 116C23 107 5 92 5 62Z',
  french: 'M5 5H95V96C95 105 90 108 81 108H63C56 108 51.5 111 50 116C48.5 111 44 108 37 108H19C10 108 5 105 5 96Z',
  iberian: 'M5 5H95V70C95 95 75 115 50 115C25 115 5 95 5 70Z',
  lozenge: 'M50 3L95 60L50 117L5 60Z',
  swiss: 'M5 3Q28 15 50 8Q72 15 95 3V62C95 92 77 107 50 116C23 107 5 92 5 62Z',
  kite: 'M50 3C76 3 95 13 95 33C95 62 73 95 50 117C27 95 5 62 5 33C5 13 24 3 50 3Z',
};

/** Flattens one of the paths above (absolute M, L, H, V, C, Q and Z only) into points about `step` apart. */
export function flatten(d: string, step = 2): Pt[] {
  const tokens = d.match(/[MLHVCQZ]|-?\d*\.?\d+/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cur: Pt = [0, 0];
  let cmd = '';
  const num = () => Number(tokens[i++]);
  const curve = (ctrl: Pt[], end: Pt) => {
    const all = [cur, ...ctrl, end];
    const len = all.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - all[k][0], p[1] - all[k][1]), 0);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      let ps = all;
      while (ps.length > 1) ps = ps.slice(1).map((p, j) => [ps[j][0] + (p[0] - ps[j][0]) * t, ps[j][1] + (p[1] - ps[j][1]) * t] as Pt);
      pts.push(ps[0]);
    }
    cur = end;
  };
  const line = (end: Pt) => {
    const len = Math.hypot(end[0] - cur[0], end[1] - cur[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) pts.push([cur[0] + ((end[0] - cur[0]) * k) / n, cur[1] + ((end[1] - cur[1]) * k) / n]);
    cur = end;
  };
  while (i < tokens.length) {
    if (/[A-Z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': cur = [num(), num()]; pts.push(cur); break;
      case 'L': line([num(), num()]); break;
      case 'H': line([num(), cur[1]]); break;
      case 'V': line([cur[0], num()]); break;
      case 'C': curve([[num(), num()], [num(), num()]], [num(), num()]); break;
      case 'Q': curve([[num(), num()]], [num(), num()]); break;
      case 'Z': if (pts.length) line(pts[0]); pts.pop(); break;
    }
  }
  return pts;
}

const signedArea = (p: Pt[]) => p.reduce((s, a, k) => { const b = p[(k + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

/**
 * The polygon moved `d` inwards (negative: outwards). Corners are mitred; points that fold back (closer to the
 * original edge than `d`, which happens next to a corner) are dropped, so the result never loops.
 */
const INSET_CACHE = new Map<string, Pt[]>();
export function inset(p: Pt[], d: number): Pt[] {
  const key = `${p.length}:${p[0]}:${p[p.length >> 1]}:${d}`;
  let r = INSET_CACHE.get(key);
  if (!r) {
    const raw = mitre(p, d);
    const min = Math.abs(d) - 0.4;
    r = raw.filter((q) => p.every((o) => Math.hypot(q[0] - o[0], q[1] - o[1]) >= min));
    INSET_CACHE.set(key, r);
  }
  return r;
}
function mitre(p: Pt[], d: number): Pt[] {
  const sign = signedArea(p) > 0 ? 1 : -1; // y points down: a positive area runs clockwise on screen
  const n = p.length;
  return p.map((b, k) => {
    const a = p[(k - 1 + n) % n];
    const c = p[(k + 1) % n];
    const n1 = normal(a, b, sign);
    const n2 = normal(b, c, sign);
    // The mitre: (n1 + n2) · d / (1 + n1·n2), capped at three times d.
    const f = d / Math.max(1 + n1[0] * n2[0] + n1[1] * n2[1], 0.3);
    let mx = (n1[0] + n2[0]) * f;
    let my = (n1[1] + n2[1]) * f;
    const ml = Math.hypot(mx, my);
    if (ml > Math.abs(d) * 3) { mx *= (Math.abs(d) * 3) / ml; my *= (Math.abs(d) * 3) / ml; }
    return [b[0] + mx, b[1] + my] as Pt;
  });
}
/** The unit normal of a→b pointing inside a polygon of the given orientation. */
function normal(a: Pt, b: Pt, sign: number): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [(-dy / l) * sign, (dx / l) * sign];
}

/** Shield outlines as points, for the bordure, the orle and charges set round the edge. */
const OUTLINE_CACHE = new Map<ShieldShape, Pt[]>();
export function outline(shape: ShieldShape): Pt[] {
  let p = OUTLINE_CACHE.get(shape);
  if (!p) OUTLINE_CACHE.set(shape, (p = flatten(SHIELD_PATH[shape], 1.5)));
  return p;
}

// ---------- lines of partition ----------

/** Each line repeats a pattern of (u along, v across) points. v is in units of the amplitude; +v is "outward". */
interface LineSpec { period: number; amp: number; pts: [number, number][] }
const smooth = (f: (t: number) => [number, number], n = 12) => Array.from({ length: n + 1 }, (_, k) => f(k / n));
const LINES: Record<Exclude<PartitionLine, 'straight'>, LineSpec> = {
  wavy: { period: 20, amp: 3.2, pts: smooth((t) => [t, Math.sin(2 * Math.PI * t)], 16) },
  nebuly: { period: 14, amp: 3.6, pts: smooth((t) => [t - 0.2 * Math.sin(4 * Math.PI * t), Math.sin(2 * Math.PI * t)], 24) },
  engrailed: { period: 10, amp: 3, pts: smooth((t) => [t, -Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))], 10) },
  invected: { period: 10, amp: 3, pts: smooth((t) => [t, Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))], 10) },
  indented: { period: 7, amp: 2.4, pts: [[0, -1], [0.5, 1], [1, -1]] },
  dancetty: { period: 32, amp: 7, pts: [[0, -1], [0.5, 1], [1, -1]] },
  embattled: { period: 12, amp: 3, pts: [[0, -1], [0.25, -1], [0.25, 1], [0.75, 1], [0.75, -1], [1, -1]] },
};

/**
 * Points along a→b in the given line. `out` is which side counts as outward (+1: the left of a→b on screen,
 * which for a clockwise polygon is outside). The pattern fits a whole number of periods, so it is symmetric.
 */
export function edge(a: Pt, b: Pt, line: PartitionLine, out = 1): Pt[] {
  if (line === 'straight') return [b];
  const spec = LINES[line];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return [b];
  const n = Math.max(1, Math.round(len / spec.period));
  const p = len / n;
  const ux = dx / len;
  const uy = dy / len;
  // The left normal of the direction on screen (y down): (uy, -ux).
  const nx = uy * out;
  const ny = -ux * out;
  const pts: Pt[] = [];
  for (let k = 0; k < n; k++) {
    for (let j = k === 0 ? 0 : 1; j < spec.pts.length; j++) {
      const [u, v] = spec.pts[j];
      const s = (k + u) * p;
      pts.push([a[0] + ux * s + nx * v * spec.amp, a[1] + uy * s + ny * v * spec.amp]);
    }
  }
  return pts;
}

/** Points along a closed curve in the given line, following its arc length. */
function alongCurve(curve: Pt[], line: PartitionLine, out: number): Pt[] {
  if (line === 'straight') return curve;
  const spec = LINES[line];
  const n = curve.length;
  const cum = [0];
  for (let k = 1; k <= n; k++) cum.push(cum[k - 1] + Math.hypot(curve[k % n][0] - curve[k - 1][0], curve[k % n][1] - curve[k - 1][1]));
  const total = cum[n];
  const periods = Math.max(3, Math.round(total / spec.period));
  const p = total / periods;
  const pos = (s: number): Pt => {
    s = ((s % total) + total) % total;
    let k = 1;
    while (k < n && cum[k] < s) k++;
    const a = curve[k - 1];
    const b = curve[k % n];
    const t = (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // The tangent is taken across a few units, so the pattern turns smoothly round corners instead of looping.
  const at = (s: number): { x: number; y: number; nx: number; ny: number } => {
    const [x, y] = pos(s);
    const a = pos(s - 4);
    const b = pos(s + 4);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / l;
    const uy = (b[1] - a[1]) / l;
    return { x, y, nx: uy * out, ny: -ux * out };
  };
  const pts: Pt[] = [];
  for (let k = 0; k < periods; k++) {
    for (let j = k === 0 ? 0 : 1; j < spec.pts.length; j++) {
      const [u, v] = spec.pts[j];
      const q = at(Math.min(total, (k + u) * p));
      pts.push([q.x + q.nx * v * spec.amp, q.y + q.ny * v * spec.amp]);
    }
  }
  return pts;
}

const fmt = (n: number) => Math.round(n * 100) / 100;
/** A closed path through the points. */
export const poly = (pts: Pt[]) => `M${pts.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')}Z`;

/** A polygon whose edges all follow the line. Edges are patterned outward (the polygon may wind either way). */
export function styledPolygon(corners: Pt[], line: PartitionLine): string {
  if (line === 'straight') return poly(corners);
  const out = signedArea(corners) > 0 ? 1 : -1;
  const pts: Pt[] = [corners[0]];
  for (let k = 0; k < corners.length; k++) pts.push(...edge(corners[k], corners[(k + 1) % corners.length], line, out));
  return poly(pts);
}

// ---------- field divisions ----------

/**
 * A division as painting instructions: fill the box with tincture 0, then paint each path in its tincture, in
 * order. Later paths may cover earlier ones, which keeps neighbouring regions sharing one exact edge.
 */
export interface Paint { t: number; d: string }

/** How many tinctures a division takes. */
export function tinctureCount(div: FieldDivision): number {
  if (div === 'plain') return 1;
  if (div === 'per-pall' || div === 'tierced-pale' || div === 'tierced-fess') return 3;
  return 2;
}

/** The region right of (or below) a line through the box, as a closed path: the line, then round the far side. */
function beyond(a: Pt, b: Pt, line: PartitionLine, far: Pt[], out = 1): string {
  return poly([a, ...edge(a, b, line, out), ...far]);
}

const BEND_DIR: Pt = (() => { const l = Math.hypot(90, 100); return [90 / l, 100 / l]; })();

export function divisionPaint(div: FieldDivision, line: PartitionLine, pieces = 6): Paint[] {
  const L = -E, R = BOX_W + E, T = -E, B = BOX_H + E;
  switch (div) {
    case 'plain': return [];
    case 'per-pale': return [{ t: 1, d: beyond([50, T], [50, B], line, [[R, B], [R, T]]) }];
    case 'per-fess': return [{ t: 1, d: beyond([L, 60], [R, 60], line, [[R, B], [L, B]], -1) }];
    // v1's per bend runs corner to corner of the box; the first tincture is the upper right.
    case 'per-bend': return [{ t: 1, d: beyond([-12, -14.4], [112, 134.4], line, [[L, B]], -1) }];
    case 'per-bend-sinister': return [{ t: 1, d: beyond([112, -14.4], [-12, 134.4], line, [[R, B]]) }];
    case 'per-saltire': return [
      { t: 1, d: poly([[-12, -14.4], ...edge([-12, -14.4], [50, 60], line), ...edge([50, 60], [-12, 134.4], line)]) },
      { t: 1, d: poly([[112, -14.4], ...edge([112, -14.4], [50, 60], line, -1), ...edge([50, 60], [112, 134.4], line, -1)]) },
    ];
    case 'quarterly': return [
      { t: 1, d: poly([[50, T], ...edge([50, T], [50, 60], line), ...edge([50, 60], [R, 60], line), [R, T]]) },
      { t: 1, d: poly([[L, 60], ...edge([L, 60], [50, 60], line, -1), ...edge([50, 60], [50, B], line, -1), [L, B]]) },
    ];
    case 'per-chevron': return [{ t: 1, d: poly([[L, 105], ...edge([L, 105], [50, 45], line), ...edge([50, 45], [R, 105], line), [R, B], [L, B]]) }];
    case 'per-pall': return [
      { t: 1, d: poly([[-12, -12.4], ...edge([-12, -12.4], [50, 56], line, -1), ...edge([50, 56], [50, B], line, -1), [L, B]]) },
      { t: 2, d: poly([[112, -12.4], ...edge([112, -12.4], [50, 56], line), ...edge([50, 56], [50, B], line), [R, B]]) },
    ];
    case 'tierced-pale': return [100 / 3, 200 / 3].map((x, k) => ({ t: k + 1, d: beyond([x, T], [x, B], line, [[R, B], [R, T]]) }));
    case 'tierced-fess': return [37, 74].map((y, k) => ({ t: k + 1, d: beyond([L, y], [R, y], line, [[R, B], [L, B]], -1) }));
    case 'gyronny': {
      // Eight gyrons round the fess point; the first tincture holds the one in dexter chief above the line.
      const c: Pt = [50, 58];
      const ends: Pt[] = [[50, T], [R + 20, T - 24], [R, 58], [R + 20, B + 24], [50, B], [L - 20, B + 24], [L, 58], [L - 20, T - 24]];
      return [0, 2, 4, 6].map((k) => ({ t: 1, d: poly([c, ...edge(c, ends[k], line), ends[(k + 1) % 8], ...edge(ends[(k + 1) % 8], c, 'straight')]) }));
    }
    case 'paly': {
      const n = clampPieces(pieces);
      return Array.from({ length: n - 1 }, (_, k) => ({ t: (k + 1) % 2, d: beyond([((k + 1) * 100) / n, T], [((k + 1) * 100) / n, B], line, [[R, B], [R, T]]) }));
    }
    case 'barry': {
      const n = clampPieces(pieces);
      const h = 116 / n;
      return Array.from({ length: n - 1 }, (_, k) => ({ t: (k + 1) % 2, d: beyond([L, 3 + (k + 1) * h], [R, 3 + (k + 1) * h], line, [[R, B], [L, B]], -1) }));
    }
    case 'bendy':
    case 'bendy-sinister': {
      // As v1: stripes across a 160-wide band turned 50.2° about the box centre.
      const n = clampPieces(pieces);
      const rot = ((div === 'bendy' ? 50.2 : -50.2) * Math.PI) / 180;
      const to = ([u, v]: Pt): Pt => [50 + u * Math.cos(rot) - v * Math.sin(rot), 60 + u * Math.sin(rot) + v * Math.cos(rot)];
      return Array.from({ length: n - 1 }, (_, k) => {
        const v = -80 + ((k + 1) * 160) / n;
        const a = to([-200, v]);
        const b = to([200, v]);
        const far = [to([200, 400]), to([-200, 400])];
        return { t: (k + 1) % 2, d: poly([a, ...edge(a, b, line, div === 'bendy' ? -1 : 1), ...far]) };
      });
    }
    case 'chequy': {
      const s = 100 / 6;
      const out: Paint[] = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2) out.push({ t: 1, d: poly([[c * s, r * s], [(c + 1) * s, r * s], [(c + 1) * s, (r + 1) * s], [c * s, (r + 1) * s]]) });
      return [{ t: 1, d: out.map((o) => o.d).join('') }];
    }
    case 'lozengy':
    case 'fusilly': {
      const w = div === 'lozengy' ? 20 : 14;
      const h = div === 'lozengy' ? 24 : 30;
      let d = '';
      for (let j = -1; j < BOX_H / (h / 2) + 2; j++) {
        if (j % 2 === 0) continue;
        for (let i = -1; i < BOX_W / w + 2; i++) {
          const cx = i * w + (j % 2 ? w / 2 : 0);
          const cy = (j * h) / 2;
          d += poly([[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]]);
        }
      }
      return [{ t: 1, d }];
    }
  }
}
export const clampPieces = (n: number) => Math.max(4, Math.min(10, Math.round(n) || 6));

// ---------- ordinaries ----------

export interface OrdinaryShape {
  /** The ordinary itself. Use fill-rule evenodd (the bordure and orle are rings). */
  d: string;
  /** Thin cotises either side, when asked for and the ordinary takes them. */
  cotises?: string;
}

/** Ordinaries that can be cotised. */
export const COTISABLE: ReadonlySet<OrdinaryKind> = new Set(['fess', 'pale', 'bend', 'bend-sinister', 'chevron']);

/** A band of half-width h along the line through c in direction u, reaching past the box. */
function band(c: Pt, u: Pt, h: number, line: PartitionLine, len = 110): string {
  const nx = -u[1], ny = u[0];
  const p = (s: number, o: number): Pt => [c[0] + u[0] * s + nx * o, c[1] + u[1] * s + ny * o];
  return styledPolygon([p(-len, -h), p(len, -h), p(len, h), p(-len, h)], line);
}

/** Arms radiating from c (any number, at any angles), each of half-width h: the cross, the saltire, the pall. */
function radiating(c: Pt, dirs: Pt[], h: number, line: PartitionLine, len = 110): string {
  const ang = (d: Pt) => Math.atan2(d[1], d[0]);
  const ds = [...dirs].sort((a, b) => ang(a) - ang(b));
  const pts: Pt[] = [];
  const n = ds.length;
  for (let k = 0; k < n; k++) {
    const d = ds[k];
    const next = ds[(k + 1) % n];
    const prev = ds[(k - 1 + n) % n];
    const perp = (toward: Pt): Pt => {
      const p: Pt = [-d[1], d[0]];
      return p[0] * toward[0] + p[1] * toward[1] >= 0 ? p : [-p[0], -p[1]];
    };
    const pp = perp(prev);
    const pn = perp(next);
    pts.push([c[0] + d[0] * len + pp[0] * h, c[1] + d[1] * len + pp[1] * h]);
    pts.push([c[0] + d[0] * len + pn[0] * h, c[1] + d[1] * len + pn[1] * h]);
    // The inner corner between this arm and the next.
    const sin = Math.abs(d[0] * next[1] - d[1] * next[0]) || 1;
    pts.push([c[0] + (h / sin) * (d[0] + next[0]), c[1] + (h / sin) * (d[1] + next[1])]);
  }
  return styledPolygon(pts, line);
}

const unit = (x: number, y: number): Pt => { const l = Math.hypot(x, y); return [x / l, y / l]; };

/** Chevron: the upper edge's apex at `top`, `w` thick, arms falling 0.8 per unit across. */
function chevron(top: number, w: number, line: PartitionLine): string {
  const y = (x: number, base: number) => base + 0.8 * Math.abs(x - 50);
  const L = -E, R = BOX_W + E;
  return styledPolygon([[L, y(L, top)], [50, top], [R, y(R, top)], [R, y(R, top + w)], [50, top + w], [L, y(L, top + w)]], line);
}

export function ordinaryShape(o: Pick<OrdinaryLayer, 'kind' | 'line' | 'cotised'>, shield: ShieldShape): OrdinaryShape {
  const L = -E, R = BOX_W + E, T = -E, B = BOX_H + E;
  const { line } = o;
  const cot = o.cotised && COTISABLE.has(o.kind);
  switch (o.kind) {
    case 'chief': return { d: styledPolygon([[L, T], [R, T], [R, 34], [L, 34]], line) };
    case 'base': return { d: styledPolygon([[L, 94], [R, 94], [R, B], [L, B]], line) };
    case 'fess': return { d: band([50, 55], [1, 0], 14, line), cotises: cot ? band([50, 35], [1, 0], 2, 'straight') + band([50, 75], [1, 0], 2, 'straight') : undefined };
    case 'pale': return { d: band([50, 55], [0, 1], 14, line, 130), cotises: cot ? band([30, 55], [0, 1], 2, 'straight', 130) + band([70, 55], [0, 1], 2, 'straight', 130) : undefined };
    case 'bend':
    case 'bend-sinister': {
      const u: Pt = o.kind === 'bend' ? BEND_DIR : [-BEND_DIR[0], BEND_DIR[1]];
      const n: Pt = [-u[1], u[0]];
      const off = (k: number): Pt => [50 + n[0] * k, 55 + n[1] * k];
      return { d: band([50, 55], u, 13, line, 130), cotises: cot ? band(off(-19), u, 2, 'straight', 130) + band(off(19), u, 2, 'straight', 130) : undefined };
    }
    case 'chevron': return { d: chevron(34, 24, line), cotises: cot ? chevron(25, 4, 'straight') + chevron(63, 4, 'straight') : undefined };
    case 'cross': return { d: radiating([50, 56], [[1, 0], [0, 1], [-1, 0], [0, -1]], 12, line) };
    case 'saltire': return { d: radiating([50, 60], [unit(100, 120), unit(-100, 120), unit(-100, -120), unit(100, -120)], 12, line) };
    case 'pall': return { d: radiating([50, 54], [unit(-50, -54), unit(50, -54), [0, 1]], 10, line) };
    case 'pile': return { d: styledPolygon([[24, T], [76, T], [50, 100]], line) };
    case 'canton': return { d: styledPolygon([[L, T], [42, T], [42, 42], [L, 42]], line) };
    case 'quarter': return { d: styledPolygon([[L, T], [50, T], [50, 60], [L, 60]], line) };
    case 'bordure': {
      const outer = inset(outline(shield), -6);
      const inner = inset(outline(shield), 10);
      return { d: poly(outer) + poly(alongCurve(inner, line, signedArea(inner) > 0 ? -1 : 1)) };
    }
    case 'orle': {
      const a = inset(outline(shield), 12);
      const b = inset(outline(shield), 19);
      const sa = signedArea(a) > 0 ? 1 : -1;
      return { d: poly(alongCurve(a, line, sa)) + poly(alongCurve(b, line, -sa)) };
    }
  }
}

// ---------- placing charges ----------

export interface Spot { x: number; y: number; s: number }

const row = (n: number, y: number, x0: number, x1: number, s: number): Spot[] =>
  Array.from({ length: n }, (_, i) => ({ x: n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1), y, s }));
const col = (n: number, x: number, y0: number, y1: number, s: number): Spot[] =>
  Array.from({ length: n }, (_, i) => ({ x, y: n === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * i) / (n - 1), s }));
const line = (n: number, a: Pt, b: Pt, s: number): Spot[] =>
  Array.from({ length: n }, (_, i) => { const t = n === 1 ? 0.5 : i / (n - 1); return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, s }; });

/** Which arrangements make sense for a count, the first being the usual one. */
export function arrangementsFor(count: number): ChargeArrangement[] {
  switch (count) {
    case 1: return ['auto', 'seme'];
    case 2: return ['auto', 'pale', 'fess', 'bend', 'bend-sinister', 'seme'];
    case 3: return ['auto', 'two-one', 'one-two', 'pale', 'fess', 'bend', 'bend-sinister', 'seme'];
    case 4: return ['auto', 'two-two', 'pale', 'fess', 'cross', 'orle', 'seme'];
    case 5: return ['auto', 'saltire', 'cross', 'pale', 'fess', 'orle', 'seme'];
    case 6: return ['auto', 'three-two-one', 'orle', 'seme'];
    default: return ['auto', 'orle', 'seme'];
  }
}

/** Charges on the open field, in an empty field 5..95 × 5..105. */
function fieldSpots(n: number, arr: ChargeArrangement, shield: ShieldShape): Spot[] {
  const a = arr === 'auto' ? (n === 1 ? 'one' : n === 2 ? 'pale' : n === 3 ? 'two-one' : n === 4 ? 'two-two' : n === 5 ? 'saltire' : n === 6 ? 'three-two-one' : 'orle') : arr;
  const s = n <= 1 ? 50 : n === 2 ? 34 : n === 3 ? 31 : n <= 5 ? 26 : 22;
  switch (a) {
    case 'one': return [{ x: 50, y: 55, s: 50 }];
    case 'pale': return col(n, 50, n === 2 ? 31 : 22, n === 2 ? 80 : 88, Math.min(s, 90 / n));
    case 'fess': return row(n, 55, n === 2 ? 29 : 20, n === 2 ? 71 : 80, Math.min(s, 80 / n));
    case 'bend': return line(n, [22, 24], [76, 86], Math.min(s, 30));
    case 'bend-sinister': return line(n, [78, 24], [24, 86], Math.min(s, 30));
    case 'two-one': return [{ x: 29, y: 32, s }, { x: 71, y: 32, s }, { x: 50, y: 79, s }].slice(0, n);
    case 'one-two': return [{ x: 50, y: 29, s }, { x: 31, y: 73, s: s * 0.92 }, { x: 69, y: 73, s: s * 0.92 }].slice(0, n);
    case 'two-two': return [{ x: 30, y: 32, s }, { x: 70, y: 32, s }, { x: 31, y: 77, s }, { x: 69, y: 77, s }].slice(0, n);
    case 'saltire': return [{ x: 25, y: 26, s: 24 }, { x: 75, y: 26, s: 24 }, { x: 50, y: 55, s: 24 }, { x: 30, y: 85, s: 22 }, { x: 70, y: 85, s: 22 }].slice(0, n);
    case 'cross': return [{ x: 50, y: 22, s: 24 }, { x: 21, y: 55, s: 24 }, { x: 50, y: 55, s: 24 }, { x: 79, y: 55, s: 24 }, { x: 50, y: 89, s: 24 }].filter((_, i) => n === 5 || i !== 2).slice(0, n);
    case 'three-two-one': return [...row(3, 26, 22, 78, 21), ...row(2, 54, 35, 65, 21), { x: 50, y: 83, s: 21 }].slice(0, n);
    case 'orle': return orleSpots(n, shield, 15, n > 8 ? 11 : 13);
    default: return [{ x: 50, y: 55, s: 50 }];
  }
}

/** Spots evenly round the shield, `d` in from the edge. */
function orleSpots(n: number, shield: ShieldShape, d: number, s: number): Spot[] {
  const c = inset(outline(shield), d);
  const cum = [0];
  for (let k = 1; k <= c.length; k++) cum.push(cum[k - 1] + Math.hypot(c[k % c.length][0] - c[k - 1][0], c[k % c.length][1] - c[k - 1][1]));
  const total = cum[c.length];
  // Start at the middle of the top edge, so the arrangement is symmetric.
  const top = c.reduce((best, p, k) => (Math.abs(p[0] - 50) + p[1] * 3 < Math.abs(c[best][0] - 50) + c[best][1] * 3 ? k : best), 0);
  const start = cum[top] + total / n / 2;
  return Array.from({ length: n }, (_, i) => {
    const sAt = (start + (total * i) / n) % total;
    let k = 1;
    while (k < c.length && cum[k] < sAt) k++;
    const a = c[k - 1], b = c[k % c.length];
    const t = (sAt - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, s };
  });
}

/** Semé: small charges strewn over the whole box, every other row shifted. */
function semeSpots(): Spot[] {
  const out: Spot[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) out.push({ x: c * 17 + (r % 2 ? 8.5 : 0), y: 4 + r * 16, s: 10 });
  return out;
}

// ---------- charges on a narrow ordinary ----------

/**
 * The narrow ordinaries as the charges see them: a centre, the arms leaving it (unit directions, in the order
 * they take charges), and the arms' half-width, as ordinaryShape draws them. A band (fess, pale, bend) is two arms
 * back to back. `centre` says how many charges make one stand on the centre: n odd for two and four arms.
 */
type NarrowKind = 'fess' | 'pale' | 'bend' | 'bend-sinister' | 'chevron' | 'cross' | 'saltire' | 'pall';
interface Narrow { c: Pt; arms: Pt[]; h: number; band?: boolean; centre: (n: number) => boolean }
const odd = (n: number) => n % 2 === 1;
const CHEVRON_ARM = unit(1, 0.8);
const NARROW: Record<NarrowKind, Narrow> = {
  fess: { c: [50, 55], arms: [[-1, 0], [1, 0]], h: 14, band: true, centre: odd },
  pale: { c: [50, 57], arms: [[0, -1], [0, 1]], h: 14, band: true, centre: odd },
  bend: { c: [50, 55], arms: [[-BEND_DIR[0], -BEND_DIR[1]], BEND_DIR], h: 13, band: true, centre: odd },
  'bend-sinister': { c: [50, 55], arms: [[BEND_DIR[0], -BEND_DIR[1]], [-BEND_DIR[0], BEND_DIR[1]]], h: 13, band: true, centre: odd },
  // The chevron is 24 deep measured straight down; across its slanted arms that is 24 · cos(atan 0.8).
  chevron: { c: [50, 46], arms: [[-CHEVRON_ARM[0], CHEVRON_ARM[1]], CHEVRON_ARM], h: 12 * CHEVRON_ARM[0], centre: odd },
  cross: { c: [50, 56], arms: [[-1, 0], [1, 0], [0, -1], [0, 1]], h: 12, centre: odd },
  saltire: { c: [50, 60], arms: [unit(-100, -120), unit(100, -120), unit(-100, 120), unit(100, 120)], h: 12, centre: odd },
  pall: { c: [50, 54], arms: [unit(-50, -54), unit(50, -54), [0, 1]], h: 10, centre: (n) => n % 3 === 1 },
};

/** How much of the ordinary's width a charge may fill: the glyphs carry their own margin, so a little short of all. */
export const NARROW_FILL = 0.9;
/** Room kept clear inside the shield's edge, where the rim is drawn. */
const RIM = 3;
/** How deep each line of partition bites into an ordinary, so the charges keep clear of its teeth. */
const BITE: Record<PartitionLine, number> = { straight: 0, wavy: 2.6, nebuly: 3, engrailed: 2.4, invected: 0, indented: 2, dancetty: 4, embattled: 2.4 };

/** The largest charge that fits across an arm of half-width h. */
export const fitAcross = (h: number) => 2 * h * NARROW_FILL;

/** True when a disc of radius r at p lies inside the shield. */
function inShield(p: Pt, r: number, shield: ShieldShape): boolean {
  const o = outline(shield);
  let inside = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const a = o[i], b = o[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) < r) return false;
  }
  return inside;
}

/** How far along u from c a charge of size s can stand and stay inside the shield. */
function reach(c: Pt, u: Pt, s: number, shield: ShieldShape): number {
  const r = (s / 2) * NARROW_FILL + RIM;
  let t = 0;
  while (t < 140 && inShield([c[0] + u[0] * (t + 0.5), c[1] + u[1] * (t + 0.5)], r, shield)) t += 0.5;
  return t;
}

/**
 * Charges on a fess, pale, bend, chevron, cross, saltire or pall. Each is as large as the arm it sits on allows,
 * smaller only when there are too many to fit along it, and never past the edge of the shield.
 */
function onNarrow(kind: NarrowKind, n: number, shield: ShieldShape, line: PartitionLine): Spot[] {
  const g = NARROW[kind];
  const h = g.h - BITE[line];
  const centre = g.centre(n);
  const per = g.arms.map(() => 0);
  for (let i = 0; i < n - (centre ? 1 : 0); i++) per[i % g.arms.length]++;
  const s0 = fitAcross(h);
  // Where an arm's charges may start: at the centre for a band, which is one straight line; clear of the
  // crossing for the others, whose arms meet there.
  const start = (k: number) => (g.band || centre || k === 0 ? 0 : h);
  const layout = (s: number) => g.arms.map((u, i) => {
    const k = per[i];
    if (!k) return { u, k, step: Infinity, a: 0 };
    // A band's two halves share one spacing, so the row stays even across the middle.
    const far = g.band ? Math.min(...g.arms.map((v) => reach(g.c, v, s, shield))) : reach(g.c, u, s, shield);
    const a = start(k);
    const room = far - a;
    // With a charge on the centre the last one is k steps out; without, the first is half a step out.
    const step = Math.min(s0 * 1.3, room / (centre ? k : k - 0.5));
    return { u, k, step, a };
  });
  // The spacing caps the size, and the size moves the edge of the shield: settle the two in a few rounds.
  let s = s0;
  let arms = layout(s);
  for (let r = 0; r < 4; r++) {
    const step = Math.min(...arms.map((a) => a.step));
    const next = Math.min(s0, step / 1.08);
    if (Math.abs(next - s) < 0.05) break;
    s = next;
    arms = layout(s);
  }
  const out: Spot[] = centre ? [{ x: g.c[0], y: g.c[1], s }] : [];
  const step = g.band ? Math.min(...arms.map((a) => a.step)) : undefined;
  for (const { u, k, a, step: own } of arms) {
    const d = step ?? own;
    for (let j = 0; j < k; j++) {
      const t = a + (centre ? j + 1 : j + 0.5) * d;
      out.push({ x: g.c[0] + u[0] * t, y: g.c[1] + u[1] * t, s });
    }
  }
  // Reading order: top to bottom, then left to right.
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

/** Charges set on an ordinary, along its length. */
function onOrdinary(o: Pick<OrdinaryLayer, 'kind' | 'line'>, n: number, shield: ShieldShape): Spot[] {
  const { kind } = o;
  if (kind in NARROW) return onNarrow(kind as NarrowKind, n, shield, o.line);
  switch (kind) {
    case 'chief': return inChief(n);
    case 'base': return row(n, 106, n === 1 ? 50 : 30, n === 1 ? 50 : 70, 15);
    case 'pile': return col(n, 50, 18, n === 1 ? 18 : 18 + Math.min(22 * (n - 1), 52), n === 1 ? 26 : 18).map((p, i) => ({ ...p, s: p.s * (1 - i * 0.12) }));
    case 'canton': return [{ x: 21, y: 22, s: 28 }];
    case 'quarter': return [{ x: 26, y: 30, s: 36 }];
    case 'bordure': return orleSpots(n < 3 ? 8 : n, shield, 2, 9);
    case 'orle': return orleSpots(n < 3 ? 8 : n, shield, 15.5, 6);
    default: return [];
  }
}

const inChief = (n: number): Spot[] => row(n, 19, n === 1 ? 50 : n === 2 ? 30 : 20, n === 1 ? 50 : n === 2 ? 70 : 80, n <= 3 ? 22 : 18);

/** Field charges set round a central ordinary ("a fess between three mullets"), when the usual arrangement is asked for. */
function between(kind: OrdinaryKind, n: number): Spot[] | undefined {
  switch (kind) {
    case 'fess':
      if (n === 2) return [{ x: 50, y: 21, s: 24 }, { x: 50, y: 90, s: 24 }];
      if (n === 3) return [{ x: 29, y: 21, s: 22 }, { x: 71, y: 21, s: 22 }, { x: 50, y: 91, s: 22 }];
      if (n === 6) return [...row(3, 21, 22, 78, 17), ...row(2, 84, 34, 66, 17), { x: 50, y: 102, s: 13 }];
      return undefined;
    case 'chevron':
      if (n === 2) return [{ x: 25, y: 25, s: 24 }, { x: 75, y: 25, s: 24 }];
      if (n === 3) return [{ x: 25, y: 25, s: 23 }, { x: 75, y: 25, s: 23 }, { x: 50, y: 88, s: 25 }];
      return undefined;
    case 'bend':
      if (n === 2) return [{ x: 75, y: 27, s: 25 }, { x: 25, y: 81, s: 25 }];
      return undefined;
    case 'bend-sinister':
      if (n === 2) return [{ x: 25, y: 27, s: 25 }, { x: 75, y: 81, s: 25 }];
      return undefined;
    case 'pale':
      if (n === 2) return [{ x: 21, y: 52, s: 24 }, { x: 79, y: 52, s: 24 }];
      if (n === 4) return [{ x: 21, y: 30, s: 22 }, { x: 79, y: 30, s: 22 }, { x: 23, y: 76, s: 22 }, { x: 77, y: 76, s: 22 }];
      return undefined;
    case 'cross':
      if (n === 4) return [{ x: 23, y: 25, s: 22 }, { x: 77, y: 25, s: 22 }, { x: 24, y: 85, s: 20 }, { x: 76, y: 85, s: 20 }];
      return undefined;
    case 'saltire':
      if (n === 4) return [{ x: 50, y: 22, s: 20 }, { x: 18, y: 60, s: 19 }, { x: 82, y: 60, s: 19 }, { x: 50, y: 99, s: 18 }];
      return undefined;
    case 'pile':
      if (n === 2) return [{ x: 19, y: 70, s: 20 }, { x: 81, y: 70, s: 20 }];
      return undefined;
    default:
      return undefined;
  }
}

/** True when field charges stand round this ordinary ("between"), rather than over it. */
export const standsBetween = (kind: OrdinaryKind, n: number) => !!between(kind, n);
/** Ordinaries that cross the fess point, so a lone central charge lies over them. */
export const CENTRAL: ReadonlySet<OrdinaryKind> = new Set(['fess', 'pale', 'bend', 'bend-sinister', 'cross', 'saltire', 'pall', 'chevron']);

/**
 * Where each charge of a layer goes, given everything painted before it. Field charges keep clear of a chief,
 * a base and a bordure, and stand round a central ordinary when their arrangement is "auto".
 */
export function placeCharges(layer: ChargeLayer, before: ArmsLayer[], shield: ShieldShape): Spot[] {
  const n = Math.max(1, Math.min(9, Math.round(layer.count) || 1));
  const k = layer.scale ?? 1;
  const scaled = (ss: Spot[]) => ss.map((p) => ({ ...p, s: p.s * k }));
  if (layer.arrangement === 'seme') return scaled(semeSpots());
  const ords = before.filter((l): l is OrdinaryLayer => l.type === 'ordinary');
  if (layer.on === 'chief') return scaled(inChief(n));
  // In base: one charge low and wide (a mount, a wave), several in a row.
  if (layer.on === 'base') return scaled(n === 1 ? [{ x: 50, y: 92, s: 62 }] : row(n, 98, 50 - 12 * (n - 1), 50 + 12 * (n - 1), Math.min(20, 70 / n)));
  if (layer.on === 'ordinary') {
    const o = ords[ords.length - 1];
    if (o) return scaled(onOrdinary(o, n, shield));
  }
  const central = ords.find((o) => !['chief', 'base', 'bordure', 'orle', 'canton', 'quarter'].includes(o.kind));
  let spots = (layer.arrangement === 'auto' && central && between(central.kind, n)) || fieldSpots(n, layer.arrangement, shield);
  // Make room for a chief or base: squeeze the field's spots into what is left.
  const top = ords.some((o) => o.kind === 'chief') ? 36 : 5;
  const bottom = ords.some((o) => o.kind === 'base') ? 92 : 105;
  if (top > 5 || bottom < 105) {
    const f = (bottom - top) / 100;
    spots = spots.map((p) => ({ x: 50 + (p.x - 50) * Math.max(f, 0.8), y: top + (p.y - 5) * f, s: p.s * Math.max(f, 0.7) }));
  }
  if (ords.some((o) => o.kind === 'bordure' || o.kind === 'orle')) spots = spots.map((p) => ({ x: 50 + (p.x - 50) * 0.84, y: 57 + (p.y - 57) * 0.84, s: p.s * 0.85 }));
  if (ords.some((o) => o.kind === 'canton' || o.kind === 'quarter') && n === 1) spots = spots.map((p) => ({ ...p, x: p.x + 6, y: p.y + 8, s: p.s * 0.85 }));
  return scaled(spots);
}
