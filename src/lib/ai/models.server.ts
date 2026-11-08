// Which models a provider offers, with what Kindred knows about each: the context size, the capabilities, and the
// price (from the price table, or from OpenRouter's own list). The provider is called with the key that is passed in,
// which may be one typed but not yet saved. The key is never stored, never logged, and never put in an error message.
// Lists are cached in memory for a few minutes, keyed by a SHA-256 of the key, so the key itself is not kept.
import { AiError } from './adapters';
import { tablePrice, type Price } from './prices';
import { PROVIDER_LABEL, type ModelInfo, type Provider } from './types';

/** The same switch settings.server.ts reads (KINDRED_AI_FAKE=1): tests and the browser harness, no provider calls. */
const fakeOn = () => process.env.KINDRED_AI_FAKE === '1';

const LIST_TTL = 5 * 60_000;
const CATALOG_TTL = 60 * 60_000;
const listCache = new Map<string, { at: number; models: ModelInfo[] }>();
let catalogCache: { at: number; models: ModelInfo[] } | undefined;

const sha256 = async (s: string): Promise<string> => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** A GET with a timeout. Errors are typed; the key is never in a message. */
async function getJson(provider: Provider, url: string, headers: Record<string, string>): Promise<any> {
  const name = PROVIDER_LABEL[provider];
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('timeout', `${name} did not answer in time. Try again.`);
    throw new AiError('unreachable', 'ai.err_unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new AiError('auth', `${name} did not accept the key. Check it in the AI settings.`);
  if (res.status === 429) throw new AiError('rate-limited', `${name} is rate-limiting this key. Try again in a minute.`);
  if (!res.ok) throw new AiError('provider', `${name} answered ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new AiError('bad-output', `${name} sent back something unreadable.`);
  }
}

const usdPerM = (perToken: unknown): number | null => {
  const n = Number(perToken);
  return typeof perToken === 'string' || typeof perToken === 'number' ? (Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null) : null;
};

// ---------- Anthropic: GET /v1/models, paged, with capabilities ----------

interface AnthropicModel {
  id: string;
  display_name?: string;
  lifecycle?: string;
  max_input_tokens?: number | null;
  capabilities?: { image_input?: { supported?: boolean }; server_tools?: { web_search?: { supported?: boolean } } } | null;
}

async function anthropicModels(key: string): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  let after: string | undefined;
  // The Models API documents this version for its capabilities object.
  const headers = { 'x-api-key': key, 'anthropic-version': '2026-10-21' };
  for (let page = 0; page < 5; page++) {
    const q = `?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
    const j = await getJson('anthropic', `https://api.anthropic.com/v1/models${q}`, headers);
    for (const m of (j.data ?? []) as AnthropicModel[]) {
      if (!m.id || m.lifecycle === 'retired') continue;
      const p = tablePrice('anthropic', m.id);
      out.push({
        id: m.id,
        name: m.display_name || m.id,
        contextTokens: typeof m.max_input_tokens === 'number' ? m.max_input_tokens : null,
        inPerM: p?.inPerM ?? null,
        outPerM: p?.outPerM ?? null,
        searchEach: p?.searchEach ?? null,
        vision: m.capabilities?.image_input?.supported ?? null,
        tools: true,
        webSearch: m.capabilities?.server_tools?.web_search?.supported ?? null,
      });
    }
    if (!j.has_more || !j.last_id) break;
    after = j.last_id as string;
  }
  return out;
}

// ---------- OpenAI: GET /v1/models, filtered to the models Chat Completions and Responses take ----------

/** Model ids that are chat or reasoning models. Everything else (embeddings, speech, images, moderation, codex) is left out. */
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NOT_CHAT = /(realtime|audio|tts|transcribe|image|embedding|moderation|whisper|dall-e|davinci|babbage|instruct|search|codex|sora)/;

async function openaiModels(key: string): Promise<ModelInfo[]> {
  const j = await getJson('openai', 'https://api.openai.com/v1/models', { authorization: `Bearer ${key}` });
  const out: ModelInfo[] = [];
  for (const m of (j.data ?? []) as { id?: string }[]) {
    const id = m.id;
    if (!id || !OPENAI_CHAT.test(id) || OPENAI_NOT_CHAT.test(id)) continue;
    const p = tablePrice('openai', id);
    out.push({
      id,
      name: id,
      // The models list gives neither a context size nor capabilities. The web search tool is listed for every model on the pricing page.
      contextTokens: null,
      inPerM: p?.inPerM ?? null,
      outPerM: p?.outPerM ?? null,
      searchEach: p?.searchEach ?? null,
      vision: null,
      tools: true,
      webSearch: true,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- OpenRouter: GET /api/v1/models, which lists prices and capabilities ----------

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: unknown; completion?: unknown; web_search?: unknown };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
}

async function openrouterCatalogue(key: string): Promise<ModelInfo[]> {
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  const j = await getJson('openrouter', 'https://openrouter.ai/api/v1/models', headers);
  const out: ModelInfo[] = [];
  for (const m of (j.data ?? []) as OpenRouterModel[]) {
    if (!m.id) continue;
    if (m.architecture?.output_modalities && !m.architecture.output_modalities.includes('text')) continue;
    const inPerM = usdPerM(m.pricing?.prompt);
    const outPerM = usdPerM(m.pricing?.completion);
    const webSearchUsd = Number(m.pricing?.web_search);
    out.push({
      id: m.id,
      name: m.name || m.id,
      contextTokens: typeof m.context_length === 'number' ? m.context_length : null,
      inPerM,
      outPerM,
      searchEach: Number.isFinite(webSearchUsd) && webSearchUsd >= 0 ? webSearchUsd : null,
      vision: m.architecture?.input_modalities ? m.architecture.input_modalities.includes('image') : null,
      tools: m.supported_parameters ? m.supported_parameters.includes('tools') : null,
      // OpenRouter's web plugin works with every model it lists.
      webSearch: true,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** OpenRouter's list, cached for an hour. Its prices are what a call's budget is booked at until the call reports its cost. */
async function catalogue(): Promise<ModelInfo[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.models;
  const models = await openrouterCatalogue('');
  catalogCache = { at: Date.now(), models };
  return models;
}

/** The price OpenRouter lists for a model, for booking a call. Undefined when the list cannot be read or has no such model. */
export async function openRouterListedPrice(model: string): Promise<Price | undefined> {
  try {
    const m = (await catalogue()).find((x) => x.id === model);
    if (!m || m.inPerM == null || m.outPerM == null) return undefined;
    return { inPerM: m.inPerM, outPerM: m.outPerM, searchEach: m.searchEach ?? 0.01 };
  } catch {
    return undefined;
  }
}

// ---------- the list a provider's key gives ----------

const FAKE_MODELS: ModelInfo[] = [
  { id: 'fake-model', name: 'Fake model (tests)', contextTokens: 200_000, inPerM: 1, outPerM: 1, searchEach: 0.01, vision: true, tools: true, webSearch: true },
  { id: 'fake-model-unpriced', name: 'Fake model without a price', contextTokens: null, inPerM: null, outPerM: null, searchEach: null, vision: null, tools: true, webSearch: null },
];

/**
 * The models the provider offers for this key. Cached for a few minutes per provider and key. Throws AiError.
 * With KINDRED_AI_FAKE=1 it returns two fixed models and calls nothing.
 */
export async function listModels(provider: Provider, key: string): Promise<{ models: ModelInfo[]; cached: boolean }> {
  if (fakeOn()) return { models: FAKE_MODELS, cached: false };
  if (!key) throw new AiError('not-configured', 'ai.err_no_key');
  const id = `${provider}:${await sha256(key)}`;
  const hit = listCache.get(id);
  if (hit && Date.now() - hit.at < LIST_TTL) return { models: hit.models, cached: true };
  const models = provider === 'anthropic' ? await anthropicModels(key) : provider === 'openai' ? await openaiModels(key) : await openrouterCatalogue(key);
  // Keep the cache small: drop what has expired before adding.
  for (const [k, v] of listCache) if (Date.now() - v.at >= LIST_TTL) listCache.delete(k);
  listCache.set(id, { at: Date.now(), models });
  return { models, cached: false };
}

/** Test seam: forget every cached list. */
export function clearModelCache(): void {
  listCache.clear();
  catalogCache = undefined;
}
