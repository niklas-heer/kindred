import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableOf } from './i18n/dictionary.ts';
import {
  OCCUPATIONS,
  germanPair,
  occupationById,
  occupationCodeFor,
  occupationForText,
  occupationLabel,
  occupationText,
  suggestOccupations,
} from './occupations.ts';

const baker = occupationById('baker')!;
const teacher = occupationById('teacher')!;

test('the vocabulary has unique, well-formed ids and every label in every language', () => {
  const ids = OCCUPATIONS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const o of OCCUPATIONS) {
    assert.match(o.id, /^[a-z][a-z0-9_]*$/, `${o.id} is a stable ascii id`);
    for (const l of ['en', 'de', 'af'] as const) assert.ok(String(tableOf(l)[`occupation.${o.id}`]).trim().length > 0, `${o.id} has a label in ${l}`);
    assert.ok(o.keywords.length >= 1, `${o.id} has search keywords`);
  }
  assert.ok(OCCUPATIONS.length >= 200, `about 250 entries, found ${OCCUPATIONS.length}`);
});

test('German gives the form for the person’s sex, and the pair when the sex is x or unknown', () => {
  assert.equal(occupationLabel(baker, 'de', 'm'), 'Bäcker');
  assert.equal(occupationLabel(baker, 'de', 'f'), 'Bäckerin');
  assert.equal(occupationLabel(baker, 'de', 'x'), 'Bäcker:in');
  assert.equal(occupationLabel(baker, 'de', undefined), 'Bäcker:in');
  assert.equal(occupationLabel(teacher, 'de', 'f'), 'Lehrerin');
  assert.equal(occupationLabel(teacher, 'de', 'x'), 'Lehrer:in');
  assert.equal(germanPair('Lehrer', 'Lehrerin'), 'Lehrer:in');
  assert.equal(germanPair('Bauer', 'Bäuerin'), 'Bauer/Bäuerin');
  assert.equal(occupationLabel(teacher, 'en', 'f'), 'Teacher', 'English and Afrikaans ignore sex');
  assert.equal(occupationLabel(teacher, 'af', 'm'), 'Onderwyser');
});

test('with a code the reader sees the entry in their language; without one, the text as written', () => {
  assert.equal(occupationText({ occupation: 'Bäckerin', occupationCode: 'baker', sex: 'f' }, 'de'), 'Bäckerin');
  assert.equal(occupationText({ occupation: 'Baker', occupationCode: 'baker', sex: 'm' }, 'de'), 'Bäcker');
  assert.equal(occupationText({ occupation: 'Baker', occupationCode: 'baker' }, 'en'), 'Baker');
  assert.equal(occupationText({ occupation: 'Ex-circus clown', occupationCode: null }, 'de'), 'Ex-circus clown');
  assert.equal(occupationText({ occupation: 'Ex-circus clown', occupationCode: 'not_a_real_id' }, 'en'), 'Ex-circus clown');
});

test('free text names an entry only by an exact or case-insensitive match in any language', () => {
  assert.equal(occupationForText('baker')?.id, 'baker');
  assert.equal(occupationForText('  BAKER  ')?.id, 'baker');
  assert.equal(occupationForText('Bäckerin')?.id, 'baker');
  assert.equal(occupationForText('Bakker')?.id, 'baker');
  assert.equal(occupationForText('Lehrer:in')?.id, 'teacher');
  assert.equal(occupationForText('a sort of wandering poet'), undefined);
  assert.equal(occupationForText('bake'), undefined, 'a part of a label is not a match');
  assert.equal(occupationForText(''), undefined);
});

test('the code stored with an occupation: an explicit choice wins, a stale id is dropped, else an exact text match', () => {
  assert.equal(occupationCodeFor('Bäckerin', 'baker'), 'baker');
  assert.equal(occupationCodeFor('whatever', 'not_a_real_id'), null);
  assert.equal(occupationCodeFor('Baker'), 'baker');
  assert.equal(occupationCodeFor('Ex-circus clown'), null);
  assert.equal(occupationCodeFor(null), null);
});

test('suggestions match in any language and put the reader’s own language first', () => {
  assert.equal(suggestOccupations('bak', 'en')[0].id, 'baker');
  assert.ok(suggestOccupations('bäck', 'de').some((o) => o.id === 'baker'), 'umlaut-free search finds the German word');
  assert.ok(suggestOccupations('Bakker', 'en').some((o) => o.id === 'baker'), 'an Afrikaans word finds the entry for an English reader');
  assert.ok(suggestOccupations('lehrerin', 'en').some((o) => o.id === 'teacher'), 'a feminine German form finds the entry');
  assert.deepEqual(suggestOccupations('   ', 'en'), []);
  assert.ok(suggestOccupations('bak', 'en', 3).length <= 3);
});
