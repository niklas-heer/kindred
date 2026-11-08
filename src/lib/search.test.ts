// node --test src/lib/search.test.ts — names: the name a person goes by now is what shows, and a search finds
// a person by the birth name or the current one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayName, fullName, personDisplayName } from './graph.ts';
import { matchesName } from './search.ts';
import type { GPerson } from './types.ts';

const ann: GPerson = { id: 'ann', given: 'Anna', surname: 'Müller', currentSurname: 'Schmidt', nickname: 'Ann', living: true, stories: 0, contacts: 0 };
const cy: GPerson = { id: 'cy', given: 'Cy', living: false, stories: 0, contacts: 0 };

test('the current name is shown, in every name mode', () => {
  assert.equal(displayName(ann), 'Anna Schmidt');
  assert.equal(fullName(ann), 'Anna Schmidt');
  assert.equal(personDisplayName(ann, 'full'), 'Anna Schmidt');
  assert.equal(personDisplayName(ann, 'first'), 'Anna');
  assert.equal(personDisplayName(ann, 'nickname'), 'Ann');
});

test('a current given name replaces the birth name, and a null one follows it', () => {
  assert.equal(personDisplayName({ ...ann, currentGiven: 'Hanna' }, 'first'), 'Hanna');
  assert.equal(personDisplayName({ ...ann, currentGiven: 'Hanna' }, 'nickname'), 'Ann');
  assert.equal(displayName({ ...ann, currentSurname: undefined }), 'Anna Müller');
  assert.equal(displayName(cy), 'Cy');
});

test('a search finds a person by the birth name or the current one, in any order, without accents', () => {
  assert.ok(matchesName(ann, 'Müller'));
  assert.ok(matchesName(ann, 'muller'));
  assert.ok(matchesName(ann, 'Schmidt'));
  assert.ok(matchesName(ann, 'schmidt anna'));
  assert.ok(matchesName(ann, '  ann '));
  assert.ok(matchesName(cy, ''));
  assert.ok(!matchesName(ann, 'Bob'));
  assert.ok(!matchesName(cy, 'Schmidt'));
});
