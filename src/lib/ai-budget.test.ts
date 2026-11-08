// node --test src/lib/ai-budget.test.ts — the family's AI budget, in money. Every provider call is booked before it is
// sent; two calls racing for the last of the month's budget cannot both get it; a refused call spends nothing; a call
// is settled to what it really cost (the provider's reported USD cost, else its tokens and searches at the model's
// price); a call that fails is charged its estimate. Runs on a private data folder with the fake provider.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { AiAdapter, AiRequest } from './ai/adapters.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-budget-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-budget-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const { AiError, outputCap } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const { tr } = await load<typeof import('./ai/labels.ts')>('/src/lib/ai/labels.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Anna', 'handle-budget', Date.now());

/** The fake's model: $1 in and $1 out per million tokens, so a token costs one micro-dollar. The fake's 20-token reply costs 20 micro-dollars. */
const FAKE_MODEL = 'claude-sonnet-5-5';
const ONE_DOLLAR_PER_M = { inPerM: 1, outPerM: 1 };
const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };

/** A family with the assistant on, a saved key, the given monthly budget in micro-dollars, and the test price. Each test uses its own family. */
async function family(tree: string, monthlyMicros: number) {
  await setup.setUpFamilyAi(tree, 'u1', {
    provider: 'anthropic',
    model: FAKE_MODEL,
    features: { assistant: true, faces: false, avatar: false, arms: false },
    webSearch: false,
    monthlyMicros,
    customPrices: { [FAKE_MODEL]: ONE_DOLLAR_PER_M },
    apiKey: 'sk-test-abcdefgh1234',
  });
}

const req: AiRequest = { system: 'You answer briefly.', messages: [{ role: 'user', text: 'Who is Ada Lovelace?' }], maxTokens: 200 };

test('two calls racing for the last of the budget: one is booked, the other is refused', async () => {
  const tree = 'race';
  await family(tree, settings.estimateMicros(req, price));
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  const results = await Promise.allSettled([adapter.complete(req), adapter.complete(req)]);
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(won.length, 1, 'exactly one call gets the budget');
  assert.equal(lost.length, 1);
  assert.ok(lost[0].reason instanceof AiError);
  assert.equal(lost[0].reason.code, 'budget');
  assert.equal(await settings.spentThisMonth(tree), 20, 'the winner is settled to what its tokens cost at the model price');
});

test('a call the budget cannot cover is refused before it is sent, and spends nothing', async () => {
  const tree = 'refuse';
  await family(tree, 1);
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  await assert.rejects(adapter.complete(req), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(await settings.spentThisMonth(tree), 0);
});

test('a call is settled to what its tokens cost, not to its estimate', async () => {
  const tree = 'settle';
  await family(tree, 100_000_000);
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  await adapter.complete(req);
  assert.equal(await settings.spentThisMonth(tree), 20);
});

test('the next call sees what the last one really cost', async () => {
  // The budget fits the first call's estimate plus ten micro-dollars; after the first call cost 20, a second call of the same size no longer fits.
  const tree = 'sequence';
  await family(tree, settings.estimateMicros(req, price) + 10);
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  await adapter.complete(req);
  await assert.rejects(adapter.complete(req), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(await settings.spentThisMonth(tree), 20);
});

test('a failed call is charged its estimate, since the provider may have billed it', async () => {
  const tree = 'failed';
  const failing: AiAdapter = {
    provider: 'anthropic',
    model: 'x',
    async complete(): Promise<never> { throw new AiError('timeout', 'slow'); },
  };
  const wrapped = settings.budgeted(tree, 100_000_000, failing, price, tr('en'));
  await assert.rejects(wrapped.complete(req), (e: unknown) => e instanceof AiError && e.code === 'timeout');
  // The failed call is charged the reservation it made, which reserves the cap the Anthropic adapter sends (outputCap).
  assert.equal(await settings.spentThisMonth(tree), settings.estimateMicros(req, price, outputCap('anthropic', 'x', req.maxTokens)));
});

test('a provider that reports its own USD cost is settled to that cost', async () => {
  const tree = 'reported';
  const reporting: AiAdapter = {
    provider: 'openrouter',
    model: 'x',
    async complete() {
      return { text: 'ok', calls: [], tokens: 20, inputTokens: 10, outputTokens: 10, searches: 1, reportedCostUsd: 0.0005 };
    },
  };
  const wrapped = settings.budgeted(tree, 100_000_000, reporting, price, tr('en'));
  await wrapped.complete(req);
  assert.equal(await settings.spentThisMonth(tree), 500, 'half a cent is 500 micro-dollars, whatever the tokens would have cost');
});

test('a family with no budget left is refused with the budget message', async () => {
  const tree = 'empty';
  await family(tree, 0);
  await assert.rejects(settings.adapterForFeature(tree, 'assistant', 'en'), (e: unknown) => e instanceof AiError && e.code === 'budget');
});

test('the budget is per UTC month: the next month starts at zero', () => {
  assert.equal(settings.resetsOn(new Date(Date.UTC(2026, 10, 8))), '2026-12-01');
  assert.equal(settings.resetsOn(new Date(Date.UTC(2026, 11, 31, 23, 59))), '2027-01-01');
});
