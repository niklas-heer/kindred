// The Cursor source for scripts/ai-eval.ts (`--provider cursor`): a model in Cursor's subscription, reached through its
// `agent` CLI. The CLI takes one text prompt and prints one JSON result, with no JSON-schema or tools API, so this adapter
// writes the request into the prompt (the system text, the conversation, and the tools or the JSON shape asked for) and
// reads the answer back. Cursor runs its own agent with its own system prompt, so the models are compared on the jobs: the
// app's own provider code is not exercised. Read-only: `--mode ask`, run from an empty folder made for the run, never from
// the repository. Tests stub the CLI: scripts/lib/cursor-adapter.test.ts.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiAdapter, AiReply, AiRequest, ToolCall } from '../../src/lib/ai/adapters.ts';

/** The CLI's name on PATH. It runs without a shell: the arguments are passed exactly as built here. */
export const AGENT_BIN = 'agent';
/** The most one call may take. A call that times out is not retried. */
export const CURSOR_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;

/**
 * AiAdapter.provider is the app's provider union, which has no cursor, and widening it would reach the app's pricing and
 * search code. Only this adapter carries the value, and the eval's cursor path never reads it: its cost is not metered and no
 * web search runs. Cast here, once.
 */
export const CURSOR_PROVIDER = 'cursor' as unknown as AiAdapter['provider'];

export type CursorErrorCode = 'bad-input' | 'bad-output' | 'provider' | 'timeout' | 'unreachable';
/**
 * A failed call, with the app's error codes so the eval reports it like the others. Not AiError: that class lives in
 * adapters.ts, which plain Node's type stripping cannot load, so the tests could not import it.
 */
export class CursorError extends Error {
  readonly code: CursorErrorCode;
  constructor(code: CursorErrorCode, message: string) {
    super(message);
    this.name = 'CursorError';
    this.code = code;
  }
}

export interface CliRun { stdout: string; stderr: string; exitCode: number; timedOut: boolean; missing: boolean }
/** Runs the CLI with these arguments, in `cwd`. Never rejects: a failure is in the result, so the caller decides. */
export type CliRunner = (args: string[], o: { cwd: string; timeoutMs: number }) => Promise<CliRun>;

/** The real CLI. */
export const runAgent: CliRunner = (args, o) => new Promise((resolve) => {
  execFile(AGENT_BIN, args, { cwd: o.cwd, timeout: o.timeoutMs, maxBuffer: MAX_STDOUT_BYTES, windowsHide: true }, (err, stdout, stderr) => {
    const out = { stdout: String(stdout), stderr: String(stderr) };
    if (!err) return resolve({ ...out, exitCode: 0, timedOut: false, missing: false });
    const code: unknown = (err as { code?: unknown }).code;
    resolve({ ...out, exitCode: typeof code === 'number' ? code : 1, timedOut: (err as { killed?: boolean }).killed === true, missing: code === 'ENOENT' });
  });
});

/** Runs `fn` in a new, empty folder, and removes the folder afterwards, whether `fn` returns or throws. */
export async function withEmptyFolder<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'kindred-cursor-eval-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FENCED = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;
/** The answer without a code fence around it (```json … ``` or ``` … ```). */
export function stripFence(s: string): string {
  const t = s.trim();
  const m = FENCED.exec(t);
  return m ? m[1]!.trim() : t;
}

/** The request as one text prompt: the system text and the conversation, each labelled, then the output the reader needs. */
export function buildPrompt(req: AiRequest): string {
  const callNames = new Map<string, string>();
  for (const m of req.messages) if (m.role === 'assistant') for (const c of m.calls ?? []) callNames.set(c.id, c.name);
  const turns = req.messages.map((m): string => {
    if (m.role === 'user') return `User:\n${m.text}`;
    if (m.role === 'assistant') {
      return [
        m.text ? `Assistant:\n${m.text}` : '',
        m.calls?.length ? `Assistant called tools:\n${JSON.stringify({ calls: m.calls.map((c) => ({ name: c.name, args: c.args ?? {} })) })}` : '',
      ].filter(Boolean).join('\n');
    }
    return `Tool result for ${callNames.get(m.callId) ?? 'a tool'}:\n${m.content}`;
  });
  return [
    'The text below is a request from a program, not a chat. Follow its system instructions, answer the last user message, and use the output format given at the end.',
    '',
    'System instructions:',
    req.system,
    '',
    'Conversation so far:',
    turns.join('\n\n') || '(no messages)',
    '',
    'Output format:',
    outputRules(req),
  ].join('\n');
}

function outputRules(req: AiRequest): string {
  if (req.json) {
    return `Reply with ONLY one JSON value that matches this JSON Schema (named "${req.json.name}"). No words before or after it, no code fences.\nJSON Schema: ${JSON.stringify(req.json.schema)}`;
  }
  if (req.tools?.length) {
    return [
      'Tools you can call (their results come back in the next message):',
      ...req.tools.map((t) => `- ${t.name}: ${t.description}\n  arguments (JSON Schema): ${JSON.stringify(t.parameters)}`),
      '',
      'Reply with ONLY one JSON object, with no words before or after it and no code fences:',
      '- to call tools: {"calls":[{"name":"<tool name>","args":{ ... }}]}',
      '- to answer the user: {"text":"<your answer>"}',
    ].join('\n');
  }
  return 'Reply with your answer only, as plain text.';
}

