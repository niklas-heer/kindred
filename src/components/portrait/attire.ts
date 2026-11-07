// Shoulders: a mantle, doublet, coat or jacket in the house's colours, cut to the era of the
// person's birth. Drawn in lorelei's own 100 × 100 space so the neckline meets its neck.
import type { GPerson } from '~/lib/types';
import { yearOf } from './face';
import { INK, LINEN, mix, type Dress } from './palette';

export type Era = 'mantle' | 'ruff' | 'stock' | 'jacket';
export type Detail = 'sm' | 'md' | 'lg';

/** Before 1500 a mantle; to 1650 a ruff; to 1850 a high collar and stock; then shirt and jacket. */
export function eraOf(p: GPerson): Era {
  const born = yearOf(p.born) ?? (yearOf(p.died) !== undefined ? yearOf(p.died)! - 50 : undefined);
  if (born === undefined) return p.living ? 'jacket' : 'stock';
  return born < 1500 ? 'mantle' : born < 1650 ? 'ruff' : born < 1850 ? 'stock' : 'jacket';
}

// The shoulder line, left to right, open between (40 78.5) and (61 78.5) for a neckline.
const LEFT = 'M-20 130L-20 100C-5 90 18 85.5 31 83.5C35 83 38 80.5 40 78.5';
const RIGHT = 'C63 80.5 66 83 70 83.5C83 85.5 106 90 121 100L121 130Z';
const body = (neck: string) => `${LEFT}${neck}${RIGHT}`;
// Draws the left half and its mirror about the neck's centre line (x = 50.5).
const pair = (svg: string) => `${svg}<g transform="translate(101 0) scale(-1 1)">${svg}</g>`;

