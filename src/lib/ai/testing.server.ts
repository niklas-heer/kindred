// Test setup for a family's AI: one call connects a provider with its key and sets the assistant's route and the switches.
// The tests and the browser harness use it; the app's own pages save each part through the settings page (page.server.ts).
import { AiError, chatModelId, searchesOnItsOwn } from './adapters';
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
