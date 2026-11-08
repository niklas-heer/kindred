// A family's AI settings, the monthly budget in money, and turning a settings row into a ready adapter. Settings
// live in the accounts database (migrations/accounts/0003_ai_settings.sql and 0007_ai_money.sql), one row per family.
import { accounts } from '../auth/store.server';
import { AiError, DEFAULT_SEARCH_USES, makeAdapter, type AiAdapter, type AiReply, type AiRequest } from './adapters';
import { fakeAdapter } from './fake';
import { openRouterListedPrice } from './models.server';
import { costMicros, reportedMicros, resolvePrice, type Price } from './prices';
import { keyTail, openKey, sealKey } from './secret.server';
import { tr, type Tr } from './labels';
import { translate } from '../i18n/dictionary';
import { DEFAULT_MODEL, FEATURES, PROVIDERS, type AiFeatures, type AiStatus, type CustomPrice, type Feature, type Provider } from './types';
import type { AiLocale } from './types';

export const OFF: AiFeatures = { assistant: false, faces: false, avatar: false, arms: false };
/** $5 a month, until a steward chooses otherwise. */
export const DEFAULT_MONTHLY_MICROS = 5_000_000;
const MODEL = /^[A-Za-z0-9._:/-]{1,120}$/;

/** The fake provider is on when KINDRED_AI_FAKE=1: every feature uses scripted answers (tests). */
export const fakeOn = () => process.env.KINDRED_AI_FAKE === '1';

interface Row {
  tree: string;
  provider: Provider;
  model: string;
  key_sealed: string | null;
  key_tail: string | null;
  features: string;
  web_search: number;
  monthly_micros: number;
  custom_prices: string;
  updated: number;
}

export interface Settings {
  provider: Provider;
  model: string;
  /** Empty means the provider's default. */
  effectiveModel: string;
  keyTail: string | null;
  sealed: string | null;
  features: AiFeatures;
  webSearch: boolean;
  /** The monthly budget in micro-dollars. 0 turns AI off. */
  monthlyMicros: number;
  customPrices: Record<string, CustomPrice>;
  updated: number;
}

const parseFeatures = (s: string): AiFeatures => {
  try {
    const j = JSON.parse(s) as Partial<AiFeatures>;
    return Object.fromEntries(FEATURES.map((f) => [f, j[f] === true])) as AiFeatures;
  } catch {
    return { ...OFF };
  }
};

