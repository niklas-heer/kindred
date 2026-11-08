// node --test src/lib/ai-adapters.test.ts — each provider's adapter and model list, with fetch stubbed: the request shape
// for web search, how the reply is parsed (text, sources, searches, token split, reported cost), the pause_turn
// continuation, the model lists (paging, filtering, prices, capabilities), and that a key never shows in an error.
// No provider is ever called.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-adapters-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '0';
process.env.KINDRED_SECRET = 'ai-adapters-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { makeAdapter, AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const models = await load<typeof import('./ai/models.server.ts')>('/src/lib/ai/models.server.ts');

test.after(async () => {
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  models.clearModelCache();
});

const KEY = 'sk-test-KEY-never-logged-1234';

interface Sent { url: string; body: any; headers: Record<string, string> }

/** Replaces fetch with a script: each call gets the next response from `replies`. Records what was sent. */
function stubFetch(replies: (Response | ((sent: Sent) => Response))[]): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const s: Sent = { url, body, headers };
    sent.push(s);
    const next = replies.shift();
    if (!next) throw new Error(`unexpected fetch to ${url}`);
    return typeof next === 'function' ? next(s) : next;
  }) as typeof fetch;
  return sent;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---------- Anthropic ----------

test('anthropic: web search is the server tool, with max_uses, and the reply carries its sources, searches and token split', async () => {
  const sent = stubFetch([json({
    content: [
      { type: 'text', text: 'Let me look. ' },
      { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'ada lovelace' } },
      { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [
        { type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Ada_Lovelace', title: 'Ada Lovelace' },
        { type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Ada_Lovelace', title: 'Duplicate' },
      ] },
      { type: 'text', text: 'She was a mathematician.' },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 120, output_tokens: 30, server_tool_use: { web_search_requests: 1 } },
  })]);
  const reply = await makeAdapter('anthropic', KEY, 'claude-sonnet-5-5').complete({
    system: 'S', messages: [{ role: 'user', text: 'Who was Ada Lovelace?' }], webSearch: { maxUses: 2 },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(sent[0].body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]);
  assert.equal(reply.text, 'Let me look. She was a mathematician.');
  assert.deepEqual(reply.sources, [{ url: 'https://en.wikipedia.org/wiki/Ada_Lovelace', title: 'Ada Lovelace' }]);
  assert.equal(reply.searches, 1);
  assert.equal(reply.inputTokens, 120);
  assert.equal(reply.outputTokens, 30);
  assert.equal(reply.tokens, 150);
});

test('anthropic: without web search there is no search tool and no searches are counted', async () => {
  const sent = stubFetch([json({ content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } })]);
  const reply = await makeAdapter('anthropic', KEY, 'claude-sonnet-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] });
  assert.equal(sent[0].body.tools, undefined);
  assert.equal(reply.searches, 0);
  assert.equal(reply.sources, undefined);
});

test('anthropic: a paused search turn is continued, and both rounds are counted', async () => {
  const sent = stubFetch([
    json({
      content: [{ type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'x' } }],
      stop_reason: 'pause_turn',
      usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } },
    }),
    json({
      content: [{ type: 'text', text: 'Done.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 150, output_tokens: 20 },
    }),
  ]);
  const reply = await makeAdapter('anthropic', KEY, 'claude-sonnet-5-5').complete({
    system: 'S', messages: [{ role: 'user', text: 'Search' }], webSearch: {},
  });
  assert.equal(sent.length, 2, 'the paused turn is sent again');
  const second = sent[1].body.messages as { role: string }[];
  assert.equal(second.at(-1)?.role, 'assistant', 'the paused assistant message is sent back');
  assert.equal(reply.text, 'Done.');
  assert.equal(reply.inputTokens, 250);
  assert.equal(reply.outputTokens, 30);
  assert.equal(reply.searches, 1);
});

test('anthropic: a refused key is reported without the key', async () => {
  stubFetch([json({ error: { message: 'invalid x-api-key' } }, 401)]);
  await assert.rejects(makeAdapter('anthropic', KEY, 'claude-sonnet-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] }), (e: unknown) => {
    assert.ok(e instanceof AiError);
    assert.equal(e.code, 'auth');
    assert.ok(!e.message.includes(KEY));
    return true;
  });
});

// ---------- OpenAI ----------

test('openai: web search goes through the Responses API, with the hosted web_search tool and url citations as sources', async () => {
  const sent = stubFetch([json({
    output: [
      { type: 'web_search_call', id: 'ws1', status: 'completed', action: { type: 'search', query: 'ada' } },
      { type: 'message', content: [{ type: 'output_text', text: 'Ada was a mathematician.', annotations: [
        { type: 'url_citation', url: 'https://example.org/ada', title: 'Ada', start_index: 0, end_index: 3 },
      ] }] },
    ],
    usage: { input_tokens: 200, output_tokens: 40, total_tokens: 240 },
  })]);
  const reply = await makeAdapter('openai', KEY, 'gpt-6.1-sol').complete({
    system: 'S', messages: [{ role: 'user', text: 'Who was Ada?' }], webSearch: { maxUses: 2 },
  });
  assert.equal(sent[0].url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(sent[0].body.tools, [{ type: 'web_search' }]);
  // The search ceiling is the Responses API's cap on built-in tool calls, and the sources are asked for by name.
  assert.equal(sent[0].body.max_tool_calls, 2);
  assert.deepEqual(sent[0].body.include, ['web_search_call.action.sources']);
  assert.deepEqual(sent[0].body.reasoning, { effort: 'low' }, 'a reasoning model searches at low effort, not minimal');
  assert.equal(sent[0].body.model, 'gpt-6.1-sol');
  assert.equal(reply.text, 'Ada was a mathematician.');
  assert.deepEqual(reply.sources, [{ url: 'https://example.org/ada', title: 'Ada' }]);
  assert.equal(reply.searches, 1);
  assert.equal(reply.inputTokens, 200);
  assert.equal(reply.outputTokens, 40);
});

test('openai: without web search the Chat Completions API is used; a reasoning model gets the larger cap and low effort', async () => {
  const sent = stubFetch([json({
    choices: [{ message: { role: 'assistant', content: 'Hi there' } }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  })]);
  const reply = await makeAdapter('openai', KEY, 'gpt-6.1-sol').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], maxTokens: 50 });
  assert.equal(sent[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(sent[0].body.max_completion_tokens, 8_000, 'reasoning tokens count against the cap, so a reasoning model is never capped low');
  assert.equal(sent[0].body.reasoning_effort, 'low');
  assert.equal(sent[0].body.tools, undefined);
  assert.equal(reply.text, 'Hi there');
  assert.equal(reply.inputTokens, 12);
  assert.equal(reply.outputTokens, 3);
  assert.equal(reply.searches, 0);
});

// ---------- OpenRouter ----------

test('openrouter: the openrouter:web_search server tool is requested with its ceiling, and the reported cost and citations come back', async () => {
  const sent = stubFetch([json({
    choices: [{ message: {
      role: 'assistant',
      content: 'Ada was a mathematician.',
      annotations: [{ type: 'url_citation', url_citation: { url: 'https://x.example/ada', title: 'Ada X', content: 'c', start_index: 0, end_index: 3 } }],
    } }],
    usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60, cost: 0.0042 },
  })]);
  const reply = await makeAdapter('openrouter', KEY, 'anthropic/claude-sonnet-5-5').complete({
    system: 'S', messages: [{ role: 'user', text: 'Who was Ada?' }], webSearch: { maxUses: 2 },
  });
  assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(sent[0].body.plugins, undefined, 'the deprecated web plugin is not used');
  assert.deepEqual(sent[0].body.tools, [{ type: 'openrouter:web_search', parameters: { max_results: 5, max_uses: 2 } }]);
  assert.equal(sent[0].body.max_tool_calls, 2);
  assert.equal(reply.reportedCostUsd, 0.0042);
  assert.deepEqual(reply.sources, [{ url: 'https://x.example/ada', title: 'Ada X' }]);
  assert.equal(reply.searches, 1);
  assert.equal(reply.inputTokens, 50);
  assert.equal(reply.outputTokens, 10);
});

test('openrouter: without web search there is no plugin and no reported cost unless the provider sends one', async () => {
  const sent = stubFetch([json({ choices: [{ message: { content: 'Hi' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } })]);
  const reply = await makeAdapter('openrouter', KEY, 'openai/gpt-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] });
  assert.equal(sent[0].body.tools, undefined);
  assert.equal(reply.reportedCostUsd, undefined);
  assert.equal(reply.searches, 0);
});

// ---------- model lists ----------

test('anthropic models: every page is read, retired models are left out, and capabilities and table prices are kept', async () => {
  const sent = stubFetch([
    json({
      data: [
        { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', lifecycle: 'active', max_input_tokens: 200000, capabilities: { image_input: { supported: true }, server_tools: { web_search: { supported: true } } } },
        { id: 'claude-old-1', display_name: 'Old', lifecycle: 'retired', max_input_tokens: 1000, capabilities: null },
      ],
      has_more: true,
      last_id: 'claude-old-1',
    }),
    json({
      data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', lifecycle: 'active', max_input_tokens: 200000, capabilities: { image_input: { supported: false }, server_tools: { web_search: { supported: true } } } }],
      has_more: false,
      last_id: 'claude-haiku-5-5',
    }),
  ]);
  const { models: list } = await models.listModels('anthropic', KEY);
  assert.equal(sent.length, 2);
  assert.match(sent[1].url, /after_id=claude-old-1/);
  assert.equal(sent[0].headers['x-api-key'], KEY);
  assert.deepEqual(list.map((m: { id: string }) => m.id), ['claude-sonnet-5-5', 'claude-haiku-5-5']);
  const sonnet = list[0];
  assert.equal(sonnet.inPerM, 2);
  assert.equal(sonnet.outPerM, 10);
  assert.equal(sonnet.contextTokens, 200000);
  assert.equal(sonnet.vision, true);
  assert.equal(sonnet.webSearch, true);
  assert.equal(sonnet.tools, true);
  const haiku = list[1];
  assert.equal(haiku.vision, false);
  assert.equal(haiku.inPerM, 0.1);
});

test('openai models: only chat and reasoning models are listed, and a listed model gets its table price', async () => {
  stubFetch([json({ data: [
    { id: 'gpt-6.1-sol', object: 'model' },
    { id: 'o3', object: 'model' },
    { id: 'text-embedding-3-small', object: 'model' },
    { id: 'whisper-1', object: 'model' },
    { id: 'gpt-5.3-codex', object: 'model' },
    { id: 'dall-e-3', object: 'model' },
  ] })]);
  const { models: list } = await models.listModels('openai', KEY);
  assert.deepEqual(list.map((m: { id: string }) => m.id), ['gpt-6.1-sol', 'o3']);
  assert.equal(list[0].inPerM, 2);
  assert.equal(list[0].outPerM, 10);
  assert.equal(list[0].webSearch, true);
  assert.equal(list[0].contextTokens, null, 'the models list gives no context size, so none is claimed');
});

test('openrouter models: per-token prices become per-1M, and modalities and parameters become capabilities', async () => {
  const sent = stubFetch([json({ data: [
    { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', context_length: 1000000,
      pricing: { prompt: '0.000002', completion: '0.00001', web_search: '0.004' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'max_tokens'] },
    { id: 'some/free-model', name: 'Free', context_length: 8000, pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: [] },
  ] })]);
  const { models: list } = await models.listModels('openrouter', KEY);
  assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/models');
  const s = list[0];
  assert.ok(Math.abs((s.inPerM ?? 0) - 2) < 1e-9, 'prompt price per 1M');
  assert.ok(Math.abs((s.outPerM ?? 0) - 10) < 1e-9, 'completion price per 1M');
  assert.equal(s.searchEach, 0.004);
  assert.equal(s.vision, true);
  assert.equal(s.tools, true);
  assert.equal(s.contextTokens, 1000000);
  assert.equal(list[1].tools, false);
  assert.equal(list[1].vision, false);
});

test('a model list is cached for a few minutes: the second read makes no call, and the key is not kept in the cache', async () => {
  const sent = stubFetch([json({ data: [{ id: 'gpt-6.1-sol', object: 'model' }] })]);
  const first = await models.listModels('openai', KEY);
  const second = await models.listModels('openai', KEY);
  assert.equal(sent.length, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.ok(!JSON.stringify(second.models).includes(KEY));
});

test('a model list that fails names the problem without the key', async () => {
  stubFetch([json({ error: { message: 'bad key' } }, 403)]);
  await assert.rejects(models.listModels('openrouter', KEY), (e: unknown) => {
    assert.ok(e instanceof AiError);
    assert.equal(e.code, 'auth');
    assert.ok(!e.message.includes(KEY));
    return true;
  });
});

// ---------- OpenRouter: the list's reasoning flag, and the :online suffix ----------

test('openrouter: a model the list says reasons gets the reasoning cap and effort, whatever its name; the list can say it does not', async () => {
  const done = () => json({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const sent = stubFetch([done(), done()]);
  await makeAdapter('openrouter', KEY, 'vendor/plain', { reasoning: true }).complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], maxTokens: 50 });
  assert.equal(sent[0].body.max_tokens, 8_000, 'the reasoning cap');
  assert.equal(sent[0].body.reasoning.effort, 'low');
  await makeAdapter('openrouter', KEY, 'openai/gpt-5', { reasoning: false }).complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], maxTokens: 50 });
  assert.equal(sent[1].body.max_tokens, 50, 'the list says no, so the name does not raise the cap');
  assert.equal(sent[1].body.reasoning, undefined);
});

test('openrouter: the :online suffix is never sent, for a chat, a lookup or any other request', async () => {
  const done = () => json({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const sent = stubFetch([done()]);
  await makeAdapter('openrouter', KEY, 'openai/gpt-5:online').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] });
  assert.equal(sent[0].body.model, 'openai/gpt-5');
  assert.equal(sent[0].body.tools, undefined, 'and no search tool is added by the suffix');
});
