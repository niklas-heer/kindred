// Drawn pictures for the invented families' feed and gallery: a lake, a boat, a garden, a street, a door, a castle.
// No photograph of anyone goes into a seed, so the pictures a seeded post carries are painted here, from a seed, as
// PNG files: flat shapes in a few colours, like the app's drawn portraits. Same scene and seed, same picture.
// Node only (zlib). scripts/seed.ts writes them into a family's media folder as gallery pictures with their small copies.
import { crc32, deflateSync } from 'node:zlib';
import { mulberry32, type Rng } from './rng.ts';

export const SCENES = ['lake', 'boat', 'garden', 'street', 'door', 'table', 'castle', 'falcon'] as const;
export type Scene = (typeof SCENES)[number];
export interface Picture { png: Uint8Array; width: number; height: number }

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A canvas in its own units (0..w, 0..h), painted at twice the size and halved at the end, so edges are soft. */
class Canvas {
  readonly w: number;
  readonly h: number;
  private readonly s = 2;
  private readonly px: Float32Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Float32Array(w * this.s * h * this.s * 3);
  }
  /** Paints every point of a box for which `inside` holds, with the colour `at` gives (and its strength, 0..1). */
  paint(x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => boolean, at: Rgb | ((x: number, y: number) => Rgb), alpha = 1) {
    const s = this.s, W = this.w * s, H = this.h * s;
    const ax = Math.max(0, Math.floor(x0 * s)), bx = Math.min(W, Math.ceil(x1 * s));
    const ay = Math.max(0, Math.floor(y0 * s)), by = Math.min(H, Math.ceil(y1 * s));
    for (let j = ay; j < by; j++) {
      for (let i = ax; i < bx; i++) {
        const x = (i + 0.5) / s, y = (j + 0.5) / s;
        if (!inside(x, y)) continue;
        const c = typeof at === 'function' ? at(x, y) : at;
        const o = (j * W + i) * 3;
        this.px[o] = this.px[o]! + (c[0] - this.px[o]!) * alpha;
        this.px[o + 1] = this.px[o + 1]! + (c[1] - this.px[o + 1]!) * alpha;
        this.px[o + 2] = this.px[o + 2]! + (c[2] - this.px[o + 2]!) * alpha;
      }
    }
  }
  /** Top to bottom, from one colour to the next between y0 and y1. */
  wash(y0: number, y1: number, top: Rgb, bottom: Rgb) {
    this.paint(0, y0, this.w, y1, () => true, (_x, y) => mix(top, bottom, (y - y0) / (y1 - y0)));
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb, alpha = 1) { this.paint(x, y, x + w, y + h, () => true, c, alpha); }
  disc(cx: number, cy: number, r: number, c: Rgb, alpha = 1) { this.paint(cx - r, cy - r, cx + r, cy + r, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, c, alpha); }
  oval(cx: number, cy: number, rx: number, ry: number, c: Rgb, alpha = 1) { this.paint(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c, alpha); }
  /** A filled triangle. */
  tri(a: [number, number], b: [number, number], c: [number, number], col: Rgb, alpha = 1) {
    const side = (p: [number, number], q: [number, number], x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    this.paint(Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), (x, y) => {
      const d1 = side(a, b, x, y), d2 = side(b, c, x, y), d3 = side(c, a, x, y);
      return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
    }, col, alpha);
  }
  /** Everything below a line that rolls across the picture: hills, a shore, a hedge. */
  land(top: (x: number) => number, bottom: number, c: Rgb | ((x: number, y: number) => Rgb), alpha = 1) {
    this.paint(0, 0, this.w, bottom, (x, y) => y >= top(x), c, alpha);
  }
  /** The finished picture as RGB bytes at its own size. */
  bytes(): Uint8Array {
    const s = this.s, W = this.w * s;
    const out = new Uint8Array(this.w * this.h * 3);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) sum += this.px[((y * s + j) * W + x * s + i) * 3 + k]!;
          out[(y * this.w + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(sum / (s * s))));
        }
      }
    }
    return out;
  }
}

/** A line that rolls: a few sine waves, the same for the same seed. */
function rolling(rng: Rng, base: number, height: number, width: number): (x: number) => number {
  const waves = Array.from({ length: 4 }, (_, i) => ({ f: (i + 1) * (0.6 + rng.next() * 0.9) / width, p: rng.next() * 6.28, a: height / (i + 1.5) }));
  return (x) => base + waves.reduce((sum, w) => sum + Math.sin(x * w.f * 6.28 + w.p) * w.a, 0);
}

