// node --test scripts/lib/cursor-adapter.test.ts — the Cursor source's adapter with a stubbed CLI: no process is started. Checked:
// the argument list and the folder the CLI runs in, the prompt it writes, the JSON and tool replies it reads (with and without
// a code fence), a bad reply, the one retry, the errors, and that the folder is removed. Run from the repository root.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { CURSOR_TIMEOUT_MS, CURSOR_PROVIDER, CursorError, buildPrompt, cursorAdapter, stripFence, withEmptyFolder, type CliRun, type CliRunner } from './cursor-adapter.ts';
import type { AiRequest } from '../../src/lib/ai/adapters.ts';

/** A CLI result that succeeded, with the JSON envelope the agent prints. */
const ok = (result: string): CliRun => ({
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, result, usage: { inputTokens: 12, outputTokens: 3 } }),
  stderr: '', exitCode: 0, timedOut: false, missing: false,
});
const failed = (stderr = 'boom'): CliRun => ({ stdout: '', stderr, exitCode: 1, timedOut: false, missing: false });

interface Call { args: string[]; cwd: string; timeoutMs: number }
/** A stub CLI: answers each call with the next of `replies` (a reply that is an Error is thrown), and records every call. */
function stubCli(replies: CliRun[]): { cli: CliRunner; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...replies];
  const cli: CliRunner = async (args, o) => {
    calls.push({ args, cwd: o.cwd, timeoutMs: o.timeoutMs });
    const next = queue.shift();
    if (!next) throw new Error('the stub CLI has no reply left');
    return next;
  };
  return { cli, calls };
}

const plain = (prompt: string, over: Partial<AiRequest> = {}): AiRequest => ({ system: 'Be brief.', messages: [{ role: 'user', text: prompt }], ...over });

test('the CLI runs read-only, in the folder given, with its argument list and no shell', async () => {
  const { cli, calls } = stubCli([ok('Ruth was born in 1931.')]);
  const a = cursorAdapter('composer-2.5', { cwd: '/scratch/empty', cli });
  const reply = await a.complete(plain('When was Ruth born?'));
  assert.equal(reply.text, 'Ruth was born in 1931.');
  assert.equal(calls.length, 1);
  const [args] = calls.map((c) => c.args);
  assert.deepEqual(args!.slice(0, 8), ['-p', '--trust', '--mode', 'ask', '--output-format', 'json', '--model', 'composer-2.5']);
  assert.equal(args!.length, 9, 'the prompt is the last and only other argument');
  assert.equal(args!.includes('--yolo') || args!.includes('-f') || args!.includes('--force'), false, 'never a flag that writes');
  assert.equal(calls[0]!.cwd, '/scratch/empty', 'never the repository');
  assert.equal(calls[0]!.timeoutMs, CURSOR_TIMEOUT_MS);
  assert.equal(CURSOR_TIMEOUT_MS, 120_000);
});

test('the request is written into one labelled prompt: the system text, the conversation and the output rule', () => {
  const prompt = buildPrompt(plain('When was Ruth born?'));
  assert.match(prompt, /System instructions:\nBe brief\./);
  assert.match(prompt, /Conversation so far:\nUser:\nWhen was Ruth born\?/);
  assert.match(prompt, /Reply with your answer only, as plain text\./);
});

test('a JSON request: the schema is in the prompt, and an answer with or without a code fence is read', async () => {
  const schema = { type: 'object', properties: { name: { type: 'string' } } };
  const { cli, calls } = stubCli([ok('{"name":"Ruth"}'), ok('```json\n{"name":"Ruth"}\n```'), ok('```\n{"name":"Ruth"}\n```')]);
  const a = cursorAdapter('gemini-3.8-flash-low', { cwd: '/x', cli });
  const req: AiRequest = { ...plain('Name?'), json: { name: 'answer', schema } };
  for (let i = 0; i < 3; i++) {
    const reply = await a.complete(req);
    assert.deepEqual(reply.json, { name: 'Ruth' });
    assert.deepEqual(reply.calls, []);
  }
  const prompt = calls[0]!.args.at(-1)!;
  assert.match(prompt, /Reply with ONLY one JSON value that matches this JSON Schema/);
  assert.ok(prompt.includes(JSON.stringify(schema)), 'the schema is written into the prompt');
});

