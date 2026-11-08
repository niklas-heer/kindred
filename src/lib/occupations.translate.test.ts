// The translation rule without a model or a database: the vocabulary, then the cache, then the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translation, type TranslationStore } from './occupations.translate.ts';

function memory(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const store: TranslationStore = {
    get: async (text, locale) => rows.get(`${locale}:${text}`),
    put: async (text, locale, label) => void rows.set(`${locale}:${text}`, label),
  };
  return { store, rows };
}
const noModel = async () => {
  throw new Error('the model must not be asked');
};

test('a text the vocabulary knows is answered without asking the cache or the model', async () => {
  assert.deepEqual(await translation('Lehrerin', 'de', memory().store, noModel), { label: 'Lehrer:in', code: 'teacher', from: 'vocabulary' });
});

test('a cached translation for the same text and locale is returned, and the model is not asked', async () => {
  const { store } = memory({ 'de:Ex-circus clown': 'Zirkusclown' });
  assert.deepEqual(await translation('  Ex-circus clown ', 'de', store, noModel), { label: 'Zirkusclown', code: null, from: 'cache' });
  const other = await translation('Ex-circus clown', 'af', store, async () => ({ label: 'Sirkusnar' }));
  assert.deepEqual(other, { label: 'Sirkusnar', code: null, from: 'model' }, 'a cache entry is per locale');
});

test('a model answer is trimmed, stored for the next reader, and never replaces the text', async () => {
  const { store, rows } = memory();
  const answer = await translation('Sea-glass collector', 'en', store, async () => ({ label: '  Sea-glass collector  ' }));
  assert.equal(answer?.label, 'Sea-glass collector');
  assert.equal(answer?.code, null);
  assert.equal(answer?.from, 'model');
  assert.equal(rows.get('en:Sea-glass collector'), 'Sea-glass collector');
});

test('a reply that is not the shape asked for is reported as no answer and stores nothing', async () => {
  const { store, rows } = memory();
  assert.equal(await translation('Sea-glass collector', 'en', store, async () => ({ words: 'oops' })), undefined);
  assert.equal(await translation('Sea-glass collector', 'en', store, async () => ({ label: '' })), undefined);
  assert.equal(rows.size, 0);
});

test('when the model cannot be asked (the AI is off), its error reaches the caller and nothing is stored', async () => {
  const { store, rows } = memory();
  await assert.rejects(() => translation('Sea-glass collector', 'en', store, async () => { throw new Error('not-configured'); }), /not-configured/);
  assert.equal(rows.size, 0);
});
