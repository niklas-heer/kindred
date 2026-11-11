// Invented names for the campaign: marches that fill a map when the family has too few places, and regent companies
// that fill a reign's four sides when the family has fewer houses. They are names, so they are the same
// in every language, and none of them is a real family's.
import type { House } from '../types.ts';

/** Marches for a map with too few real places. */
export const MARCH_NAMES: readonly string[] = [
  'Ravenmoor', 'Thornwick', 'Eldermark', 'Greyfen', 'Ashby Cross', 'Winterhollow', 'Marrowdale', 'Stagsreach', 'Oldmill',
  'Kestrel Down', 'Brackenford', 'Highmere', 'Lowen Weir', 'Dunmarrow', 'Saltmarsh', 'Fallowfield', 'Hartsease',
  'Ember Tor', 'Wyrmwater', 'Linden Rise', 'Corbel Heath', 'Mistral Gap', 'Oxbow', 'Quillon',
];

export interface Rival { id: string; name: string; arms: House['arms'] }

/** Companies a regent always plays. Their ids start with `rival:`, which no house's id does. */
export const RIVALS: readonly Rival[] = [
  { id: 'rival:greywatch', name: 'The Greywatch', arms: { field: 'sable', division: 'chevron', field2: 'argent', charge: 'tower', chargeTincture: 'argent' } },
  { id: 'rival:marchwardens', name: 'The Marchwardens', arms: { field: 'vert', division: 'per-pale', field2: 'or', charge: 'stag', chargeTincture: 'sable' } },
  { id: 'rival:emberguard', name: 'The Emberguard', arms: { field: 'gules', division: 'per-fess', field2: 'sable', charge: 'sword', chargeTincture: 'or' } },
  { id: 'rival:tidereeves', name: 'The Tidereeves', arms: { field: 'azure', division: 'per-bend', field2: 'argent', charge: 'star', chargeTincture: 'or' } },
];

export const isRival = (side: string) => side.startsWith('rival:');
