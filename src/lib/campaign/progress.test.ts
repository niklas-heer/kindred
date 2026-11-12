// node --test src/lib/campaign/progress.test.ts — the moves of a reign under way: which of them are settled, and whether
// one list goes on from another.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Move } from './engine.ts';
import { goesOnFrom, settled, turnOf } from './progress.ts';

const place: Move = { t: 'place', to: 1 };
const march: Move = { t: 'march', from: 1, to: 2, troops: 2 };
const attack: Move = { t: 'attack', from: 2, to: 3, troops: 3 };
const end: Move = { t: 'end' };

test('what is settled: everything up to the last battle or end of a turn, and nothing that can still be undone', () => {
  assert.deepEqual(settled([]), []);
  assert.deepEqual(settled([place, march]), [], 'placing and marching can be taken back');
  assert.deepEqual(settled([place, attack, march, place]), [place, attack]);
  assert.deepEqual(settled([place, attack, march, end, place]), [place, attack, march, end]);
  assert.equal(turnOf([place, end, attack, end, march]), 2);
});

test('a list goes on from another when it begins with the same moves', () => {
  assert.ok(goesOnFrom([place, attack, end], [place, attack]));
  assert.ok(goesOnFrom([place, attack], [place, attack]), 'the same list goes on from itself');
  assert.ok(goesOnFrom([place], []));
  assert.ok(!goesOnFrom([place], [place, attack]), 'a shorter list does not');
  assert.ok(!goesOnFrom([place, { ...attack, troops: 2 }, end], [place, attack]), 'a battle fought another way does not');
  assert.ok(!goesOnFrom([march, attack], [place, attack]));
  // The order of a move's fields does not matter: the server reads them back from JSON.
  assert.ok(goesOnFrom([{ troops: 3, to: 3, from: 2, t: 'attack' } as Move], [attack]));
});
