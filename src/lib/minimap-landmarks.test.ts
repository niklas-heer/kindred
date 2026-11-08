// node --test src/lib/minimap-landmarks.test.ts — where the house shields sit on the minimap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { houseLandmarks, largestCluster, MAX_SHIELDS, type HouseLandmark, type LandmarkPerson, type MinimapFrame } from './minimap-landmarks.ts';

const grid = { cardW: 148, rowH: 316, size: 22 };
const frame: MinimapFrame = { s: 1, ox: 0, oy: 0, width: 500, height: 300 };
const person = (id: string, house: string, x: number, y = 100): LandmarkPerson => ({ id, house, x, y });
const h = 22 * 1.2;

/** Shields may not touch: the same rule the placement uses. */
function assertApart(marks: HouseLandmark[]) {
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const a = marks[i], b = marks[j];
      const size = (a.size + b.size) / 2;
      assert.ok(Math.abs(a.x - b.x) >= size + 2 || Math.abs(a.y - b.y) >= size * 1.2 + 2, `${a.house} and ${b.house} overlap`);
    }
  }
}

test('one house, or none, gets no landmark: the whole map is that house', () => {
  assert.deepEqual(houseLandmarks([], frame, grid), []);
  assert.deepEqual(houseLandmarks([person('a', 'h1', 10), person('b', 'h1', 200)], frame, grid), []);
  // People without a house do not count as a second house.
  assert.deepEqual(houseLandmarks([person('a', 'h1', 10), person('b', '', 200)], frame, grid), []);
});

test('each house gets one shield at the middle of its people, and the jump goes to the same point', () => {
  const people = [person('a1', 'h1', 100), person('a2', 'h1', 200), person('b1', 'h2', 400)];
  const marks = houseLandmarks(people, frame, grid);
  assert.equal(marks.length, 2);
  const a = marks.find((m) => m.house === 'h1')!;
  const b = marks.find((m) => m.house === 'h2')!;
  assert.deepEqual([a.x, a.y, a.wx, a.wy], [150, 100, 150, 100]);
  assert.deepEqual([b.x, b.y, b.wx, b.wy], [400, 100, 400, 100]);
  assert.equal(a.people, 2);
  assert.equal(b.people, 1);
});

test('a house split across the tree is anchored on its largest branch, not the average of all of it', () => {
  const people = [person('a1', 'h1', 100), person('a2', 'h1', 200), person('a3', 'h1', 150), person('far', 'h1', 2000), person('b', 'h2', 400)];
  const a = houseLandmarks(people, frame, grid).find((m) => m.house === 'h1')!;
  assert.deepEqual([a.wx, a.wy], [150, 100]);
  // The lone branch 2000 units away does not drag the middle.
  assert.equal(a.people, 4);
});

test('cards one generation apart link into a cluster; two generations apart do not', () => {
  const near = largestCluster([person('p', 'h', 0, 0), person('q', 'h', 50, 316), person('r', 'h', 0, 632 * 1.6)], grid);
  // p and q link (one row apart), r is three rows away and so stays out: the middle of p and q.
  assert.deepEqual(near, { x: 25, y: 158 });
});

test('a duplicate placement of one person counts once', () => {
  const people = [person('a', 'h1', 100), person('a', 'h1', 300), person('b', 'h2', 400)];
  const a = houseLandmarks(people, frame, grid).find((m) => m.house === 'h1')!;
  assert.equal(a.people, 1);
});

test('when two shields would land on the same spot, the bigger house keeps it and the smaller moves off', () => {
  const people = [
    person('a1', 'big', 100), person('a2', 'big', 100, 200), person('a3', 'big', 100, 300),
    person('b1', 'small', 100, 200), // the same spot as the big house's middle
    person('c1', 'other', 480, 260),
  ];
  const marks = houseLandmarks(people, frame, grid);
  const big = marks.find((m) => m.house === 'big')!;
  const small = marks.find((m) => m.house === 'small')!;
  assert.deepEqual([big.x, big.y], [100, 200]);
  assert.ok(small, 'the smaller house is still placed, nudged');
  assert.ok(small.x !== big.x || small.y !== big.y);
  assertApart(marks);
});

