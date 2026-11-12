// Invented names for the campaign: the continent, its provinces, towns and seas, built from syllables in one old-world
// flavour, and the regent companies that fill a reign's four sides when the family has fewer houses. They are names, so
// they are the same in every language. None of them is a real family's, and none is a real place: every name the
// generator can make is listed by `everyName`, which the tests check against the names in DENIED (the ones the whole
// list shared with the GeoNames gazetteer when it was last compared, see docs/campaign.md) and against rude words.
import type { House } from '../types.ts';

/** How a root begins and ends: "Kel" + "an" is Kelan. Every pair is a root, so the list of all names is finite. */
const HEADS: readonly string[] = [
  'Al', 'Ar', 'Bel', 'Bran', 'Cael', 'Cor', 'Dar', 'Dun', 'El', 'Fal', 'Gar', 'Hal', 'Isk', 'Kel', 'Lor', 'Maer', 'Mor',
  'Nar', 'Or', 'Pen', 'Rav', 'Sel', 'Tal', 'Tor', 'Ul', 'Val', 'Ves', 'Wen', 'Yr', 'Zan',
];
const TAILS: readonly string[] = ['an', 'en', 'in', 'ar', 'er', 'or', 'eth', 'and', 'end', 'ost', 'ir', 'un', 'yn', 'ath'];

/** What a name is for. A province is named after its land; a town after what it is. */
export type NameKind = 'plains' | 'forest' | 'highland' | 'marsh' | 'seat' | 'haven' | 'town' | 'continent' | 'sea';

const ENDS: Record<NameKind, readonly string[]> = {
  plains: ['mark', 'vale', 'lea', 'reach', 'march', 'garth'],
  forest: ['wold', 'holt', 'weald', 'shaw', 'hurst'],
  highland: ['fell', 'tor', 'crag', 'scar', 'rigg', 'howe'],
  marsh: ['fen', 'mire', 'mere', 'moss', 'carr'],
  // A seat is a castle; a haven is a town on the coast; a town is any other.
  seat: ['hold', 'gard', 'keep'],
  haven: ['haven', 'mouth', 'strand'],
  town: ['stead', 'wick', 'ford', 'gate'],
  continent: ['ia', 'or', 'ael', 'une'],
  sea: ['um', 'is', 'ium'],
};

/**
 * Names the generator could make that are a real place's (compared with GeoNames cities500, every spelling, folded) or
 * that read badly. They are never dealt. Add to it; never take from it.
 */
export const DENIED: ReadonlySet<string> = new Set<string>([
  'Alania', 'Aleria', 'Araria', 'Faleria', 'Moreria', 'Orania', 'Oriria', 'Selinia', 'Valoria',
  'Mare Alanis', 'Mare Alostum', 'Mare Alunis', 'Mare Arandis', 'Mare Arinis', 'Mare Belaris', 'Mare Belinum', 'Mare Lorandium', 'Mare Toranum',
]);

/** Letters in a row that no name may hold, in English, German or Afrikaans. */
const RUDE = /ass(?![a-z])|arse|anal|anus|cum|cock|dick|fuc|fuk|shit|piss|tit|nazi|hure|fick|kack|arsch|poes|kak|kont|naai|moer|slut|fag|rape|hell(?![a-z])|damn|dung|sex|pedo|turd|puss|wank|bitch|hitler|stalin|kill|dead|dood|tod(?![a-z])|mord/i;

const joined = (root: string, end: string) => {
  // No letter three times in a row, and no doubled letter at the seam that the end did not ask for ("Kelan" + "ia").
  const seam = root.at(-1) === end[0] ? root + end.slice(1) : root + end;
  return seam.replace(/(.)\1\1/g, '$1$1');
};

const made = (kind: NameKind, root: string, end: string) => (kind === 'sea' ? `Mare ${joined(root, end)}` : joined(root, end));

/** Whether a name may be dealt: not a real place's, and nothing rude in it. */
export const allowed = (name: string) => !DENIED.has(name) && !RUDE.test(name.replace(/^Mare /, ''));

/** Every name the generator can make for a kind, allowed or not: what the tests and the gazetteer comparison read. */
export function everyName(kind: NameKind): string[] {
  const out: string[] = [];
  for (const head of HEADS) for (const tail of TAILS) for (const end of ENDS[kind]) out.push(made(kind, head + tail, end));
  return out;
}

export const NAME_KINDS = Object.keys(ENDS) as NameKind[];

/**
 * A name of this kind, dealt by `random`, that is allowed, not in `taken`, and whose root no name in `taken` has: two
 * provinces of one map never read alike ("Kelanmark" beside "Kelanwold"). `taken` is added to.
 */
export function dealName(kind: NameKind, random: () => number, taken: Set<string>, roots: Set<string>): string {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  for (let tries = 0; tries < 400; tries++) {
    const head = pick(HEADS);
    const root = head + pick(TAILS);
    const name = made(kind, root, pick(ENDS[kind]));
    // After many tries a head may be used twice, but never a whole root.
    if (!allowed(name) || taken.has(name) || roots.has(root) || (tries < 200 && roots.has(head))) continue;
    taken.add(name);
    roots.add(root);
    roots.add(head);
    return name;
  }
  // Out of names: cannot happen with a map's two dozen, but a name must still come back.
  const spare = `${made(kind, 'Kelan', ENDS[kind][0])} ${taken.size + 1}`;
  taken.add(spare);
  return spare;
}

export interface Rival { id: string; name: string; arms: House['arms'] }

/** Companies a regent always plays. Their ids start with `rival:`, which no house's id does. */
export const RIVALS: readonly Rival[] = [
  { id: 'rival:greywatch', name: 'The Greywatch', arms: { field: 'sable', division: 'chevron', field2: 'argent', charge: 'tower', chargeTincture: 'argent' } },
  { id: 'rival:marchwardens', name: 'The Marchwardens', arms: { field: 'vert', division: 'per-pale', field2: 'or', charge: 'stag', chargeTincture: 'sable' } },
  { id: 'rival:emberguard', name: 'The Emberguard', arms: { field: 'gules', division: 'per-fess', field2: 'sable', charge: 'sword', chargeTincture: 'or' } },
  { id: 'rival:tidereeves', name: 'The Tidereeves', arms: { field: 'azure', division: 'per-bend', field2: 'argent', charge: 'star', chargeTincture: 'or' } },
];

export const isRival = (side: string) => side.startsWith('rival:');
