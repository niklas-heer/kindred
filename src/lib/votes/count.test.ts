// node --test src/lib/votes/count.test.ts — single-choice and instant-runoff counting. Invented names only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countVote } from './count.ts';

const ranked = (options: string[], ballots: string[][]) => {
  const r = countVote('ranked', options, ballots);
  assert.equal(r.kind, 'ranked');
  return r as Extract<ReturnType<typeof countVote>, { kind: 'ranked' }>;
};

test('single: the most ballots wins, a tie is a tie, no ballots has no winner', () => {
  const win = countVote('single', ['a', 'b'], [['a'], ['a'], ['b']]);
  assert.deepEqual(win.winners, ['a']);
  assert.equal(win.ballots, 3);
  assert.deepEqual(countVote('single', ['a', 'b'], [['a'], ['b']]).winners, ['a', 'b']);
  const none = countVote('single', ['a', 'b'], []);
  assert.deepEqual(none.winners, []);
  assert.equal(none.ballots, 0);
});

test('single: ids that are not options are ignored', () => {
  const r = countVote('single', ['a', 'b'], [['x'], ['b']]);
  assert.equal(r.kind, 'single');
  assert.deepEqual(r.kind === 'single' && r.tallies, { a: 0, b: 1 });
  assert.equal(r.ballots, 1);
});

test('ranked: a majority in round one wins at once', () => {
  const r = ranked(['a', 'b', 'c'], [['a'], ['a', 'b'], ['b']]);
  assert.deepEqual(r.winners, ['a']);
  assert.equal(r.rounds.length, 1);
  assert.deepEqual(r.rounds[0], { tallies: { a: 2, b: 1, c: 0 }, out: [], exhausted: 0 });
});

test('ranked: the last option drops out and its ballots transfer', () => {
  const r = ranked(['a', 'b', 'c'], [['a', 'b'], ['a', 'b'], ['b', 'a'], ['b', 'a'], ['c', 'b']]);
  assert.deepEqual(r.rounds[0], { tallies: { a: 2, b: 2, c: 1 }, out: ['c'], exhausted: 0 });
  assert.deepEqual(r.rounds[1].tallies, { a: 2, b: 3 });
  assert.deepEqual(r.winners, ['b']);
});

test('ranked: an exhausted ballot leaves the count and the majority is of the ballots still in', () => {
  const r = ranked(['a', 'b', 'c'], [['a'], ['a'], ['b'], ['b'], ['c']]);
  assert.deepEqual(r.rounds[0].out, ['c']);
  assert.equal(r.rounds[1].exhausted, 1);
  assert.deepEqual(r.rounds[1].tallies, { a: 2, b: 2 });
  // 2 of 4 in play is not more than half: a and b tie.
  assert.deepEqual(r.winners, ['a', 'b']);
  const m = ranked(['a', 'b', 'c'], [['a'], ['a'], ['a', 'b'], ['b'], ['b'], ['c'], ['c'], ['c', 'a']]);
  assert.equal(m.ballots, 8);
  const last = m.rounds[m.rounds.length - 1];
  assert.equal(last.exhausted + Object.values(last.tallies).reduce((s, n) => s + n, 0), 8);
});

test('ranked: ties for last place are broken by the previous round', () => {
  // Round 1: a4 b3 c1 d2 -> c out; c's ballot goes to d. Round 2: a4 b3 d3 -> b,d tied last; round 1: b3 d2 -> d out.
  const r = ranked(
    ['a', 'b', 'c', 'd'],
    [['a'], ['a'], ['a'], ['a'], ['b'], ['b'], ['b'], ['c', 'd'], ['d'], ['d']],
  );
  assert.deepEqual(r.rounds[0].out, ['c']);
  assert.deepEqual(r.rounds[1].tallies, { a: 4, b: 3, d: 3 });
  assert.deepEqual(r.rounds[1].out, ['d']);
  assert.deepEqual(r.winners, ['a']);
});

test('ranked: an unbreakable tie for last drops them all, unless that leaves none', () => {
  const four = ranked(['a', 'b', 'c', 'd'], [['a'], ['a'], ['a'], ['b'], ['b'], ['b'], ['c'], ['d']]);
  assert.deepEqual(four.rounds[0].out, ['c', 'd']);
  assert.equal(four.rounds[1].exhausted, 2);
  assert.deepEqual(four.winners, ['a', 'b']);
  const tie = ranked(['a', 'b'], [['a'], ['b']]);
  assert.deepEqual(tie.winners, ['a', 'b']);
  assert.deepEqual(tie.rounds[tie.rounds.length - 1].out, []);
  const all = ranked(['a', 'b', 'c'], [['a'], ['b'], ['c']]);
  assert.deepEqual(all.winners, ['a', 'b', 'c']);
});

test('ranked: an option nobody ranked counts 0 and drops out first', () => {
  const r = ranked(['a', 'b', 'c'], [['a'], ['b'], ['a', 'b']]);
  assert.deepEqual(r.rounds[0].tallies, { a: 2, b: 1, c: 0 });
  assert.deepEqual(r.winners, ['a']);
  const r2 = ranked(['a', 'b', 'c'], [['a'], ['a'], ['b'], ['b']]);
  assert.deepEqual(r2.rounds[0], { tallies: { a: 2, b: 2, c: 0 }, out: ['c'], exhausted: 0 });
});

test('ranked: no ballots, and ballots with only unknown ids, have no winner', () => {
  const r = ranked(['a', 'b'], [['x'], []]);
  assert.deepEqual(r.winners, []);
  assert.equal(r.ballots, 0);
  assert.deepEqual(r.rounds, []);
});
