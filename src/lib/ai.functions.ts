// The AI server functions: settings (stewards), the assistant (viewers ask; contributors and editors
// get proposals), and the three suggestion features. Every handler starts with the server's role check,
// the same one the browser asks `useCan()` about. Keys never leave the server: the settings return only
// each provider's state and masked tail.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { CHAT_MESSAGE_CHARS, FAMILY_SESSION_CHARS, FEATURES, PROVIDERS, ROUTES, toAiLocale, type AiFeatures, type AiSettingsData, type ModelInfo, type Provider } from './ai/types';

/** The models a provider offers, or why they could not be listed (the page then offers a typed model id). */
export type ModelsResult =
  | { ok: true; provider: Provider; models: ModelInfo[]; cached: boolean }
  | { ok: false; code: string; message: string };

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const locale = z.string().max(8).optional();
const guard = () => import('./auth/guard.server');
const ai = () => import('./ai/settings.server');
const page = () => import('./ai/page.server');
const providers = () => import('./ai/providers.server');

// ---------- status (what the UI may show) ----------

export const aiStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    // A guest gets no AI at all: every feature is off for them, whatever the family has set up.
    if ((await (await guard()).requireReader(data.tree)).guest) return { configured: false, provider: null, features: Object.fromEntries(FEATURES.map((f) => [f, false])) as AiFeatures };
    return (await ai()).statusFor(data.tree);
  });

export const aiStatusQuery = (t: string) => queryOptions({ queryKey: ['ai-status', t], queryFn: () => aiStatus({ data: { tree: t } }), staleTime: 60_000 });

// ---------- settings (stewards) ----------

const routeInput = z.object({
  route: z.enum(ROUTES),
  /** Null: the same as the assistant (only for the routes that follow it). */
  provider: z.enum(PROVIDERS).nullable(),
  model: z.string().trim().max(120),
});

/** Every connected provider's state, every route, the switches, the budget and the prices. Never a key. */
export const aiSettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<AiSettingsData> => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    return (await page()).settingsPage(data.tree);
  });

export const aiSettingsQuery = (t: string) => queryOptions({ queryKey: ['ai-settings', t], queryFn: () => aiSettings({ data: { tree: t } }) });

/** Saves the page: the routes, the feature switches, the budget and web search, the prices, and the portrait and task switches. */
export const aiSaveSettings = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    /** Every route the page shows (a route left out keeps its stored choice). */
    routes: z.array(routeInput).max(ROUTES.length),
    features: z.object({ assistant: z.boolean(), faces: z.boolean(), avatar: z.boolean(), arms: z.boolean() }),
    /** The monthly budget in US dollars. 0 turns AI off. */
    monthlyUsd: z.number().min(0).max(10_000),
    webSearch: z.boolean(),
    /** The family's own prices, for models Kindred has no price for (USD per 1M tokens). Replaces the saved map when sent. */
    customPrices: z.record(z.string().trim().min(1).max(120), z.object({ inPerM: z.number().min(0).max(10_000), outPerM: z.number().min(0).max(10_000) })).optional(),
    portraitEnabled: z.boolean(),
    tasks: z.object({ arms: z.boolean(), occupations: z.boolean(), chronicle: z.boolean(), names: z.boolean() }),
    locale,
  }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'manage-access');
    const { validModel } = await providers();
    for (const r of data.routes) {
      if (!validModel(r.model)) throw new Error('ai.err_model_chars');
    }
    const cur = await (await ai()).readSettings(data.tree);
    await (await page()).saveSettingsPage(data.tree, m.user.id, {
      features: data.features,
      webSearch: data.webSearch,
      monthlyMicros: Math.round(data.monthlyUsd * 1_000_000),
      customPrices: data.customPrices ?? cur.customPrices,
      routes: data.routes,
      portraitEnabled: data.portraitEnabled,
      tasks: data.tasks,
    });
  });

const apiKeyShape = z.string().trim().max(400);

/**
 * Connects a provider with its key (replacing the saved one). The key is sealed for that provider and never returned. Stewards only.
 * Refused when the key has the wrong shape; the connection is checked separately ("Test connection").
 */
export const aiSaveProvider = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, provider: z.enum(PROVIDERS), apiKey: apiKeyShape, locale }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'manage-access');
    if (!/^\S{8,400}$/.test(data.apiKey)) throw new Error('ai.err_key_shape');
    await (await providers()).saveProviderKey(data.tree, m.user.id, data.provider, data.apiKey);
  });

