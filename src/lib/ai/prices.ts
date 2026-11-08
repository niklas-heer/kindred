// What a model costs, in US dollars, and what a budget reservation is worth in micro-dollars (1 USD = 1,000,000).
// Pure: the browser shows these prices too, and the server books spend with them. No provider is called here.
//
// Sources, checked 2026-11-08:
//  - Anthropic model prices: https://platform.claude.com/docs/en/about-claude/pricing (Model pricing table, base input
//    and output; the Haiku 5.5 price is for prompts up to 100,000 tokens). Web search: $10 per 1,000 searches
//    (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool, "Usage and pricing").
//  - OpenAI text model prices, standard tier, short context: https://developers.openai.com/api/docs/pricing.
//    Web search tool: $10 per 1,000 calls for all models, plus the search content tokens at the model's rates
//    (same page, "Web search tool pricing").
//  - OpenRouter: no table. Its prices come from its own model list (GET https://openrouter.ai/api/v1/models, the
//    pricing object: prompt and completion are USD per token, web_search is USD per search), and a request's real
//    cost comes back in usage.cost (https://openrouter.ai/docs/use-cases/usage-accounting).
//
// Prices here go stale. Re-check the pages above when a model is added, and say so in the commit.
import type { Provider } from './types';

export const PRICES_CHECKED = '2026-11-08';
export const PRICES_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  openrouter: 'https://openrouter.ai/api/v1/models',
} as const;

export const MICROS_PER_USD = 1_000_000;

export interface Price {
  /** USD per 1M input tokens. */
  inPerM: number;
  /** USD per 1M output tokens. */
  outPerM: number;
  /** USD per web search. */
  searchEach: number;
}

/** Where a price came from, so the page can say how sure the budget is. */
export type PriceSource = 'custom' | 'table' | 'openrouter' | 'default';

/** Anthropic and OpenAI: USD per 1M tokens, keyed by model id as the API names it. */
const SEARCH_EACH = 0.01;
const priced = (inPerM: number, outPerM: number): Price => ({ inPerM, outPerM, searchEach: SEARCH_EACH });

export const PRICE_TABLE: Record<'anthropic' | 'openai', Record<string, Price>> = {
  anthropic: {
    'claude-fable-5-1': priced(10, 50),
    'claude-fable-5': priced(10, 50),
    'claude-mythos-5-1': priced(10, 50),
    'claude-mythos-5': priced(10, 50),
    'claude-opus-5-5': priced(4, 20),
    'claude-opus-5': priced(5, 25),
    'claude-opus-4-8': priced(5, 25),
    'claude-opus-4-7': priced(5, 25),
    'claude-opus-4-6': priced(5, 25),
    'claude-opus-4-5-20251101': priced(5, 25),
    'claude-sonnet-5-5': priced(2, 10),
    'claude-sonnet-5': priced(2, 10),
    'claude-sonnet-4-6': priced(3, 15),
    'claude-sonnet-4-5-20250929': priced(3, 15),
    'claude-haiku-5-5': priced(0.1, 0.5),
    'claude-haiku-4-5-20251001': priced(1, 5),
  },
  openai: {
    'gpt-6-astra': priced(10, 50),
    'gpt-6.1-sol': priced(2, 10),
    'gpt-6.1-terra': priced(1, 5),
    'gpt-6-luna': priced(0.1, 0.5),
    'gpt-6-sol': priced(2, 10),
    'gpt-5.6-sol': priced(4, 20),
    'gpt-5.6-terra': priced(2, 12),
    'gpt-5.6-luna': priced(0.2, 1.2),
    'gpt-5.5': priced(5, 30),
    'gpt-5.5-pro': priced(30, 180),
    'gpt-5.4': priced(2.5, 15),
    'gpt-5.4-pro': priced(30, 180),
    'gpt-5.4-mini': priced(0.75, 4.5),
    'gpt-5.4-nano': priced(0.2, 1.25),
    'gpt-5.2': priced(1.75, 14),
    'gpt-5.2-pro': priced(21, 168),
    'gpt-5.1': priced(1.25, 10),
    'gpt-5': priced(1.25, 10),
    'gpt-5-mini': priced(0.25, 2),
    'gpt-5-nano': priced(0.05, 0.4),
    'gpt-5-pro': priced(15, 120),
    'gpt-4.1': priced(2, 8),
    'gpt-4.1-mini': priced(0.4, 1.6),
    'gpt-4o': priced(2.5, 10),
    'gpt-4o-mini': priced(0.15, 0.6),
    o3: priced(2, 8),
    'o3-pro': priced(20, 80),
    'gpt-5.3-codex': priced(1.75, 14),
  },
};

