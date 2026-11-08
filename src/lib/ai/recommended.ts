// The models Kindred recommends, per provider. Typed, so a typo fails the build. Each is `provisional`: the choice
// is a reasoned first pick, and a measured test (quality, speed and cost on the family's own questions) comes later
// and may change the list. The page shows the list first and says it is provisional.
import type { Provider } from './types';

export type Role = 'balanced' | 'cheap' | 'best';

export interface Recommendation {
  provider: Provider;
  model: string;
  role: Role;
  /** Not yet measured. Always true until the measured test is done. */
  provisional: true;
}

export const RECOMMENDED: readonly Recommendation[] = [
  { provider: 'anthropic', model: 'claude-sonnet-5-5', role: 'balanced', provisional: true },
  { provider: 'anthropic', model: 'claude-haiku-5-5', role: 'cheap', provisional: true },
  { provider: 'anthropic', model: 'claude-opus-5-5', role: 'best', provisional: true },
  { provider: 'openai', model: 'gpt-6.1-sol', role: 'balanced', provisional: true },
  { provider: 'openai', model: 'gpt-6.1-terra', role: 'cheap', provisional: true },
  { provider: 'openai', model: 'gpt-6-astra', role: 'best', provisional: true },
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-5-5', role: 'balanced', provisional: true },
  { provider: 'openrouter', model: 'anthropic/claude-haiku-5-5', role: 'cheap', provisional: true },
  { provider: 'openrouter', model: 'anthropic/claude-opus-5-5', role: 'best', provisional: true },
];

export const recommendedFor = (provider: Provider): Recommendation[] => RECOMMENDED.filter((r) => r.provider === provider);
