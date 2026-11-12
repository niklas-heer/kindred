// node --test src/components/campaign/drawing.test.ts — where the map's marks stand: a garrison's count never on a
// neighbour's banner, and an order's arrow never over the names of the provinces it joins.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupField, type GameMap } from '../../lib/campaign/engine.ts';
import { courseOf, nameBox, namesAt, tokenAt, tokenSides, type Box } from './drawing.ts';

const SIDES = ['a', 'b', 'c', 'd'];
const fields = Array.from({ length: 40 }, (_, i) => setupField(SIDES, `drawing:${i}`));
const seatsOf = (f: (typeof fields)[number]) => new Set(Object.values(f.start.seats));
const meets = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** How many counts stand on a neighbour's shield or count, with the marks drawn this large. */
function covered(map: GameMap, sides: number[], room: number): number {
  const shield = 46 * room, r = 15 * room;
  const token = (id: number): Box => { const [x, y] = tokenAt(map.provinces[id], sides[id], room); return [x - r, y - r, x + r, y + r]; };
  let n = 0;
  for (const p of map.provinces) {
    for (const q of map.provinces) {
      if (p.id === q.id) continue;
      if (meets(token(p.id), [q.x - shield / 2, q.y - shield * 0.78, q.x + shield / 2, q.y + shield * 0.38]) || (p.id < q.id && meets(token(p.id), token(q.id)))) n++;
    }
  }
  return n;
}

test('a garrison’s count stands lower right of its banner, and moves to another side sooner than cover a neighbour’s', () => {
  let before = 0, after = 0, moved = 0;
  for (const f of fields) {
    const wide = tokenSides(f.map, seatsOf(f), 1);
    assert.equal(wide.length, f.map.provinces.length);
    // Drawn large, as on a phone, banners crowd: the default covers some, the chosen sides fewer.
    const narrow = tokenSides(f.map, seatsOf(f), 1.7);
    before += covered(f.map, f.map.provinces.map(() => 0), 1.7);
    after += covered(f.map, narrow, 1.7);
    moved += narrow.filter((s) => s !== 0).length;
    assert.deepEqual(tokenSides(f.map, seatsOf(f), 1.7), narrow, 'the same every time');
    for (const s of narrow) assert.ok(s >= 0 && s <= 3);
  }
  assert.ok(before > 0, 'forty continents have crowded banners somewhere');
  assert.ok(moved > 0);
  assert.ok(after < before / 4, `${after} covered of ${before} before`);
  // Alone on the sheet a count stays where it always was.
  assert.deepEqual(tokenAt({ x: 100, y: 100 }, 0, 1), [100 + 46 * 0.46, 100 + 46 * 0.3]);
});

test('an order’s arrow sets out beyond its own province’s name and stops short of the name of the one it goes to', () => {
  const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const holds = (box: Box, x: number, y: number) => x > box[0] && x < box[2] && y > box[1] && y < box[3];
  const on = (box: Box, p: number[]) => Array.from({ length: 41 }, (_, i) => i / 40).some((t) => holds(box, (1 - t) ** 2 * p[0] + 2 * t * (1 - t) * p[2] + t * t * p[4], (1 - t) ** 2 * p[1] + 2 * t * (1 - t) * p[3] + t * t * p[5]));
  let arrows = 0, crossed = 0, cross = 0, changed = 0;
  for (const f of fields) {
    const names = namesAt(f.map, seatsOf(f), 1, 21, { tokens: tokenSides(f.map, seatsOf(f), 1) });
    for (const [a, b] of f.map.borders) {
      for (const [from, to] of [[a, b], [b, a]]) {
        const clear = { from: nameBox(names.get(from)!, 21), to: nameBox(names.get(to)!, 21) };
        const plain = courseOf(f.map, from, to, 34)!;
        const course = courseOf(f.map, from, to, 34, clear)!;
        assert.match(course.d, /^M-?[\d.]+ -?[\d.]+Q-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+$/);
        const [was, is] = [numbers(plain.d), numbers(course.d)];
        arrows++;
        if (on(clear.from, was) || on(clear.to, was)) crossed++;
        if (on(clear.from, is) || on(clear.to, is)) cross++;
        if (course.d === plain.d) continue;
        changed++;
        // An end that gave way is right off the name, and an arrow is left to read. It never grows.
        const [startMoved, endMoved] = [was[0] !== is[0] || was[1] !== is[1], was[4] !== is[4] || was[5] !== is[5]];
        if (startMoved) assert.ok(!on(clear.from, is), `${course.d} still sets out across its own name`);
        if (endMoved) assert.ok(!on(clear.to, is), `${course.d} still ends on the name it goes to`);
        assert.ok(Math.hypot(is[4] - is[0], is[5] - is[1]) >= 17, `${course.d} is too short`);
        assert.ok(Math.hypot(is[4] - is[0], is[5] - is[1]) <= Math.hypot(was[4] - was[0], was[5] - was[1]) + 1);
      }
    }
  }
  assert.ok(crossed > arrows / 4, `${crossed} of ${arrows} arrows would cross a name of their own two`);
  assert.ok(changed > crossed / 2, `${changed} gave way`);
  assert.ok(cross < crossed / 2, `${cross} of ${crossed} still cross one (too short to give way; the name is written over them)`);
  // With nothing to keep off, the course is what it was.
  const [a, b] = fields[0].map.borders[0];
  assert.deepEqual(courseOf(fields[0].map, a, b, 34, {}), courseOf(fields[0].map, a, b, 34));
});
