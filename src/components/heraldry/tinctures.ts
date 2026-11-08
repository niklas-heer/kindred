// Tinctures for heraldry v2: the seven classic ones, the stains, the furs and "proper".
import type { Fur, Stain, Tincture, TinctureV2 } from '~/lib/seed-format';

/** The everyday colours. Furs use their dominant colour here (for swatches, minimap dots and summaries). */
export const HEX_V2: Record<TinctureV2, string> = {
  or: '#d4a53c',
  argent: '#e8e6df',
  gules: '#b3312c',
  azure: '#2d5aa0',
  vert: '#2f7a46',
  sable: '#26241f',
  purpure: '#7b3f7f',
  murrey: '#8c2f4f',
  sanguine: '#7a1f1c',
  tenne: '#b8642a',
  carnation: '#e2ae8f',
  ermine: '#e8e6df',
  ermines: '#26241f',
  erminois: '#d4a53c',
  vair: '#2d5aa0',
  'counter-vair': '#2d5aa0',
  potent: '#2d5aa0',
  proper: '#8a5a32',
};

export type TinctureKind = 'metal' | 'colour' | 'fur' | 'proper';

export const METALS_V2: ReadonlySet<TinctureV2> = new Set(['or', 'argent']);
export const FURS: readonly Fur[] = ['ermine', 'ermines', 'erminois', 'vair', 'counter-vair', 'potent'];
export const STAINS: readonly Stain[] = ['murrey', 'sanguine', 'tenne', 'carnation'];
const FUR_SET: ReadonlySet<string> = new Set(FURS);

export const isFur = (t: TinctureV2): t is Fur => FUR_SET.has(t);
export function kindOf(t: TinctureV2): TinctureKind {
  if (t === 'proper') return 'proper';
  if (METALS_V2.has(t)) return 'metal';
  return isFur(t) ? 'fur' : 'colour';
}

/** Every tincture, in picker order, with its heraldic and everyday names. */
export const TINCTURES_V2: { id: TinctureV2; label: string; plain: string; kind: TinctureKind }[] = [
  { id: 'or', label: 'Or', plain: 'gold', kind: 'metal' },
  { id: 'argent', label: 'Argent', plain: 'silver', kind: 'metal' },
  { id: 'gules', label: 'Gules', plain: 'red', kind: 'colour' },
  { id: 'azure', label: 'Azure', plain: 'blue', kind: 'colour' },
  { id: 'vert', label: 'Vert', plain: 'green', kind: 'colour' },
  { id: 'sable', label: 'Sable', plain: 'black', kind: 'colour' },
  { id: 'purpure', label: 'Purpure', plain: 'purple', kind: 'colour' },
  { id: 'murrey', label: 'Murrey', plain: 'mulberry', kind: 'colour' },
  { id: 'sanguine', label: 'Sanguine', plain: 'blood red', kind: 'colour' },
  { id: 'tenne', label: 'Tenné', plain: 'orange-brown', kind: 'colour' },
  { id: 'carnation', label: 'Carnation', plain: 'flesh', kind: 'colour' },
  { id: 'ermine', label: 'Ermine', plain: 'white with black spots', kind: 'fur' },
  { id: 'ermines', label: 'Ermines', plain: 'black with white spots', kind: 'fur' },
  { id: 'erminois', label: 'Erminois', plain: 'gold with black spots', kind: 'fur' },
  { id: 'vair', label: 'Vair', plain: 'blue and white bells', kind: 'fur' },
  { id: 'counter-vair', label: 'Counter-vair', plain: 'bells base to base', kind: 'fur' },
  { id: 'potent', label: 'Potent', plain: 'blue and white crutches', kind: 'fur' },
  { id: 'proper', label: 'Proper', plain: 'natural colours', kind: 'proper' },
];
const LABEL = new Map(TINCTURES_V2.map((t) => [t.id, t]));
export const labelV2 = (t: TinctureV2) => LABEL.get(t)?.label ?? t;
export const plainV2 = (t: TinctureV2) => LABEL.get(t)?.plain ?? t;

/** The nearest of the seven v1 tinctures, for the v1 summary older readers see. */
export function nearestV1(t: TinctureV2): Tincture {
  switch (t) {
    case 'murrey': return 'purpure';
    case 'sanguine': return 'gules';
    case 'tenne': return 'gules';
    case 'carnation': return 'argent';
    case 'ermine': return 'argent';
    case 'ermines': return 'sable';
    case 'erminois': return 'or';
    case 'vair': case 'counter-vair': case 'potent': return 'azure';
    case 'proper': return 'or';
    default: return t;
  }
}

/** The fur's two colours: ground and pattern. */
export const FUR_COLOURS: Record<Fur, [string, string]> = {
  ermine: [HEX_V2.argent, HEX_V2.sable],
  ermines: [HEX_V2.sable, HEX_V2.argent],
  erminois: [HEX_V2.or, HEX_V2.sable],
  vair: [HEX_V2.azure, HEX_V2.argent],
  'counter-vair': [HEX_V2.azure, HEX_V2.argent],
  potent: [HEX_V2.azure, HEX_V2.argent],
};
