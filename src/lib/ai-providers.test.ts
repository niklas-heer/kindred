// node --test src/lib/ai-providers.test.ts — several providers per family, each route on its own provider and key.
//   * a route's request goes to its own provider, with that provider's key (the stub reads the URL and the key);
//   * the settings page, the status and the model list never carry a key;
//   * a viewer and an editor can't see or change the AI settings (the roles, and every server function's own check).
// Runs on a private data folder; `fetch` is stubbed, so nothing is called.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-providers-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '0';
process.env.KINDRED_SECRET = 'ai-providers-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const providers = await load<typeof import('./ai/providers.server.ts')>('/src/lib/ai/providers.server.ts');
const page = await load<typeof import('./ai/page.server.ts')>('/src/lib/ai/page.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const models = await load<typeof import('./ai/models.server.ts')>('/src/lib/ai/models.server.ts');
const roles = await load<typeof import('./roles.ts')>('/src/lib/roles.ts');
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

const ANTHROPIC_KEY = 'sk-ant-ROUTE-ANTHROPIC-KEY-1111';
const OPENROUTER_KEY = 'sk-or-v1-ROUTE-OPENROUTER-KEY-2222';
const OPENAI_KEY = 'sk-openai-ROUTE-OPENAI-KEY-3333';
const TREE = 'routes';
const OFF = { assistant: false, faces: false, avatar: false, arms: false };

interface Call { url: string; auth: string; body: string }

/**
 * Answers like each provider does, enough for the adapters to read a reply, and records every request: its URL and the key it
 * carried. The model lists are empty, so nothing else is read. Anything else is an error in the test.
 */
function stub(reply: (url: string) => Response = defaultReply): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, auth: headers.authorization ?? headers['x-api-key'] ?? '', body: String(init?.body ?? '') });
    return reply(url);
  }) as typeof fetch;
  return calls;
}
function defaultReply(url: string): Response {
  if (url.includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://api.anthropic.com/')) return new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Anna', 'handle-routes', Date.now());

test('each route\'s request goes to its own provider, with that provider\'s key', async () => {
  // Connected: Anthropic (the assistant) and OpenRouter (the arms). Arms is on OpenRouter, so its key must be OpenRouter's.
  await providers.saveProviderKey(TREE, 'u1', 'anthropic', ANTHROPIC_KEY);
  await providers.saveProviderKey(TREE, 'u1', 'openrouter', OPENROUTER_KEY);
  await setup.setUpFamilyAi(TREE, 'u1', {
    provider: 'anthropic', model: 'claude-haiku-5-5', features: { ...OFF, assistant: true, arms: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {},
    routes: [{ route: 'arms', provider: 'openrouter', model: 'google/gemini-3.8-flash' }],
  });
  const calls = stub();

  const assistant = await settings.adapterForFeature(TREE, 'assistant', 'en');
  await assistant.adapter.complete({ system: 'Say OK.', messages: [{ role: 'user', text: 'Ping' }], maxTokens: 16 }).catch(() => undefined);
  const arms = await settings.adapterForFeature(TREE, 'arms', 'en');
  await arms.adapter.complete({ system: 'Say OK.', messages: [{ role: 'user', text: 'Ping' }], maxTokens: 16 }).catch(() => undefined);

  const toAnthropic = calls.filter((c) => c.url.startsWith('https://api.anthropic.com/'));
  const toOpenRouter = calls.filter((c) => c.url.startsWith('https://openrouter.ai/') && !c.url.includes('/models'));
  // OpenRouter's model list is public: its request carries no key at all.
  assert.ok(calls.filter((c) => c.url.includes('/models')).every((c) => c.auth === ''), 'the public model list is read without a key');
  assert.ok(toAnthropic.length >= 1, 'the assistant called Anthropic');
  assert.ok(toOpenRouter.length >= 1, 'the arms route called OpenRouter');
  assert.ok(toAnthropic.every((c) => c.auth === ANTHROPIC_KEY), 'Anthropic was only ever sent the Anthropic key');
  assert.ok(toOpenRouter.every((c) => c.auth === `Bearer ${OPENROUTER_KEY}`), 'OpenRouter was only ever sent the OpenRouter key');
  assert.ok(calls.every((c) => !c.auth.includes(ANTHROPIC_KEY) || c.url.startsWith('https://api.anthropic.com/')), 'the Anthropic key went nowhere else');
  assert.ok(calls.every((c) => !c.auth.includes(OPENROUTER_KEY) || c.url.startsWith('https://openrouter.ai/')), 'the OpenRouter key went nowhere else');
});

test('a job on a provider with no key of its own is refused: its request is never sent, and the key of another provider is not used', async () => {
  await providers.saveProviderKey(TREE, 'u1', 'openai', OPENAI_KEY);
  await providers.saveRoutes(TREE, [{ route: 'occupations', provider: 'openai', model: 'gpt-6.1-sol' }]);
  await providers.removeProvider(TREE, 'openai');
  const calls = stub();
  await assert.rejects(() => settings.routeAdapter(TREE, 'occupations', 'en'), (e: unknown) => e instanceof AiError && e.code === 'not-configured');
  assert.equal(calls.length, 0, 'nothing was sent to OpenAI, or to any other provider');
});

test('removing the arms provider disables its job: no request goes to OpenRouter, and the assistant keeps running on Anthropic', async () => {
  await providers.removeProvider(TREE, 'openrouter');
  const calls = stub();
  await assert.rejects(() => settings.adapterForFeature(TREE, 'arms', 'en'), (e: unknown) => e instanceof AiError && e.code === 'not-configured');
  assert.equal(calls.filter((c) => c.url.startsWith('https://openrouter.ai/')).length, 0, 'OpenRouter was not called');
  const r = await providers.resolveRoute(TREE, 'arms');
  assert.equal(r.effective?.provider, 'openrouter', 'the arms job is not rerouted to another provider');
  assert.equal(r.connected, false);
  const assistant = await settings.adapterForFeature(TREE, 'assistant', 'en');
  await assistant.adapter.complete({ system: 'Say OK.', messages: [{ role: 'user', text: 'Ping' }], maxTokens: 16 }).catch(() => undefined);
  assert.ok(calls.some((c) => c.url.startsWith('https://api.anthropic.com/') && c.auth === ANTHROPIC_KEY), 'the assistant still uses its own key');
});

test('the settings page, the status and a failed check never carry a key: only the masked tails', async () => {
  await providers.saveProviderKey(TREE, 'u1', 'openrouter', OPENROUTER_KEY);
  const data = await page.settingsPage(TREE);
  const status = await settings.statusFor(TREE);
  const serialised = JSON.stringify({ data, status });
  for (const key of [ANTHROPIC_KEY, OPENROUTER_KEY, OPENAI_KEY]) {
    assert.ok(!serialised.includes(key), 'a full key is not in the page or the status');
    assert.ok(!serialised.includes(key.slice(0, 12)), 'nor any part of its start');
  }
  const or = data.providers.find((p) => p.provider === 'openrouter');
  assert.equal(or?.keyState, 'saved');
  assert.equal(or?.keyTail, OPENROUTER_KEY.slice(-4), 'only the last four characters are shown');

  // A provider that refuses the key: the message names the problem, never the key.
  stub(() => new Response(JSON.stringify({ error: { message: 'invalid' } }), { status: 401 }));
  const failed = await models.listModels('openrouter', OPENROUTER_KEY).catch((e: unknown) => e);
  assert.ok(failed instanceof AiError);
  assert.ok(!(failed as Error).message.includes(OPENROUTER_KEY), 'the error does not carry the key');
  const test = await settings.testConnection(TREE, { provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: ANTHROPIC_KEY }, 'en').catch((e: unknown) => e);
  assert.ok(!JSON.stringify(test).includes(ANTHROPIC_KEY), 'a failed check does not return the typed key');
});

test('a viewer and an editor can\'t see or change the AI settings: the roles say so, and every settings function checks it', async () => {
  assert.equal(roles.can('viewer', 'manage-access'), false);
  assert.equal(roles.can('contributor', 'manage-access'), false);
  assert.equal(roles.can('editor', 'manage-access'), false);
  assert.equal(roles.can('steward', 'manage-access'), true);
  // Each server function that reads or changes the settings, the providers or the routes starts with the steward check.
  const sources: Record<string, string> = {
    'src/lib/ai.functions.ts': readFileSync(join(process.cwd(), 'src/lib/ai.functions.ts'), 'utf8'),
    'src/lib/portrait.functions.ts': readFileSync(join(process.cwd(), 'src/lib/portrait.functions.ts'), 'utf8'),
    'src/lib/ai/background.functions.ts': readFileSync(join(process.cwd(), 'src/lib/ai/background.functions.ts'), 'utf8'),
  };
  const checks: [string, string][] = [
    ['src/lib/ai.functions.ts', 'aiSettings'], ['src/lib/ai.functions.ts', 'aiSaveSettings'], ['src/lib/ai.functions.ts', 'aiSaveProvider'],
    ['src/lib/ai.functions.ts', 'aiRemoveProvider'], ['src/lib/ai.functions.ts', 'aiListModels'], ['src/lib/ai.functions.ts', 'aiTestConnection'],
    ['src/lib/portrait.functions.ts', 'getPortraitSettings'], ['src/lib/portrait.functions.ts', 'savePortraitSettings'],
    ['src/lib/ai/background.functions.ts', 'aiActivity'], ['src/lib/ai/background.functions.ts', 'aiSaveBackground'],
  ];
  for (const [file, name] of checks) {
    const src = sources[file]!;
    const start = src.indexOf(`export const ${name} =`);
    assert.ok(start >= 0, `${name} exists in ${file}`);
    const next = src.indexOf('\nexport const ', start + 10);
    const body = src.slice(start, next < 0 ? undefined : next);
    assert.ok(body.includes("requireCan(data.tree, 'manage-access')"), `${name} requires manage-access`);
  }
});

test('a route saved on a provider that is not connected is refused, and so is a painting route on a provider that does not paint', async () => {
  // OpenAI has no key in this family now (removed above), so a route on it is refused.
  await assert.rejects(() => providers.saveRoutes(TREE, [{ route: 'faces', provider: 'openai', model: '' }]), (e: unknown) => e instanceof AiError && e.message === 'ai.err_provider_not_connected');
  await assert.rejects(() => providers.saveRoutes(TREE, [{ route: 'portrait', provider: 'anthropic', model: 'claude-haiku-5-5' }]), (e: unknown) => e instanceof AiError && e.message === 'paint.err_provider_cannot_paint');
  await assert.rejects(() => providers.saveRoutes(TREE, [{ route: 'assistant', provider: null, model: '' }]), (e: unknown) => e instanceof AiError && e.message === 'ai.err_route');
});
