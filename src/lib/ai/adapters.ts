// One interface over the three providers, built on plain fetch so it runs on Workers as well as Node:
// chat with tools, image input and JSON-structured output. Anthropic's Messages API; OpenAI's Chat
// Completions API; OpenRouter, which speaks the same Chat Completions shape. Never logs the key, and
// never puts it in an error message.
import { PROVIDER_LABEL, type Provider } from './types';

export type AiErrorCode = 'not-configured' | 'bad-input' | 'budget' | 'auth' | 'rate-limited' | 'timeout' | 'unreachable' | 'provider' | 'bad-output' | 'key-unreadable';

export class AiError extends Error {
  constructor(readonly code: AiErrorCode, message: string, readonly retryAfter?: number) {
    super(message);
    this.name = 'AiError';
  }
}

export type JsonSchema = Record<string, unknown>;
export interface ToolSpec { name: string; description: string; parameters: JsonSchema }
export interface ToolCall { id: string; name: string; args: unknown }
export interface ImagePart { mime: string; base64: string }

export type AiMessage =
  | { role: 'user'; text: string; images?: ImagePart[] }
  | { role: 'assistant'; text: string; calls?: ToolCall[] }
  | { role: 'tool'; callId: string; content: string };

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  tools?: ToolSpec[];
  /** Ask for an answer in this JSON shape; the reply's `json` holds it, already parsed. */
  json?: { name: string; schema: JsonSchema };
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiReply {
  text: string;
  calls: ToolCall[];
  json?: unknown;
  /** Tokens the call used (input and output), for the family's daily budget. */
  tokens: number;
}

export interface AiAdapter {
  readonly provider: Provider | 'fake';
  readonly model: string;
  complete(req: AiRequest): Promise<AiReply>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strips the key from anything that might echo it, and keeps the message short. */
const scrub = (s: string, key: string) => (key ? s.split(key).join('…') : s).slice(0, 300);

/**
 * One POST with the failure handling every provider shares: a timeout, a single retry for a 429 or 5xx
 * (after the provider's Retry-After, at most five seconds), and plain messages for the rest.
 */
async function post(label: Provider, url: string, headers: Record<string, string>, body: unknown, key: string, timeoutMs: number): Promise<any> {
  const name = PROVIDER_LABEL[label];
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('timeout', `${name} did not answer in time. Try again.`);
      throw new AiError('unreachable', `Could not reach ${name}. Check the connection.`);
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new AiError('bad-output', `${name} sent back something unreadable.`);
      }
    }
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    if ((res.status === 429 || res.status >= 500) && attempt === 1) {
      await sleep(Math.min(retryAfter ?? 1, 5) * 1000);
      continue;
    }
    if (res.status === 429) throw new AiError('rate-limited', `${name} is rate-limiting this key. Try again in a minute.`, retryAfter);
    if (res.status === 401 || res.status === 403) throw new AiError('auth', `${name} did not accept the key. Check it in the AI settings.`);
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } | string };
      detail = typeof j.error === 'string' ? j.error : j.error?.message ?? '';
    } catch {}
    throw new AiError('provider', `${name} answered ${res.status}${detail ? `: ${scrub(detail, key)}` : '.'}`);
  }
}

// ---------- Anthropic Messages API ----------

function anthropic(key: string, model: string): AiAdapter {
  return {
    provider: 'anthropic',
    model,
    async complete(req) {
      const messages: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
      for (const m of req.messages) {
        if (m.role === 'user') {
          const content: unknown[] = (m.images ?? []).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } }));
          content.push({ type: 'text', text: m.text || ' ' });
          messages.push({ role: 'user', content });
        } else if (m.role === 'assistant') {
          const content: unknown[] = [];
          if (m.text) content.push({ type: 'text', text: m.text });
          for (const c of m.calls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
          if (content.length) messages.push({ role: 'assistant', content });
        } else {
          // Results of one turn's tool calls share one user message.
          const block = { type: 'tool_result', tool_use_id: m.callId, content: m.content };
          const last = messages.at(-1);
          if (last?.role === 'user' && last.content.every((b) => (b as { type: string }).type === 'tool_result')) last.content.push(block);
          else messages.push({ role: 'user', content: [block] });
        }
      }
      const body: Record<string, unknown> = { model, max_tokens: req.maxTokens ?? 1024, system: req.system, messages };
      if (req.json) {
        body.tools = [{ name: req.json.name, description: 'Give the answer in this shape.', input_schema: req.json.schema }];
        body.tool_choice = { type: 'tool', name: req.json.name };
      } else if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      }
      const data = await post('anthropic', 'https://api.anthropic.com/v1/messages', {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      }, body, key, req.timeoutMs ?? 45_000);
      const blocks = (data.content ?? []) as { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id!, name: b.name!, args: b.input }));
      const tokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
      if (req.json) {
        const answer = calls.find((c) => c.name === req.json!.name);
        if (!answer) throw new AiError('bad-output', 'The AI did not answer in the shape asked for.');
        return { text, calls: [], json: answer.args, tokens };
      }
      return { text, calls, tokens };
    },
  };
}

// ---------- OpenAI Chat Completions, and OpenRouter, which is the same shape ----------

function chatCompletions(provider: 'openai' | 'openrouter', key: string, model: string): AiAdapter {
  const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  // OpenRouter identifies the app, never the reader: no email, no account id.
  if (provider === 'openrouter') headers['x-title'] = 'Kindred';
  return {
    provider,
    model,
    async complete(req) {
      const messages: unknown[] = [{ role: 'system', content: req.system }];
      for (const m of req.messages) {
        if (m.role === 'user') {
          if (m.images?.length) {
            messages.push({ role: 'user', content: [...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })), { type: 'text', text: m.text || ' ' }] });
          } else messages.push({ role: 'user', content: m.text });
        } else if (m.role === 'assistant') {
          const msg: Record<string, unknown> = { role: 'assistant', content: m.text || null };
          if (m.calls?.length) msg.tool_calls = m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }));
          messages.push(msg);
        } else {
          messages.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
        }
      }
      const body: Record<string, unknown> = { model, messages };
      // OpenAI's reasoning models take max_completion_tokens; OpenRouter's normalised API takes max_tokens.
      if (provider === 'openai') body.max_completion_tokens = req.maxTokens ?? 1024;
      else body.max_tokens = req.maxTokens ?? 1024;
      if (req.json) body.response_format = { type: 'json_schema', json_schema: { name: req.json.name, schema: req.json.schema, strict: false } };
      else if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      const data = await post(provider, url, headers, body, key, req.timeoutMs ?? 45_000);
      const msg = data.choices?.[0]?.message as { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } | undefined;
      if (!msg) throw new AiError('bad-output', `${PROVIDER_LABEL[provider]} sent back no answer.`);
      const tokens = data.usage?.total_tokens ?? (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
      const text = msg.content ?? '';
      if (req.json) {
        try {
          return { text, calls: [], json: JSON.parse(text), tokens };
        } catch {
          throw new AiError('bad-output', 'The AI did not answer in the shape asked for.');
        }
      }
      const calls = (msg.tool_calls ?? []).map((c) => {
        let args: unknown = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
        return { id: c.id, name: c.function.name, args };
      });
      return { text, calls, tokens };
    },
  };
}

/** The adapter for a provider and key. `fetch` is the platform's, so this works on Workers. */
export function makeAdapter(provider: Provider, key: string, model: string): AiAdapter {
  if (provider === 'anthropic') return anthropic(key, model);
  return chatCompletions(provider, key, model);
}
