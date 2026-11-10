// node --test src/lib/proposal-label.test.ts — the assistant's proposal card shows a field's stored label the way the
// Edit tab shows it: the preset word translated, and a label the family typed kept as typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPresetLabel } from './fields/presets.ts';
import { translate, type Key } from './i18n/dictionary.ts';

/** A translator as the components get from `useT()`, for one language. */
const as = (locale: 'de' | 'en') => Object.assign((key: Key) => translate(locale, key), { locale, setLocale: () => {} });
const de = as('de');
const en = as('en');

test('a preset label in the summary is shown as the Edit tab shows it, in the reader’s language', () => {
  assert.equal(withPresetLabel('Allergien (food) bei Paula', 'food', de), `Allergien (${translate('de', 'preset.food')}) bei Paula`);
  assert.equal(withPresetLabel('Allergies (food) for Paula', 'food', en), `Allergies (${translate('en', 'preset.food')}) for Paula`);
});

test('a label the family typed stays as typed', () => {
  assert.equal(withPresetLabel('Notes (Grandma’s recipes) for Paula', 'Grandma’s recipes', de), 'Notes (Grandma’s recipes) for Paula');
});

test('no label, or a summary without it, is left alone', () => {
  assert.equal(withPresetLabel('Phone for Paula', '', de), 'Phone for Paula');
  assert.equal(withPresetLabel('Phone for Paula', 'mobile', de), 'Phone for Paula');
});
