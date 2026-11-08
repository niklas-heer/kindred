// node --test src/lib/ai-budget.test.ts — the family's AI budget. Every provider call is booked before it is sent;
// two calls racing for the last allowance cannot both get it; a call is settled to what the provider used; a call
// that fails is charged its estimate. Runs on a private data folder with the fake provider.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { AiRequest } from './ai/adapters.ts';

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
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const { tr } = await load<typeof import('./ai/labels.ts')>('/src/lib/ai/labels.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Anna', 'handle-budget', Date.now());

/** A family with the assistant on and a saved key, and the given daily budget. Each test uses its own family. */
async function family(tree: string, dailyTokens: number) {
  await settings.saveSettings(tree, 'u1', {
    provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, dailyTokens, apiKey: 'sk-test-abcdefgh1234',
  });
}

const req: AiRequest = { system: 'You answer briefly.', messages: [{ role: 'user', text: 'Who is Ada Lovelace?' }], maxTokens: 200 };

test('two calls racing for the last allowance: one is booked, the other is refused', async () => {
  const tree = 'race';
  await family(tree, settings.estimateTokens(req));
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  const results = await Promise.allSettled([adapter.complete(req), adapter.complete(req)]);
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(won.length, 1, 'exactly one call gets the allowance');
  assert.equal(lost.length, 1);
  assert.ok(lost[0].reason instanceof AiError);
  assert.equal(lost[0].reason.code, 'budget');
  assert.equal(await settings.usedToday(tree), 20, 'the winner is settled to the tokens the fake provider used');
});

test('a call the budget cannot cover is refused before it is sent, and spends nothing', async () => {
  const tree = 'refuse';
  await family(tree, 1);
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  await assert.rejects(adapter.complete(req), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(await settings.usedToday(tree), 0);
});

test('a call is settled to the tokens the provider reports, not to its estimate', async () => {
  const tree = 'settle';
  await family(tree, 100_000);
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  await adapter.complete(req);
  assert.equal(await settings.usedToday(tree), 20);
});

test('the next call sees what the last one really used', async () => {
  // The budget fits the first call's estimate; after it used 20 tokens, a second call of the same size no longer fits.
  const tree = 'sequence';
  await family(tree, settings.estimateTokens(req) + 10);
  const { adapter } = await settings.adapterForFeature(tree, 'assistant', 'en');
  await adapter.complete(req);
  await assert.rejects(adapter.complete(req), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(await settings.usedToday(tree), 20);
});

test('a failed call is charged its estimate, since the provider may have billed it', async () => {
  const tree = 'failed';
  await family(tree, 100_000);
  const failing = {
    provider: 'anthropic' as const,
    model: 'x',
    async complete(): Promise<never> { throw new AiError('timeout', 'slow'); },
  };
  const wrapped = settings.budgeted(tree, 100_000, failing, tr('en'));
  await assert.rejects(wrapped.complete(req), (e: unknown) => e instanceof AiError && e.code === 'timeout');
  assert.equal(await settings.usedToday(tree), settings.estimateTokens(req));
});

test('a family with no allowance left is refused with the budget message', async () => {
  const tree = 'empty';
  await family(tree, 0);
  await assert.rejects(settings.adapterForFeature(tree, 'assistant', 'en'), (e: unknown) => e instanceof AiError && e.code === 'budget');
});
