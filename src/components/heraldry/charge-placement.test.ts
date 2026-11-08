// Charges set on a narrow ordinary (fess, pale, bend, chevron, cross, saltire, pall): each must fit across the
// arm it sits on, stay on that arm and inside the shield, keep clear of its neighbours, and stay large enough to read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outline, placeCharges, type Pt, type Spot } from './geometry.ts';
import type { ArmsLayer, ChargeLayer, OrdinaryKind, PartitionLine, ShieldShape } from '~/lib/seed-format';

const unit = (x: number, y: number): Pt => { const l = Math.hypot(x, y); return [x / l, y / l]; };
const BEND = unit(90, 100);
const CHEV = unit(1, 0.8);

/** The ordinaries as ordinaryShape draws them: centre, arms (rays from the centre) and half-width across an arm. */
const SHAPES: Record<string, { c: Pt; arms: Pt[]; h: number }> = {
  fess: { c: [50, 55], arms: [[1, 0], [-1, 0]], h: 14 },
  pale: { c: [50, 55], arms: [[0, 1], [0, -1]], h: 14 },
  bend: { c: [50, 55], arms: [BEND, [-BEND[0], -BEND[1]]], h: 13 },
  'bend-sinister': { c: [50, 55], arms: [[-BEND[0], BEND[1]], [BEND[0], -BEND[1]]], h: 13 },
  chevron: { c: [50, 46], arms: [CHEV, [-CHEV[0], CHEV[1]]], h: 12 * CHEV[0] },
  cross: { c: [50, 56], arms: [[1, 0], [-1, 0], [0, 1], [0, -1]], h: 12 },
  saltire: { c: [50, 60], arms: [unit(100, 120), unit(-100, 120), unit(100, -120), unit(-100, -120)], h: 12 },
  pall: { c: [50, 54], arms: [unit(-50, -54), unit(50, -54), [0, 1]], h: 10 },
};
const KINDS = Object.keys(SHAPES) as OrdinaryKind[];
const SHIELDS: ShieldShape[] = ['heater', 'french', 'iberian', 'lozenge', 'swiss', 'kite'];

function place(kind: OrdinaryKind, count: number, shield: ShieldShape = 'heater', line: PartitionLine = 'straight'): Spot[] {
  const before: ArmsLayer[] = [{ type: 'ordinary', kind, tincture: 'argent', line }];
  const layer: ChargeLayer = { type: 'charge', charge: 'mullet', tincture: 'gules', count, arrangement: 'auto', on: 'ordinary' };
  return placeCharges(layer, before, shield);
}

/** How far p lies from the nearest arm's centre line. */
function offArm(p: Spot, kind: string): number {
  const { c, arms } = SHAPES[kind];
  return Math.min(...arms.map((u) => {
    const t = Math.max(0, (p.x - c[0]) * u[0] + (p.y - c[1]) * u[1]);
    return Math.hypot(p.x - c[0] - u[0] * t, p.y - c[1] - u[1] * t);
  }));
}

function inside(p: Pt, poly: Pt[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

test('every charge on a narrow ordinary sits on it and fits across it', () => {
  for (const kind of KINDS) for (let n = 1; n <= 9; n++) {
    const spots = place(kind, n);
    assert.equal(spots.length, n, `${kind} ×${n}`);
    for (const p of spots) {
      assert.ok(offArm(p, kind) < 0.5, `${kind} ×${n}: a charge at ${p.x.toFixed(1)},${p.y.toFixed(1)} is off the ordinary`);
      assert.ok(p.s <= 2 * SHAPES[kind].h * 0.9 + 1e-6, `${kind} ×${n}: size ${p.s.toFixed(1)} is wider than the ordinary`);
    }
  }
});

test('one to three charges are as large as the ordinary allows, and up to five stay readable', () => {
  for (const kind of KINDS) {
    const full = 2 * SHAPES[kind].h * 0.9;
    for (let n = 1; n <= 3; n++) for (const p of place(kind, n)) assert.ok(p.s >= full * 0.8, `${kind} ×${n}: size ${p.s.toFixed(1)} of ${full.toFixed(1)}`);
    for (let n = 4; n <= 5; n++) for (const p of place(kind, n)) assert.ok(p.s >= 11, `${kind} ×${n}: size ${p.s.toFixed(1)} is too small to read`);
  }
});

test('charges on an ordinary keep clear of each other and of the shield edge, on every shield', () => {
  for (const shield of SHIELDS) for (const kind of KINDS) for (let n = 1; n <= 9; n++) {
    const spots = place(kind, n, shield);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      const d = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y);
      assert.ok(d >= spots[i].s * 0.95, `${shield} ${kind} ×${n}: charges ${i} and ${j} overlap`);
    }
    for (const p of spots) assert.ok(p.s >= 5, `${shield} ${kind} ×${n}: size ${p.s.toFixed(1)}`);
    const o = outline(shield);
    for (const p of spots) {
      const r = p.s * 0.45;
      for (let a = 0; a < 8; a++) {
        const q: Pt = [p.x + Math.cos((a * Math.PI) / 4) * r, p.y + Math.sin((a * Math.PI) / 4) * r];
        assert.ok(inside(q, o), `${shield} ${kind} ×${n}: a charge at ${p.x.toFixed(1)},${p.y.toFixed(1)} runs off the shield`);
      }
    }
  }
});

test('a toothed line narrows the ordinary, so its charges shrink to keep clear of the teeth', () => {
  for (const kind of KINDS) {
    const plain = place(kind, 1)[0].s;
    assert.ok(place(kind, 1, 'heater', 'dancetty')[0].s < plain, kind);
    assert.ok(place(kind, 1, 'heater', 'wavy')[0].s < plain, kind);
  }
});

test('a lone charge stands on the centre of the ordinary', () => {
  for (const kind of KINDS) {
    const [p] = place(kind, 1);
    const { c } = SHAPES[kind];
    assert.ok(Math.abs(p.x - c[0]) < 0.01 && Math.abs(p.y - c[1]) < 3, `${kind}: ${p.x},${p.y}`);
  }
});
