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
import { z } from 'zod';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-adapters-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '0';
process.env.KINDRED_SECRET = 'ai-adapters-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { makeAdapter, AiError, chatModelId, searchesOnItsOwn, structuredSchema, isolatedSearch, outputCap } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const types = await load<typeof import('./ai/types.ts')>('/src/lib/ai/types.ts');
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

test('a model that searches by itself is refused by one rule on both providers, and :online is stripped wherever it sits', async () => {
  for (const [provider, model] of [
    ['openai', 'gpt-4o-search-preview'], ['openai', 'gpt-4o-mini-search-preview'], ['openai', 'o3-deep-research'],
    ['openrouter', 'openai/gpt-4o-search-preview'], ['openrouter', 'openai/gpt-4o-mini-search-preview'],
    ['openrouter', 'openai/o3-deep-research'], ['openrouter', 'perplexity/sonar'], ['openrouter', 'perplexity/sonar-pro:online'],
  ] as const) {
    assert.equal(searchesOnItsOwn(provider, chatModelId(provider, model)), true, `${provider} ${model}`);
    assert.throws(() => makeAdapter(provider, KEY, model), (e: unknown) => e instanceof AiError && e.code === 'bad-input', `${provider} ${model}`);
  }
  for (const model of ['gpt-4o', 'openai/gpt-5', 'vendor/model']) assert.equal(searchesOnItsOwn('openrouter', model), false, model);
  assert.equal(chatModelId('openrouter', 'openai/gpt-5:online:nitro'), 'openai/gpt-5:nitro');
  assert.equal(chatModelId('openrouter', 'openai/gpt-5:Online'), 'openai/gpt-5');

  // The suffix is stripped on the way out too: the request names the model without it, and nothing else in it searches.
  const done = () => json({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const sent = stubFetch([done()]);
  await makeAdapter('openrouter', KEY, 'openai/gpt-5:online:nitro').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] });
  assert.equal(sent[0].body.model, 'openai/gpt-5:nitro');
  assert.ok(!sent[0].body.model.includes(':online'));
});

