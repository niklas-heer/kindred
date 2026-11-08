// node --test src/lib/auth/name.test.ts — the setup's name, split into the first person's given name and surname.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitName } from './name.ts';

test('the name splits at its last space: everything before is the given name', () => {
  assert.deepEqual(splitName('Paula Probe'), { given: 'Paula', surname: 'Probe' });
  assert.deepEqual(splitName('Ludwig van Beethoven'), { given: 'Ludwig van', surname: 'Beethoven' });
  assert.deepEqual(splitName('  Anna   Maria  Schmidt '), { given: 'Anna Maria', surname: 'Schmidt' }, 'spaces are collapsed');
});

test('one word is a given name with no surname; nothing is nothing', () => {
  assert.deepEqual(splitName('Anna'), { given: 'Anna', surname: '' });
  assert.deepEqual(splitName('   '), { given: '', surname: '' });
});
