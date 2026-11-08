// node --test src/lib/ai-portrait-picks.test.ts — the recommended painters: only those the provider lists are offered, Flare is
// the default when no model is chosen, and a saved choice is never replaced.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PORTRAIT_MODEL, RECOMMENDED, RECOMMENDED_PORTRAIT, portraitModelOr, portraitPicks } from './ai/recommended.ts';

const FLARE = 'openai/gpt-image-2.6-flare';
const KLEIN = 'black-forest-labs/flux-3-image-klein';
const list = (...ids: string[]) => ids.map((id) => ({ id }));

test('Flare is the best pick and the default, and FLUX 3 Klein the budget pick, both on OpenRouter', () => {
  assert.equal(DEFAULT_PORTRAIT_MODEL, FLARE);
  assert.deepEqual(RECOMMENDED_PORTRAIT.map((r) => [r.provider, r.model, r.role]), [['openrouter', FLARE, 'best'], ['openrouter', KLEIN, 'cheap']]);
  for (const r of RECOMMENDED_PORTRAIT) assert.equal(r.provisional, false, `${r.model} was measured`);
});

test('the models that lost the likeness are not recommended, and the painters stay out of the text list', () => {
  const ids = RECOMMENDED_PORTRAIT.map((r) => r.model);
  assert.ok(!ids.some((id) => /krea-2-large|recraft/.test(id)));
  assert.ok(!RECOMMENDED.some((r) => ids.includes(r.model)));
});

test('a recommended model the provider does not list is not offered', () => {
  assert.deepEqual(portraitPicks(list(FLARE, KLEIN, 'x/y')).map((r) => r.model), [FLARE, KLEIN]);
  assert.deepEqual(portraitPicks(list(KLEIN)).map((r) => r.model), [KLEIN]);
  assert.deepEqual(portraitPicks(list('x/y')), []);
});

test('no model chosen takes Flare when it is listed, and nothing when it is not', () => {
  assert.equal(portraitModelOr('', list(FLARE, KLEIN)), FLARE);
  assert.equal(portraitModelOr('  ', list(FLARE)), FLARE);
  assert.equal(portraitModelOr('', list(KLEIN)), '', 'the budget pick is not silently taken instead');
});

test('a saved choice is kept, even one the provider no longer lists', () => {
  assert.equal(portraitModelOr(KLEIN, list(FLARE, KLEIN)), KLEIN);
  assert.equal(portraitModelOr('old/retired', list(FLARE)), 'old/retired');
});
