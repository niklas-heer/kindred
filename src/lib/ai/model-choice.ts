// A steward's choice of model for a chat: what the picker lists, its plain cost hint, and which model counts as "stronger".
// Pure: the server builds the list and the browser picks from it.
import { RECOMMENDED, type Role as PickRole } from './recommended.ts';
import type { Provider } from './types';

export type CostHint = '$' | '$$' | '$$$' | '';

export interface ModelChoice {
  provider: Provider;
  id: string;
  name: string;
  cost: CostHint;
  /** Kindred's measured pick for this provider. */
  recommended: boolean;
  /** Dollars per million tokens of a typical chat, or null when the price is unknown. */
  blended: number | null;
}

export interface ModelChoices {
  /** Where this family's assistant goes when a chat has no choice of its own. */
  familyDefault: { provider: Provider; model: string } | null;
  models: ModelChoice[];
  /** Providers whose list could not be read just now: their recommended models are still offered. */
  unavailable: Provider[];
}

// A typical chat turn is about four tokens read for each one written (prices.ts, ESTIMATE_CONVERSATION).
export const blendedPrice = (inPerM: number | null, outPerM: number | null): number | null =>
  inPerM == null || outPerM == null ? null : (inPerM * 4 + outPerM) / 5;

export function costHint(blended: number | null): CostHint {
  if (blended == null) return '';
  if (blended < 1) return '$';
  return blended < 6 ? '$$' : '$$$';
}

const STRENGTH: Record<PickRole, number> = { cheap: 0, balanced: 1, best: 2 };

/** The provider's picks, weakest first. */
const ladder = (provider: Provider) => RECOMMENDED.filter((r) => r.provider === provider).sort((a, b) => STRENGTH[a.role] - STRENGTH[b.role]).map((r) => r.model);

/**
 * The next model up from the one that answered: the provider's next recommended tier, else the cheapest listed model that
 * costs more. Null when nothing stronger is offered, and the reader can still pick one themselves.
 */
export function nextStronger(current: { provider: Provider | 'fake'; model: string }, models: readonly ModelChoice[]): ModelChoice | null {
  const here = models.find((m) => m.id === current.model && (m.provider === current.provider || current.provider === 'fake'));
  const peers = models.filter((m) => m.id !== current.model && (current.provider === 'fake' || m.provider === current.provider));
  if (current.provider !== 'fake') {
    const picks = ladder(current.provider);
    const at = picks.indexOf(current.model);
    if (at >= 0) {
      for (const id of picks.slice(at + 1)) {
        const found = peers.find((m) => m.id === id);
        if (found) return found;
      }
      return null;
    }
  }
  const floor = here?.blended ?? -1;
  return peers.filter((m) => m.blended != null && m.blended > floor).sort((a, b) => a.blended! - b.blended!)[0] ?? null;
}
