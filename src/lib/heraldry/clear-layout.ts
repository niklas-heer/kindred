// Whether a design can be drawn cleanly: no group of charges on top of another. It asks the renderer's own placement
// (placeCharges), so what is checked here is what the shield will show.
import type { ArmsV2, ChargeLayer } from '~/lib/seed-format';
import { placeCharges } from './geometry';

/** The clear space, in shield units, that two groups of charges must keep between them. */
const MIN_GAP = 2;

/** The charge groups of a design: one layer is one group, however many charges it repeats. */
export const chargeGroups = (arms: ArmsV2): ChargeLayer[] => arms.layers.filter((l): l is ChargeLayer => l.type === 'charge');

/** True when a charge of one group lies on, or touches, a charge of another. Charges of one group may cross on purpose. */
export function chargesOverlap(arms: ArmsV2): boolean {
  const groups = arms.layers.flatMap((l, i) => (l.type === 'charge' ? [placeCharges(l, arms.layers.slice(0, i), arms.shield)] : []));
  return groups.some((group, i) => groups.slice(i + 1).some((other) => group.some((a) => other.some((b) => {
    const reach = (a.s + b.s) / 2 + MIN_GAP;
    return Math.abs(a.x - b.x) < reach && Math.abs(a.y - b.y) < reach;
  }))));
}