export function attireSvg(era: Era, dress: Dress, detail: Detail, sex: GPerson['sex']): string {
  const w = detail === 'sm' ? 1.5 : detail === 'md' ? 1.15 : 0.9;
  const ink = `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const fine = detail === 'lg';
  const shade = mix(dress.cloth, INK, 0.35);
  // Engraved shading on the far shoulders, at the panel size only.
  const hatch = (d: string) => (fine ? `<path d="${d}" fill="url(#hatch)" mask="url(#sides)"/>` : '');

  switch (era) {
    case 'mantle': {
      const tunic = body('Q50.5 89 61 78.5');
      const half = 'M-20 130L-20 100C-5 90 18 85.5 31 83.5C35 83 38 80.5 40 78.5C41 86 45 94 49 97.5L48 130Z';
      const lining = fine ? `<path d="M40 78.5C41 86 45 94 49 97.5" fill="none" stroke="${dress.trim}" stroke-width="2.6"/>` : '';
      const brooch =
        `<circle cx="50.5" cy="97.5" r="${detail === 'sm' ? 4.2 : 4.6}" fill="${dress.metal}" ${ink}/>` +
        (detail === 'sm' ? '' : `<circle cx="50.5" cy="97.5" r="2" fill="${dress.trim}" ${ink}/>`) +
        (fine ? `<path d="M44.5 103.5L56.5 91.5" ${ink} fill="none"/>` : '');
      return (
        `<path d="${tunic}" fill="${dress.trim}" ${ink}/>` +
        pair(`<path d="${half}" fill="${dress.cloth}" ${ink}/>${lining}`) +
        hatch(body('Q50.5 89 61 78.5')) +
        brooch
      );
    }
    case 'ruff': {
      const buttons = fine ? [91, 98, 105].map((y) => `<circle cx="50.5" cy="${y}" r="1.3" fill="${dress.metal}" ${ink}/>`).join('') : '';
      const wings = detail === 'sm' ? '' : pair(`<path d="M18 86.5C24 84.5 28 84 31 83.5C31 88 30 92 28 96C23 95 19 93 16 90Z" fill="${dress.trim}" ${ink}/>`);
      const ruffDetail = detail === 'sm' ? '' : Array.from({ length: 7 }, (_, i) => {
        const x = 38.5 + i * 4;
        return `<path d="M${x} 83.6Q${x + 2} 81.2 ${x + 4} 83.6" fill="none" ${ink}/>`;
      }).join('');
      return (
        `<path d="${body('Q50.5 84 61 78.5')}" fill="${dress.cloth}" ${ink}/>` +
        hatch(body('Q50.5 84 61 78.5')) +
        wings +
        `<path d="M50.5 86V130" fill="none" ${ink}/>` +
        buttons +
        `<ellipse cx="50.5" cy="81" rx="15.5" ry="5.2" fill="${LINEN}" ${ink}/>` +
        ruffDetail
      );
    }
    case 'stock': {
      const collar = pair(`<path d="M31 83.5C33 79.5 36 76 39.5 74L43 81L36.5 86Z" fill="${shade}" ${ink}/>`);
      const waistcoat = `<path d="M44 85L57 85L59.5 130L41.5 130Z" fill="${dress.trim}" ${ink}/>`;
      const buttons = fine ? [101, 108].map((y) => `<circle cx="50.5" cy="${y}" r="1.1" fill="${dress.metal}" ${ink}/>`).join('') : '';
      const stock = `<path d="M39.5 76Q50.5 80.5 61.5 76L61 82Q50.5 86.5 40 82Z" fill="${LINEN}" ${ink}/>`;
      const jabot = `<path d="M46 84Q50.5 82 55 84L53.5 96Q50.5 98.5 47.5 96Z" fill="${LINEN}" ${ink}/>`;
      return (
        `<path d="${body('Q50.5 82 61 78.5')}" fill="${dress.cloth}" ${ink}/>` +
        hatch(body('Q50.5 82 61 78.5')) +
        waistcoat +
        buttons +
        collar +
        stock +
        jabot
      );
    }
    case 'jacket': {
      // Modern cloth is a dark suiting with only a hint of the house colour; the tie carries it.
      const cloth = mix(dress.cloth, INK, 0.55);
      const shirt = `<path d="M40 78.5L61 78.5L55.5 104L50.5 111L45.5 104Z" fill="${LINEN}" ${ink}/>`;
      const lapel = pair(`<path d="M36.5 83.5L44.5 89L50.5 111L46.5 111L38.5 97.5L41 95.5Z" fill="${mix(cloth, '#ffffff', 0.08)}" ${ink}/>`);
      const tie =
        sex === 'm'
          ? `<path d="M48.6 84.5L52.4 84.5L53.2 87.5L52.6 88.2L54 104L50.5 108L47 104L48.4 88.2L47.8 87.5Z" fill="${dress.trim}" ${ink}/>`
          : '';
      const collar =
        sex === 'm'
          ? pair(`<path d="M40.3 78L50.5 83L46 89.5L38.2 84Z" fill="${LINEN}" ${ink}/>`)
          : pair(`<path d="M40.3 78Q37.5 86 44.5 88Q49.5 88.5 50.5 82.5Z" fill="${LINEN}" ${ink}/>`);
      return (
        `<path d="${body('Q50.5 82 61 78.5')}" fill="${cloth}" ${ink}/>` +
        hatch(body('Q50.5 82 61 78.5')) +
        shirt +
        tie +
        collar +
        lapel
      );
    }
  }
}

/** Patterns the attire refers to, once per drawing. */
export function attireDefs(): string {
  return (
    `<pattern id="hatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">` +
    `<path d="M0 .6H2.4" stroke="${INK}" stroke-width=".55" stroke-opacity=".55"/></pattern>` +
    `<linearGradient id="sidesG" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
    `<mask id="sides" maskUnits="userSpaceOnUse" x="-20" y="0" width="141" height="130"><rect x="-20" y="0" width="141" height="130" fill="url(#sidesG)"/></mask>`
  );
}
