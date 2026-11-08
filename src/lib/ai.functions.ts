// The AI server functions: settings (stewards), the assistant (viewers ask; contributors and editors
// get proposals), and the three suggestion features. Every handler starts with the server's role check,
// the same one the browser asks `useCan()` about. Keys never leave the server: the settings return only
// a masked tail.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { DEFAULT_MODEL, PROVIDERS, FEATURES, toAiLocale, type AiFeatures, type ModelInfo, type Provider } from './ai/types';

/** The models a provider offers, or why they could not be listed (the page then offers a typed model id). */
export type ModelsResult =
  | { ok: true; provider: Provider; models: ModelInfo[]; cached: boolean }
  | { ok: false; code: string; message: string };

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const locale = z.string().max(8).optional();
const features = z.object({ assistant: z.boolean(), faces: z.boolean(), avatar: z.boolean(), arms: z.boolean() });
const guard = () => import('./auth/guard.server');
const ai = () => import('./ai/settings.server');

// ---------- status (what the UI may show) ----------

export const aiStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireMember(data.tree);
    return (await ai()).statusFor(data.tree);
  });

export const aiStatusQuery = (t: string) => queryOptions({ queryKey: ['ai-status', t], queryFn: () => aiStatus({ data: { tree: t } }), staleTime: 60_000 });

// ---------- settings (stewards) ----------

export const aiSettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    const s = await ai();
    const { openKey } = await import('./ai/secret.server');
    const cur = await s.readSettings(data.tree);
    let keyState: 'none' | 'saved' | 'unreadable' = 'none';
    if (cur.sealed) {
      try { await openKey(data.tree, cur.sealed); keyState = 'saved'; } catch { keyState = 'unreadable'; }
    }
    return {
      provider: cur.provider,
      model: cur.model,
      defaultModel: DEFAULT_MODEL[cur.provider],
      keyState,
      keyTail: keyState === 'saved' ? cur.keyTail : null,
      features: cur.features,
      webSearch: cur.webSearch,
      monthlyMicros: cur.monthlyMicros,
      spentMicros: await s.spentThisMonth(data.tree),
      resetsOn: s.resetsOn(),
      customPrices: cur.customPrices,
      updated: cur.updated,
    };
  });

export const aiSettingsQuery = (t: string) => queryOptions({ queryKey: ['ai-settings', t], queryFn: () => aiSettings({ data: { tree: t } }) });

export const aiSaveSettings = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    provider: z.enum(PROVIDERS),
    model: z.string().trim().max(120),
    /** Empty or absent keeps the saved key. */
    apiKey: z.string().trim().max(400).optional(),
    clearKey: z.boolean().optional(),
    features,
    /** The monthly budget in US dollars. 0 turns AI off. */
    monthlyUsd: z.number().min(0).max(10_000),
    webSearch: z.boolean(),
    /** The family's own prices, for models Kindred has no price for (USD per 1M tokens). Replaces the saved map when sent. */
    customPrices: z.record(z.string().trim().min(1).max(120), z.object({ inPerM: z.number().min(0).max(10_000), outPerM: z.number().min(0).max(10_000) })).optional(),
    locale,
  }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'manage-access');
    const s = await ai();
    const c = (await import('./ai/labels')).tr(toAiLocale(data.locale));
    if (!s.validModel(data.model)) throw new Error('ai.err_model_chars');
    if (data.apiKey && !/^\S{8,400}$/.test(data.apiKey)) throw new Error('ai.err_key_shape');
    const cur = await s.readSettings(data.tree);
    const keyWillExist = !data.clearKey && (!!data.apiKey || !!cur.sealed);
    if (!keyWillExist && (FEATURES as readonly string[]).some((f) => data.features[f as keyof AiFeatures])) throw new Error(c('ai.needsKey'));
    await s.saveSettings(data.tree, m.user.id, {
      provider: data.provider,
      model: data.model,
      features: data.features,
      webSearch: data.webSearch,
      monthlyMicros: Math.round(data.monthlyUsd * 1_000_000),
      customPrices: data.customPrices ?? cur.customPrices,
      apiKey: data.apiKey || undefined,
      clearKey: data.clearKey,
    });
  });

/**
 * The models a provider offers, for the page's list. Uses the key typed on the page when one is given (checked, and
 * never stored or logged), else the family's saved key for the saved provider. Stewards only.
 */
export const aiListModels = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, provider: z.enum(PROVIDERS).optional(), key: z.string().trim().max(400).optional(), locale }))
  .handler(async ({ data }): Promise<ModelsResult> => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    const s = await ai();
    const c = (await import('./ai/labels')).tr(toAiLocale(data.locale));
    const cur = await s.readSettings(data.tree);
    const provider: Provider = data.provider ?? cur.provider;
    let key = data.key ?? '';
    if (!key && provider === cur.provider && cur.sealed) {
      const { openKey } = await import('./ai/secret.server');
      try {
        key = await openKey(data.tree, cur.sealed);
      } catch {
        return { ok: false, code: 'key-unreadable', message: c('ai.err_key_unreadable') };
      }
    }
    if (!key) return { ok: false, code: 'not-configured', message: c('ai.errNoKey') };
    const { AiError } = await import('./ai/adapters');
    try {
      const { listModels } = await import('./ai/models.server');
      const r = await listModels(provider, key);
      return { ok: true, provider, models: r.models, cached: r.cached };
    } catch (e) {
      if (e instanceof AiError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  });

export const aiTestConnection = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, provider: z.enum(PROVIDERS), model: z.string().trim().max(120), apiKey: z.string().trim().max(400).optional(), locale }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    const s = await ai();
    if (!s.validModel(data.model)) return { ok: false as const, message: 'ai.err_model_chars', model: data.model, code: 'bad-input' as const };
    return s.testConnection(data.tree, { provider: data.provider, model: data.model, apiKey: data.apiKey || undefined }, toAiLocale(data.locale));
  });

// ---------- the assistant (asking: viewers; proposals are offered by role) ----------

export const aiChatLoad = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await import('./ai/chat.server')).loadChat(data.tree, m.user.id, m.role);
  });

export const aiChatQuery = (t: string) => queryOptions({ queryKey: ['ai-chat', t], queryFn: () => aiChatLoad({ data: { tree: t } }), staleTime: 0 });

export const aiChatNew = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    await (await import('./ai/chat.server')).newConversation(data.tree, m.user.id);
  });

export const aiChatSend = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, text: z.string().trim().min(1).max(4000), locale }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await import('./ai/chat.server')).sendMessage({ tree: data.tree, user: m.user.id, role: m.role, me: m.person, text: data.text, locale: data.locale ?? 'en' });
  });

export const aiChatMark = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, itemId: z.string().max(64), proposalId: z.string().max(64), status: z.enum(['done', 'dismissed']) }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    await (await import('./ai/chat.server')).markProposal(data.tree, m.user.id, m.role, data.itemId, data.proposalId, data.status);
  });

// ---------- suggestions from pictures and names ----------

const mediaKey = z.string().min(3).max(200);

export const aiFindFaces = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, mediaKey, locale }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'upload-photo');
    return (await import('./ai/vision.server')).findFaces({ tree: data.tree, mediaKey: data.mediaKey, locale: toAiLocale(data.locale) });
  });

export const aiAvatarFromPhoto = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: z.string().min(1).max(100), mediaKey, locale }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-person');
    return (await import('./ai/vision.server')).avatarFromPhoto({ tree: data.tree, personId: data.personId, mediaKey: data.mediaKey, locale: toAiLocale(data.locale) });
  });
