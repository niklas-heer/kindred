// node --test src/lib/ai-keys.test.ts — each provider has its own key. A key is sealed for its provider (it opens only as that
// provider's key), a connection test uses that provider's key only, and a route whose provider has no key is refused without
// anything being sent. Runs on a private data folder; `fetch` is stubbed, so nothing is called.
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
const providers = await load<typeof import('./ai/providers.server.ts')>('/src/lib/ai/providers.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const { openKey, sealKey } = await load<typeof import('./ai/secret.server.ts')>('/src/lib/ai/secret.server.ts');
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
const OPENROUTER_KEY = 'sk-or-v1-OPENROUTER-KEY-for-or-5678';
const TREE = 'keys';
const OFF = { assistant: false, faces: false, avatar: false, arms: false };

/** Records every request: its URL and the key it carried. Nothing is sent in a refused case, so the count must stay at zero. */
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
await setup.setUpFamilyAi(TREE, 'u1', {
  provider: 'anthropic', model: '', apiKey: ANTHROPIC_KEY, features: { ...OFF, assistant: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {},
});

test('a key is sealed for its own provider: it opens as that provider and as no other', async () => {
  const sealed = await sealKey(TREE, 'anthropic', ANTHROPIC_KEY);
  assert.ok(sealed.startsWith('v2.') && !sealed.includes(ANTHROPIC_KEY), 'sealed, not in clear');
  assert.equal(await openKey(TREE, 'anthropic', sealed), ANTHROPIC_KEY);
  await assert.rejects(() => openKey(TREE, 'openai', sealed), (e: unknown) => e instanceof AiError && e.code === 'key-unreadable');
  await assert.rejects(() => openKey('another-family', 'anthropic', sealed), (e: unknown) => e instanceof AiError && e.code === 'key-unreadable');
});

test('test connection with another provider and no typed key is refused, and nothing is sent', async () => {
  const { calls } = stubFetch(okReply);
  const r = await settings.testConnection(TREE, { provider: 'openai', model: 'gpt-6.1-sol' }, 'en');
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0, 'no request was made');
});

test('test connection with a saved provider and no typed key uses that provider\'s own key', async () => {
  const { calls } = stubFetch(okReply);
  const r = await settings.testConnection(TREE, { provider: 'anthropic', model: 'claude-sonnet-5-5' }, 'en');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.startsWith('https://api.anthropic.com/'), true, 'sent to Anthropic only');
  assert.equal(calls[0]!.auth, ANTHROPIC_KEY, 'with the saved Anthropic key');
});

test('a typed key goes only to the provider it was typed for', async () => {
  const { calls } = stubFetch(okReply);
  const r = await settings.testConnection(TREE, { provider: 'openai', model: 'gpt-6.1-sol', apiKey: OPENAI_KEY }, 'en');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.startsWith('https://api.openai.com/'), true);
  assert.equal(calls[0]!.auth, `Bearer ${OPENAI_KEY}`);
  assert.ok(!calls.some((c) => c.auth.includes(ANTHROPIC_KEY)), 'the Anthropic key was not sent');
});

test('connecting a second provider keeps the first; replacing a key replaces only that provider\'s', async () => {
  await providers.saveProviderKey(TREE, 'u1', 'openrouter', OPENROUTER_KEY);
  const before = (await providers.providerStates(TREE)).map((p) => [p.provider, p.keyTail]);
  assert.deepEqual(before.find(([p]) => p === 'anthropic'), ['anthropic', ANTHROPIC_KEY.slice(-4)]);
  assert.deepEqual(before.find(([p]) => p === 'openrouter'), ['openrouter', OPENROUTER_KEY.slice(-4)]);
  await providers.saveProviderKey(TREE, 'u1', 'openrouter', 'sk-or-v1-REPLACED-KEY-9999');
  const after = await providers.providerStates(TREE);
  assert.equal(after.find((p) => p.provider === 'openrouter')?.keyTail, '9999');
  assert.equal(await providers.keyFor(TREE, 'anthropic'), ANTHROPIC_KEY, 'the other key is untouched');
});

test('removing a provider disables its routes: they report needs-provider and are never rerouted', async () => {
  await providers.saveProviderKey(TREE, 'u1', 'openrouter', OPENROUTER_KEY);
  await providers.saveRoutes(TREE, [{ route: 'occupations', provider: 'openrouter', model: 'google/gemini-3.8-flash' }]);
  await providers.removeProvider(TREE, 'openrouter');
  const route = await providers.resolveRoute(TREE, 'occupations');
  assert.equal(route.provider, 'openrouter', 'the choice is kept, so connecting again restores it');
  assert.equal(route.connected, false, 'and it cannot run');
  assert.equal(route.effective?.provider, 'openrouter', 'it is not sent to another provider');
  await assert.rejects(() => providers.keyFor(TREE, 'openrouter'), (e: unknown) => e instanceof AiError && e.code === 'not-configured');
  // The assistant still runs on Anthropic, untouched.
  assert.equal((await providers.resolveRoute(TREE, 'assistant')).connected, true);
});

test('a job that follows the assistant needs the assistant\'s provider: removing it never reroutes the job to another provider', async () => {
  await providers.saveProviderKey(TREE, 'u1', 'openrouter', OPENROUTER_KEY);
  await providers.removeProvider(TREE, 'anthropic');
  const faces = await providers.resolveRoute(TREE, 'faces');
  assert.equal(faces.effective?.provider, 'anthropic', 'it still follows the assistant');
  assert.equal(faces.connected, false, 'and waits for Anthropic: OpenRouter is connected, but is not used');
  await providers.saveProviderKey(TREE, 'u1', 'anthropic', ANTHROPIC_KEY);
});

test('a saved OpenRouter model with the :online suffix is read back without it', async () => {
  await providers.saveProviderKey(TREE, 'u1', 'openrouter', OPENROUTER_KEY);
  await providers.saveRoutes(TREE, [{ route: 'chronicle', provider: 'openrouter', model: 'openai/gpt-5:online' }]);
  assert.equal((await providers.resolveRoute(TREE, 'chronicle')).effective?.model, 'openai/gpt-5');
});

test('a route is refused on a provider that is not connected, and a route left as it was is not re-judged', async () => {
  await assert.rejects(() => providers.saveRoutes(TREE, [{ route: 'arms', provider: 'openai', model: 'gpt-5' }]), (e: unknown) => e instanceof AiError && e.message === 'ai.err_provider_not_connected');
  await providers.removeProvider(TREE, 'openrouter');
  // Saving the same (now disconnected) choice again is not a new choice, so it is not refused.
  await providers.saveRoutes(TREE, [{ route: 'occupations', provider: 'openrouter', model: 'google/gemini-3.8-flash' }]);
  await assert.rejects(() => providers.saveRoutes(TREE, [{ route: 'arms', provider: 'openrouter', model: 'google/gemini-3.8-flash' }]), (e: unknown) => e instanceof AiError && e.message === 'ai.err_provider_not_connected');
});

test('a family-level switch cannot be turned on for a job that has no connected provider', async () => {
  await assert.rejects(
    () => settings.saveSettings(TREE, 'u1', { features: { ...OFF, assistant: true, arms: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, routes: [{ route: 'arms', provider: 'openai', model: '' }] }),
    (e: unknown) => e instanceof AiError && e.message === 'ai.needsKey',
  );
});
