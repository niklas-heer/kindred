// A family's AI settings, the daily budget, and turning a settings row into a ready adapter. Settings
// live in the accounts database (migrations/accounts/0003_ai_settings.sql), one row per family.
import { accounts } from '../auth/store.server';
import { AiError, makeAdapter, type AiAdapter } from './adapters';
import { fakeAdapter } from './fake';
import { keyTail, openKey, sealKey } from './secret.server';
import { COPY, copyFor } from './copy';
import { DEFAULT_MODEL, FEATURES, PROVIDERS, type AiFeatures, type AiStatus, type Feature, type Provider } from './types';
import type { AiLocale } from './types';

export const OFF: AiFeatures = { assistant: false, faces: false, avatar: false, arms: false };
export const DEFAULT_BUDGET = 300_000;
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
  daily_tokens: number;
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
  dailyTokens: number;
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

export async function readSettings(tree: string): Promise<Settings> {
  const r = await accounts().get<Row>('SELECT * FROM ai_settings WHERE tree = ?', tree);
  if (!r) {
    return { provider: 'anthropic', model: '', effectiveModel: DEFAULT_MODEL.anthropic, keyTail: null, sealed: null, features: { ...OFF }, dailyTokens: DEFAULT_BUDGET, updated: 0 };
  }
  return {
    provider: r.provider,
    model: r.model,
    effectiveModel: r.model || DEFAULT_MODEL[r.provider],
    keyTail: r.key_tail,
    sealed: r.key_sealed,
    features: parseFeatures(r.features),
    dailyTokens: r.daily_tokens,
    updated: r.updated,
  };
}

/** Saves the settings. A key is sealed when given; without one, the saved key stays. `clearKey` removes it. */
export async function saveSettings(
  tree: string,
  by: string,
  input: { provider: Provider; model: string; features: AiFeatures; dailyTokens: number; apiKey?: string; clearKey?: boolean },
): Promise<void> {
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
    `INSERT INTO ai_settings (tree, provider, model, key_sealed, key_tail, features, daily_tokens, updated, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tree) DO UPDATE SET provider = excluded.provider, model = excluded.model, key_sealed = excluded.key_sealed,
       key_tail = excluded.key_tail, features = excluded.features, daily_tokens = excluded.daily_tokens,
       updated = excluded.updated, updated_by = excluded.updated_by`,
    tree, input.provider, input.model.trim(), sealed, tail, JSON.stringify(input.features), input.dailyTokens, Date.now(), by,
  );
}

export const validModel = (m: string) => m === '' || MODEL.test(m);
export const providerOk = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

// ---------- the daily budget (UTC days) ----------

export const today = () => new Date().toISOString().slice(0, 10);

export async function usedToday(tree: string): Promise<number> {
  return (await accounts().get<{ tokens: number }>('SELECT tokens FROM ai_usage WHERE tree = ? AND day = ?', tree, today()))?.tokens ?? 0;
}

export async function spend(tree: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  await accounts().run(
    'INSERT INTO ai_usage (tree, day, tokens) VALUES (?, ?, ?) ON CONFLICT(tree, day) DO UPDATE SET tokens = tokens + excluded.tokens',
    tree, today(), Math.round(tokens),
  );
}

// ---------- adapters ----------

/**
 * The adapter for a family, or the reason there is none. Throws `not-configured` when no key is saved
 * (or the key can't be opened), and `key-unreadable` for a key sealed under another secret.
 */
export async function adapterFor(tree: string, s?: Settings): Promise<AiAdapter> {
  const cur = s ?? (await readSettings(tree));
  if (!cur.sealed) throw new AiError('not-configured', COPY.en.errNotConfigured);
  const key = await openKey(tree, cur.sealed);
  if (fakeOn()) return fakeAdapter(cur.effectiveModel);
  return makeAdapter(cur.provider, key, cur.effectiveModel);
}

/**
 * The adapter for one feature, after the switch and the budget are checked. Throws AiError with a
 * message in the reader's language when it can't run.
 */
export async function adapterForFeature(tree: string, feature: Feature, locale: AiLocale): Promise<{ adapter: AiAdapter; settings: Settings }> {
  const c = copyFor(locale);
  const settings = await readSettings(tree);
  if (!settings.features[feature]) throw new AiError('not-configured', c.errOff);
  if (!settings.sealed) throw new AiError('not-configured', c.errNotConfigured);
  if (settings.dailyTokens <= 0 || (await usedToday(tree)) >= settings.dailyTokens) throw new AiError('budget', c.errBudget);
  return { adapter: await adapterFor(tree, settings), settings };
}

/** What the browser shows: a feature is on only when it is switched on and a readable key is saved. */
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
  const on = configured && s.dailyTokens > 0;
  return {
    configured,
    provider: fakeOn() && configured ? 'fake' : configured ? s.provider : null,
    features: Object.fromEntries(FEATURES.map((f) => [f, on && s.features[f]])) as AiFeatures,
  };
}

/** A live call to the provider with the given key, for "Test connection". Never stores anything. */
export async function testConnection(tree: string, input: { provider: Provider; model: string; apiKey?: string }, locale: AiLocale) {
  const c = copyFor(locale);
  const model = input.model.trim() || DEFAULT_MODEL[input.provider];
  const started = Date.now();
  try {
    let adapter: AiAdapter;
    if (fakeOn()) adapter = fakeAdapter(model);
    else {
      let key = input.apiKey?.trim() ?? '';
      if (!key) {
        const s = await readSettings(tree);
        if (!s.sealed) throw new AiError('not-configured', c.errNotConfigured);
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
