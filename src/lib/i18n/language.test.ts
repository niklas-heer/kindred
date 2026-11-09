// node --test src/lib/i18n/language.test.ts — the grammar the dictionary cannot hold in a single string: ordinals,
// sorting, whole anniversary names and sentence templates. Names are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareText } from './dictionary.ts';

test('names sort the way the reader’s language sorts them', () => {
  const names = ['Zimmer', 'Öberg', 'Muzzy', 'Müller', 'Ärmel', 'Anna 10', 'Anna 2', 'Berg'];
  assert.deepEqual([...names].sort(compareText('de')), ['Anna 2', 'Anna 10', 'Ärmel', 'Berg', 'Müller', 'Muzzy', 'Öberg', 'Zimmer']);
  assert.deepEqual([...names].sort(compareText('en')).slice(0, 3), ['Anna 2', 'Anna 10', 'Ärmel']);
  assert.ok(compareText('af')('Öberg', 'Zimmer') < 0);
});