/** Only finite, non-negative prices survive; anything else is dropped rather than booked. */
export function parseCustomPrices(s: string): Record<string, CustomPrice> {
  try {
    const j = JSON.parse(s) as Record<string, Partial<CustomPrice>>;
    const out: Record<string, CustomPrice> = {};
    for (const [model, p] of Object.entries(j ?? {})) {
      if (MODEL.test(model) && Number.isFinite(p?.inPerM) && Number.isFinite(p?.outPerM) && p!.inPerM! >= 0 && p!.outPerM! >= 0) {
        out[model] = { inPerM: p!.inPerM!, outPerM: p!.outPerM! };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function readSettings(tree: string): Promise<Settings> {
  const r = await accounts().get<Row>('SELECT * FROM ai_settings WHERE tree = ?', tree);
  if (!r) {
    return {
      provider: 'anthropic', model: '', effectiveModel: DEFAULT_MODEL.anthropic, keyTail: null, sealed: null,
      features: { ...OFF }, webSearch: false, monthlyMicros: DEFAULT_MONTHLY_MICROS, customPrices: {}, updated: 0,
    };
  }
  return {
    provider: r.provider,
    model: r.model,
    effectiveModel: r.model || DEFAULT_MODEL[r.provider],
    keyTail: r.key_tail,
    sealed: r.key_sealed,
    features: parseFeatures(r.features),
    webSearch: r.web_search === 1,
    monthlyMicros: r.monthly_micros,
    customPrices: parseCustomPrices(r.custom_prices),
    updated: r.updated,
  };
}

export interface SaveInput {
  provider: Provider;
  model: string;
  features: AiFeatures;
  webSearch: boolean;
  monthlyMicros: number;
  customPrices: Record<string, CustomPrice>;
  apiKey?: string;
  clearKey?: boolean;
}

/** Saves the settings. A key is sealed when given; without one, the saved key stays. `clearKey` removes it. */
export async function saveSettings(tree: string, by: string, input: SaveInput): Promise<void> {
  const cur = await readSettings(tree);
  let sealed = cur.sealed;
  let tail = cur.keyTail;
  if (input.clearKey) {
    sealed = null;
    tail = null;
  } else if (input.apiKey) {
    sealed = await sealKey(tree, input.apiKey);
    tail = keyTail(input.apiKey);
  }
  await accounts().run(
    `INSERT INTO ai_settings (tree, provider, model, key_sealed, key_tail, features, web_search, monthly_micros, custom_prices, updated, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tree) DO UPDATE SET provider = excluded.provider, model = excluded.model, key_sealed = excluded.key_sealed,
       key_tail = excluded.key_tail, features = excluded.features, web_search = excluded.web_search,
       monthly_micros = excluded.monthly_micros, custom_prices = excluded.custom_prices,
       updated = excluded.updated, updated_by = excluded.updated_by`,
    tree, input.provider, input.model.trim(), sealed, tail, JSON.stringify(input.features), input.webSearch ? 1 : 0,
    Math.max(0, Math.round(input.monthlyMicros)), JSON.stringify(input.customPrices), Date.now(), by,
  );
}

export const validModel = (m: string) => m === '' || MODEL.test(m);
export const providerOk = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

// ---------- the monthly budget (UTC months, in micro-dollars) ----------
//
// Every call to a provider is booked before it is sent: its estimated cost (see `estimateMicros`) is added to the
// month's spend with one conditional UPDATE that fails when it would pass the budget, so two calls racing for the
// last of it cannot both get it. After the call, the estimate is replaced by what the call really cost: the
// provider's reported USD cost when it reports one (OpenRouter), else the tokens it used and its searches, at the
// model's price. A call that fails is charged its estimate, since the provider may have billed it.

/** The UTC month, YYYY-MM. */
export const monthNow = (now = new Date()) => now.toISOString().slice(0, 7);

/** The day the budget starts again: the first of next month, UTC, YYYY-MM-DD. */
export function resetsOn(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** Micro-dollars the family has booked this UTC month. */
export async function spentThisMonth(tree: string): Promise<number> {
  return (await accounts().get<{ micros: number }>('SELECT micros FROM ai_spend WHERE tree = ? AND month = ?', tree, monthNow()))?.micros ?? 0;
}

/** Input tokens a call may send, before it is sent: text at two characters a token (generous), images at a fixed allowance, and the search results a search brings in. */
const IMAGE_TOKENS = 2000;
/** Generous allowance for the page text one web search brings into the context. */
const SEARCH_TOKENS = 4000;
export function estimateInputTokens(req: AiRequest): number {
  const images = req.messages.reduce((n, m) => n + (m.role === 'user' ? (m.images?.length ?? 0) : 0), 0);
  const messages = req.messages.map((m) => (m.role === 'user' ? { role: m.role, text: m.text } : m));
  const text = JSON.stringify({ system: req.system, messages, tools: req.tools, json: req.json });
  const searches = req.webSearch && !req.json ? (req.webSearch.maxUses ?? DEFAULT_SEARCH_USES) : 0;
  return Math.ceil(text.length / 2) + images * IMAGE_TOKENS + searches * SEARCH_TOKENS;
}

/** Micro-dollars a call may cost, before it is sent: its estimated input, its reply's cap, and the searches it may run. */
export function estimateMicros(req: AiRequest, price: Price): number {
  const searches = req.webSearch && !req.json ? (req.webSearch.maxUses ?? DEFAULT_SEARCH_USES) : 0;
  return costMicros({ inputTokens: estimateInputTokens(req), outputTokens: req.maxTokens ?? 1024, searches }, price);
}

/** What a finished call cost, in micro-dollars: the provider's own figure when it has one, else its usage at the model's price. */
export function replyMicros(reply: Pick<AiReply, 'reportedCostUsd' | 'inputTokens' | 'outputTokens' | 'searches'>, price: Price): number {
  if (typeof reply.reportedCostUsd === 'number') return reportedMicros(reply.reportedCostUsd);
  return costMicros({ inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, searches: reply.searches }, price);
}

/** Books `amount` micro-dollars of the month's budget, or throws `budget` when they would take it past `limit`. One statement decides, so it is atomic. */
async function reserve(tree: string, limit: number, amount: number, c: Tr): Promise<{ month: string; amount: number }> {
  const month = monthNow();
  await accounts().run('INSERT INTO ai_spend (tree, month, micros) VALUES (?, ?, 0) ON CONFLICT (tree, month) DO NOTHING', tree, month);
  const r = await accounts().run('UPDATE ai_spend SET micros = micros + ? WHERE tree = ? AND month = ? AND micros + ? <= ?', amount, tree, month, amount, limit);
  if (r.changes !== 1) throw new AiError('budget', c('ai.errBudget'));
  return { month, amount };
}

/** Replaces a booking with what the call really cost. */
async function settle(tree: string, booked: { month: string; amount: number }, actual: number): Promise<void> {
  await accounts().run('UPDATE ai_spend SET micros = MAX(0, micros - ? + ?) WHERE tree = ? AND month = ?', booked.amount, Math.max(0, Math.round(actual)), tree, booked.month);
}

/**
 * The adapter with every call booked against the family's monthly budget first, and settled after. `price` is the
 * model's price, which the booking uses until the provider's answer says what the call cost.
 */
export function budgeted(tree: string, limitMicros: number, adapter: AiAdapter, price: Price, c: Tr): AiAdapter {
  return {
    provider: adapter.provider,
    model: adapter.model,
    async complete(req) {
      const booked = await reserve(tree, limitMicros, estimateMicros(req, price), c);
      let actual = booked.amount;
      try {
        const reply = await adapter.complete(req);
        actual = replyMicros(reply, price);
        return reply;
      } finally {
        await settle(tree, booked, actual);
      }
    },
  };
}

// ---------- adapters ----------

/**
 * The adapter for a family, or the reason there is none. Throws `not-configured` when no key is saved
 * (or the key can't be opened), and `key-unreadable` for a key sealed under another secret.
 */
export async function adapterFor(tree: string, s?: Settings): Promise<AiAdapter> {
  const cur = s ?? (await readSettings(tree));
  if (!cur.sealed) throw new AiError('not-configured', translate('en', 'ai.errNotConfigured'));
  const key = await openKey(tree, cur.sealed);
  if (fakeOn()) return fakeAdapter(cur.effectiveModel);
  return makeAdapter(cur.provider, key, cur.effectiveModel);
}

/**
 * The adapter for one feature, after the switch is checked, and whether this family allows web search. Every call
 * the adapter makes is booked against the family's monthly budget before it is sent (see `budgeted`). Throws AiError
 * with a message in the reader's language when it can't run. `webSearch` is for the caller to pass on: only the
 * assistant does, and only when the reply can say what it searched.
 */
export async function adapterForFeature(tree: string, feature: Feature, locale: AiLocale): Promise<{ adapter: AiAdapter; webSearch: boolean; settings: Settings }> {
  const c = tr(locale);
  const settings = await readSettings(tree);
  if (!settings.features[feature]) throw new AiError('not-configured', c('ai.errOff'));
  if (!settings.sealed) throw new AiError('not-configured', c('ai.errNotConfigured'));
  if (settings.monthlyMicros <= 0) throw new AiError('budget', c('ai.errBudget'));
  const inner = await adapterFor(tree, settings);
  // OpenRouter's own list prices its models; the table prices the other two. Read once per adapter, never per call.
  const listed = settings.provider === 'openrouter' && !fakeOn() ? await openRouterListedPrice(settings.effectiveModel) : undefined;
  const { price } = resolvePrice(settings.provider, settings.effectiveModel, settings.customPrices, listed);
  return { adapter: budgeted(tree, settings.monthlyMicros, inner, price, c), webSearch: settings.webSearch, settings };
}

/** What the browser shows: a feature is on only when it is switched on, a readable key is saved, and the budget is above 0. */
export async function statusFor(tree: string): Promise<AiStatus> {
  const s = await readSettings(tree);
  let configured = false;
  if (s.sealed) {
    try {
      await openKey(tree, s.sealed);
      configured = true;
    } catch {
      configured = false;
    }
  }
  const on = configured && s.monthlyMicros > 0;
  return {
    configured,
    provider: fakeOn() && configured ? 'fake' : configured ? s.provider : null,
    features: Object.fromEntries(FEATURES.map((f) => [f, on && s.features[f]])) as AiFeatures,
  };
}

/** A live call to the provider with the given key, for "Test connection". Never stores anything. */
export async function testConnection(tree: string, input: { provider: Provider; model: string; apiKey?: string }, locale: AiLocale) {
  const c = tr(locale);
  const model = input.model.trim() || DEFAULT_MODEL[input.provider];
  const started = Date.now();
  try {
    let adapter: AiAdapter;
    if (fakeOn()) adapter = fakeAdapter(model);
    else {
      let key = input.apiKey?.trim() ?? '';
      if (!key) {
        const s = await readSettings(tree);
        if (!s.sealed) throw new AiError('not-configured', c('ai.errNotConfigured'));
        key = await openKey(tree, s.sealed);
      }
      adapter = makeAdapter(input.provider, key, model);
    }
    await adapter.complete({ system: 'You check a connection. Reply with the single word OK.', messages: [{ role: 'user', text: 'Ping' }], maxTokens: 16, timeoutMs: 15_000 });
    return { ok: true as const, provider: adapter.provider, model, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof AiError) return { ok: false as const, message: e.message, model, code: e.code };
    throw e;
  }
}
