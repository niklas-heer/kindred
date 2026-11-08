// One interface over the three providers, built on plain fetch so it runs on Workers as well as Node:
// chat with tools, image input, JSON-structured output and web search. Anthropic's Messages API (web search as its
// server tool, web_search_20250305); OpenAI's Chat Completions API, and for a call with web search its Responses API
// (the hosted web_search tool); OpenRouter, which speaks the Chat Completions shape and searches through its web
// plugin. Never logs the key, and never puts it in an error message.
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

/** The most searches one call may run when the request does not say. The budget reserves for this many. */
export const DEFAULT_SEARCH_USES = 3;

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  tools?: ToolSpec[];
  /** Ask for an answer in this JSON shape; the reply's `json` holds it, already parsed. */
  json?: { name: string; schema: JsonSchema };
  maxTokens?: number;
  timeoutMs?: number;
  /** Let the model search the web, when the provider can and the family has allowed it. Costs extra per search. Not used with `json`. */
  webSearch?: { maxUses?: number };
}

export interface AiReply {
  text: string;
  calls: ToolCall[];
  json?: unknown;
  /** Tokens the call used (input and output together). Kept for callers that only count tokens. */
  tokens: number;
  /** Tokens the call sent. */
  inputTokens: number;
  /** Tokens the call generated. */
  outputTokens: number;
  /** Web searches the provider ran for this call. */
  searches: number;
  /** The cost the provider reported in USD, when it does (OpenRouter). Otherwise the budget prices the usage itself. */
  reportedCostUsd?: number;
  /** The pages a web search drew on, when the provider reports them. */
  sources?: { url: string; title?: string }[];
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
      throw new AiError('unreachable', 'ai.err_unreachable');
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

/** A URL citation or search result, de-duplicated by URL, in the order the provider gave them. */
function addSource(list: { url: string; title?: string }[], url: unknown, title?: unknown): void {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || list.some((s) => s.url === url)) return;
  list.push(typeof title === 'string' && title ? { url, title } : { url });
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
      } else {
        const tools: unknown[] = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
        // The server tool: Anthropic runs the searches itself and cites them. Basic version, which every current model accepts.
        if (req.webSearch) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: req.webSearch.maxUses ?? DEFAULT_SEARCH_USES });
        if (tools.length) body.tools = tools;
      }
      const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      const timeoutMs = req.timeoutMs ?? 45_000;
      let text = '';
      const calls: ToolCall[] = [];
      const sources: { url: string; title?: string }[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let searches = 0;
      let data: any;
      // A long search turn can pause (stop_reason pause_turn): send the paused message back unchanged to continue it.
      for (let round = 0; ; round++) {
        data = await post('anthropic', 'https://api.anthropic.com/v1/messages', headers, body, key, timeoutMs);
        const blocks = (data.content ?? []) as { type: string; text?: string; id?: string; name?: string; input?: unknown; content?: unknown }[];
        text += blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
        for (const b of blocks.filter((x) => x.type === 'tool_use')) calls.push({ id: b.id!, name: b.name!, args: b.input });
        for (const b of blocks) {
          if (b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
          for (const r of b.content as { url?: unknown; title?: unknown }[]) addSource(sources, r.url, r.title);
        }
        inputTokens += data.usage?.input_tokens ?? 0;
        outputTokens += data.usage?.output_tokens ?? 0;
        searches += data.usage?.server_tool_use?.web_search_requests ?? blocks.filter((b) => b.type === 'server_tool_use' && b.name === 'web_search').length;
        if (data.stop_reason !== 'pause_turn' || round >= 3) break;
        body.messages = [...(body.messages as unknown[]), { role: 'assistant', content: data.content }];
      }
      if (req.json) {
        const answer = calls.find((c) => c.name === req.json!.name);
        if (!answer) throw new AiError('bad-output', 'ai.err_shape');
        return { text, calls: [], json: answer.args, tokens: inputTokens + outputTokens, inputTokens, outputTokens, searches: 0 };
      }
      return {
        text,
        calls,
        tokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        searches,
        ...(sources.length ? { sources } : {}),
      };
    },
  };
}

