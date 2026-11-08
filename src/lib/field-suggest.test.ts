import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countrySuggestions, languageSuggestions, wordSuggestions } from './field-suggest.ts';

const labels = (s: { label: string }[]) => s.map((x) => x.label);

test('with nothing typed: the family\'s languages first, then the common ones', () => {
  const list = languageSuggestions('', 'en-GB', [{ value: 'Italian', n: 1 }, { value: 'Portuguese', n: 4 }]);
  assert.deepEqual(labels(list).slice(0, 2), ['Portuguese', 'Italian']);
  assert.ok(list[0].used);
  assert.ok(labels(list).includes('German'));
  assert.ok(!list.at(-1)!.used);
});

test('names are in the reader\'s language', () => {
  assert.ok(labels(languageSuggestions('', 'de-DE')).includes('Deutsch'));
  assert.ok(labels(languageSuggestions('', 'af-ZA')).includes('Duits'));
});

test('typing finds a language by its name in any of the three languages', () => {
  const list = languageSuggestions('Ger', 'de-DE');
  const hit = list.find((x) => x.label === 'Deutsch');
  assert.equal(hit?.hint, 'German');
});

test('typing reaches beyond the common list', () => {
  assert.ok(labels(languageSuggestions('Xho', 'en-GB')).includes('Xhosa'));
});

test('the family\'s spelling of a known language counts for that language, in the reader\'s word', () => {
  const list = languageSuggestions('', 'en-GB', [{ value: 'Deutsch', n: 3 }]);
  assert.equal(list[0].label, 'German');
  assert.equal(labels(list).filter((l) => l === 'Deutsch').length, 0);
  assert.equal(labels(list).filter((l) => l === 'German').length, 1);
});

test('a word only this family uses is offered as they wrote it', () => {
  const list = languageSuggestions('Schw', 'de-DE', [{ value: 'Schwäbisch', n: 2 }]);
  assert.equal(list[0].label, 'Schwäbisch');
  assert.ok(list[0].used);
});

test('a family word in the list is not offered twice', () => {
  const list = wordSuggestions('', ['Fluent', 'Basic'], [{ value: 'fluent', n: 2 }]);
  assert.deepEqual(labels(list), ['Fluent', 'Basic']);
});

test('countries come in the reader\'s language and leave out what is not a country', () => {
  assert.ok(labels(countrySuggestions('Deutsch', 'de-DE')).includes('Deutschland'));
  assert.ok(labels(countrySuggestions('Germ', 'en-GB')).includes('Germany'));
  assert.deepEqual(labels(countrySuggestions('Unknown Region', 'en-GB')), []);
  assert.deepEqual(labels(countrySuggestions('Pseudo', 'en-GB')), []);
});

test('text nothing matches gives an empty list, so free text just stays', () => {
  assert.deepEqual(languageSuggestions('Klingonish', 'en-GB'), []);
});