/**
 * Disconnects a provider: its key is deleted, and every route that uses it reports "needs a provider" until it is connected
 * again. Nothing is rerouted to another provider. Stewards only.
 */
export const aiRemoveProvider = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, provider: z.enum(PROVIDERS) }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    await (await providers()).removeProvider(data.tree, data.provider);
  });

/**
 * The models a provider offers, for the page's list. Uses the key typed on the page when one is given (checked, and never
 * stored or logged), else that provider's own saved key. Stewards only.
 */
export const aiListModels = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, provider: z.enum(PROVIDERS), key: z.string().trim().max(400).optional(), locale }))
  .handler(async ({ data }): Promise<ModelsResult> => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    const c = (await import('./ai/labels')).tr(toAiLocale(data.locale));
    let key = data.key ?? '';
    if (!key) {
      try {
        key = await (await providers()).keyFor(data.tree, data.provider);
      } catch (e) {
        const { AiError } = await import('./ai/adapters');
        if (e instanceof AiError) return { ok: false, code: e.code, message: e.code === 'not-configured' ? c('ai.errNoKey') : c('ai.err_key_unreadable') };
        throw e;
      }
    }
    const { AiError } = await import('./ai/adapters');
    try {
      const { listModels } = await import('./ai/models.server');
      const r = await listModels(data.provider, key);
      return { ok: true, provider: data.provider, models: r.models, cached: r.cached };
    } catch (e) {
      if (e instanceof AiError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  });

export const aiTestConnection = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, provider: z.enum(PROVIDERS), model: z.string().trim().max(120), apiKey: z.string().trim().max(400).optional(), locale }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    if (!(await providers()).validModel(data.model)) return { ok: false as const, message: 'ai.err_model_chars', model: data.model, code: 'bad-input' as const };
    return (await ai()).testConnection(data.tree, { provider: data.provider, model: data.model, apiKey: data.apiKey || undefined }, toAiLocale(data.locale));
  });

// ---------- the assistant (asking: viewers; proposals are offered by role) ----------

/** A chat's id. The server still checks that it is this reader's, on every path. */
const conv = z.string().uuid();
const chats = () => import('./ai/conversations.server');
const pickedModel = z.object({ provider: z.enum(PROVIDERS), model: z.string().trim().min(1).max(120) });

export const aiChatLoad = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, conv }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await chats()).loadChat(data.tree, m.user.id, m.role, data.conv);
  });

export const aiChatQuery = (t: string, c: string) => queryOptions({ queryKey: ['ai-chat', t, c], queryFn: () => aiChatLoad({ data: { tree: t, conv: c } }), staleTime: 0, retry: (n, e) => n < 2 && !String(e?.message).includes('ai.err_no_chat') });

/** A new, empty chat for this reader. It is listed once something has been said in it. */
export const aiChatNew = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return { conv: await (await chats()).newThread(data.tree, m.user.id) };
  });

/** Every chat this reader has something to read in, newest first. */
export const aiThreadList = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await chats()).listThreads(data.tree, m.user.id, m.role);
  });

export const aiThreadsQuery = (t: string) => queryOptions({ queryKey: ['ai-threads', t], queryFn: () => aiThreadList({ data: { tree: t } }), staleTime: 0 });

export const aiThreadSearch = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, query: z.string().trim().max(200) }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await chats()).searchThreads(data.tree, m.user.id, m.role, data.query);
  });

export const aiThreadSearchQuery = (t: string, query: string) => queryOptions({ queryKey: ['ai-threads', t, 'search', query], queryFn: () => aiThreadSearch({ data: { tree: t, query } }), staleTime: 0, enabled: !!query.trim() });

export const aiThreadRename = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, conv, title: z.string().max(200) }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    await (await chats()).renameThread(data.tree, m.user.id, m.role, data.conv, data.title);
  });

export const aiThreadDelete = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, conv }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    await (await chats()).deleteThread(data.tree, m.user.id, data.conv);
  });

/** A steward's choice of model for one chat, or null to go back to the family's. */
export const aiThreadSetModel = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, conv, model: pickedModel.nullable() }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    await (await chats()).setThreadModel(data.tree, m.user.id, m.role, data.conv, data.model);
  });

