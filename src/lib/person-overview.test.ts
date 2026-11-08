// The person Overview's sums from the graph: only what is recorded, in the right order, and nothing for a sparse person.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFamily } from './graph.ts';
import { closestFamily, lifeGlance, openFolds, partitionSoon, toggleFold } from './person-overview.ts';
import type { GPerson, GUnion, Graph } from './types.ts';

const person = (id: string, more: Partial<GPerson> = {}) => ({ id, given: id, surname: 'Test', living: true, stories: 0, ...more }) as GPerson;
const union = (id: string, a: string, b: string, more: Partial<GUnion> = {}) => ({ id, a, b, kind: 'marriage', ...more }) as GUnion;
const link = (child: string, parent: string, kind = 'biological') => ({ child, parent, kind, confidence: 'certain' });
const family = (people: GPerson[], unions: GUnion[] = [], rels: ReturnType<typeof link>[] = []) =>
  buildFamily({ people, unions, parents: rels, houses: [], places: [] } as unknown as Graph);
const today = new Date(2026, 10, 8);

test('a person with nothing recorded has nothing at a glance and no close family', () => {
  const f = family([person('a')]);
  assert.deepEqual(lifeGlance(f, f.byId.get('a')!, today), []);
  assert.deepEqual(closestFamily(f, 'a', 8), { shown: [], more: 0 });
});

test('counts children, grandchildren, and descendants only when there are more generations', () => {
  const two = family([person('a'), person('k'), person('g')], [], [link('k', 'a'), link('g', 'k')]);
  assert.deepEqual(lifeGlance(two, two.byId.get('a')!, today).map((i) => i.key), ['children', 'grandchildren']);
  const three = family([person('a'), person('k'), person('g'), person('gg')], [], [link('k', 'a'), link('g', 'k'), link('gg', 'g')]);
  assert.deepEqual(lifeGlance(three, three.byId.get('a')!, today).find((i) => i.key === 'descendants'), { key: 'descendants', n: 3 });
});

test('a grandchild reached through two children counts once', () => {
  const f = family([person('a'), person('k1'), person('k2'), person('g')], [], [link('k1', 'a'), link('k2', 'a'), link('g', 'k1'), link('g', 'k2')]);
  assert.deepEqual(lifeGlance(f, f.byId.get('a')!, today).find((i) => i.key === 'grandchildren'), { key: 'grandchildren', n: 1 });
});

test('a standing marriage counts to today, even past a longer earlier one', () => {
  const f = family([person('a', { born: '1950-01-01' }), person('x', { living: false, died: '2000-01-01' }), person('y')], [
    union('u1', 'a', 'x', { start: '1960-01-01', end: '1999-01-01', endReason: 'divorce' }),
    union('u2', 'a', 'y', { start: '2020-06-01' }),
  ]);
  assert.deepEqual(lifeGlance(f, f.byId.get('a')!, today)[0], { key: 'together', married: true, years: 6, approx: false });
});

test('a marriage ended by death runs to that death, and only a year-long start date is approximate', () => {
  const f = family([person('a'), person('x', { living: false, died: '1990-05-01' })], [union('u1', 'a', 'x', { start: '1960' })]);
  assert.deepEqual(lifeGlance(f, f.byId.get('a')!, today)[0], { key: 'together', married: true, years: 30, approx: true });
});

test('no length is claimed for a partnership without a start date, or without an end we can place', () => {
  const noStart = family([person('a'), person('x')], [union('u1', 'a', 'x')]);
  assert.deepEqual(lifeGlance(noStart, noStart.byId.get('a')!, today), []);
  const deadUndated = family([person('a', { living: false }), person('x')], [union('u1', 'a', 'x', { start: '1960' })]);
  assert.deepEqual(lifeGlance(deadUndated, deadUndated.byId.get('a')!, today), []);
  const noToday = family([person('a'), person('x')], [union('u1', 'a', 'x', { start: '1960-01-01' })]);
  assert.deepEqual(lifeGlance(noToday, noToday.byId.get('a')!), []);
});

test('birth order needs every sibling placed; otherwise it is a plain count', () => {
  const people = [person('m'), person('a', { born: '1980-05-01' }), person('b', { born: '1978-01-01' }), person('c', { born: '1985-01-01' })];
  const f = family(people, [], [link('a', 'm'), link('b', 'm'), link('c', 'm')]);
  assert.deepEqual(lifeGlance(f, f.byId.get('a')!, today).at(-1), { key: 'order', position: 2, of: 3 });
  const unknown = family([person('m'), person('a', { born: '1980-05-01' }), person('b')], [], [link('a', 'm'), link('b', 'm')]);
  assert.deepEqual(lifeGlance(unknown, unknown.byId.get('a')!, today).at(-1), { key: 'siblings', n: 1 });
  const twins = family([person('m'), person('a', { born: '1980' }), person('b', { born: '1980' })], [], [link('a', 'm'), link('b', 'm')]);
  assert.deepEqual(lifeGlance(twins, twins.byId.get('a')!, today).at(-1), { key: 'siblings', n: 1 });
});

test('closest family: partners, parents, children, siblings; an ex is left out but counted', () => {
  const f = family([person('a'), person('dad'), person('kid'), person('sis'), person('wife'), person('ex')], [
    union('u2', 'a', 'wife', { start: '2000' }),
    union('u1', 'a', 'ex', { start: '1990', end: '1995', endReason: 'divorce' }),
  ], [link('a', 'dad'), link('kid', 'a', 'adoptive'), link('sis', 'dad')]);
  const { shown, more } = closestFamily(f, 'a', 8);
  assert.deepEqual(shown.map((r) => [r.id, r.kind]), [['wife', 'partner'], ['dad', 'parent'], ['kid', 'child'], ['sis', 'sibling']]);
  assert.equal(more, 1);
  assert.equal(shown.find((r) => r.id === 'kid')!.neutral, true);
});

test('a late spouse is still close family, and the limit counts into "more"', () => {
  const f = family([person('a'), person('w', { living: false, died: '2001' }), person('k1'), person('k2')], [union('u', 'a', 'w', { end: '2001', endReason: 'death' })], [link('k1', 'a'), link('k2', 'a')]);
  const { shown, more } = closestFamily(f, 'a', 2);
  assert.deepEqual(shown.map((r) => r.id), ['w', 'k1']);
  assert.equal(more, 1);
});

test('dates within 30 days stay up front, later ones are held back', () => {
  assert.deepEqual(partitionSoon([3, 30, 31, 200], (n) => n), { soon: [3, 30], later: [31, 200] });
});

test('open sections survive bad saved values and toggle cleanly', () => {
  assert.deepEqual(openFolds(null), ['life']);
  assert.deepEqual(openFolds('not json'), ['life']);
  assert.deepEqual(openFolds('{"a":1}'), ['life']);
  assert.deepEqual(openFolds('["places","bogus"]'), ['places']);
  assert.deepEqual(openFolds('[]'), []);
  assert.deepEqual(toggleFold(['life'], 'places'), ['life', 'places']);
  assert.deepEqual(toggleFold(['life', 'places'], 'life'), ['places']);
});