/** A tool-request reply: `{"calls":[…]}` becomes the calls, `{"text":"…"}` the answer. Anything else is a bad reply. */
function toolReply(answer: string, nextId: () => string): { text: string; calls: ToolCall[] } {
  const bad = (why: string) => new CursorError('bad-output', `Cursor’s answer was not the tool reply asked for: ${why}.`);
  let v: unknown;
  try {
    v = JSON.parse(stripFence(answer));
  } catch {
    throw bad('not JSON');
  }
  if (typeof v !== 'object' || v === null) throw bad('not an object');
  const o = v as { text?: unknown; calls?: unknown };
  const calls: ToolCall[] = [];
  if (o.calls !== undefined) {
    if (!Array.isArray(o.calls)) throw bad('"calls" is not a list');
    for (const c of o.calls as unknown[]) {
      const call = c as { name?: unknown; args?: unknown } | null;
      const argsOk = call?.args === undefined || (typeof call.args === 'object' && call.args !== null && !Array.isArray(call.args));
      if (!call || typeof call.name !== 'string' || !argsOk) throw bad('a call has no name, or its args are not an object');
      calls.push({ id: nextId(), name: call.name, args: call.args ?? {} });
    }
  }
  const text = typeof o.text === 'string' ? o.text : '';
  if (calls.length) return { text, calls };
  if (typeof o.text === 'string') return { text, calls: [] };
  throw bad('neither calls nor text');
}

interface Answer { text: string; inputTokens: number; outputTokens: number }
interface Envelope { type?: unknown; subtype?: unknown; is_error?: unknown; result?: unknown; usage?: { inputTokens?: unknown; outputTokens?: unknown } }

const count = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** The CLI's answer, read from its one JSON result; or why there is none. */
function readResult(run: CliRun): Answer | { problem: string } {
  if (run.exitCode !== 0) {
    const line = run.stderr.trim().split('\n')[0]?.slice(0, 160) ?? '';
    return { problem: `exit ${run.exitCode}${line ? `: ${line}` : ''}` };
  }
  let env: Envelope | null;
  try {
    env = JSON.parse(run.stdout) as Envelope | null;
  } catch {
    return { problem: 'no JSON result on stdout' };
  }
  if (env?.type !== 'result' || env.is_error === true || env.subtype !== 'success' || typeof env.result !== 'string') {
    return { problem: `result ${String(env?.subtype ?? 'missing')}` };
  }
  return { text: env.result, inputTokens: count(env.usage?.inputTokens), outputTokens: count(env.usage?.outputTokens) };
}

/** One call, with one retry when the CLI itself fails. A timeout or a missing CLI is not retried. */
async function ask(cli: CliRunner, args: string[], cwd: string): Promise<Answer> {
  for (let attempt = 1; ; attempt++) {
    const run = await cli(args, { cwd, timeoutMs: CURSOR_TIMEOUT_MS });
    if (run.missing) throw new CursorError('unreachable', `The Cursor agent CLI (\`${AGENT_BIN}\`) was not found on PATH.`);
    if (run.timedOut) throw new CursorError('timeout', `Cursor did not answer within ${CURSOR_TIMEOUT_MS / 1000} s.`);
    const got = readResult(run);
    if ('text' in got) return got;
    if (attempt >= 2) throw new CursorError('provider', `Cursor’s agent failed on two tries (${got.problem}).`);
  }
}

/**
 * The adapter for one Cursor model. `cwd` is the empty folder every call runs in (see withEmptyFolder). `cli` defaults to the
 * real CLI. Vision and web search are refused: the eval does not run those tasks for this source. Reasoning is not set.
 */
export function cursorAdapter(model: string, o: { cwd: string; cli?: CliRunner }): AiAdapter {
  const cli = o.cli ?? runAgent;
  let made = 0;
  const nextId = () => `cursor-${++made}`;
  return {
    provider: CURSOR_PROVIDER,
    model,
    async complete(req: AiRequest): Promise<AiReply> {
      if (req.webSearch) throw new CursorError('bad-input', 'The Cursor source runs no web search.');
      if (req.messages.some((m) => m.role === 'user' && (m.images?.length ?? 0) > 0)) throw new CursorError('bad-input', 'The Cursor source takes no pictures.');
      const answer = await ask(cli, ['-p', '--trust', '--mode', 'ask', '--output-format', 'json', '--model', model, buildPrompt(req)], o.cwd);
      const usage = { tokens: answer.inputTokens + answer.outputTokens, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, searches: 0 };
      if (req.json) {
        let json: unknown;
        try {
          json = JSON.parse(stripFence(answer.text));
        } catch {
          throw new CursorError('bad-output', 'Cursor’s answer was not the JSON shape asked for.');
        }
        return { text: answer.text, calls: [], json, ...usage };
      }
      if (req.tools?.length) return { ...toolReply(answer.text, nextId), ...usage };
      return { text: answer.text.trim(), calls: [], ...usage };
    },
  };
}
