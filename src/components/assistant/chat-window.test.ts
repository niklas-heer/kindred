// node --test src/components/assistant/chat-window.test.ts — the assistant window's size and place: it stays on screen, within its limits.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampRect, defaultLayout, MARGIN, MIN_H, MIN_W, moveRect, parseLayout, resizeRect, visibleRect, type Edge } from './chat-window.ts';

const VW = 1280;
const VH = 800;
const box = { x: 300, y: 100, w: 500, h: 600 };

function assertOnScreen(r: { x: number; y: number; w: number; h: number }, vw: number, vh: number) {
  assert.ok(r.x >= MARGIN, `left edge ${r.x}`);
  assert.ok(r.y >= MARGIN, `top edge ${r.y}`);
  assert.ok(r.x + r.w <= vw - MARGIN, `right edge ${r.x + r.w}`);
  assert.ok(r.y + r.h <= vh - MARGIN, `bottom edge ${r.y + r.h}`);
}

test('the default window is on screen at the lower right', () => {
  const d = defaultLayout(VW, VH);
  assertOnScreen(d, VW, VH);
  assert.equal(d.x + d.w, VW - MARGIN);
  assert.equal(d.y + d.h, VH - MARGIN);
  assert.equal(d.docked, false);
});

test('a window left beyond a viewport that has shrunk comes back whole', () => {
  const r = clampRect({ x: 1100, y: 700, w: 900, h: 700 }, 800, 500);
  assertOnScreen(r, 800, 500);
  assert.equal(r.w, 800 - MARGIN * 2);
  assert.equal(r.h, 500 - MARGIN * 2);
});

test('a screen smaller than the minimum gets the largest window that fits, not an overflowing one', () => {
  const r = clampRect({ x: 0, y: 0, w: MIN_W, h: MIN_H }, 300, 300);
  assertOnScreen(r, 300, 300);
});

test('moving stops at every side of the screen', () => {
  assertOnScreen(moveRect(box, -5000, -5000, VW, VH), VW, VH);
  assertOnScreen(moveRect(box, 5000, 5000, VW, VH), VW, VH);
  assert.deepEqual(moveRect(box, 10, 20, VW, VH), { ...box, x: 310, y: 120 });
});

test('each edge moves only its own side, and the opposite side stays put', () => {
  const cases: [Edge, number, number, Partial<typeof box>][] = [
    ['e', 40, 0, { w: 540 }],
    ['s', 0, 40, { h: 640 }],
    ['w', -40, 0, { x: 260, w: 540 }],
    ['n', 0, -40, { y: 60, h: 640 }],
    ['se', 40, 30, { w: 540, h: 630 }],
    ['nw', -40, -30, { x: 260, y: 70, w: 540, h: 630 }],
    ['ne', 40, -30, { y: 70, w: 540, h: 630 }],
    ['sw', -40, 30, { x: 260, w: 540, h: 630 }],
  ];
  for (const [edge, dx, dy, want] of cases) assert.deepEqual(resizeRect(box, edge, dx, dy, VW, VH), { ...box, ...want }, edge);
});

test('shrinking past the minimum holds the opposite side still', () => {
  const west = resizeRect(box, 'w', 5000, 0, VW, VH);
  assert.equal(west.w, MIN_W);
  assert.equal(west.x + west.w, box.x + box.w);
  const north = resizeRect(box, 'n', 0, 5000, VW, VH);
  assert.equal(north.h, MIN_H);
  assert.equal(north.y + north.h, box.y + box.h);
});

test('growing past the screen stops at its margin, on every edge', () => {
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Edge[]) {
    assertOnScreen(resizeRect(box, edge, edge.includes('w') ? -5000 : 5000, edge.includes('n') ? -5000 : 5000, VW, VH), VW, VH);
  }
});

test('a docked window takes the full height at the right edge and keeps its own width', () => {
  assert.deepEqual(visibleRect({ ...box, docked: true }, VW, VH), { x: VW - box.w, y: 0, w: box.w, h: VH });
  const narrow = visibleRect({ ...box, w: 2000, docked: true }, 700, VH);
  assert.ok(narrow.x >= MARGIN && narrow.x + narrow.w === 700);
});

test('only a whole, numeric layout is taken back from storage', () => {
  assert.deepEqual(parseLayout(JSON.stringify({ ...box, docked: true })), { ...box, docked: true });
  assert.equal(parseLayout(null), null);
  assert.equal(parseLayout('not json'), null);
  assert.equal(parseLayout('{"x":1,"y":2,"w":3}'), null);
  assert.equal(parseLayout('{"x":"1","y":2,"w":3,"h":4}'), null);
  assert.equal(parseLayout(JSON.stringify({ ...box, h: null })), null);
});
