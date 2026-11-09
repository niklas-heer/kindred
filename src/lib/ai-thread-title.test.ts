import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blendedPrice, costHint, nextStronger, type ModelChoice } from './ai/model-choice.ts';
import { foldText, snippetAround, threadTitle, TITLE_CHARS } from './ai/thread-title.ts';

test('a title is the first line, without markup, cut at a word', () => {
  assert.equal(threadTitle('  # Who **was** Ada?\nSecond line'), 'Who was Ada?');
  const long = threadTitle('Please tell me everything about the people who lived near the old river mill');
  assert.ok(long.endsWith('…') && Array.from(long).length <= TITLE_CHARS + 1, long);
  assert.ok(!/\s…$/.test(long));
  assert.equal(threadTitle('\n\n  '), '');
});
test('one very long word is cut, and an emoji is never split', () => {
  assert.equal(Array.from(threadTitle('x'.repeat(200))).length, TITLE_CHARS + 1);
  assert.ok(!threadTitle('👑'.repeat(60)).includes('�'));
});
test('search folding ignores case and accents and keeps positions', () => {
  assert.equal(foldText('Müller ÉA'), 'muller ea');
  const text = 'Über die Großmutter Müller und ihre Briefe';
  assert.ok(snippetAround(text, foldText(text).indexOf('muller'), 6).includes('Müller'));
});
test('cost hints come from the price of a typical chat', () => {
  assert.equal(costHint(blendedPrice(0.1, 0.5)), '$');
  assert.equal(costHint(blendedPrice(2, 10)), '$$');
  assert.equal(costHint(blendedPrice(10, 50)), '$$$');
  assert.equal(costHint(blendedPrice(null, 5)), '');
});
const m = (provider: ModelChoice['provider'], id: string, blended: number | null): ModelChoice => ({ provider, id, name: id, cost: '', recommended: false, blended });
test('the next stronger model is the provider’s next tier, or the next dearer model', () => {
  const list = [m('anthropic', 'claude-haiku-5-5', 0.18), m('anthropic', 'claude-sonnet-5-5', 3.6), m('anthropic', 'claude-opus-5-5', 7.2), m('anthropic', 'some-other', 9)];
  assert.equal(nextStronger({ provider: 'anthropic', model: 'claude-haiku-5-5' }, list)?.id, 'claude-sonnet-5-5');
  assert.equal(nextStronger({ provider: 'anthropic', model: 'claude-opus-5-5' }, list), null, 'nothing above the best tier');
  assert.equal(nextStronger({ provider: 'anthropic', model: 'unlisted' }, list)?.id, 'claude-haiku-5-5');
  assert.equal(nextStronger({ provider: 'fake', model: 'claude-haiku-5-5' }, list)?.id, 'claude-sonnet-5-5');
});
