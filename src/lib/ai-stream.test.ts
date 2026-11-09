// node --test src/lib/ai-stream.test.ts — replies as they are written: each provider's stream put back together, what a failed
// or stopped stream costs, the event protocol, and a chat's one running turn. Provider tests stub fetch; the turn tests use the
// fake provider on a private data folder. No provider is ever called.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-stream-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-stream-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts, q } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { makeAdapter, AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const chat = await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts');
const threads = await load<typeof import('./ai/conversations.server.ts')>('/src/lib/ai/conversations.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const { chatEventStream } = await load<typeof import('./ai/chat-stream.server.ts')>('/src/lib/ai/chat-stream.server.ts');
const { claimTurn, TURN_LEASE_MS } = await load<typeof import('./ai/turn-lease.server.ts')>('/src/lib/ai/turn-lease.server.ts');
const { encodeEvent, KEEP_ALIVE, sseData, stepLabel } = await load<typeof import('./ai/stream.ts')>('/src/lib/ai/stream.ts');
const { forgetInterrupted, interruptedKey, readTurn } = await load<typeof import('../components/assistant/useChatStream.ts')>('/src/components/assistant/useChatStream.ts');
const { tr } = await load<typeof import('./ai/labels.ts')>('/src/lib/ai/labels.ts');

const PRICE = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
const TREE = 'streamfam';
const USER = 'u1';
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname) VALUES ('ada', 'Ada', 'Example');
`);
family.close();
await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', USER, 'Reader', 'handle-stream', Date.now());
await setup.setUpFamilyAi(TREE, USER, { provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: 'sk-test-abcdefgh1234' });

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const encoder = new TextEncoder();
/** A response whose body is these strings, one read each. A chunk may split a line anywhere. */
const streamOf = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const s of chunks) c.enqueue(encoder.encode(s)); c.close(); },
});
const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
function stub(body: BodyInit, status = 200) {
  const sent: any[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(body, { status });
  }) as typeof fetch;
  return sent;
}
const req = (extra: object = {}) => ({ system: 'S', messages: [{ role: 'user' as const, text: 'hi' }], ...extra });
const c = (delta: object, finish?: string) => ({ choices: [{ delta, finish_reason: finish ?? null }] });

test('an Anthropic stream becomes the same reply as a whole response, with its thinking kept for the tool turn', async () => {
  stub(streamOf(sse([
    { type: 'message_start', message: { usage: { input_tokens: 11, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'He' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'llo' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'look', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"q"' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: ':"a"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    { type: 'message_stop' },
  ])));
  const deltas: string[] = [];
  const r = await makeAdapter('anthropic', 'k', 'claude-haiku-4-5').complete(req({ onDelta: (t: string) => deltas.push(t) }));
  assert.deepEqual(deltas, ['He', 'llo']);
  assert.equal(r.text, 'Hello');
  assert.deepEqual(r.calls, [{ id: 't1', name: 'look', args: { q: 'a' } }]);
  assert.deepEqual([r.inputTokens, r.outputTokens], [11, 9]);
  assert.deepEqual(r.reasoningDetails, [{ type: 'thinking', thinking: 'hm', signature: 'SIG' }]);
});

test('an OpenRouter stream asks for usage, joins tool arguments and keeps reasoning details whole', async () => {
  // Split inside lines, and with a keep-alive comment: both are what a real connection does.
  const text = [
    ': OPENROUTER PROCESSING\n\n',
    ...sse([
      c({ reasoning_details: [{ type: 'reasoning.text', text: 'Fi', index: 0 }] }),
      c({ reasoning_details: [{ type: 'reasoning.text', text: 'rst', index: 0, signature: null }] }),
      c({ reasoning_details: [{ type: 'reasoning.encrypted', data: 'BLOB', index: 1 }] }),
      c({ tool_calls: [{ index: 0, id: 't1', function: { name: 'look', arguments: '{"q"' } }] }),
      c({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }),
      c({}, 'tool_calls'),
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.5 } },
    ]),
    'data: [DONE]\n\n',
  ].join('');
  const sent = stub(streamOf([text.slice(0, 40), text.slice(40, 41), text.slice(41)]));
  const r = await makeAdapter('openrouter', 'k', 'x/y').complete(req({ onDelta: () => {} }));
  assert.equal(sent[0].stream, true);
  assert.deepEqual(sent[0].stream_options, { include_usage: true });
  assert.deepEqual(r.calls, [{ id: 't1', name: 'look', args: { q: 1 } }]);
  assert.deepEqual(r.reasoningDetails, [{ type: 'reasoning.text', text: 'First', index: 0 }, { type: 'reasoning.encrypted', data: 'BLOB', index: 1 }]);
  assert.equal(r.reportedCostUsd, 0.5);
  assert.deepEqual([r.inputTokens, r.outputTokens], [3, 4]);
});

test('the reasoning details go back with the tool turn on the next request', async () => {
  const sent: any[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(streamOf(sse([c({ content: 'ok' }), c({}, 'stop'), { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }])));
  }) as typeof fetch;
  const details = [{ type: 'reasoning.encrypted', data: 'BLOB', index: 0 }];
  await makeAdapter('openrouter', 'k', 'x/y').complete({
    system: 'S', onDelta: () => {},
    messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: '', calls: [{ id: 't1', name: 'look', args: {} }], reasoningDetails: details }, { role: 'tool', callId: 't1', content: 'r' }],
  });
  assert.deepEqual(sent[0].messages[2].reasoning_details, details);
});

for (const [name, body, code] of [
  ['a provider error under a 200', sse([c({ content: 'par' }), { error: { message: 'upstream failed' }, choices: [] }]), 'provider'],
  ['a stream cut off with no end', sse([c({ content: 'par' })]), 'bad-output'],
] as const) {
  test(`${name} fails the call, and the failed call keeps its reservation`, async () => {
    stub(streamOf([...body]));
    const before = await settings.spentThisMonth(TREE);
    const adapter = settings.budgeted(TREE, 5_000_000, makeAdapter('openrouter', 'k', 'x/y'), PRICE, tr('en'));
    await assert.rejects(adapter.complete(req({ onDelta: () => {} })), (e: InstanceType<typeof AiError>) => e.code === code && e.midStream === true);
    assert.ok((await settings.spentThisMonth(TREE)) > before, 'it may have billed, so it stays booked');
  });
}

test('a stream that never says what it used keeps its whole reservation', async () => {
  stub(streamOf(sse([c({ content: 'ok' }), c({}, 'stop')])));
  const before = await settings.spentThisMonth(TREE);
  const adapter = settings.budgeted(TREE, 5_000_000, makeAdapter('openrouter', 'k', 'x/y'), PRICE, tr('en'));
  const r = await adapter.complete(req({ onDelta: () => {} }));
  assert.equal(r.usageUnknown, true);
  assert.ok((await settings.spentThisMonth(TREE)) > before);
});

/** A stream that sends one piece and then stays open, until the request is aborted. */
function hangingFetch() {
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(sse([c({ content: 'par' })])[0]));
      init?.signal?.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')));
    },
  }))) as typeof fetch;
}

test('stopping a reply aborts the provider call', async () => {
  hangingFetch();
  const ac = new AbortController();
  const adapter = makeAdapter('openai', 'k', 'gpt-x');
  const got = adapter.complete(req({ signal: ac.signal, onDelta: () => ac.abort() }));
  await assert.rejects(got, (e: InstanceType<typeof AiError>) => e.code === 'aborted' && e.midStream === true);
});

test('a reply that goes silent times out', async () => {
  hangingFetch();
  await assert.rejects(makeAdapter('openai', 'k', 'gpt-x').complete(req({ timeoutMs: 40, onDelta: () => {} })), (e: InstanceType<typeof AiError>) => e.code === 'timeout');
});

test('a stopped call that never started books nothing', async () => {
  const ac = new AbortController();
  ac.abort();
  const before = await settings.spentThisMonth(TREE);
  const adapter = settings.budgeted(TREE, 5_000_000, makeAdapter('openai', 'k', 'gpt-x'), PRICE, tr('en'));
  await assert.rejects(adapter.complete(req({ signal: ac.signal, onDelta: () => {} })), (e: InstanceType<typeof AiError>) => e.code === 'aborted');
  assert.equal(await settings.spentThisMonth(TREE), before);
});

test('the event stream parser survives lines split across reads and skips comments', async () => {
  const text = `${encodeEvent({ type: 'delta', text: 'häl' })}${KEEP_ALIVE}${encodeEvent({ type: 'delta', text: 'lo' })}`;
  const bytes = encoder.encode(text);
  // Split in the middle of the two-byte ä.
  const cut = bytes.indexOf(0xc3) + 1;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)); c.close(); } });
  const seen: any[] = [];
  for await (const e of sseData(body)) seen.push(e);
  assert.deepEqual(seen.map((e) => e.text), ['häl', 'lo']);
});

test('a tool gets a friendly label; a tool not listed gets a plain one', () => {
  assert.equal(stepLabel('search_people'), 'ai.stepFamily');
  assert.equal(stepLabel('propose_set_dates'), 'ai.stepProposing');
  assert.equal(stepLabel('a_new_tool'), 'ai.stepWorking');
  assert.equal(stepLabel(undefined), 'ai.sending');
});

const events = (list: unknown[]) => streamOf(list.map((e) => encodeEvent(e as never)));

test('the browser clears what was written before a tool, and ends on the last event', async () => {
  const shown: { text: string; step: string }[] = [];
  const out = await readTurn(events([{ type: 'delta', text: 'Let me look' }, { type: 'step', tools: ['search_people'] }, { type: 'delta', text: 'Ada' }, { type: 'done', items: [] }]), (r) => shown.push(r), 0);
  assert.deepEqual(out, { kind: 'done', items: [] });
  assert.ok(shown.some((s) => s.text === '' && s.step === 'ai.stepFamily'), 'the status replaces the text written before the tool');
});

test('a connection that ends without a result is lost, and an error says why', async () => {
  assert.deepEqual(await readTurn(events([{ type: 'delta', text: 'par' }]), () => {}, 0), { kind: 'lost' });
  assert.deepEqual(await readTurn(events([{ type: 'error', message: 'ai.errBudget' }]), () => {}, 0), { kind: 'error', message: 'ai.errBudget' });
});

// ---------- whole turns, on the fake provider ----------

const reader = (conv: string) => ({ tree: TREE, user: USER, role: 'steward' as const, me: null, locale: 'en', conv });
const stored = async (conv: string) => (await accounts().all<{ id: string; role: string }>('SELECT id, role FROM ai_chat WHERE tree = ? AND user = ? AND conv = ?', TREE, USER, conv));
const uuid = () => crypto.randomUUID();

async function collect(body: ReadableStream<Uint8Array>) {
  const seen: any[] = [];
  for await (const e of sseData(body)) seen.push(e);
  return seen;
}
const send = (conv: string, text: string, turnId?: string) => chatEventStream((sink) => chat.sendMessage({ ...reader(conv), sink, text, turnId }));

test('a reply streams in pieces that add up to what is stored', async () => {
  const conv = await threads.newThread(TREE, USER);
  const seen = await collect(send(conv, 'Who is Ada?'));
  const pieces = seen.filter((e) => e.type === 'delta');
  assert.ok(pieces.length > 1, 'more than one piece');
  const done = seen.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(pieces.map((e) => e.text).join(''), done.items[1].text);
  assert.equal((await stored(conv)).length, 2);
});

test('a tool step is announced by name only, and its text is not the answer', async () => {
  const conv = await threads.newThread(TREE, USER);
  const seen = await collect(send(conv, '/tool search_people {"query":"Ada"}'));
  const step = seen.find((e) => e.type === 'step');
  assert.deepEqual(step, { type: 'step', tools: ['search_people'] });
  assert.equal(seen.at(-1).type, 'done');
  assert.match(seen.at(-1).items[1].text, /^Fake summary/);
});

test('stopping a reply stores nothing, and frees the chat', async () => {
  const conv = await threads.newThread(TREE, USER);
  const body = send(conv, 'FAKE-SLOW a long question that takes a while');
  const r = body.getReader();
  await r.read();
  await r.cancel();
  // The turn ends as soon as the stop reaches it; the lease goes with it.
  for (let i = 0; i < 50 && !(await claimAndFree(conv)); i++) await new Promise((d) => setTimeout(d, 20));
  assert.equal((await stored(conv)).length, 0);
  const again = await collect(send(conv, 'next'));
  assert.equal(again.at(-1).type, 'done');
});

async function claimAndFree(conv: string) {
  const l = await claimTurn(conv);
  await l?.release();
  return !!l;
}

test('a provider that breaks off mid-reply gives an error and stores nothing', async () => {
  const conv = await threads.newThread(TREE, USER);
  const seen = await collect(send(conv, 'FAKE-FAIL please'));
  assert.equal(seen.at(-1).type, 'error');
  assert.equal((await stored(conv)).length, 0);
});

test('a turn past its limit ends with a timeout and stores nothing', async () => {
  const conv = await threads.newThread(TREE, USER);
  const seen = await collect(chatEventStream((sink) => chat.sendMessage({ ...reader(conv), sink, text: 'FAKE-SLOW and long' }), { deadlineMs: 30 }));
  assert.equal(seen.at(-1).type, 'error');
  assert.equal(seen.at(-1).code, 'timeout');
  assert.equal((await stored(conv)).length, 0);
});

test('one running turn per chat: a second in the same chat is refused, another chat runs alongside it', async () => {
  const [a, b] = [await threads.newThread(TREE, USER), await threads.newThread(TREE, USER)];
  const first = collect(send(a, 'FAKE-SLOW one'));
  await new Promise((d) => setTimeout(d, 60));
  const refused = await collect(send(a, 'two'));
  assert.equal(refused.at(-1).type, 'error');
  assert.equal(refused.at(-1).code, 'busy');
  const other = await collect(send(b, 'in another chat'));
  assert.equal(other.at(-1).type, 'done');
  assert.equal((await first).at(-1).type, 'done');
  assert.equal((await stored(a)).length, 2);
});

test('a lease left by a turn that died stops counting', async () => {
  const conv = uuid();
  const old = Date.now() - TURN_LEASE_MS - 1;
  assert.ok(await claimTurn(conv, old));
  assert.equal(await claimTurn(conv, Date.now() - 1000), null, 'still fresh a moment later would be refused');
  await accounts().run('UPDATE ai_turn SET at = ? WHERE conv = ?', old, conv);
  assert.ok(await claimTurn(conv));
});

test('a retry of a turn that was stored finds it, and spends nothing', async () => {
  const conv = await threads.newThread(TREE, USER);
  const turnId = uuid();
  await collect(send(conv, 'once', turnId));
  const spent = await settings.spentThisMonth(TREE);
  const again = await collect(send(conv, 'once', turnId));
  assert.equal(again.at(-1).type, 'done');
  assert.equal(again.at(-1).items[0].id, turnId);
  assert.equal((await stored(conv)).length, 2, 'not stored twice');
  assert.equal(await settings.spentThisMonth(TREE), spent);
});

test('a continuation streams, and one stopped leaves the decisions to be told again', async () => {
  const conv = await threads.newThread(TREE, USER);
  const made = await collect(send(conv, `/tool propose_add_story ${JSON.stringify({ person: 'ada', kind: 'memory', title: 'Mill', body: 'She ran the mill.' })}`));
  const reply = made.at(-1).items[1];
  const p = reply.proposals[0];
  await chat.markProposal(TREE, USER, 'steward', conv, reply.id, p.id, 'done');

  const stoppedBody = chatEventStream((sink) => chat.continueAfterDecisions({ ...reader(conv), sink }));
  const r = stoppedBody.getReader();
  await r.read();
  await r.cancel();
  for (let i = 0; i < 50 && !(await claimAndFree(conv)); i++) await new Promise((d) => setTimeout(d, 20));
  assert.equal((await stored(conv)).length, 2, 'the stopped continuation stored nothing');

  const seen = await collect(chatEventStream((sink) => chat.continueAfterDecisions({ ...reader(conv), sink })));
  assert.equal(seen.at(-1).type, 'done');
  assert.ok(seen.some((e) => e.type === 'delta'), 'the continuation streams');
  assert.match(seen.at(-1).items[0].text, /Fake continuation/);
});

const leaseAt = async (conv: string) => (await accounts().get<{ at: number }>('SELECT at FROM ai_turn WHERE conv = ?', conv))?.at;
const until = async (ok: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((d) => setTimeout(d, 10));
};

test('a turn that lost its lease is stopped and stores nothing: only the holder stores', async () => {
  const conv = await threads.newThread(TREE, USER);
  const stalled = collect(send(conv, 'FAKE-SLOW the first turn, which stalls'));
  await new Promise((d) => setTimeout(d, 60));
  // The first turn has gone quiet past the lease, so a message from another tab is admitted.
  await accounts().run('UPDATE ai_turn SET at = ? WHERE conv = ?', Date.now() - TURN_LEASE_MS - 1, conv);
  const holder = await collect(send(conv, 'the second turn'));
  assert.equal(holder.at(-1).type, 'done');
  const first = await stalled;
  assert.equal(first.at(-1).type, 'error');
  assert.equal(first.at(-1).code, 'busy', 'the turn that lost the chat is told so');
  const rows = await accounts().all<{ role: string; body: string }>('SELECT role, body FROM ai_chat WHERE conv = ? ORDER BY at, rowid', conv);
  assert.equal(rows.length, 2, 'the stale turn stored nothing');
  assert.equal((JSON.parse(rows[0].body) as { text: string }).text, 'the second turn');
});

test('a batch fenced by a lease is refused once another turn holds the chat', async () => {
  const conv = uuid();
  const lease = (await claimTurn(conv))!;
  await accounts().batch([lease.fence(), q('INSERT INTO ai_turn (conv, claim, at) VALUES (?, ?, ?)', `${conv}-held`, 'x', 1)]);
  assert.equal(await leaseAt(`${conv}-held`), 1, 'the holder stores');
  await accounts().run('UPDATE ai_turn SET claim = ? WHERE conv = ?', 'another turn', conv);
  await assert.rejects(accounts().batch([lease.fence(), q('INSERT INTO ai_turn (conv, claim, at) VALUES (?, ?, ?)', `${conv}-stale`, 'x', 1)]), /kindred:guard/);
  assert.equal(await leaseAt(`${conv}-stale`), undefined, 'a stale turn stores nothing');
  assert.equal(await lease.held(), false);
});

test('a lease renews by itself while a turn is silent, and stops when released', async () => {
  const conv = uuid();
  const lease = (await claimTurn(conv, Date.now(), 5))!;
  await accounts().run('UPDATE ai_turn SET at = 1 WHERE conv = ?', conv);
  await until(async () => (await leaseAt(conv)) !== 1);
  assert.notEqual(await leaseAt(conv), 1, 'no text and no tool result is needed for it to stay alive');
  await lease.release();
  assert.equal(await leaseAt(conv), undefined);
});

test('a heartbeat that finds another claim stops its turn', async () => {
  const conv = uuid();
  const lease = (await claimTurn(conv, Date.now(), 5))!;
  await accounts().run('UPDATE ai_turn SET claim = ? WHERE conv = ?', 'another turn', conv);
  await until(() => lease.signal.aborted);
  assert.ok(lease.signal.aborted, 'the zero-row update was noticed');
  assert.equal((lease.signal.reason as InstanceType<typeof AiError>).code, 'busy');
  await lease.release();
  assert.equal(await leaseAt(conv) !== undefined, true, 'releasing a lost lease leaves the new holder alone');
});

test('Edit on an interrupted message drops its record, so a reload does not bring the old text back', () => {
  const data = new Map<string, string>();
  (globalThis as any).sessionStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) };
  try {
    const key = interruptedKey(TREE);
    data.set(key, JSON.stringify([{ conv: 'c', id: 'edited', text: 'old text', keep: false }, { conv: 'c', id: 'other', text: 'kept', keep: false }]));
    forgetInterrupted(TREE, 'edited');
    assert.deepEqual((JSON.parse(data.get(key)!) as { id: string }[]).map((x) => x.id), ['other']);
  } finally {
    delete (globalThis as any).sessionStorage;
  }
});
