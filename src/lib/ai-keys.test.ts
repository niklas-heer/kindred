// node --test src/lib/ai-keys.test.ts — a saved key is used only with the provider it was saved for. Test connection and
// Save with a different provider and no new key are refused with `key-required`, and nothing is sent anywhere. Saving a
// new provider with a new key replaces the key. Runs on a private data folder; `fetch` is stubbed, so nothing is called.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-keys-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '0';
process.env.KINDRED_SECRET = 'ai-keys-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const { openKey } = await load<typeof import('./ai/secret.server.ts')>('/src/lib/ai/secret.server.ts');
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ANTHROPIC_KEY = 'sk-ant-SAVED-SECRET-for-anthropic';
const OPENAI_KEY = 'sk-openai-TYPED-for-openai-1234';
const TREE = 'keys';

/** Counts every request. Nothing is sent in a refused case, so the count must stay at zero. */
function stubFetch(reply: () => Response): { calls: { url: string; auth: string }[] } {
  const calls: { url: string; auth: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), auth: headers.authorization ?? headers['x-api-key'] ?? '' });
    return reply();
  }) as typeof fetch;
  return { calls };
}

const okReply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Anna', 'handle-keys', Date.now());
await settings.saveSettings(TREE, 'u1', {
  provider: 'anthropic', model: '', features: { assistant: false, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: ANTHROPIC_KEY,
});

test('the saved key fits only the provider it was saved for', () => {
  const cur = { sealed: 'v1.x.y', provider: 'anthropic' as const };
  assert.equal(settings.savedKeyFits(cur, 'anthropic'), true);
  assert.equal(settings.savedKeyFits(cur, 'openai'), false);
  assert.equal(settings.savedKeyFits(cur, 'openrouter'), false);
  assert.equal(settings.savedKeyFits({ sealed: null, provider: 'anthropic' }, 'anthropic'), false, 'no key saved, nothing fits');
});

test('test connection with another provider and no new key is refused, and nothing is sent', async () => {
  const sent = stubFetch(okReply);
  const r = await settings.testConnection(TREE, { provider: 'openai', model: 'gpt-6.1-sol' }, 'en');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'key-required');
  assert.equal(sent.calls.length, 0, 'no request left the server');
  assert.ok(!JSON.stringify(r).includes(ANTHROPIC_KEY), 'the saved key is not echoed');
});

test('test connection with the saved provider and no typed key uses the saved key, with that provider only', async () => {
  const sent = stubFetch(okReply);
  const r = await settings.testConnection(TREE, { provider: 'anthropic', model: 'claude-sonnet-5-5' }, 'en');
  assert.equal(r.ok, true);
  assert.equal(sent.calls.length, 1);
  assert.match(sent.calls[0].url, /api\.anthropic\.com/);
  assert.equal(sent.calls[0].auth, ANTHROPIC_KEY);
});

test('test connection with a typed key for another provider sends only the typed key, to that provider', async () => {
  const sent = stubFetch(okReply);
  const r = await settings.testConnection(TREE, { provider: 'openai', model: 'gpt-6.1-sol', apiKey: OPENAI_KEY }, 'en');
  assert.equal(r.ok, true);
  assert.equal(sent.calls.length, 1);
  assert.match(sent.calls[0].url, /api\.openai\.com/);
  assert.equal(sent.calls[0].auth, `Bearer ${OPENAI_KEY}`);
  assert.ok(!sent.calls.some((c) => c.auth.includes(ANTHROPIC_KEY)), 'the saved key never reaches another provider');
});

test('saving another provider with no new key is refused, and the saved settings are unchanged', async () => {
  await assert.rejects(
    settings.saveSettings(TREE, 'u1', {
      provider: 'openrouter', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {},
    }),
    (e: unknown) => e instanceof AiError && e.code === 'key-required' && e.message === 'ai.err_key_required',
  );
  const cur = await settings.readSettings(TREE);
  assert.equal(cur.provider, 'anthropic');
  assert.equal(await openKey(TREE, cur.sealed!), ANTHROPIC_KEY, 'the saved key is still the one saved');
});

test('saving a new provider with a new key replaces the key', async () => {
  await settings.saveSettings(TREE, 'u1', {
    provider: 'openai', model: 'gpt-6.1-sol', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: OPENAI_KEY,
  });
  const cur = await settings.readSettings(TREE);
  assert.equal(cur.provider, 'openai');
  assert.equal(await openKey(TREE, cur.sealed!), OPENAI_KEY);
  assert.equal(cur.keyTail, OPENAI_KEY.slice(-4));
});

test('saving the same provider with no new key keeps the saved key', async () => {
  await settings.saveSettings(TREE, 'u1', {
    provider: 'openai', model: 'gpt-5.5', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {},
  });
  const cur = await settings.readSettings(TREE);
  assert.equal(cur.model, 'gpt-5.5');
  assert.equal(await openKey(TREE, cur.sealed!), OPENAI_KEY);
});