test('a crowded map drops the shields that have no free place rather than piling them up', () => {
  const tight: MinimapFrame = { s: 1, ox: 0, oy: 0, width: 40, height: 40 };
  const people = Array.from({ length: 8 }, (_, i) => person(`p${i}`, `h${i}`, 20, 20));
  const marks = houseLandmarks(people, tight, grid);
  assert.ok(marks.length < 8, 'not every house fits');
  assert.ok(marks.length >= 1);
  assertApart(marks);
});

/** n houses of falling size, spread across a map the size of the real one. */
function spread(n: number): LandmarkPerson[] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n - i }, (_, j) => person(`h${i}-${j}`, `h${i}`, 20 + (i % 5) * 45, 20 + Math.floor(i / 5) * 50))).flat();
}
const mapFrame: MinimapFrame = { s: 1, ox: 0, oy: 0, width: 240, height: 180 };

test('an ordinary family keeps a full shield for every house', () => {
  for (let n = 2; n <= MAX_SHIELDS; n++) {
    const marks = houseLandmarks(spread(n), mapFrame, grid);
    assert.equal(marks.length, n);
    assert.ok(marks.every((m) => !m.compact && m.size === 22), `${n} houses`);
  }
});

test('a family of many houses shows full shields for the biggest and small markers for the rest', () => {
  const marks = houseLandmarks(spread(11), mapFrame, grid);
  assert.equal(marks.length, 11, 'every house can still be jumped to');
  const full = marks.filter((m) => !m.compact);
  assert.equal(full.length, MAX_SHIELDS);
  const smallestFull = Math.min(...full.map((m) => m.people));
  for (const m of marks.filter((x) => x.compact)) {
    assert.ok(m.people <= smallestFull, `${m.house} is bigger than a house with a full shield`);
    assert.equal(m.size, 11);
  }
  assertApart(marks);
});

test('a shield with no free place becomes a marker rather than disappearing', () => {
  const tight: MinimapFrame = { s: 1, ox: 0, oy: 0, width: 60, height: 30 };
  const marks = houseLandmarks([person('a', 'h1', 30, 15), person('a2', 'h1', 30, 15), person('b', 'h2', 30, 15)], tight, grid);
  assert.equal(marks.length, 2);
  assert.deepEqual(marks.map((m) => m.compact).sort(), [false, true]);
  assertApart(marks);
});

test('every shield stays inside the minimap', () => {
  const people = [person('a', 'h1', -50, 0), person('b', 'h2', 9000, 9000), person('c', 'h3', 250, 150)];
  const marks = houseLandmarks(people, frame, grid);
  for (const m of marks) {
    assert.ok(m.x >= 11 && m.x <= frame.width - 11, `${m.house} x ${m.x}`);
    assert.ok(m.y >= h / 2 && m.y <= frame.height - h / 2, `${m.house} y ${m.y}`);
  }
});

test('the tooltip opens below near the top edge and aligns inward near the sides', () => {
  const top = houseLandmarks([person('a', 'h1', 250, 0), person('b', 'h2', 400, 0)], frame, grid).find((m) => m.house === 'h1')!;
  assert.equal(top.tip, 'below');
  assert.equal(top.align, 'center');
  const left = houseLandmarks([person('a', 'h1', 10, 150), person('b', 'h2', 400, 150)], frame, grid).find((m) => m.house === 'h1')!;
  assert.equal(left.tip, 'above');
  assert.equal(left.align, 'start');
  const right = houseLandmarks([person('a', 'h1', 480, 150), person('b', 'h2', 10, 150)], frame, grid).find((m) => m.house === 'h1')!;
  assert.equal(right.align, 'end');
});

test('the result is in reading order, so keyboard focus follows the tree top to bottom', () => {
  const people = [person('a', 'h1', 400, 250), person('b', 'h2', 50, 250), person('c', 'h3', 250, 20)];
  const marks = houseLandmarks(people, frame, grid);
  const ys = marks.map((m) => m.y);
  assert.deepEqual(ys, [...ys].sort((p, q) => p - q));
});