function sun(c: Canvas, x: number, y: number, r: number, col: Rgb) {
  c.disc(x, y, r * 2.6, col, 0.1);
  c.disc(x, y, r * 1.7, col, 0.18);
  c.disc(x, y, r, col);
}

function pine(c: Canvas, x: number, base: number, h: number, col: Rgb) {
  c.rect(x - h * 0.03, base - h * 0.2, h * 0.06, h * 0.2, hex('#4a3a2c'));
  for (let i = 0; i < 3; i++) c.tri([x, base - h + i * h * 0.22], [x - h * (0.16 + i * 0.07), base - h * 0.18 + (i - 2) * h * 0.2], [x + h * (0.16 + i * 0.07), base - h * 0.18 + (i - 2) * h * 0.2], col);
}

function paintScene(scene: Scene, rng: Rng, w: number, h: number): Canvas {
  const c = new Canvas(w, h);
  if (scene === 'lake') {
    c.wash(0, h * 0.55, hex('#9cc4e4'), hex('#f6e3c0'));
    sun(c, w * (0.6 + rng.next() * 0.25), h * 0.3, h * 0.055, hex('#fff3cf'));
    c.land(rolling(rng, h * 0.44, h * 0.05, w), h * 0.56, hex('#8fa6b8'));
    c.land(rolling(rng, h * 0.5, h * 0.035, w), h * 0.56, hex('#5f7f7a'));
    c.wash(h * 0.55, h, hex('#7fb0c9'), hex('#2f5d7c'));
    for (let i = 0; i < 26; i++) { const y = h * (0.58 + rng.next() * 0.4); c.rect(rng.next() * w, y, w * (0.04 + rng.next() * 0.1), h * 0.004, hex('#eaf6fb'), 0.35); }
    for (let i = 0; i < 5; i++) pine(c, w * (0.04 + i * 0.045 + rng.next() * 0.01), h * (0.57 + i * 0.004), h * (0.2 + rng.next() * 0.08), hex('#2f4a3a'));
    // A jetty, and someone's towel on it.
    c.rect(w * 0.56, h * 0.78, w * 0.3, h * 0.022, hex('#b08a5a'));
    for (let i = 0; i < 4; i++) c.rect(w * (0.58 + i * 0.085), h * 0.78, w * 0.012, h * 0.1, hex('#7d5e3c'));
    c.rect(w * 0.7, h * 0.768, w * 0.07, h * 0.014, hex('#d8553f'));
  } else if (scene === 'boat') {
    c.wash(0, h * 0.5, hex('#bfe0f2'), hex('#e9f3ee'));
    for (let i = 0; i < 4; i++) c.oval(w * (0.15 + rng.next() * 0.7), h * (0.1 + rng.next() * 0.2), w * (0.08 + rng.next() * 0.06), h * 0.03, hex('#ffffff'), 0.8);
    c.wash(h * 0.5, h, hex('#3f8fb5'), hex('#1d4f73'));
    for (let i = 0; i < 30; i++) c.rect(rng.next() * w, h * (0.52 + rng.next() * 0.46), w * (0.03 + rng.next() * 0.07), h * 0.004, hex('#d9f0fa'), 0.4);
    const x = w * (0.4 + rng.next() * 0.2), y = h * 0.62;
    c.tri([x - w * 0.16, y], [x + w * 0.17, y], [x + w * 0.11, y + h * 0.07], hex('#8a3b2a'));
    c.tri([x - w * 0.16, y], [x - w * 0.1, y + h * 0.07], [x + w * 0.11, y + h * 0.07], hex('#8a3b2a'));
    c.rect(x - w * 0.004, y - h * 0.4, w * 0.008, h * 0.4, hex('#5a4630'));
    c.tri([x + w * 0.012, y - h * 0.39], [x + w * 0.012, y - h * 0.03], [x + w * 0.15, y - h * 0.03], hex('#fbf6ea'));
    c.tri([x - w * 0.012, y - h * 0.33], [x - w * 0.012, y - h * 0.03], [x - w * 0.12, y - h * 0.03], hex('#f0d9a8'));
    c.disc(x + w * 0.03, y - h * 0.035, h * 0.022, hex('#33475b'));
  } else if (scene === 'garden') {
    c.wash(0, h * 0.6, hex('#a9d3ee'), hex('#eaf4e6'));
    c.land(rolling(rng, h * 0.52, h * 0.03, w), h * 0.62, hex('#7fae74'));
    c.wash(h * 0.6, h, hex('#6fa860'), hex('#3f7a43'));
    for (let i = 0; i < 12; i++) c.rect(w * (i / 12) + w * 0.01, h * 0.5, w * 0.012, h * 0.13, hex('#f3ead7'));
    c.rect(0, h * 0.54, w, h * 0.012, hex('#f3ead7'));
    const x = w * (0.3 + rng.next() * 0.3);
    c.rect(x - w * 0.02, h * 0.42, w * 0.04, h * 0.36, hex('#6a4b33'));
    for (const [dx, dy, r] of [[0, 0, 0.17], [-0.11, 0.04, 0.12], [0.12, 0.03, 0.13], [0.03, -0.08, 0.12]] as const) c.disc(x + w * dx, h * (0.34 + dy), h * r, hex('#3f7f45'));
    for (let i = 0; i < 16; i++) c.disc(x + w * (rng.next() * 0.34 - 0.17), h * (0.24 + rng.next() * 0.22), h * 0.012, hex('#c9402f'));
    for (let i = 0; i < 40; i++) c.disc(rng.next() * w, h * (0.68 + rng.next() * 0.3), h * 0.006, rng.pick([hex('#f6d743'), hex('#ffffff'), hex('#e58fb0')]));
  } else if (scene === 'street') {
    c.wash(0, h * 0.82, hex('#f4b77a'), hex('#f7e3bd'));
    sun(c, w * 0.78, h * 0.5, h * 0.06, hex('#fff1c9'));
    const fronts = [hex('#c96f4a'), hex('#e3c56d'), hex('#7d9aa8'), hex('#b5574f'), hex('#d9d2c0'), hex('#8fa37a')];
    let x = -w * 0.02;
    while (x < w) {
      const bw = w * (0.13 + rng.next() * 0.07), bh = h * (0.34 + rng.next() * 0.2), top = h * 0.8 - bh;
      const col = rng.pick(fronts);
      c.rect(x, top, bw, bh, col);
      c.tri([x - bw * 0.04, top], [x + bw * 1.04, top], [x + bw / 2, top - bh * 0.22], hex('#6b3f33'));
      for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) c.rect(x + bw * (0.18 + k * 0.42), top + bh * (0.12 + r * 0.27), bw * 0.22, bh * 0.15, rng.chance(0.5) ? hex('#ffe9a8') : hex('#3b4a5c'));
      c.rect(x + bw * 0.4, h * 0.8 - bh * 0.2, bw * 0.2, bh * 0.2, hex('#3d2f2a'));
      x += bw + w * 0.004;
    }
    c.wash(h * 0.8, h, hex('#8d8478'), hex('#5d564e'));
    for (let i = 0; i < 9; i++) c.rect(w * (0.03 + i * 0.115), h * 0.9, w * 0.06, h * 0.008, hex('#e9e2cf'), 0.7);
  } else if (scene === 'door') {
    const brick = hex('#b8674a'), mortar = hex('#d9c4a9');
    c.rect(0, 0, w, h, mortar);
    const bh = h / 16, bw = w / 7;
    for (let r = 0; r < 17; r++) for (let k = -1; k < 8; k++) {
      const shade = 0.82 + rng.next() * 0.3;
      c.rect(k * bw + (r % 2 ? bw / 2 : 0) + 2, r * bh + 2, bw - 4, bh - 4, [brick[0] * shade, brick[1] * shade, brick[2] * shade]);
    }
    const dw = w * 0.36, dx = (w - dw) / 2, dy = h * 0.2;
    c.rect(dx - w * 0.03, dy - h * 0.03, dw + w * 0.06, h * 0.83, hex('#efe6d2'));
    c.rect(dx, dy, dw, h * 0.8, hex('#2f6b4a'));
    for (const [px, py] of [[0.1, 0.06], [0.55, 0.06], [0.1, 0.48], [0.55, 0.48]] as const) c.rect(dx + dw * px, dy + h * 0.8 * py, dw * 0.35, h * 0.8 * 0.36, hex('#27593d'));
    c.disc(dx + dw * 0.88, dy + h * 0.42, h * 0.016, hex('#e0b64d'));
    c.rect(0, h * 0.97, w, h * 0.03, hex('#6f675d'));
    c.oval(dx - w * 0.12, h * 0.9, w * 0.07, h * 0.07, hex('#3f7f45'));
    c.rect(dx - w * 0.16, h * 0.9, w * 0.08, h * 0.08, hex('#a2553a'));
  } else if (scene === 'table') {
    c.rect(0, 0, w, h, hex('#e9dcc3'));
    for (let i = 0; i < 9; i++) c.rect(0, h * (i / 9), w, h * 0.004, hex('#d5c4a3'));
    c.oval(w / 2, h / 2, w * 0.44, h * 0.4, hex('#f7f1e3'));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.28 + rng.next() * 0.2, px = w / 2 + Math.cos(a) * w * 0.3, py = h / 2 + Math.sin(a) * h * 0.27;
      c.disc(px, py, h * 0.085, hex('#ffffff'));
      c.disc(px, py, h * 0.06, rng.pick([hex('#d9a441'), hex('#b8573c'), hex('#7f9c5a'), hex('#e9cf8a')]));
    }
    c.disc(w / 2, h / 2, h * 0.11, hex('#8a5a3a'));
    c.disc(w / 2, h / 2, h * 0.09, hex('#d98d4a'));
    for (let i = 0; i < 9; i++) c.disc(w / 2 + (rng.next() - 0.5) * h * 0.13, h / 2 + (rng.next() - 0.5) * h * 0.13, h * 0.012, hex('#7a2d1f'));
  } else if (scene === 'castle') {
    c.wash(0, h * 0.7, hex('#8e9db5'), hex('#e8d9b8'));
    c.land(rolling(rng, h * 0.6, h * 0.05, w), h * 0.75, hex('#7b8c74'));
    const stone = hex('#b9ad98'), dark = hex('#8d826f');
    const x = w * 0.28, base = h * 0.72;
    c.rect(x, base - h * 0.26, w * 0.44, h * 0.26, stone);
    for (let i = 0; i < 9; i++) c.rect(x + w * (i * 0.05), base - h * 0.29, w * 0.03, h * 0.03, stone);
    for (const tx of [x - w * 0.05, x + w * 0.39]) {
      c.rect(tx, base - h * 0.42, w * 0.1, h * 0.42, dark);
      for (let i = 0; i < 3; i++) c.rect(tx + w * (i * 0.037), base - h * 0.45, w * 0.026, h * 0.03, dark);
      c.rect(tx + w * 0.04, base - h * 0.34, w * 0.02, h * 0.06, hex('#2c2a33'));
    }
    c.rect(x + w * 0.18, base - h * 0.14, w * 0.08, h * 0.14, hex('#3b2c22'));
    c.disc(x + w * 0.22, base - h * 0.14, w * 0.04, hex('#3b2c22'));
    c.rect(x + w * 0.215, base - h * 0.56, w * 0.006, h * 0.27, hex('#4a3a2c'));
    c.tri([x + w * 0.221, base - h * 0.56], [x + w * 0.221, base - h * 0.5], [x + w * 0.3, base - h * 0.53], hex('#a8322a'));
    c.wash(h * 0.72, h, hex('#6f8a5b'), hex('#465e3d'));
  } else {
    // A falcon over the march: a wide sky, low hills and one bird.
    c.wash(0, h, hex('#c9d7e6'), hex('#f1e2c4'));
    c.land(rolling(rng, h * 0.78, h * 0.04, w), h, hex('#8a9a78'));
    c.land(rolling(rng, h * 0.86, h * 0.03, w), h, hex('#5f744f'));
    const x = w * (0.35 + rng.next() * 0.3), y = h * (0.3 + rng.next() * 0.12), s = w * 0.11;
    const ink = hex('#3a3128');
    c.tri([x, y], [x - s * 1.6, y - s * 0.5], [x - s * 0.5, y + s * 0.12], ink);
    c.tri([x, y], [x + s * 1.6, y - s * 0.5], [x + s * 0.5, y + s * 0.12], ink);
    c.oval(x, y + s * 0.08, s * 0.2, s * 0.34, ink);
    c.tri([x - s * 0.14, y + s * 0.36], [x + s * 0.14, y + s * 0.36], [x, y + s * 0.7], ink);
  }
  return c;
}

// ---------- PNG ----------

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An RGB picture as a PNG file. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits a channel, RGB
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** A scene painted from a seed, `width` pixels wide (4:3, or 3:4 when `tall`). */
export function drawScene(scene: Scene, seed: number, width = 960, tall = false): Picture {
  const w = tall ? Math.round(width * 0.75) : width;
  const h = tall ? width : Math.round(width * 0.75);
  const c = paintScene(scene, mulberry32(seed), w, h);
  return { png: encodePng(c.bytes(), w, h), width: w, height: h };
}
