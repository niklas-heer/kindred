// Colours baked into the portrait drawing. Theme-dependent colour (backdrop, frame, mourning) is
// applied in CSS instead, so one drawing serves all three themes.
import type { Tincture } from '~/lib/seed-format';
import type { House } from '~/lib/types';
import { TINCTURE_HEX } from '../Heraldry';

/** Line work: a warm iron-gall ink, never pure black. */
export const INK = '#2a1f16';
/** Undyed linen for collars, ruffs and shirts. */
export const LINEN = '#efe6d2';

const METALS: ReadonlySet<Tincture> = new Set(['or', 'argent']);
const contrastOf = (t: Tincture): Tincture => (METALS.has(t) ? 'gules' : 'argent');

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** Mixes `b` into `a` by `t` (0–1), in sRGB, which is close enough for pigments. */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export interface Dress {
  /** The main cloth: the house's field. */
  cloth: string;
  /** Linings, trims and ties: the house's second tincture. */
  trim: string;
  /** Brooches and buttons. */
  metal: string;
}

// Without a house: plain undyed and earth-dyed cloths, picked per person so a family of
// commoners is not dressed alike.
const PLAIN: Dress[] = [
  { cloth: '#6e5b45', trim: '#b5a07a', metal: '#c9a14a' }, // walnut and flax
  { cloth: '#4d5a66', trim: '#9e4a3a', metal: '#c9a14a' }, // slate and madder
  { cloth: '#5f6446', trim: '#c2a35e', metal: '#c9a14a' }, // olive and weld
  { cloth: '#5b4552', trim: '#a9a28f', metal: '#c9a14a' }, // mulberry and stone
  { cloth: '#3f4a5e', trim: '#b88a4a', metal: '#c9a14a' }, // indigo and ochre
];

/** The house's colours as dyed cloth: a little duller and darker than the enamel of the arms.
 *  `pick` chooses among plain cloths for someone without a house. */
export function dressOf(house: House | undefined, pick: number): Dress {
  if (!house) return PLAIN[pick % PLAIN.length];
  const { field } = house.arms;
  const field2 = house.arms.field2 ?? contrastOf(field);
  const dye = (t: Tincture) => mix(TINCTURE_HEX[t], INK, t === 'argent' ? 0.12 : 0.2);
  return {
    cloth: dye(field),
    // A trim in the same tincture as the cloth would vanish; fall back to the contrast tincture.
    trim: dye(field2 === field ? contrastOf(field) : field2),
    metal: field === 'or' ? '#e4e0d4' : '#d6aa4c',
  };
}
