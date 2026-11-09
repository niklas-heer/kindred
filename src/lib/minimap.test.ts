// node --test src/lib/minimap.test.ts — the minimap's size, click-to-jump mapping and density steps.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { letterPx, mapToWorld, MIN_LETTER_PX, minimapDensity, minimapFrame, shieldPaint, worldToMap, type MinimapStep } from './minimap.ts';

const CARD_W = 148;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);

test('a click maps back to the world point drawn under it, wherever the tree starts', () => {
  for (const b of [{ x: 0, y: 0, w: 3000, h: 1200 }, { x: -5120, y: 316, w: 9000, h: 4000 }, { x: 80, y: -40, w: 400, h: 200 }]) {
    const f = minimapFrame(b, CARD_W);
    for (const [wx, wy] of [[b.x, b.y], [b.x + b.w, b.y + b.h], [b.x + b.w / 3, b.y + b.h / 2]]) {
      const p = worldToMap(f, wx, wy);
      const back = mapToWorld(f, p.x, p.y);
      near(back.x, wx);
      near(back.y, wy);
    }
  }
});

test('the middle of the map is the middle of the tree, and the corners stay inside it', () => {
  const b = { x: -700, y: 120, w: 5000, h: 2600 };
  const f = minimapFrame(b, CARD_W);
  const mid = mapToWorld(f, f.width / 2, f.height / 2);
  near(mid.x, b.x + b.w / 2);
  near(mid.y, b.y + b.h / 2);
  const a = worldToMap(f, b.x, b.y), z = worldToMap(f, b.x + b.w, b.y + b.h);
  assert.ok(a.x >= 0 && a.y >= 0 && z.x <= f.width && z.y <= f.height);
});

test('the map takes the shape of the tree, inside its limits', () => {
  const wide = minimapFrame({ x: 0, y: 0, w: 20000, h: 1000 }, CARD_W);
  assert.equal(wide.width, 240);
  assert.equal(wide.height, 72);
  const tall = minimapFrame({ x: 0, y: 0, w: 1000, h: 20000 }, CARD_W);
  assert.equal(tall.height, 180);
  assert.equal(tall.width, 150);
});

test('a tiny family stays a few small shields rather than filling the box', () => {
  const f = minimapFrame({ x: 0, y: 0, w: 340, h: 196 }, CARD_W);
  assert.ok(CARD_W * f.s <= 30);
  assert.equal(f.width, 150);
  assert.equal(f.height, 72);
});

test('as a family gets denser the marks lose the initials, then the rim, then the shape', () => {
  const order: MinimapStep[] = ['initials', 'shields', 'small', 'dots'];
  let last = -1;
  const seen = new Set<MinimapStep>();
  for (let px = 40; px > 0.2; px *= 0.97) {
    const i = order.indexOf(minimapDensity(px).step);
    assert.ok(i >= last, `step went back up at ${px}px`);
    last = i;
    seen.add(order[i]);
  }
  assert.deepEqual([...seen], order);
});

test('initials only show at a size they can be read, on a shield that holds them', () => {
  for (let px = 0.5; px < 40; px += 0.25) {
    const d = minimapDensity(px);
    if (d.step !== 'initials') continue;
    assert.ok(letterPx(d.width) >= MIN_LETTER_PX);
    assert.ok(letterPx(d.width) <= d.width * 0.7, `letter overflows a ${d.width}px shield`);
  }
  assert.equal(minimapDensity(11).step, 'shields');
  assert.equal(minimapDensity(16).step, 'initials');
});

test('the lines stay at every density, and a dot never vanishes', () => {
  for (const px of [30, 14, 8, 4, 2, 0.5, 0.05]) {
    const d = minimapDensity(px);
    assert.ok(d.lineWidth > 0 && d.lineAlpha > 0, `no lines at ${px}px`);
    assert.ok(d.width >= 2, `${px}px is drawn ${d.width}px wide`);
  }
});

test('the rim that tells the living from the dead goes only when a mark is too small for it', () => {
  assert.ok(minimapDensity(16).rim > 0);
  assert.ok(minimapDensity(8).rim > 0);
  assert.equal(minimapDensity(4).rim, 0);
  assert.equal(minimapDensity(1).rim, 0);
});

test('the living and the dead differ in every theme, at shield and at dot size', () => {
  for (const light of [false, true]) {
    for (const [house, ink] of [['#2a5aa8', '#2a5aa8'], ['#e6e3da', '#9a958a'], ['#1b1a18', '#1b1a18']]) {
      const living = shieldPaint(light, house, ink, true, '#6b6142');
      const dead = shieldPaint(light, house, ink, false, '#6b6142');
      assert.notEqual(living.top, dead.top);
      assert.notEqual(living.dot, dead.dot);
    }
  }
});

test('a black house still shows at dot size on a dark ground', () => {
  const dot = shieldPaint(false, '#141414', '#141414', true, '#1a1e27').dot;
  const sum = [1, 3, 5].reduce((n, i) => n + parseInt(dot.slice(i, i + 2), 16), 0);
  assert.ok(sum > 200, `${dot} is too dark`);
});

test('the small map is a quarter smaller and still holds the whole tree', () => {
  const b = { x: -3000, y: 0, w: 9000, h: 3600 };
  const full = minimapFrame(b, CARD_W), small = minimapFrame(b, CARD_W, true);
  assert.equal(full.width, 240);
  assert.equal(small.width, 180);
  assert.ok(small.height < full.height);
  const a = worldToMap(small, b.x, b.y), z = worldToMap(small, b.x + b.w, b.y + b.h);
  assert.ok(a.x >= 0 && a.y >= 0 && z.x <= small.width && z.y <= small.height);
});
