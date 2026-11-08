// Tinctures for heraldry v2: the seven classic ones, the stains, the furs and "proper".
import type { Fur, Stain, Tincture, TinctureV2 } from '~/lib/seed-format';
import type { Key } from '~/lib/i18n/dictionary';

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
export const TINCTURES_V2: { id: TinctureV2; label: Key; plain: Key; kind: TinctureKind }[] = [
  { id: 'or', label: 'heraldry.tincture.or', plain: 'heraldry.tincture_plain.or', kind: 'metal' },
  { id: 'argent', label: 'heraldry.tincture.argent', plain: 'heraldry.tincture_plain.argent', kind: 'metal' },
  { id: 'gules', label: 'heraldry.tincture.gules', plain: 'heraldry.tincture_plain.gules', kind: 'colour' },
  { id: 'azure', label: 'heraldry.tincture.azure', plain: 'heraldry.tincture_plain.azure', kind: 'colour' },
  { id: 'vert', label: 'heraldry.tincture.vert', plain: 'heraldry.tincture_plain.vert', kind: 'colour' },
  { id: 'sable', label: 'heraldry.tincture.sable', plain: 'heraldry.tincture_plain.sable', kind: 'colour' },
  { id: 'purpure', label: 'heraldry.tincture.purpure', plain: 'heraldry.tincture_plain.purpure', kind: 'colour' },
  { id: 'murrey', label: 'heraldry.tincture.murrey', plain: 'heraldry.tincture_plain.murrey', kind: 'colour' },
  { id: 'sanguine', label: 'heraldry.tincture.sanguine', plain: 'heraldry.tincture_plain.sanguine', kind: 'colour' },
  { id: 'tenne', label: 'heraldry.tincture.tenne', plain: 'heraldry.tincture_plain.tenne', kind: 'colour' },
  { id: 'carnation', label: 'heraldry.tincture.carnation', plain: 'heraldry.tincture_plain.carnation', kind: 'colour' },
  { id: 'ermine', label: 'heraldry.tincture.ermine', plain: 'heraldry.tincture_plain.ermine', kind: 'fur' },
  { id: 'ermines', label: 'heraldry.tincture.ermines', plain: 'heraldry.tincture_plain.ermines', kind: 'fur' },
  { id: 'erminois', label: 'heraldry.tincture.erminois', plain: 'heraldry.tincture_plain.erminois', kind: 'fur' },
  { id: 'vair', label: 'heraldry.tincture.vair', plain: 'heraldry.tincture_plain.vair', kind: 'fur' },
  { id: 'counter-vair', label: 'heraldry.tincture.counter-vair', plain: 'heraldry.tincture_plain.counter-vair', kind: 'fur' },
  { id: 'potent', label: 'heraldry.tincture.potent', plain: 'heraldry.tincture_plain.potent', kind: 'fur' },
  { id: 'proper', label: 'heraldry.tincture.proper', plain: 'heraldry.tincture_plain.proper', kind: 'proper' },
];
const LABEL = new Map(TINCTURES_V2.map((t) => [t.id, t]));
/** The i18n key of a tincture's name. Blazon uses the English text; the Designer translates. */
export const labelV2 = (t: TinctureV2): Key => LABEL.get(t)!.label;
export const plainV2 = (t: TinctureV2): Key => LABEL.get(t)!.plain;

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
