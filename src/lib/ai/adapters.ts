// One interface over the three providers, built on plain fetch so it runs on Workers as well as Node:
// chat with tools, image input, JSON-structured output and web search. Anthropic's Messages API (web search as its
// server tool, web_search_20250305); OpenAI's Chat Completions API, and for a call with web search its Responses API
// (the hosted web_search tool); OpenRouter, which speaks the Chat Completions shape and searches through its server
// tool openrouter:web_search. Never logs the key, and never puts it in an error message.
import { PROVIDER_LABEL, type Provider } from './types';

export type AiErrorCode =
  | 'not-configured' | 'key-required' | 'bad-input' | 'budget' | 'auth' | 'rate-limited' | 'timeout' | 'unreachable' | 'provider' | 'bad-output' | 'key-unreadable';

/** What the provider billed for requests that completed: the usage a budget settles to when a later request fails. */
export interface Usage { inputTokens: number; outputTokens: number; searches: number }

export class AiError extends Error {
  /** The usage of the requests that completed before this error (a paused search turn's earlier rounds), when there were any. */
  billed?: Usage;
  /** Set when the request that failed was sent and may have billed (its reply never came, or could not be read). */
  inFlight?: boolean;
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
/** The reply length a call asks for when the request does not say. */
export const DEFAULT_MAX_TOKENS = 1024;
/**
 * A reasoning model's reply is never capped below this, with reasoning effort low: reasoning tokens count against the cap,
 * so a short cap would leave no room for the answer. A reply that still runs out is an error, not a partial answer.
 */
export const REASONING_MAX_TOKENS = 8_000;
/** The continuations a paused Anthropic search turn may take. The budget reserves for exactly the first request and each of these. */
export const PAUSE_CONTINUATIONS = 2;
const REASONING_MODEL: Record<'openai' | 'openrouter', RegExp> = {
  openai: /^(o\d|gpt-5|gpt-6)/,
  openrouter: /(^|\/)(o\d|gpt-5|gpt-6)/,
};

/**
 * Whether a model reasons before it answers (so it needs the larger cap, and takes a reasoning effort). OpenRouter's list
 * says so for the models it lists (the adapter's `reasoning` option); the model's name is the guess for the rest.
 */
export const isReasoningModel = (provider: Provider | 'fake', model: string, listed?: boolean): boolean =>
  listed ?? (provider === 'openai' || provider === 'openrouter' ? REASONING_MODEL[provider].test(model) : false);

/** The most tokens a reply may use: the caller's request, raised for a reasoning model. Sent to the provider and reserved by the budget alike. */
export function outputCap(provider: Provider | 'fake', model: string, requested = DEFAULT_MAX_TOKENS, listed?: boolean): number {
  return isReasoningModel(provider, model, listed) ? Math.max(requested, REASONING_MAX_TOKENS) : requested;
}

/**
 * OpenRouter's ":online" suffix turns on its web plugin for any model: the model then searches whatever the request holds,
 * with no ceiling and outside the budget. So the suffix is removed from every model id Kindred sends. A search goes only
 * through the server tool that a search request names (isolatedSearch).
 */
export const chatModelId = (provider: Provider | 'fake', model: string): string =>
  provider === 'openrouter' ? model.replace(/(:online)+$/i, '') : model;

/**
 * Model ids that search the web by themselves, whatever a request says: OpenAI's search models, and OpenRouter's Perplexity
 * models. Kindred never sends a chat, arms or other non-search request to one of these.
 */
export const searchesOnItsOwn = (provider: Provider | 'fake', model: string): boolean =>
  (provider === 'openai' && /-search/i.test(model)) || (provider === 'openrouter' && /(^|\/)perplexity\//i.test(model));

/** How many requests a call may make to the provider. A paused Anthropic search turn is continued, up to PAUSE_CONTINUATIONS times. */
export const callRounds = (provider: Provider | 'fake', req: Pick<AiRequest, 'webSearch' | 'json'>): number =>
  provider === 'anthropic' && req.webSearch && !req.json ? PAUSE_CONTINUATIONS + 1 : 1;

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  tools?: ToolSpec[];
  /** Ask for an answer in this JSON shape; the reply's `json` holds it, already parsed. */
  json?: { name: string; schema: JsonSchema };
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Let the model search the web in this request, when the provider can. Costs extra per search, and the reply says
   * how many it ran. The provider is told the most it may run, and the budget reserves for that many. Not used with `json`.
   * The chat never sets this: its web lookups run as their own requests (see isolatedSearch).
   */
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
  /** Whether the model reasons before it answers, when the provider's list says so. Undefined: the model's name decides. */
  readonly reasoning?: boolean;
  complete(req: AiRequest): Promise<AiReply>;
}

/**
 * One search, in a request of its own: the only input is a fixed system prompt and one prompt (the query). No history,
 * no tools, no family data: the caller builds `system` and `prompt` from nothing else. Booked like any call.
 */
export function isolatedSearch(adapter: AiAdapter, o: { system: string; prompt: string; maxUses?: number; maxTokens?: number; timeoutMs?: number }): Promise<AiReply> {
  return adapter.complete({
    system: o.system,
    messages: [{ role: 'user', text: o.prompt }],
    maxTokens: o.maxTokens ?? 800,
    timeoutMs: o.timeoutMs ?? 45_000,
    webSearch: { maxUses: o.maxUses ?? DEFAULT_SEARCH_USES },
  });
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
      const body: Record<string, unknown> = { model, max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS, system: req.system, messages };
      if (req.json) {
        body.tools = [{ name: req.json.name, description: 'Give the answer in this shape.', input_schema: req.json.schema }];
        body.tool_choice = { type: 'tool', name: req.json.name };
      } else {
        const tools: unknown[] = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
        // The server tool: Anthropic runs the searches itself and cites them. max_uses is the ceiling the provider enforces.
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
      // A failure must still report the usage of the rounds that completed before it: they billed. `inFlight` says whether
      // the failing request itself was sent, which only a request in flight can leave unknown.
      const billed = (e: unknown, inFlight: boolean): unknown => {
        if (e instanceof AiError) {
          if (inputTokens || outputTokens) e.billed = { inputTokens, outputTokens, searches };
          e.inFlight = inFlight;
        }
        return e;
      };
      // A long search turn can pause (stop_reason pause_turn): send the paused message back unchanged to continue it, up to
      // PAUSE_CONTINUATIONS times. The budget reserves for exactly that many requests (callRounds).
      for (let round = 0; ; round++) {
        try {
          data = await post('anthropic', 'https://api.anthropic.com/v1/messages', headers, body, key, timeoutMs);
        } catch (e) {
          throw billed(e, true);
        }
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
        if (data.stop_reason !== 'pause_turn' || round >= PAUSE_CONTINUATIONS) break;
        body.messages = [...(body.messages as unknown[]), { role: 'assistant', content: data.content }];
      }
      // A reply cut off by its cap, or a search turn still paused, is not an answer: say so instead of showing part of one.
      if (data.stop_reason === 'max_tokens' || data.stop_reason === 'pause_turn') throw billed(new AiError('bad-output', 'Anthropic stopped before it finished its answer.'), false);
      if (req.json) {
        const answer = calls.find((c) => c.name === req.json!.name);
        if (!answer) throw billed(new AiError('bad-output', 'ai.err_shape'), false);
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
  const maxUses = req.webSearch?.maxUses ?? DEFAULT_SEARCH_USES;
  const body: Record<string, unknown> = {
    model,
    instructions: req.system,
    input,
    tools,
    max_output_tokens: outputCap('openai', model, req.maxTokens),
    // The pages the model consulted, not only the ones it cited: the sources come back even when the answer is JSON text.
    include: ['web_search_call.action.sources'],
    // The most calls to the built-in search tool the reply may make. The budget reserves for this many searches.
    max_tool_calls: maxUses,
  };
  if (isReasoningModel('openai', model)) body.reasoning = { effort: 'low' };
  const data = await post('openai', 'https://api.openai.com/v1/responses', { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body, key, req.timeoutMs ?? 60_000);
  if (data.status === 'incomplete') throw new AiError('bad-output', 'OpenAI stopped before it finished its answer.');
  let text = '';
  const calls: ToolCall[] = [];
  const sources: { url: string; title?: string }[] = [];
  let searches = 0;
  for (const item of (data.output ?? []) as { type: string; status?: string; call_id?: string; name?: string; arguments?: string; action?: { sources?: { url?: string; title?: string }[] }; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[]) {
    if (item.type === 'web_search_call') {
      if (item.status !== 'failed') searches++;
      for (const s of item.action?.sources ?? []) addSource(sources, s.url, s.title);
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

function chatCompletions(provider: 'openai' | 'openrouter', key: string, model: string, listedReasoning?: boolean): AiAdapter {
  const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  // OpenRouter identifies the app, never the reader: no email, no account id.
  if (provider === 'openrouter') headers['x-title'] = 'Kindred';
  return {
    provider,
    model,
    reasoning: listedReasoning,
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
      const cap = outputCap(provider, model, req.maxTokens, listedReasoning);
      const reasoning = isReasoningModel(provider, model, listedReasoning);
      // OpenAI's reasoning models take max_completion_tokens; OpenRouter's normalised API takes max_tokens.
      if (provider === 'openai') {
        body.max_completion_tokens = cap;
        if (reasoning) body.reasoning_effort = 'low';
      } else {
        body.max_tokens = cap;
        if (reasoning) body.reasoning = { effort: 'low' };
      }
      if (req.json) body.response_format = { type: 'json_schema', json_schema: { name: req.json.name, schema: req.json.schema, strict: false } };
      const tools: unknown[] = (req.tools ?? []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      // OpenRouter's server tool: the model decides whether and what to search, and max_tool_calls is the ceiling for every server tool in the request.
      if (provider === 'openrouter' && req.webSearch && !req.json) {
        const maxUses = req.webSearch.maxUses ?? DEFAULT_SEARCH_USES;
        tools.push({ type: 'openrouter:web_search', parameters: { max_results: 5, max_uses: maxUses } });
        body.max_tool_calls = maxUses;
      }
      if (tools.length) body.tools = tools;
      const data = await post(provider, url, headers, body, key, req.timeoutMs ?? 45_000);
      const choice = data.choices?.[0] as { finish_reason?: string; message?: {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        annotations?: { type: string; url_citation?: { url?: string; title?: string } }[];
      } } | undefined;
      const msg = choice?.message;
      if (!msg) throw new AiError('bad-output', `${PROVIDER_LABEL[provider]} sent back no answer.`);
      // A reply cut off by its cap is not an answer: say so, rather than showing an empty or partial one.
      if (choice?.finish_reason === 'length') throw new AiError('bad-output', `${PROVIDER_LABEL[provider]} stopped before it finished its answer.`);
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      const text = msg.content ?? '';
      const sources: { url: string; title?: string }[] = [];
      for (const a of msg.annotations ?? []) if (a.type === 'url_citation') addSource(sources, a.url_citation?.url, a.url_citation?.title);
      const reported = typeof data.usage?.cost === 'number' ? { reportedCostUsd: data.usage.cost as number } : {};
      // A search counts only when the reply says it ran one, or cites a page: "checked on the web" is never claimed on a guess.
      const reportedSearches = data.usage?.server_tool_use_details?.web_search_requests;
      const searched = provider === 'openrouter' && !!req.webSearch && !req.json
        ? Math.max(typeof reportedSearches === 'number' ? reportedSearches : 0, sources.length ? 1 : 0)
        : 0;
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

/**
 * The adapter for a provider and key. `fetch` is the platform's, so this works on Workers. The model id is sent as
 * chatModelId gives it, and a model that searches by itself is refused (bad-input). `reasoning` is OpenRouter's list's
 * answer on whether the model reasons, when it gave one.
 */
export function makeAdapter(provider: Provider, key: string, model: string, opts: { reasoning?: boolean } = {}): AiAdapter {
  const id = chatModelId(provider, model);
  if (searchesOnItsOwn(provider, id)) throw new AiError('bad-input', 'ai.err_model_search');
  if (provider === 'anthropic') return anthropic(key, id);
  return chatCompletions(provider, key, id, opts.reasoning);
}
