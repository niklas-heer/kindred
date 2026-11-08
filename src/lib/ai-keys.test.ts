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

// ---------- saving a new key after a removal ----------

test('a removal saved with a new key typed keeps the new key: the removal does not drop it', async () => {
  const tree = 'keys-remove';
  await settings.saveSettings(tree, 'u1', {
    provider: 'anthropic', model: '', features: { assistant: false, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: ANTHROPIC_KEY,
  });
  // Remove the key, save; then type a new one and save: the page sends the new key with no removal.
  await settings.saveSettings(tree, 'u1', { provider: 'anthropic', model: '', features: { assistant: false, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, clearKey: true });
  assert.equal((await settings.readSettings(tree)).sealed, null, 'the key was removed');
  const NEW = 'sk-ant-NEW-KEY-typed-after-removal-99';
  await settings.saveSettings(tree, 'u1', { provider: 'anthropic', model: '', features: { assistant: false, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: NEW });
  const after = await settings.readSettings(tree);
  assert.equal(await openKey(tree, after.sealed!), NEW, 'the new key is saved');
  // And a save that sends both (the page's old state) saves the typed key rather than dropping it.
  await settings.saveSettings(tree, 'u1', { provider: 'anthropic', model: '', features: { assistant: false, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, clearKey: true, apiKey: NEW + '-2' });
  assert.equal(await openKey(tree, (await settings.readSettings(tree)).sealed!), NEW + '-2');
});

// ---------- the saved model, and Test connection on reasoning models ----------

test('a saved OpenRouter model with the :online suffix is read back without it', async () => {
  const tree = 'keys-online';
  await settings.saveSettings(tree, 'u1', {
    provider: 'openrouter', model: 'openai/gpt-5', features: { assistant: false, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: OPENAI_KEY,
  });
  // A row saved before the suffix was dropped still holds it: it is read without it.
  await accounts().run('UPDATE ai_settings SET model = ? WHERE tree = ?', 'openai/gpt-5:online', tree);
  const s = await settings.readSettings(tree);
  assert.equal(s.model, 'openai/gpt-5');
  assert.equal(s.effectiveModel, 'openai/gpt-5');
});

/** OpenRouter's list (for the reasoning flag) and one chat reply, recorded. */
function stubOpenRouterCheck(reply: () => Response): { calls: { url: string; body: any }[] } {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/models')) {
      return new Response(JSON.stringify({ data: [
        // The name says nothing about reasoning; the list does.
        { id: 'vendor/plain-named', name: 'Plain', pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['reasoning', 'max_tokens'] },
        // The name says reasoning (gpt-5); the list says it does not take a reasoning parameter.
        { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools', 'max_tokens'] },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return reply();
  }) as typeof fetch;
  return { calls };
}

const cutOff = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: null } }], usage: { prompt_tokens: 10, completion_tokens: 16 } }), { status: 200, headers: { 'content-type': 'application/json' } });

test('test connection: a reply the 16-token check cannot read still means the key works', async () => {
  const { calls } = stubOpenRouterCheck(cutOff);
  const r = await settings.testConnection('keys-check', { provider: 'openrouter', model: 'vendor/plain-named', apiKey: 'sk-or-typed-12345678' }, 'en');
  assert.equal(r.ok, true, 'connected');
  assert.equal(calls.length, 1, 'one check request');
});

test('test connection: the OpenRouter list decides whether a model reasons, over its name', async () => {
  const { calls } = stubOpenRouterCheck(() => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }], usage: { prompt_tokens: 10, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  await settings.testConnection('keys-check', { provider: 'openrouter', model: 'vendor/plain-named', apiKey: 'sk-or-typed-12345678' }, 'en');
  assert.equal(calls[0].body.max_tokens, 8_000, 'listed as reasoning: the reasoning cap');
  assert.equal(calls[0].body.reasoning.effort, 'low');
  await settings.testConnection('keys-check', { provider: 'openrouter', model: 'openai/gpt-5-mini', apiKey: 'sk-or-typed-12345678' }, 'en');
  assert.equal(calls[1].body.max_tokens, 16, 'listed as not reasoning, so the name does not raise the cap');
  assert.equal(calls[1].body.reasoning, undefined);
});