/** What a steward can choose from. */
export const aiChatModels = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await chats()).modelChoices(data.tree, m.role);
  });

export const aiChatModelsQuery = (t: string, enabled: boolean) => queryOptions({ queryKey: ['ai-chat-models', t], queryFn: () => aiChatModels({ data: { tree: t } }), staleTime: 5 * 60_000, enabled });

/** Asks the same question again on another model, and keeps both answers. Stewards only: the server refuses anyone else. */
export const aiChatRetry = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, conv, itemId: z.string().max(64), model: pickedModel, locale }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await import('./ai/chat.server')).retryWithModel({ tree: data.tree, user: m.user.id, role: m.role, me: m.person, locale: data.locale ?? 'en', conv: data.conv, itemId: data.itemId, modelOverride: data.model });
  });

export const aiChatSend = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    conv,
    /** A steward's choice of model for this one message. The server refuses it from anyone else. */
    model: pickedModel.optional(),
    // Empty only when pictures come with it; the server says so if neither does.
    text: z.string().trim().max(FAMILY_SESSION_CHARS),
    locale,
    /** Pictures for this message, as base64. The server takes their type from their bytes (ai/chat-images.ts), and checks their size there too. */
    images: z.array(z.object({ base64: z.string().min(1) })).optional(),
    /** Keep these pictures with the message. Without it they are read once and not stored. */
    keepImages: z.boolean().optional(),
    /** A family session: the text is a whole transcript, and the reply drafts the family from it. */
    session: z.boolean().optional(),
    /** The person speaking in the session (a person id in this tree). */
    speaker: z.string().max(120).nullable().optional(),
    /** What the reader is looking at. The server checks the person is in this family. */
    page: z.object({ path: z.string().max(300), personId: z.string().max(120).optional() }).nullable().optional(),
  }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    // A message is short; a family session is a whole transcript, up to its own limit. Past that, the reader splits it.
    if (!data.session && data.text.length > CHAT_MESSAGE_CHARS) throw new Error('ai.err_message_long');
    if (data.session && data.text.length > FAMILY_SESSION_CHARS) throw new Error('ai.err_session_long');
    const reply = await (await import('./ai/chat.server')).sendMessage({
      tree: data.tree, user: m.user.id, role: m.role, me: m.person, text: data.text, locale: data.locale ?? 'en', conv: data.conv, modelOverride: data.model,
      session: data.session, speaker: data.speaker ?? null, images: data.images, keepImages: data.keepImages, page: data.page,
    });
    await (await import('./stats/store.server')).countFeature(data.tree, m.user.id, 'assistant.asked');
    return reply;
  });

/** A picture this reader kept with one of their own messages. The same check as the message itself. */
export const aiChatImage = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await chats()).loadChatImage(data.tree, m.user.id, m.role, data.id);
  });

export const aiChatImageQuery = (t: string, id: string) => queryOptions({ queryKey: ['ai-chat-image', t, id], queryFn: () => aiChatImage({ data: { tree: t, id } }), staleTime: Infinity });

const decisionOutcome = z.object({
  edited: z.boolean().optional(),
  removed: z.number().int().min(0).max(1000).optional(),
  added: z.array(z.string().max(64)).max(200).optional(),
  failed: z.array(z.string().max(64)).max(200).optional(),
  linksAdded: z.number().int().min(0).max(1000).optional(),
  linksFailed: z.number().int().min(0).max(1000).optional(),
  error: z.string().max(240).optional(),
});

/** Records a card's outcome, and says whether the assistant should now carry on. */
export const aiChatMark = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, conv, itemId: z.string().max(64), proposalId: z.string().max(64), status: z.enum(['done', 'dismissed', 'failed']), outcome: decisionOutcome.optional() }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await import('./ai/chat.server')).markProposal(data.tree, m.user.id, m.role, data.conv, data.itemId, data.proposalId, data.status, data.outcome);
  });

/** The assistant carries on after the reader's decisions. The same member check as a message; the server decides whether anything is due. */
export const aiChatContinue = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, conv, locale }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    return (await import('./ai/chat.server')).continueAfterDecisions({ tree: data.tree, user: m.user.id, role: m.role, me: m.person, locale: data.locale ?? 'en', conv: data.conv });
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
