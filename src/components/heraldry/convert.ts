// Between v1 and v2. A v1 coat of arms opens in the editor as its v2 equivalent; a v2 design is stored with
// a v1 summary beside it, so older readers (and the minimap's house colours) keep working.
import type { ArmsV2, ChargeLayer, FieldDivision, OrdinaryLayer, SeedHouse, Tincture } from '~/lib/seed-format';
import { nearestV1 } from './tinctures';

type ArmsV1 = Omit<SeedHouse['arms'], 'v2'>;
type V1Division = ArmsV1['division'];
type V1Charge = ArmsV1['charge'];

const contrastV1 = (t: Tincture): Tincture => (t === 'or' || t === 'argent' ? 'gules' : 'argent');

/** v1 charge ids that changed name in the v2 catalogue. */
const V1_TO_V2_CHARGE: Partial<Record<V1Charge, string>> = { star: 'mullet', crescent: 'moon' };
const V2_TO_V1_CHARGE: Record<string, V1Charge> = {
  lion: 'lion', eagle: 'eagle', tower: 'tower', mullet: 'star', moon: 'crescent', crescent: 'crescent', fleur: 'fleur',
  key: 'key', rose: 'rose', boar: 'boar', stag: 'stag', sword: 'sword',
};

/** The v2 design a v1 coat of arms stands for. */
export function v1ToV2(a: ArmsV1): ArmsV2 {
  const second = a.field2 ?? contrastV1(a.field);
  const layers: ArmsV2['layers'] = [];
  let division: FieldDivision = 'plain';
  let tinctures: ArmsV2['field']['tinctures'] = [a.field];
  switch (a.division) {
    case 'chevron': case 'cross': case 'saltire':
      layers.push({ type: 'ordinary', kind: a.division, tincture: second, line: 'straight' });
      break;
    case 'plain': break;
    default:
      division = a.division;
      tinctures = [a.field, second];
  }
  if (a.charge !== 'none') layers.push({ type: 'charge', charge: V1_TO_V2_CHARGE[a.charge] ?? a.charge, tincture: a.chargeTincture, count: 1, arrangement: 'auto', on: 'field' });
  return { shield: 'heater', field: { division, tinctures, line: 'straight' }, layers };
}

const V1_DIVISIONS: ReadonlySet<string> = new Set<V1Division>(['per-pale', 'per-fess', 'per-bend', 'quarterly', 'paly', 'bendy']);

/** The nearest v1 coat of arms, for readers that only know v1. */
export function v2ToV1(a: ArmsV2): ArmsV1 {
  const t0 = a.field.tinctures[0] ?? 'argent';
  const field = nearestV1(t0);
  const out: ArmsV1 = { field, division: 'plain', charge: 'none', chargeTincture: contrastV1(field) };
  if (V1_DIVISIONS.has(a.field.division) && a.field.tinctures[1]) {
    out.division = a.field.division as V1Division;
    out.field2 = nearestV1(a.field.tinctures[1]);
  } else {
    const ord = a.layers.find((l): l is OrdinaryLayer => l.type === 'ordinary' && (l.kind === 'chevron' || l.kind === 'cross' || l.kind === 'saltire'));
    if (ord) {
      out.division = ord.kind as V1Division;
      out.field2 = nearestV1(ord.tincture);
    }
  }
  const ch = a.layers.find((l): l is ChargeLayer => l.type === 'charge' && !!V2_TO_V1_CHARGE[l.charge]);
  if (ch) {
    out.charge = V2_TO_V1_CHARGE[ch.charge];
    out.chargeTincture = nearestV1(ch.tincture);
  }
  return out;
}

/** The value to store: the v1 summary and the design. */
export function storeV2(a: ArmsV2): SeedHouse['arms'] {
  return { ...v2ToV1(a), v2: a };
}

/** The design to edit or draw: the stored v2, or the v1 arms read as v2. */
export function asV2(a: SeedHouse['arms']): ArmsV2 {
  return a.v2 ?? v1ToV2(a);
}
