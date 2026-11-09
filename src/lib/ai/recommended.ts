// The models Kindred recommends, per provider. Typed, so a typo fails the build. A `provisional` pick is a reasoned first
// choice; the others were measured with scripts/ai-eval.ts (docs/evals/models.md). The page shows the list first and says which.
import type { Provider } from './types';

export type Role = 'balanced' | 'cheap' | 'best';

export interface Recommendation {
  provider: Provider;
  model: string;
  role: Role;
  /** Not yet measured with scripts/ai-eval.ts. */
  provisional: boolean;
}

export const RECOMMENDED: readonly Recommendation[] = [
  // Measured 2026-11-08: Haiku passed every check at about a twelfth of Sonnet's cost, so it comes first.
  { provider: 'anthropic', model: 'claude-haiku-5-5', role: 'cheap', provisional: false },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', role: 'balanced', provisional: false },
  { provider: 'anthropic', model: 'claude-opus-5-5', role: 'best', provisional: false },
  { provider: 'openai', model: 'gpt-6.1-sol', role: 'balanced', provisional: true },
  { provider: 'openai', model: 'gpt-6.1-terra', role: 'cheap', provisional: true },
  { provider: 'openai', model: 'gpt-6-astra', role: 'best', provisional: true },
  // Measured 2026-11-08 through OpenRouter: Gemini 3.8 Flash 98%, GPT-6.1 Terra 95%, Haiku 86% (it cited no page for web research) at the lowest cost.
  { provider: 'openrouter', model: 'google/gemini-3.8-flash', role: 'best', provisional: false },
  { provider: 'openrouter', model: 'openai/gpt-6.1-terra', role: 'balanced', provisional: false },
  { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', role: 'cheap', provisional: false },
];

export const recommendedFor = (provider: Provider): Recommendation[] => RECOMMENDED.filter((r) => r.provider === provider);

export interface PortraitRecommendation extends Recommendation {
  /** What one portrait cost when it was measured, in USD. OpenRouter's list gives only a cautious estimate for the budget. */
  usd: number;
}

// Measured in the owner's bake-off of 21 image models from one photo. Flare kept the likeness and painted period dress; FLUX 3
// Klein stayed faithful at a fraction of the price. Krea 2 Large and Recraft lost the likeness, so they are not listed.
export const RECOMMENDED_PORTRAIT: readonly PortraitRecommendation[] = [
  { provider: 'openrouter', model: 'openai/gpt-image-2.6-flare', role: 'best', provisional: false, usd: 0.048 },
  { provider: 'openrouter', model: 'black-forest-labs/flux-3-image-klein', role: 'cheap', provisional: false, usd: 0.009 },
];

export const DEFAULT_PORTRAIT_MODEL = 'openai/gpt-image-2.6-flare';

/** The recommended painters the provider really lists now. One it no longer lists is not offered. */
export const portraitPicks = (listed: readonly { id: string }[]): PortraitRecommendation[] =>
  RECOMMENDED_PORTRAIT.filter((r) => listed.some((m) => m.id === r.model));

/** The portrait route's model: the saved choice as it is, else the default when the provider lists it, else none. */
export const portraitModelOr = (saved: string, listed: readonly { id: string }[]): string =>
  saved.trim() || (listed.some((m) => m.id === DEFAULT_PORTRAIT_MODEL) ? DEFAULT_PORTRAIT_MODEL : '');
