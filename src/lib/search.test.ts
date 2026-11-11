// node --test src/lib/search.test.ts — names: the name a person goes by now is what shows, and a search finds
// a person by the birth name or the current one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayName, fullName, personDisplayName } from './graph.ts';
import { matchesName, pickList, rankByName } from './search.ts';
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

// ---------- who a person picker lists, and in what order ----------

const person = (id: string, given: string, surname: string): GPerson => ({ id, given, surname, living: true, stories: 0, contacts: 0 });
const people = [
  person('a', 'Kjell', 'Lindqvist'), person('b', 'Claire', 'Ashworth'), person('c', 'Sven', 'Lindqvist'),
  person('d', 'Rachel', 'Ashworth'), person('e', 'Margit', 'Ashworth'), person('f', 'Kerstin', 'Holm'),
];
const ids = (list: GPerson[]) => list.map((p) => p.id).join('');

test('with nobody suggested, the family’s own order is kept', () => {
  assert.equal(ids(pickList(people, '')), 'abcdef');
  assert.equal(ids(pickList(people, 'ashworth')), 'bde');
});

test('suggested people come first, in the order they were suggested', () => {
  assert.equal(ids(pickList(people, '', ['f', 'd'])), 'fdabce');
});

test('what was typed still decides who is listed; a suggestion only moves a match up', () => {
  assert.equal(ids(pickList(people, 'ashworth', ['e', 'f'])), 'ebd');
  assert.equal(ids(pickList(people, 'zzz', ['e'])), '');
});

test('the list stops at the limit, and someone who has left the family is not invented', () => {
  assert.equal(ids(pickList(people, '', ['f', 'gone'], 3)), 'fab');
});

test('a search ignores accents and finds an umlaut spelled out, and ß as ss', () => {
  assert.ok(matchesName(ann, 'Muller'));
  assert.ok(matchesName(ann, 'Mueller'));
  assert.ok(matchesName(ann, 'anna müll'));
  const str = { ...cy, given: 'Ida', surname: 'Großmann' };
  assert.ok(matchesName(str, 'grossmann'));
  assert.ok(matchesName(str, 'Großm'));
  assert.ok(!matchesName(ann, 'Muellerx'));
});

test('names are ranked with a word that starts the name above one found inside it', () => {
  const places = ['Neustadt', 'Stuttgart', 'Bad Cannstatt, Stuttgart', 'Münster', 'Ostrava'];
  assert.deepEqual(rankByName(places, 'st', (x) => x), ['Stuttgart', 'Bad Cannstatt, Stuttgart', 'Neustadt', 'Münster', 'Ostrava']);
  assert.deepEqual(rankByName(places, 'munster', (x) => x), ['Münster']);
  assert.deepEqual(rankByName(places, 'muenster', (x) => x), ['Münster']);
  assert.deepEqual(rankByName(places, '  ', (x) => x), []);
  assert.equal(rankByName(places, 's', (x) => x, 2).length, 2);
});