/**
 * What a model is assumed to cost when nothing is known about it: the dearest price in the table (gpt-5.5-pro), so
 * a model Kindred does not know is never booked cheaper than one it does. The page says so until the steward enters
 * the model's real prices.
 */
export const CONSERVATIVE: Price = { inPerM: 30, outPerM: 180, searchEach: 0.02 };

/** The table's price for a provider's model, if Kindred has one. OpenRouter has no table: its list is the source. */
export function tablePrice(provider: Provider | 'fake', model: string): Price | undefined {
  if (provider === 'anthropic' || provider === 'openai') return PRICE_TABLE[provider][model];
  return undefined;
}

/**
 * The price a model's calls are booked at, and where it came from. Order: the family's own price for the model; then
 * the table; then OpenRouter's list (`listed`, passed in by the caller); then the conservative default.
 */
export function resolvePrice(provider: Provider | 'fake', model: string, custom: Record<string, { inPerM: number; outPerM: number }>, listed?: Price): { price: Price; source: PriceSource } {
  const mine = custom[model];
  const table = tablePrice(provider, model);
  if (mine) return { price: { inPerM: mine.inPerM, outPerM: mine.outPerM, searchEach: table?.searchEach ?? listed?.searchEach ?? SEARCH_EACH }, source: 'custom' };
  if (table) return { price: table, source: 'table' };
  if (listed) return { price: listed, source: 'openrouter' };
  return { price: CONSERVATIVE, source: 'default' };
}

/** Micro-dollars for a call: tokens at the per-1M prices (USD per 1M tokens is micro-dollars per token) and searches at the per-search price. Rounded up, so a booking never undercounts. */
export function costMicros(u: { inputTokens: number; outputTokens: number; searches: number }, p: Price): number {
  return Math.ceil(u.inputTokens * p.inPerM + u.outputTokens * p.outPerM + u.searches * p.searchEach * MICROS_PER_USD);
}

/** The cheapest a search is reserved at: a listed price of "0", or none, still reserves this much per search. */
export const SEARCH_RESERVE_FLOOR_USD = 0.01;
/** The margin a search's reservation carries over its listed price, so a price that moves a little still fits. */
export const SEARCH_RESERVE_MARGIN = 1.5;

/** Micro-dollars reserved for `searches` searches at a model's price: the price (floored, with a margin) per search. */
export function searchReserveMicros(searches: number, p: Pick<Price, 'searchEach'>): number {
  return Math.ceil(Math.max(0, searches) * Math.max(p.searchEach, SEARCH_RESERVE_FLOOR_USD) * SEARCH_RESERVE_MARGIN * MICROS_PER_USD);
}

/** The cost a provider reported in USD, as micro-dollars. */
export const reportedMicros = (usd: number): number => Math.ceil(Math.max(0, usd) * MICROS_PER_USD);

export const usd = (micros: number): number => micros / MICROS_PER_USD;

/**
 * "About N conversations for $1". A conversation is ESTIMATE_CONVERSATION questions, each with ESTIMATE_QUESTION input
 * and output tokens. These are estimates for the page, not a bill.
 */
export const ESTIMATE_CONVERSATION = { questions: 4, inputTokens: 2000, outputTokens: 500 } as const;

/** How many typical conversations a dollar buys at a model's prices. */
export function conversationsForDollar(p: Pick<Price, 'inPerM' | 'outPerM'>): number {
  const perConversation = ESTIMATE_CONVERSATION.questions * (ESTIMATE_CONVERSATION.inputTokens * p.inPerM + ESTIMATE_CONVERSATION.outputTokens * p.outPerM) / 1_000_000;
  return perConversation > 0 ? Math.floor(1 / perConversation) : 0;
}