test('openrouter: a reply\'s reasoning_details are kept on the reply, and go back unchanged on the assistant message with its calls', async () => {
  const details = [{ type: 'reasoning.encrypted', id: 'r1', format: 'anthropic-claude-v1', index: 0, data: 'SIGNED-BLOCK' }];
  const sent = stubFetch([
    json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, reasoning_details: details, tool_calls: [{ id: 'c1', function: { name: 'read_person', arguments: '{"id":"anna"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    json({ choices: [{ finish_reason: 'stop', message: { content: 'Anna.' } }], usage: { prompt_tokens: 20, completion_tokens: 2 } }),
  ]);
  const adapter = makeAdapter('openrouter', KEY, 'vendor/reasons', { reasoning: true });
  const first = await adapter.complete({ system: 'S', messages: [{ role: 'user', text: 'Who is Anna?' }], tools: [{ name: 'read_person', description: 'Read one person.', parameters: { type: 'object' } }] });
  assert.deepEqual(first.reasoningDetails, details, 'the reply keeps the blocks');
  await adapter.complete({
    system: 'S',
    messages: [
      { role: 'user', text: 'Who is Anna?' },
      { role: 'assistant', text: first.text, calls: first.calls, reasoningDetails: first.reasoningDetails },
      { role: 'tool', callId: 'c1', content: '{"name":"Anna"}' },
    ],
  });
  // OpenRouter carries the system prompt first; the assistant turn is the one with the calls.
  const back = sent[1].body.messages.find((m: { role: string }) => m.role === 'assistant');
  assert.ok(back, 'the assistant turn is sent');
  assert.deepEqual(back.reasoning_details, details, 'the second request carries them unchanged');
  assert.equal(back.tool_calls[0].id, 'c1');
  assert.equal(sent[1].body.reasoning.effort, 'low', 'reasoning stays on for the continuation');
});

test('openrouter: a reply without reasoning blocks carries none, and an assistant turn without them sends none', async () => {
  const sent = stubFetch([json({ choices: [{ finish_reason: 'stop', message: { content: 'Plain.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })]);
  const reply = await makeAdapter('openrouter', KEY, 'vendor/plain').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] });
  assert.equal(reply.reasoningDetails, undefined);
  assert.ok(!('reasoning_details' in sent[0].body) && !JSON.stringify(sent[0].body).includes('reasoning_details'));
});

// ---------- Anthropic: structured outputs, effort, the cap, refusals and thinking ----------

const faceSchema: Record<string, unknown> = {
  type: 'object',
  properties: { faces: { type: 'array', maxItems: 5, items: { type: 'object', properties: { box: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1 } } } } } } },
  required: ['faces'],
};
const FORBIDDEN_IN_FORMAT = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', '$schema'];

/** Every keyword the format refuses is gone, and every object is closed. Throws with the path of the first breach. */
function assertFormatSafe(node: unknown, path = 'root'): void {
  if (Array.isArray(node)) return node.forEach((n, i) => assertFormatSafe(n, `${path}[${i}]`));
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  for (const k of FORBIDDEN_IN_FORMAT) assert.ok(!(k in o), `${path} still has ${k}`);
  if (o.type === 'object' || o.properties) assert.equal(o.additionalProperties, false, `${path} is not closed`);
  for (const [k, v] of Object.entries(o)) {
    // The names of properties are not keywords: a property called "minimum" is kept.
    if (k === 'properties' || k === '$defs') for (const [name, s] of Object.entries(v as Record<string, unknown>)) assertFormatSafe(s, `${path}.${k}.${name}`);
    else if (k !== 'enum' && k !== 'required') assertFormatSafe(v, `${path}.${k}`);
  }
}

test('anthropic: Opus 5.5 and Sonnet 5.5 send the JSON answer as structured output, with low effort and no forced tool', async () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    const sent = stubFetch([json({ content: [{ type: 'text', text: '\n{"faces":[]}\n' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } })]);
    const reply = await makeAdapter('anthropic', KEY, model).complete({ system: 'S', messages: [{ role: 'user', text: 'Find the faces' }], json: { name: 'faces', schema: faceSchema } });
    const body = sent[0].body;
    assert.equal(body.tool_choice, undefined, `${model}: a forced tool_choice is a 400 here`);
    assert.equal(body.tools, undefined, `${model}: no tool stands in for the answer`);
    assert.deepEqual(body.output_config, { effort: 'low', format: { type: 'json_schema', schema: structuredSchema(faceSchema) } });
    assert.equal(body.max_tokens, 8_000, `${model}: the cap has the floor`);
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in body), `${model}: ${k} is not sent`);
    assert.deepEqual(reply.json, { faces: [] }, 'the JSON in the text block is parsed');
    assert.equal(reply.searches, 0);
  }
});

test('anthropic: Haiku 4.5 takes the structured output without effort; an older model keeps the forced tool', async () => {
  const haiku = stubFetch([json({ content: [{ type: 'text', text: '{"faces":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })]);
  await makeAdapter('anthropic', KEY, 'claude-haiku-4-5-20251001').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], json: { name: 'faces', schema: faceSchema } });
  assert.ok(haiku[0].body.output_config.format, 'Haiku 4.5 has structured outputs');
  assert.equal(haiku[0].body.output_config.effort, undefined, 'Haiku 4.5 does not take effort');

  const older = stubFetch([json({ content: [{ type: 'tool_use', id: 't1', name: 'faces', input: { faces: [] } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } })]);
  const reply = await makeAdapter('anthropic', KEY, 'claude-sonnet-4-6').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], json: { name: 'faces', schema: faceSchema } });
  assert.deepEqual(older[0].body.tool_choice, { type: 'tool', name: 'faces' });
  assert.equal(older[0].body.output_config, undefined, 'no structured output and no effort for an older model');
  assert.deepEqual(reply.json, { faces: [] }, 'the forced tool input is the answer');
});

test('anthropic: the schema sent is closed, and the bounds are dropped, without touching the schema it came from', () => {
  const before = JSON.stringify(faceSchema);
  assert.deepEqual(structuredSchema(faceSchema), {
    type: 'object',
    properties: { faces: { type: 'array', items: { type: 'object', properties: { box: { type: 'object', properties: { x: { type: 'number' } }, additionalProperties: false } }, additionalProperties: false } } },
    required: ['faces'],
    additionalProperties: false,
  });
  assert.equal(JSON.stringify(faceSchema), before, 'the caller’s schema is not changed');
  // A property named after a bound is a property, not a bound.
  const named = structuredSchema({ type: 'object', properties: { minimum: { type: 'number', minimum: 0 }, pattern: { type: 'string', pattern: '^a' } } });
  assert.deepEqual(named, { type: 'object', properties: { minimum: { type: 'number' }, pattern: { type: 'string', pattern: '^a' } }, additionalProperties: false });
});

test('anthropic: the zod schemas Kindred sends come out as the format takes them', () => {
  const { $schema: _drop, ...raw } = z.toJSONSchema(types.faceResultSchema) as Record<string, unknown>;
  const sent = structuredSchema(raw);
  assertFormatSafe(sent);
  assert.ok(JSON.stringify(sent).includes('"box"'), 'the shape itself is kept');
});

test('anthropic: a reply cut off by its cap is bad output, with what it billed', async () => {
  stubFetch([json({ content: [{ type: 'thinking', thinking: 'Still thinking', signature: 'sig' }], stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: 8_000 } })]);
  await assert.rejects(makeAdapter('anthropic', KEY, 'claude-opus-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], json: { name: 'faces', schema: faceSchema } }), (e: unknown) => {
    assert.ok(e instanceof AiError);
    assert.equal(e.code, 'bad-output');
    assert.deepEqual(e.billed, { inputTokens: 100, outputTokens: 8_000, searches: 0 });
    assert.equal(e.inFlight, false);
    return true;
  });
});

test('anthropic: a refusal is its own readable error, not bad output, and it keeps what it billed', async () => {
  stubFetch([json({ content: [], stop_reason: 'refusal', usage: { input_tokens: 40, output_tokens: 3 } })]);
  await assert.rejects(makeAdapter('anthropic', KEY, 'claude-sonnet-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], json: { name: 'faces', schema: faceSchema } }), (e: unknown) => {
    assert.ok(e instanceof AiError);
    assert.equal(e.code, 'refused');
    assert.match(e.message, /declined/);
    assert.deepEqual(e.billed, { inputTokens: 40, outputTokens: 3, searches: 0 });
    return true;
  });
});

test('anthropic: a reply with a refusal in a plain chat is refused too, before any text is read', async () => {
  stubFetch([json({ content: [{ type: 'text', text: 'Partial words' }], stop_reason: 'refusal', usage: { input_tokens: 5, output_tokens: 2 } })]);
  await assert.rejects(makeAdapter('anthropic', KEY, 'claude-opus-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] }), (e: unknown) => e instanceof AiError && e.code === 'refused');
});

test('anthropic: thinking blocks come back unchanged, first, with the tool calls they came with', async () => {
  const thinking = { type: 'thinking', thinking: 'The tree has Ruth.', signature: 'sig-abc' };
  const redacted = { type: 'redacted_thinking', data: 'opaque-blob' };
  const sent = stubFetch([
    json({
      content: [thinking, redacted, { type: 'tool_use', id: 'tu1', name: 'lookup', input: { name: 'Ruth' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 30 },
    }),
    json({ content: [{ type: 'text', text: 'Ruth was born in 1952.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 12 } }),
  ]);
  const adapter = makeAdapter('anthropic', KEY, 'claude-opus-5-5');
  const tools = [{ name: 'lookup', description: 'Look up a person', parameters: { type: 'object', properties: { name: { type: 'string' } } } }];
  const first = await adapter.complete({ system: 'S', messages: [{ role: 'user', text: 'When was Ruth born?' }], tools });
  assert.deepEqual(first.reasoningDetails, [thinking, redacted]);
  assert.equal(first.calls[0]?.name, 'lookup');
  await adapter.complete({
    system: 'S',
    messages: [
      { role: 'user', text: 'When was Ruth born?' },
      { role: 'assistant', text: first.text, calls: first.calls, reasoningDetails: first.reasoningDetails },
      { role: 'tool', callId: 'tu1', content: '1952' },
    ],
    tools,
  });
  const turn = sent[1].body.messages as { role: string; content: unknown }[];
  assert.deepEqual(turn[1], {
    role: 'assistant',
    content: [thinking, redacted, { type: 'tool_use', id: 'tu1', name: 'lookup', input: { name: 'Ruth' } }],
  });
  assert.deepEqual(turn[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '1952' }] });
});

test('anthropic: a reply without thinking carries no reasoning blocks', async () => {
  stubFetch([json({ content: [{ type: 'text', text: 'Plain.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })]);
  const reply = await makeAdapter('anthropic', KEY, 'claude-haiku-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] });
  assert.equal(reply.reasoningDetails, undefined);
});

test('anthropic: an isolated search is raised to the same floor as the reservation, and the cap is the one sent', async () => {
  const sent = stubFetch([json({ content: [{ type: 'text', text: 'Schmidt: a smith.' }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 4, server_tool_use: { web_search_requests: 1 } } })]);
  await isolatedSearch(makeAdapter('anthropic', KEY, 'claude-haiku-5-5'), { system: 'S', prompt: 'Surname: Schmidt', maxTokens: 800 });
  assert.equal(sent[0].body.max_tokens, 8_000);
  assert.equal(outputCap('anthropic', 'claude-haiku-5-5', 800), sent[0].body.max_tokens, 'the budget reserves what is sent');
  assert.deepEqual(sent[0].body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
});

test('outputCap: an Anthropic reply is never capped below its floor, and a larger request stays as asked', () => {
  assert.equal(outputCap('anthropic', 'claude-opus-5-5', 1200), 8_000);
  assert.equal(outputCap('anthropic', 'claude-opus-5-5', 20_000), 20_000);
  assert.equal(outputCap('anthropic', 'claude-opus-5-5'), 8_000);
});

