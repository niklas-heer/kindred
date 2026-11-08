// How a house's AI-written text is shown in the reader's language, and how a model's translation is checked. No model, no database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SavedMeaning, SavedMeaningRow } from './house-meaning.ts';
import { meaningLine } from './house-meaning.ts';
import { checkMeanings, checkReview, meaningsSource, reviewSource, translateReview, translateRow, translateSaved, type MeaningTranslation } from './house-translation.ts';

const row = (over: Partial<SavedMeaningRow> = {}): SavedMeaningRow => ({
  id: 'm1', language: 'Dutch and German', root: 'heer', meaning: 'lord, gentleman', attestation: 'well-attested', chosen: true,
  ideas: [{ kind: 'quality', idea: 'courage' }], sources: [{ url: 'https://example.org/heer', title: 'Heer' }], ...over,
});
const saved = (meanings: SavedMeaningRow[] = [row()], note = 'Little is known.'): SavedMeaning => ({ house: 'h1', name: 'Heer', familyWords: '', webSearched: false, note, savedAt: 1, meanings });

const source = meaningsSource(saved())!;
const german = (): MeaningTranslation => {
  const checked = checkMeanings(source, { same: false, note: 'Wenig ist bekannt.', meanings: [{ id: 'm1', language: 'Niederländisch und Deutsch', meaning: 'Herr', ideas: ['Mut'] }] });
  assert.ok(checked && !checked.same);
  return checked.content;
};

test('the German is shown when there is one; the root and the source links stay as they are', () => {
  const shown = translateSaved(saved(), german());
  assert.equal(shown.note, 'Wenig ist bekannt.');
  const m = shown.meanings[0];
  assert.equal(m.language, 'Niederländisch und Deutsch');
  assert.equal(m.meaning, 'Herr');
  assert.equal(m.ideas[0].idea, 'Mut');
  assert.equal(m.ideas[0].kind, 'quality');
  assert.equal(m.root, 'heer');
  assert.deepEqual(m.sources, row().sources);
  assert.equal(m.chosen, true);
  assert.equal(meaningLine(shown), 'Herr', 'the line in the list of houses is translated too');
});

test('without a translation the original is shown', () => {
  const s = saved();
  assert.equal(translateSaved(s, undefined), s);
  assert.equal(translateRow(row({ id: 'other' }), german()).meaning, 'lord, gentleman');
});

test('a translation of older text is not laid over newer text', () => {
  assert.equal(translateRow(row({ meaning: 'an army' }), german()).meaning, 'an army');
  assert.equal(translateSaved(saved([row()], 'A new note.'), german()).note, 'A new note.');
});

test('the family’s own words are neither sent nor replaced', () => {
  const family = row({ id: 'own1', root: '', language: '', meaning: 'We kept an estate.', attestation: 'family', ideas: [] });
  assert.deepEqual(meaningsSource(saved([family], ''))?.meanings, undefined);
  assert.deepEqual(meaningsSource(saved([row(), family]))?.meanings.map((m) => m.id), ['m1']);
  const t: MeaningTranslation = { note: '', noteOf: '', rows: { own1: { of: JSON.stringify(['', 'We kept an estate.', []]), language: '', meaning: 'Übersetzt', ideas: [] } } };
  assert.equal(translateRow(family, t).meaning, 'We kept an estate.');
});

test('nothing to translate is no work at all', () => {
  assert.equal(meaningsSource(saved([], '  ')), undefined);
  assert.equal(reviewSource({ reason: ' ', advice: '' }), undefined);
});

test('a translation is accepted only when every piece is there', () => {
  const reply = { same: false, note: 'N', meanings: [{ id: 'm1', language: 'L', meaning: 'M', ideas: ['I'] }] };
  assert.ok(checkMeanings(source, reply));
  assert.deepEqual(checkMeanings(source, { same: true, note: '', meanings: [] }), { same: true });
  assert.equal(checkMeanings(source, { ...reply, meanings: [] }), undefined, 'a meaning is missing');
  assert.equal(checkMeanings(source, { ...reply, meanings: [{ ...reply.meanings[0], id: 'x' }] }), undefined, 'an id was changed');
  assert.equal(checkMeanings(source, { ...reply, meanings: [{ ...reply.meanings[0], ideas: [] }] }), undefined, 'an idea is missing');
  assert.equal(checkMeanings(source, { ...reply, note: ' ' }), undefined, 'the note is missing');
  assert.equal(checkMeanings(source, { words: 'oops' }), undefined);
});

test('an arms check reads in the reader’s language, and only when it is about this text', () => {
  const r = { reason: 'Only courage.', advice: 'Add a trade.', house: 'h1' };
  const checked = checkReview(r, { same: false, reason: 'Nur Mut.', advice: 'Ein Gewerbe ergänzen.' });
  assert.ok(checked && !checked.same);
  assert.deepEqual(translateReview(r, checked.content), { reason: 'Nur Mut.', advice: 'Ein Gewerbe ergänzen.', house: 'h1' });
  assert.equal(translateReview({ ...r, reason: 'New.' }, checked.content).reason, 'New.');
  assert.equal(translateReview(r, undefined), r);
  assert.equal(checkReview(r, { same: false, reason: 'Nur Mut.', advice: '' }), undefined, 'the advice is missing');
});