test('a JSON answer that is not JSON is a bad output, and it is not retried', async () => {
  const { cli, calls } = stubCli([ok('Sure! Here it is: Ruth.')]);
  const a = cursorAdapter('grok-4.7-low', { cwd: '/x', cli });
  await assert.rejects(a.complete({ ...plain('Name?'), json: { name: 'answer', schema: { type: 'object' } } }), (e: unknown) => e instanceof CursorError && e.code === 'bad-output');
  assert.equal(calls.length, 1);
});

test('a tool request: a calls reply becomes tool calls, and a text reply becomes the answer', async () => {
  const tools = [{ name: 'read_person', description: 'Read one person.', parameters: { type: 'object', properties: { id: { type: 'string' } } } }];
  const { cli, calls } = stubCli([ok('{"calls":[{"name":"read_person","args":{"id":"ruth"}}]}'), ok('{"text":"Ruth was born in 1931."}')]);
  const a = cursorAdapter('composer-2.5', { cwd: '/x', cli });
  const first = await a.complete({ ...plain('When was Ruth born?'), tools });
  assert.equal(first.text, '');
  assert.equal(first.calls.length, 1);
  assert.equal(first.calls[0]!.name, 'read_person');
  assert.deepEqual(first.calls[0]!.args, { id: 'ruth' });
  assert.match(first.calls[0]!.id, /^cursor-\d+$/);
  const second = await a.complete({ ...plain('When was Ruth born?'), tools });
  assert.equal(second.text, 'Ruth was born in 1931.');
  assert.deepEqual(second.calls, []);
  const prompt = calls[0]!.args.at(-1)!;
  assert.match(prompt, /- read_person: Read one person\./);
  assert.match(prompt, /\{"calls":\[\{"name":"<tool name>"/);
});

test('the tool results go back in the next prompt, labelled with the tool that made them', async () => {
  const { cli, calls } = stubCli([ok('{"text":"done"}')]);
  const a = cursorAdapter('composer-2.5', { cwd: '/x', cli });
  await a.complete({
    system: 's',
    tools: [{ name: 'read_person', description: 'd', parameters: {} }],
    messages: [
      { role: 'user', text: 'Q?' },
      { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'read_person', args: { id: 'ruth' } }] },
      { role: 'tool', callId: 'c1', content: '{"id":"ruth","born":"1931"}' },
    ],
  });
  const prompt = calls[0]!.args.at(-1)!;
  assert.match(prompt, /Assistant called tools:\n\{"calls":\[\{"name":"read_person","args":\{"id":"ruth"\}\}\]\}/);
  assert.match(prompt, /Tool result for read_person:\n\{"id":"ruth","born":"1931"\}/);
});

test('a tool reply that is neither calls nor text, or is prose, is a bad output', async () => {
  for (const bad of ['{"answer":"1931"}', '{"calls":"read_person"}', '{"calls":[{"args":{}}]}', 'Ruth was born in 1931.', '{"calls":[{"name":"x","args":[1]}]}']) {
    const { cli } = stubCli([ok(bad)]);
    const a = cursorAdapter('composer-2.5', { cwd: '/x', cli });
    await assert.rejects(a.complete({ ...plain('Q?'), tools: [{ name: 'x', description: 'd', parameters: {} }] }), (e: unknown) => e instanceof CursorError && e.code === 'bad-output', bad);
  }
});

test('a CLI error is retried once: the second call answers', async () => {
  const { cli, calls } = stubCli([failed('rate limited'), ok('Ruth was born in 1931.')]);
  const a = cursorAdapter('composer-2.5', { cwd: '/x', cli });
  const reply = await a.complete(plain('When?'));
  assert.equal(reply.text, 'Ruth was born in 1931.');
  assert.equal(calls.length, 2);
});

test('a CLI error on both tries fails the call as a provider error, after two calls', async () => {
  const { cli, calls } = stubCli([failed('first'), failed('second')]);
  const a = cursorAdapter('composer-2.5', { cwd: '/x', cli });
  await assert.rejects(a.complete(plain('When?')), (e: unknown) => e instanceof CursorError && e.code === 'provider' && /exit 1: second/.test(e.message));
  assert.equal(calls.length, 2);
});

test('an error the CLI reports in its JSON (is_error) counts as a CLI error and is retried', async () => {
  const errorEnvelope: CliRun = { stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' }), stderr: '', exitCode: 0, timedOut: false, missing: false };
  const { cli, calls } = stubCli([errorEnvelope, ok('Ruth.')]);
  const a = cursorAdapter('composer-2.5', { cwd: '/x', cli });
  assert.equal((await a.complete(plain('Who?'))).text, 'Ruth.');
  assert.equal(calls.length, 2);
  const { cli: cli2 } = stubCli([errorEnvelope, errorEnvelope]);
  await assert.rejects(cursorAdapter('composer-2.5', { cwd: '/x', cli: cli2 }).complete(plain('Who?')), (e: unknown) => e instanceof CursorError && e.code === 'provider');
});

test('a timeout is not retried, and a missing CLI is reported as unreachable', async () => {
  const timedOut: CliRun = { stdout: '', stderr: '', exitCode: 1, timedOut: true, missing: false };
  const { cli, calls } = stubCli([timedOut, ok('never reached')]);
  await assert.rejects(cursorAdapter('composer-2.5', { cwd: '/x', cli }).complete(plain('Q?')), (e: unknown) => e instanceof CursorError && e.code === 'timeout' && /120 s/.test(e.message));
  assert.equal(calls.length, 1);
  const missing: CliRun = { stdout: '', stderr: '', exitCode: 1, timedOut: false, missing: true };
  const again = stubCli([missing]);
  await assert.rejects(cursorAdapter('composer-2.5', { cwd: '/x', cli: again.cli }).complete(plain('Q?')), (e: unknown) => e instanceof CursorError && e.code === 'unreachable');
  assert.equal(again.calls.length, 1);
});

test('a web-search request and a picture are refused before the CLI runs', async () => {
  const { cli, calls } = stubCli([]);
  const a = cursorAdapter('composer-2.5', { cwd: '/x', cli });
  await assert.rejects(a.complete({ ...plain('Q?'), webSearch: { maxUses: 2 } }), (e: unknown) => e instanceof CursorError && e.code === 'bad-input');
  await assert.rejects(a.complete({ system: 's', messages: [{ role: 'user', text: 'Q?', images: [{ mime: 'image/png', base64: 'AAAA' }] }] }), (e: unknown) => e instanceof CursorError && e.code === 'bad-input');
  assert.equal(calls.length, 0);
});

test('the code fence is stripped only around the whole answer', () => {
  assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFence('```\n{}\n```'), '{}');
  assert.equal(stripFence('  {"a":1}  '), '{"a":1}');
  assert.equal(stripFence('```json\n{"a":1}\n```\nand more'), '```json\n{"a":1}\n```\nand more', 'a fence in the middle of an answer is left alone');
});

test('the adapter reports the cursor provider and the model it was given', () => {
  assert.equal(CURSOR_PROVIDER, 'cursor');
  assert.equal(cursorAdapter('composer-2.5', { cwd: '/x', cli: stubCli([]).cli }).model, 'composer-2.5');
});

test('the temporary folder is empty while the run uses it, and is removed afterwards, also when the run throws', async () => {
  let seen = '';
  const value = await withEmptyFolder(async (dir) => {
    seen = dir;
    assert.equal(existsSync(dir), true);
    assert.deepEqual(readdirSync(dir), [], 'the folder is empty');
    const { cli, calls } = stubCli([ok('ok')]);
    await cursorAdapter('composer-2.5', { cwd: dir, cli }).complete(plain('Q?'));
    assert.equal(calls[0]!.cwd, dir, 'the CLI runs in that folder');
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(existsSync(seen), false, 'removed after the run');

  let thrown = '';
  await assert.rejects(withEmptyFolder(async (dir) => {
    thrown = dir;
    throw new Error('run failed');
  }), /run failed/);
  assert.equal(existsSync(thrown), false, 'removed even when the run throws');
});
