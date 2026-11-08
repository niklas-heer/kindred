// A family's AI settings, the monthly budget in money, and turning a settings row into a ready adapter. Settings
// live in the accounts database (migrations/accounts/0003_ai_settings.sql and 0007_ai_money.sql), one row per family.
import { accounts } from '../auth/store.server';
import { AiError, DEFAULT_MAX_TOKENS, DEFAULT_SEARCH_USES, callRounds, chatModelId, makeAdapter, outputCap, searchesOnItsOwn, type AiAdapter, type AiReply, type AiRequest } from './adapters';
import { fakeAdapter } from './fake';
import { openRouterListed } from './models.server';
import { costMicros, reportedMicros, resolvePrice, searchReserveMicros, type Price } from './prices';
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
  const model = chatModelId(r.provider, r.model);
  return {
    provider: r.provider,
    model,
    effectiveModel: model || DEFAULT_MODEL[r.provider],
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

/**
 * Saves the settings. A typed key is sealed and replaces the saved one; without one, the saved key stays, and `clearKey`
 * removes it. A model that searches by itself is refused, and OpenRouter's :online suffix is dropped (chatModelId).
 */
export async function saveSettings(tree: string, by: string, input: SaveInput): Promise<void> {
  const model = chatModelId(input.provider, input.model.trim());
  if (searchesOnItsOwn(input.provider, model)) throw new AiError('bad-input', 'ai.err_model_search');
  const cur = await readSettings(tree);
  let sealed = cur.sealed;
  let tail = cur.keyTail;
  if (input.apiKey) {
    sealed = await sealKey(tree, input.apiKey);
    tail = keyTail(input.apiKey);
  } else if (input.clearKey) {
    sealed = null;
    tail = null;
  } else if (cur.sealed && !savedKeyFits(cur, input.provider)) {
    // Switching provider keeps the old key only if it would be sent to the new provider: refused, and nothing is saved.
    // The message is the dictionary key: the settings page shows its translated text.
    throw new AiError('key-required', 'ai.err_key_required');
  }
  await accounts().run(
    `INSERT INTO ai_settings (tree, provider, model, key_sealed, key_tail, features, web_search, monthly_micros, custom_prices, updated, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tree) DO UPDATE SET provider = excluded.provider, model = excluded.model, key_sealed = excluded.key_sealed,
       key_tail = excluded.key_tail, features = excluded.features, web_search = excluded.web_search,
       monthly_micros = excluded.monthly_micros, custom_prices = excluded.custom_prices,
       updated = excluded.updated, updated_by = excluded.updated_by`,
    tree, input.provider, model, sealed, tail, JSON.stringify(input.features), input.webSearch ? 1 : 0,
    Math.max(0, Math.round(input.monthlyMicros)), JSON.stringify(input.customPrices), Date.now(), by,
  );
}

/**
 * A saved key may be used only with the provider it was saved for. Every path that would send it (Test connection,
 * Save, the model list, a call) asks this one rule, so a key is never sent to a provider it was not saved for.
 */
export const savedKeyFits = (cur: Pick<Settings, 'sealed' | 'provider'>, provider: Provider): boolean => !!cur.sealed && cur.provider === provider;

export const validModel = (m: string) => m === '' || MODEL.test(m);
export const providerOk = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

// ---------- the monthly budget (UTC months, in micro-dollars) ----------
//
// Every call to a provider is booked before it is sent: its reservation (see `estimateMicros`) is added to the month's
// spend with one conditional UPDATE that fails when it would pass the budget, so two calls racing for the last of it
// cannot both get it. A reservation is the estimate of what the call may cost: its input (estimated from the text it sends),
// its reply's cap, its searches, and every request it may make (callRounds). It is not a hard ceiling: the input that a
// search's results add is not reserved, so a search turn can cost more than its reservation, and the budget is then settled
// to the real cost. One call may not reserve more than a fifth of the month's budget, unless the budget is
// under a dollar; a call that would is refused, not run on a guess. After the call, the reservation is replaced by what the
// call really cost: the provider's reported USD cost when it reports one (OpenRouter), else the tokens it used and its
// searches, at the model's price. A failure is charged what its completed requests billed (AiError.billed); a failure with no
// completed request costs nothing when the provider did not bill it, and its reservation when it may have.

/** One call may reserve at most this share of the month's budget... */
export const SINGLE_CALL_SHARE = 0.2;
/** ...unless the budget is below this, where a fifth of it is too little for any call. */
export const TINY_BUDGET_MICROS = 1_000_000;

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

/**
 * Micro-dollars a call may cost, before it is sent: its estimated input, its reply's cap, and the searches it may run, over
 * `rounds` requests (callRounds). A continuation re-sends the reply before it, so each round's input grows by one reply.
 * Each search is reserved at its listed price with a margin (see searchReserveMicros), so a call that runs no more
 * searches than it was allowed cannot book more than it reserved.
 */
export function estimateMicros(req: AiRequest, price: Price, outputTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS, rounds = 1): number {
  const searches = req.webSearch && !req.json ? (req.webSearch.maxUses ?? DEFAULT_SEARCH_USES) : 0;
  const inputTokens = rounds * estimateInputTokens(req) + outputTokens * ((rounds * (rounds - 1)) / 2);
  return costMicros({ inputTokens, outputTokens: rounds * outputTokens, searches: 0 }, price) + searchReserveMicros(searches, price);
}

/**
 * What a failed call costs, when no request of it completed. A refusal, a rate limit, a key the provider does not take, a
 * network error or a 5xx did not bill, so nothing is charged. A timeout, or a reply that could not be read (or was cut
 * off), may have billed, so the reservation stays. A failure that is not a typed AiError is charged its reservation, to be safe.
 */
export function failureMicros(e: unknown, reserved: number): number {
  if (e instanceof AiError && e.code !== 'timeout' && e.code !== 'bad-output') return 0;
  return reserved;
}

/** What a finished call cost, in micro-dollars: the provider's own figure when it has one, else its usage at the model's price. */
export function replyMicros(reply: Pick<AiReply, 'reportedCostUsd' | 'inputTokens' | 'outputTokens' | 'searches'>, price: Price): number {
  if (typeof reply.reportedCostUsd === 'number') return reportedMicros(reply.reportedCostUsd);
  return costMicros({ inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, searches: reply.searches }, price);
}

/** Books `amount` micro-dollars of the month's budget, or throws `budget` when they would take it past `limit`. One statement decides, so it is atomic. */
export async function reserve(tree: string, limit: number, amount: number, c: Tr): Promise<{ month: string; amount: number }> {
  const month = monthNow();
  await accounts().run('INSERT INTO ai_spend (tree, month, micros) VALUES (?, ?, 0) ON CONFLICT (tree, month) DO NOTHING', tree, month);
  const r = await accounts().run('UPDATE ai_spend SET micros = micros + ? WHERE tree = ? AND month = ? AND micros + ? <= ?', amount, tree, month, amount, limit);
  if (r.changes !== 1) throw new AiError('budget', c('ai.errBudget'));
  return { month, amount };
}

/** Replaces a booking with what the call really cost. */
export async function settle(tree: string, booked: { month: string; amount: number }, actual: number): Promise<void> {
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
    reasoning: adapter.reasoning,
    async complete(req) {
      // The reservation prices the reply cap the adapter will send (a reasoning model's is raised), so they agree.
      const cap = outputCap(adapter.provider, adapter.model, req.maxTokens, adapter.reasoning);
      const estimate = estimateMicros(req, price, cap, callRounds(adapter.provider, req));
      if (limitMicros >= TINY_BUDGET_MICROS && estimate > limitMicros * SINGLE_CALL_SHARE) throw new AiError('budget', c('ai.errBudgetShare'));
      const booked = await reserve(tree, limitMicros, estimate, c);
      let actual = booked.amount;
      try {
        const reply = await adapter.complete(req);
        actual = replyMicros(reply, price);
        return reply;
      } catch (e) {
        // A failure after completed requests keeps what they billed. The request that was in flight when it failed may have
        // billed too (it timed out, or its reply could not be read): it is charged as one more request, to be safe.
        actual = e instanceof AiError && e.billed
          ? replyMicros(e.billed, price) + (e.inFlight && (e.code === 'timeout' || e.code === 'bad-output') ? estimateMicros(req, price, cap, 1) : 0)
          : failureMicros(e, booked.amount);
        throw e;
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
  if (searchesOnItsOwn(cur.provider, cur.effectiveModel)) throw new AiError('bad-input', 'ai.err_model_search');
  const key = await openKey(tree, cur.sealed);
  if (fakeOn()) return fakeAdapter(cur.effectiveModel);
  const listed = cur.provider === 'openrouter' ? await openRouterListed(cur.effectiveModel) : undefined;
  return makeAdapter(cur.provider, key, cur.effectiveModel, { reasoning: listed?.reasoning });
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
  if (searchesOnItsOwn(settings.provider, settings.effectiveModel)) throw new AiError('bad-input', c('ai.err_model_search'));
  // OpenRouter's own list prices its models and says whether they reason; the table prices the other two. Read once per adapter, never per call.
  const listed = settings.provider === 'openrouter' && !fakeOn() ? await openRouterListed(settings.effectiveModel) : undefined;
  const { price } = resolvePrice(settings.provider, settings.effectiveModel, settings.customPrices, listed?.price);
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
  const model = chatModelId(input.provider, input.model.trim() || DEFAULT_MODEL[input.provider]);
  const started = Date.now();
  try {
    let adapter: AiAdapter;
    let key = input.apiKey?.trim() ?? '';
    if (!key) {
      const s = await readSettings(tree);
      // The saved key goes only to the provider it was saved for: another provider needs a key typed here.
      if (s.sealed && !savedKeyFits(s, input.provider)) throw new AiError('key-required', c('ai.err_key_required'));
      if (!fakeOn()) {
        if (!s.sealed) throw new AiError('not-configured', c('ai.errNotConfigured'));
        key = await openKey(tree, s.sealed);
      }
    }
    if (fakeOn()) adapter = fakeAdapter(model);
    else {
      const listed = input.provider === 'openrouter' ? await openRouterListed(model) : undefined;
      adapter = makeAdapter(input.provider, key, model, { reasoning: listed?.reasoning });
    }
    await adapter.complete({ system: 'You check a connection. Reply with the single word OK.', messages: [{ role: 'user', text: 'Ping' }], maxTokens: 16, timeoutMs: 15_000 });
    return { ok: true as const, provider: adapter.provider, model, ms: Date.now() - started };
  } catch (e) {
    // The provider answered, so the key works. A reply this check could not read (a reasoning model cut off by its 16-token
    // cap, say) is still a connection; anything else is reported.
    if (e instanceof AiError && e.code === 'bad-output') return { ok: true as const, provider: input.provider, model, ms: Date.now() - started };
    if (e instanceof AiError) return { ok: false as const, message: e.message, model, code: e.code };
    throw e;
  }
}
