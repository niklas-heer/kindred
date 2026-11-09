// Test setup for a family's AI: one call connects a provider with its key and sets the assistant's route and the switches.
// The tests and the browser harness use it; the app's own pages save each part through the settings page (page.server.ts).
import { accounts } from '../auth/store.server';
import type { Role } from '../roles';
import { AiError, chatModelId, searchesOnItsOwn } from './adapters';
import { newThread } from './conversations.server';
import { removeProvider, saveProviderKey, type RouteInput } from './providers.server';
import { saveSettings } from './settings.server';
import type { AiFeatures, CustomPrice, Provider } from './types';

export interface FamilyAiSetup {
  /** The assistant's provider and model (empty model: the provider's default). */
  provider: Provider;
  model: string;
  /** A key for `provider`, saved (replacing the saved one). */
  apiKey?: string;
  /** Removes `provider`'s key. */
  clearKey?: boolean;
  features: AiFeatures;
  webSearch: boolean;
  monthlyMicros: number;
  customPrices: Record<string, CustomPrice>;
  /** Other routes to set, as the settings page would. */
  routes?: RouteInput[];
}

export async function setUpFamilyAi(tree: string, by: string | null, o: FamilyAiSetup): Promise<void> {
  // Refused before anything is saved, so a refused setup leaves no key behind (the same rule saveRoutes applies).
  if (searchesOnItsOwn(o.provider, chatModelId(o.provider, o.model.trim()))) throw new AiError('bad-input', 'ai.err_model_search');
  if (o.apiKey) await saveProviderKey(tree, by, o.provider, o.apiKey);
  if (o.clearKey) await removeProvider(tree, o.provider);
  await saveSettings(tree, by, {
    features: o.features,
    webSearch: o.webSearch,
    monthlyMicros: o.monthlyMicros,
    customPrices: o.customPrices,
    routes: [{ route: 'assistant', provider: o.provider, model: o.model }, ...(o.routes ?? [])],
  });
}

/**
 * The assistant's functions as a single-chat caller uses them, for tests that are not about choosing a chat: each call goes
 * to this reader's newest chat, made on first use. Tests about chats themselves call chat.server directly.
 */
export function withLatestChat<T extends typeof import('./chat.server')>(chat: T) {
  const latest = async (tree: string, user: string): Promise<string> => {
    const row = await accounts().get<{ conv: string }>('SELECT conv FROM ai_thread WHERE tree = ? AND user = ? ORDER BY created DESC, rowid DESC LIMIT 1', tree, user);
    // A reader the test never made cannot own a chat: a call that is refused for another reason still gets that refusal.
    return row?.conv ?? newThread(tree, user).catch(() => crypto.randomUUID());
  };
  type Sent = Omit<Parameters<T['sendMessage']>[0], 'conv'> & { conv?: string };
  type Asked = Omit<Parameters<T['continueAfterDecisions']>[0], 'conv'> & { conv?: string };
  return {
    ...chat,
    loadChat: async (tree: string, user: string, role: Role) => chat.loadChat(tree, user, role, await latest(tree, user)),
    sendMessage: async (o: Sent) => chat.sendMessage({ ...o, conv: o.conv ?? await latest(o.tree, o.user) } as Parameters<T['sendMessage']>[0]),
    continueAfterDecisions: async (o: Asked) => chat.continueAfterDecisions({ ...o, conv: o.conv ?? await latest(o.tree, o.user) } as Parameters<T['continueAfterDecisions']>[0]),
    markProposal: async (tree: string, user: string, role: Role, itemId: string, proposalId: string, status: 'done' | 'dismissed' | 'failed', outcome?: Parameters<T['markProposal']>[7]) =>
      chat.markProposal(tree, user, role, await latest(tree, user), itemId, proposalId, status, outcome),
    newConversation: async (tree: string, user: string) => { await newThread(tree, user); },
  };
}
