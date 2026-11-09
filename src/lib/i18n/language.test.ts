// node --test src/lib/i18n/language.test.ts — the grammar the dictionary cannot hold in a single string: ordinals,
// sorting, whole anniversary names and sentence templates. Names are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareText, ordinal, ordinalWord } from './dictionary.ts';

test('Afrikaans ordinals: -ste for 1, 8 and from 20 up, the last two digits past a hundred', () => {
  const af = (n: number) => ordinal(n, 'af');
  assert.deepEqual([1, 2, 3, 7, 8, 9, 10, 12, 19].map(af), ['1ste', '2de', '3de', '7de', '8ste', '9de', '10de', '12de', '19de']);
  assert.deepEqual([20, 21, 25, 28, 58, 99].map(af), ['20ste', '21ste', '25ste', '28ste', '58ste', '99ste']);
  assert.deepEqual([100, 101, 102, 108, 110, 120, 1000].map(af), ['100ste', '101ste', '102de', '108ste', '110de', '120ste', '1000ste']);
  assert.equal(ordinalWord(25, 'af'), '25ste');
  assert.equal(ordinal(25, 'de'), '25.');
  assert.equal(ordinal(21, 'en'), '21st');
});

test('names sort the way the reader’s language sorts them', () => {
  const names = ['Zimmer', 'Öberg', 'Muzzy', 'Müller', 'Ärmel', 'Anna 10', 'Anna 2', 'Berg'];
  assert.deepEqual([...names].sort(compareText('de')), ['Anna 2', 'Anna 10', 'Ärmel', 'Berg', 'Müller', 'Muzzy', 'Öberg', 'Zimmer']);
  assert.deepEqual([...names].sort(compareText('en')).slice(0, 3), ['Anna 2', 'Anna 10', 'Ärmel']);
  assert.ok(compareText('af')('Öberg', 'Zimmer') < 0);
});