// ---------- OpenAI: Chat Completions, and the Responses API for web search ----------

/** Responses API: the hosted web_search tool. Used for a call that asks for web search (OpenAI only). */
async function openaiResponses(key: string, model: string, req: AiRequest): Promise<AiReply> {
  const input: unknown[] = [];
  for (const m of req.messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        input.push({ role: 'user', content: [...m.images.map((img) => ({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })), { type: 'input_text', text: m.text || ' ' }] });
      } else input.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      if (m.text) input.push({ role: 'assistant', content: m.text });
      for (const c of m.calls ?? []) input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.args ?? {}) });
    } else {
      input.push({ type: 'function_call_output', call_id: m.callId, output: m.content });
    }
  }
  const tools: unknown[] = [{ type: 'web_search' }];
  for (const t of req.tools ?? []) tools.push({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false });
  const data = await post('openai', 'https://api.openai.com/v1/responses', { 'content-type': 'application/json', authorization: `Bearer ${key}` }, {
    model, instructions: req.system, input, tools, max_output_tokens: req.maxTokens ?? 1024,
  }, key, req.timeoutMs ?? 60_000);
  let text = '';
  const calls: ToolCall[] = [];
  const sources: { url: string; title?: string }[] = [];
  let searches = 0;
  for (const item of (data.output ?? []) as { type: string; status?: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[]) {
    if (item.type === 'web_search_call') {
      if (item.status !== 'failed') searches++;
    } else if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type !== 'output_text') continue;
        text += part.text ?? '';
        for (const a of part.annotations ?? []) if (a.type === 'url_citation') addSource(sources, a.url, a.title);
      }
    } else if (item.type === 'function_call') {
      let args: unknown = {};
      try { args = JSON.parse(item.arguments || '{}'); } catch {}
      calls.push({ id: item.call_id!, name: item.name!, args });
    }
  }
  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  return { text, calls, tokens: inputTokens + outputTokens, inputTokens, outputTokens, searches, ...(sources.length ? { sources } : {}) };
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
      // OpenAI's web search is the Responses API's hosted tool. Structured output keeps the Chat Completions path.
      if (provider === 'openai' && req.webSearch && !req.json) return openaiResponses(key, model, req);
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
      // OpenRouter's web plugin searches for any model it lists. Its cost comes back in usage.cost.
      if (provider === 'openrouter' && req.webSearch && !req.json) body.plugins = [{ id: 'web', max_results: 5 }];
      const data = await post(provider, url, headers, body, key, req.timeoutMs ?? 45_000);
      const msg = data.choices?.[0]?.message as {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        annotations?: { type: string; url_citation?: { url?: string; title?: string } }[];
      } | undefined;
      if (!msg) throw new AiError('bad-output', `${PROVIDER_LABEL[provider]} sent back no answer.`);
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      const text = msg.content ?? '';
      const sources: { url: string; title?: string }[] = [];
      for (const a of msg.annotations ?? []) if (a.type === 'url_citation') addSource(sources, a.url_citation?.url, a.url_citation?.title);
      const reported = typeof data.usage?.cost === 'number' ? { reportedCostUsd: data.usage.cost as number } : {};
      const searched = provider === 'openrouter' && !!req.webSearch && !req.json ? 1 : 0;
      if (req.json) {
        try {
          return { text, calls: [], json: JSON.parse(text), tokens: inputTokens + outputTokens, inputTokens, outputTokens, searches: 0, ...reported };
        } catch {
          throw new AiError('bad-output', 'ai.err_shape');
        }
      }
      const calls = (msg.tool_calls ?? []).map((c) => {
        let args: unknown = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
        return { id: c.id, name: c.function.name, args };
      });
      return {
        text,
        calls,
        tokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        searches: searched,
        ...reported,
        ...(sources.length ? { sources } : {}),
      };
    },
  };
}

/** The adapter for a provider and key. `fetch` is the platform's, so this works on Workers. */
export function makeAdapter(provider: Provider, key: string, model: string): AiAdapter {
  if (provider === 'anthropic') return anthropic(key, model);
  return chatCompletions(provider, key, model);
}
