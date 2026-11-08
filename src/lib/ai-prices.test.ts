// node --test src/lib/ai-prices.test.ts — what a call costs. The price of a model comes from the family's own price first,
// then the table, then OpenRouter's list, then a conservative default; a cost is tokens at the per-1M prices plus the
// searches at the per-search price, in micro-dollars, rounded up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSERVATIVE, ESTIMATE_CONVERSATION, PRICE_TABLE, conversationsForDollar, costMicros, reportedMicros, resolvePrice, tablePrice } from './ai/prices.ts';
import { RECOMMENDED } from './ai/recommended.ts';

test('a call costs its tokens at the per-1M prices, and its searches at the per-search price, in micro-dollars', () => {
  // 1,000 tokens in at $2 per 1M is $0.002; 500 out at $10 per 1M is $0.005; 2 searches at $0.01 is $0.02. Total $0.027.
  const micros = costMicros({ inputTokens: 1000, outputTokens: 500, searches: 2 }, { inPerM: 2, outPerM: 10, searchEach: 0.01 });
  assert.equal(micros, 27_000);
});

test('a cost is rounded up, so a booking never undercounts', () => {
  assert.equal(costMicros({ inputTokens: 1, outputTokens: 0, searches: 0 }, { inPerM: 0.1, outPerM: 0, searchEach: 0 }), 1);
});

test('a family’s own price beats the table; the table beats OpenRouter’s list; the list beats the default', () => {
  const listed = { inPerM: 7, outPerM: 9, searchEach: 0.004 };
  assert.equal(resolvePrice('anthropic', 'claude-sonnet-5-5', { 'claude-sonnet-5-5': { inPerM: 3, outPerM: 4 } }).source, 'custom');
  assert.equal(resolvePrice('anthropic', 'claude-sonnet-5-5', { 'claude-sonnet-5-5': { inPerM: 3, outPerM: 4 } }).price.inPerM, 3);
  assert.equal(resolvePrice('anthropic', 'claude-sonnet-5-5', {}).source, 'table');
  assert.equal(resolvePrice('openrouter', 'anthropic/claude-sonnet-5-5', {}, listed).source, 'openrouter');
  assert.equal(resolvePrice('openrouter', 'anthropic/claude-sonnet-5-5', {}, listed).price.searchEach, 0.004);
  const unknown = resolvePrice('openrouter', 'unknown/model', {});
  assert.equal(unknown.source, 'default');
  assert.deepEqual(unknown.price, CONSERVATIVE);
});

test('a model with no known price is booked at the conservative default, which is never cheaper than a known model', () => {
  const known = [...Object.values(PRICE_TABLE.anthropic), ...Object.values(PRICE_TABLE.openai)];
  assert.ok(CONSERVATIVE.inPerM >= Math.max(...known.map((p) => p.inPerM)), 'the default input price is at least the dearest known');
  assert.ok(CONSERVATIVE.outPerM >= Math.max(...known.map((p) => p.outPerM)), 'the default output price is at least the dearest known');
  assert.equal(tablePrice('openrouter', 'anthropic/claude-sonnet-5-5'), undefined, 'OpenRouter has no table: its list is the source');
});

test('the price table has positive prices for every entry, and the search price is $10 per 1,000', () => {
  for (const table of [PRICE_TABLE.anthropic, PRICE_TABLE.openai]) {
    for (const [model, p] of Object.entries(table)) {
      assert.ok(p.inPerM > 0 && p.outPerM > 0, `${model} has a positive price`);
      assert.equal(p.searchEach, 0.01);
    }
  }
});

test('every recommended model is a known model in the price table, or an OpenRouter id', () => {
  for (const r of RECOMMENDED) {
    assert.equal(r.provisional, r.provider !== 'anthropic', 'only what scripts/ai-eval.ts measured loses the provisional mark');
    if (r.provider !== 'openrouter') assert.ok(tablePrice(r.provider, r.model), `${r.model} has a table price`);
  }
});

test('about how many typical conversations a dollar buys', () => {
  // One conversation is 4 questions of 2,000 tokens in and 500 out. At $2 in and $10 out that is $0.036, so $1 buys 27.
  assert.deepEqual(ESTIMATE_CONVERSATION, { questions: 4, inputTokens: 2000, outputTokens: 500 });
  assert.equal(conversationsForDollar({ inPerM: 2, outPerM: 10 }), 27);
  assert.equal(conversationsForDollar({ inPerM: 0, outPerM: 0 }), 0, 'a free model gives no number, rather than infinity');
});

test('a provider’s reported USD cost is used as micro-dollars, never negative', () => {
  assert.equal(reportedMicros(0.0042), 4200);
  assert.equal(reportedMicros(-1), 0);
});
