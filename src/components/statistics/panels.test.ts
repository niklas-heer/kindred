// node --test src/components/statistics/panels.test.ts — a smaller series is never squashed flat under a larger one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { niceMax, planPanels } from './panels.ts';

test('series of a similar size share one axis', () => assert.deepEqual(planPanels([120, 60]), [[0, 1]]));
test('a series far below the other gets its own panel, in series order', () => assert.deepEqual(planPanels([400, 6]), [[0], [1]]));
test('the share limit is inclusive', () => assert.deepEqual(planPanels([100, 25]), [[0, 1]]));
test('an empty series does not hide the other and still gets a panel', () => {
  assert.deepEqual(planPanels([0, 0]), [[0, 1]]);
  assert.deepEqual(planPanels([50, 0]), [[0], [1]]);
});
test('a single series is one panel', () => assert.deepEqual(planPanels([9]), [[0]]));
test('niceMax gives a round top of at least 2', () => {
  assert.equal(niceMax(0), 2);
  assert.equal(niceMax(7), 8);
  assert.equal(niceMax(130), 150);
});
