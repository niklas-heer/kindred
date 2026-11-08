// The models Kindred recommends, per provider. Typed, so a typo fails the build. A `provisional` pick is a reasoned first
// choice; the others were measured with scripts/ai-eval.ts (docs/ai-model-test.md). The page shows the list first and says which.
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
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', role: 'balanced', provisional: true },
  { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', role: 'cheap', provisional: true },
  { provider: 'openrouter', model: 'anthropic/claude-opus-5.5', role: 'best', provisional: true },
];

export const recommendedFor = (provider: Provider): Recommendation[] => RECOMMENDED.filter((r) => r.provider === provider);
