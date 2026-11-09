// node --test src/lib/camera.test.ts — what a card shows at each zoom, the zoom a tree opens at, and how far out
// the canvas goes. The numbers are a laptop's: the free area of a 1440×900 window with the person panel open is
// about 930×770, of a 1280×800 one about 770×670.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MID_K, MIN_SEAL_PX, MIN_TEXT_PX, NAME_PX, NEAR_K, READABLE_K, detailFor, minZoom, openingZoom, type Detail } from './camera.ts';
import { CARD_H, CARD_W, ROW_H } from './layout.ts';

test('a card shows as much as its name can carry at that zoom', () => {
  assert.equal(detailFor(1, 'near'), 'near');
  assert.equal(detailFor(0.8, 'near'), 'mid');
  assert.equal(detailFor(0.6, 'mid'), 'mid');
  // One step out from the opening zoom of a large tree: shields that keep their names, not bare initials.
  assert.equal(detailFor(READABLE_K * 0.8, 'mid'), 'seal');
  assert.equal(detailFor(READABLE_K * 0.8 * 0.8, 'seal'), 'seal');
  assert.equal(detailFor(0.2, 'seal'), 'far');
  assert.equal(detailFor(0.05, 'far'), 'far');
});

test('no level shows a name smaller than it promises', () => {
  const floor = { near: MIN_TEXT_PX, mid: MIN_TEXT_PX, seal: MIN_SEAL_PX } as const;
  for (const prev of ['far', 'seal', 'mid', 'near'] as Detail[]) {
    for (let k = 0.04; k <= 2.2; k += 0.01) {
      const d = detailFor(k, prev);
      if (d !== 'far') assert.ok(k * NAME_PX[d] >= floor[d] - 0.5 - 1e-9, `${d} at ${k.toFixed(2)} from ${prev}`);
    }
  }
});

test('a level is kept a little past its threshold, so zooming near one does not flicker', () => {
  const edge = MIN_TEXT_PX / NAME_PX.mid;
  assert.equal(detailFor(edge - 0.01, 'mid'), 'mid');
  assert.equal(detailFor(edge - 0.01, 'seal'), 'seal');
  const sealEdge = MIN_SEAL_PX / NAME_PX.seal;
  assert.equal(detailFor(sealEdge - 0.01, 'seal'), 'seal');
  assert.equal(detailFor(sealEdge - 0.01, 'far'), 'far');
});

/** The zooms at which a tree of `cols` cards across and `gens` generations fits an area. */
const fits = (cols: number, gens: number, w: number, h: number): [number, number, number, number] =>
  [w / (cols * CARD_W + (cols - 1) * 44), h / ((gens - 1) * ROW_H + CARD_H), w, h];

test('a small family opens on full cards with three generations whole', () => {
  // Twelve people over five generations, four cards across: 1440×900.
  const k = openingZoom(...fits(4, 5, 930, 771));
  assert.equal(detailFor(k, 'near'), 'near');
  assert.ok((2 * ROW_H + CARD_H) * k <= 771, 'parents, the person and children fit');
  // On a taller screen it is not blown up past the smallest full card.
  assert.equal(openingZoom(...fits(4, 5, 1400, 1000)), NEAR_K);
});

test('on a short laptop a small family opens as large as shows three generations, well above the readable floor', () => {
  const k = openingZoom(...fits(4, 5, 770, 671));
  assert.ok(Math.abs(k - 671 / (2 * ROW_H + CARD_H)) < 1e-9);
  assert.ok(k > READABLE_K * 1.3);
  assert.equal(detailFor(k, 'near'), 'mid');
});

test('a tree that fits whole opens whole', () => {
  // One person, and a couple with two children: full cards, never past life size.
  assert.equal(openingZoom(...fits(1, 1, 930, 771)), 1);
  assert.equal(openingZoom(...fits(3, 2, 930, 771)), 1);
  // Three generations that just miss full cards still open on them.
  const [w, h] = [930, (2 * ROW_H + CARD_H) * NEAR_K * 0.9];
  assert.equal(openingZoom(...fits(3, 3, w, h)), NEAR_K);
});

test('large trees open as they did: readable name plates around the focus', () => {
  // A dynasty: 30 across, 12 generations.
  assert.equal(openingZoom(...fits(30, 12, 930, 771)), READABLE_K);
  // A wide hourglass that fits at name plates opens whole at them, not cut to full cards.
  const wide = fits(9, 3, 1300, 560);
  const k = openingZoom(...wide);
  assert.ok(k >= MID_K && k < NEAR_K * 0.86);
  assert.equal(k, Math.min(wide[0], wide[1]));
});

test('a phone keeps its own opening', () => {
  const tall = openingZoom(...fits(4, 5, 334, 560));
  assert.ok(tall >= READABLE_K && tall <= READABLE_K * 1.2 + 1e-9);
});

test('zooming out stops a little past the whole tree', () => {
  // Twelve people on a phone fit at about 0.3: pinching ends at 0.24, not at 4 %.
  assert.ok(Math.abs(minZoom(0.3) - 0.24) < 1e-9);
  // A handful of people who fit at life size can still be taken out to bare shields, and no farther.
  const few = minZoom(1.4);
  assert.equal(detailFor(few, 'seal'), 'far');
  assert.ok(few > 0.25);
  // The largest dynasties keep the old floor.
  assert.equal(minZoom(0.03), 0.04);
});
