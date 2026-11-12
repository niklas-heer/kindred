// Invented names for the campaign: the continent, its provinces, towns and seas, and the regent companies that fill a
// reign's four sides when the family has fewer houses. They are names, so they are the same in every language.
//
// A name is a root and an ending. The root is two syllables from two banks that share nothing: a head with a cluster of
// its own ("Drev", "Isk", "Maer") and a heavy tail ("ost", "und", "eth"), so a root does not read like a given name the
// way "Alan" or "Elin" would. A province carries its ending after a hyphen ("Drevost-fell"), which keeps the two parts
// apart to the eye; the continent and the seas take a vowel ending ("Drevostune", "Mare Drevostum").
//
// None of them is meant to be a real family's, a real place's or a well-known invented one. Every name the generator can
// make is listed by `everyName`, and ./names.test.ts compares the whole list with the names in ./known-names.ts (invented
// worlds, given names, Europe's regions), with GeoNames when the file is at hand, and with a list of rude letter runs.
// What those found is in DENIED and DENIED_ROOTS, and is never dealt. See docs/campaign.md.
import type { House } from '../types.ts';

/** How a root begins. No two heads begin with the same three letters, so no two provinces read alike. */
const HEADS: readonly string[] = [
  'Arv', 'Cael', 'Dalv', 'Drev', 'Fenn', 'Fyr', 'Gorl', 'Grisk', 'Hald', 'Holv', 'Hurn', 'Isk', 'Jorv', 'Kell', 'Lund', 'Maer',
  'Mern', 'Nev', 'Orm', 'Pryd', 'Rusk', 'Selk', 'Skar', 'Tarn', 'Thal', 'Ulv', 'Vosk', 'Vyrn', 'Wend', 'Wulm', 'Yarl', 'Zeth',
];
/**
 * Heads that were dealt once and are not any more, because each is the beginning of names everybody knows: "Bran" is a
 * Stark of Westeros, "Dun" begins Dunland, Dunharrow and the Dúnedain, "Eld" the Eldar, Eldamar and Hyrule's Eldin,
 * "Nym" Nymeria, and "Quen" is Quenya, the Quendi and a sign in the Witcher's world. Kept so that nobody puts them
 * back, and so that the roots denied while they were dealt still read as roots. Add to it; never take from it.
 */
export const RETIRED_HEADS: readonly string[] = ['Bran', 'Dun', 'Eld', 'Nym', 'Quen'];
/** How a root ends. None is an ending given names have ("-an", "-en", "-in", "-ar", "-er"). */
const TAILS: readonly string[] = ['eth', 'ost', 'ath', 'und', 'or', 'ir', 'esk', 'orn', 'oss', 'urn', 'uth', 'ard', 'ald'];

/** What a name is for. A province is named after its land; a town after what it is. */
export type NameKind = 'plains' | 'forest' | 'highland' | 'marsh' | 'seat' | 'haven' | 'town' | 'continent' | 'sea';

const ENDS: Record<NameKind, readonly string[]> = {
  plains: ['mark', 'vale', 'lea', 'reach', 'march', 'garth'],
  forest: ['wold', 'holt', 'weald', 'shaw', 'hurst'],
  highland: ['fell', 'tor', 'crag', 'scar', 'rigg', 'howe'],
  marsh: ['fen', 'mire', 'mere', 'moss', 'carr'],
  // A seat is a castle; a haven is a town on the coast; a town is any other.
  seat: ['hold', 'gard', 'keep'],
  haven: ['haven', 'mouth', 'hythe'],
  town: ['stead', 'wick', 'ford', 'gate'],
  continent: ['ael', 'une', 'ane', 'ea'],
  sea: ['um', 'is', 'ium'],
};

/** The kinds whose ending is joined to the root itself; every other kind carries it after a hyphen. */
const FUSED: ReadonlySet<NameKind> = new Set<NameKind>(['continent', 'sea']);

/**
 * Roots that are never dealt, whatever their ending: a known name ("Haldir"), one letter from one ("Garneth", "Dunald"),
 * a word, or simply ugly. Add to it; never take from it.
 */
export const DENIED_ROOTS: ReadonlySet<string> = new Set<string>([
  // A known name, or one letter from one (the name it is near is in ./known-names.ts).
  'Arvor', 'Arvir', 'Caelor', 'Caelir', 'Caelorn', 'Drevor', 'Dunald', 'Eldor', 'Eldir', 'Eldard', 'Fenneth', 'Fennor', 'Fennir', 'Fennard',
  'Haldeth', 'Haldor', 'Haldir', 'Jorveth', 'Lundir', 'Mernard', 'Ormund', 'Selkor', 'Tarneth', 'Tarnor', 'Thaleth', 'Wendor',
  // A real place's, or the beginning of one ("Selkirk").
  'Nevir', 'Selkir',
  // Found by reading the whole list again: Tarnost is a range of hills in Gondor and Thalath Dirnen a plain in Beleriand,
  // the Selkath are a people of Star Wars, and the rest are one letter from Gorlois, Jorvik, the Thalmor and Jarlath.
  'Tarnost', 'Thalath', 'Selkath', 'Gorloss', 'Jorvir', 'Thalor', 'Yarlath', 'Arvald',
  // And one letter from those, or from Gorlim, Haldar and the Daleks' Skaro, which three roots began with.
  'Tarnoss', 'Thaluth', 'Selketh', 'Selkuth', 'Gorlir', 'Haldard', 'Skarost', 'Skarorn', 'Skaross',
  // One letter from the given names Halvard and Halvor.
  'Dalvard', 'Dalvor', 'Holvard', 'Holvor',
]);

/**
 * Whole names that are never dealt: a real place's (compared with GeoNames cities500, every spelling, folded) or a known
 * name's. Add to it; never take from it.
 */
export const DENIED: ReadonlySet<string> = new Set<string>([]);

/** Letters in a row that no name may hold, in English, German or Afrikaans. */
const RUDE = /ass(?![a-z])|arse|anal|anus|cum|cock|dick|fuc|fuk|shit|piss|tit|nazi|hure|fick|kack|arsch|poes|kak|kont|naai|moer|slut|fag|rape|hell(?![a-z])|damn|dung|sex|pedo|turd|puss|wank|bitch|hitler|stalin|kill|dead|dood|tod(?![a-z])|mord/i;

const VOWEL = /[aeiouy]/;
/** A syllable's last vowel and the consonants after it. */
const rime = (syllable: string) => {
  const s = syllable.toLowerCase();
  let i = s.length - 1;
  while (i > 0 && !VOWEL.test(s[i])) i--;
  return { vowel: s[i], coda: s.slice(i + 1) };
};

/** Whether a head and a tail jar: they end alike ("Lund-und", "Skar-or"), or the tail repeats the head ("Orm-orn"). */
const jars = (head: string, tail: string) => {
  const h = rime(head), t = rime(tail);
  return h.coda === t.coda || (h.vowel === t.vowel && h.coda[0] === t.coda[0]);
};

/** Whether a word is a root, of today's heads or of the retired ones: a head and a tail. What the test of DENIED_ROOTS reads. */
export const isRoot = (word: string) => [...HEADS, ...RETIRED_HEADS].some((head) => word.startsWith(head) && TAILS.includes(word.slice(head.length)));

/** Every root: each head with each tail it does not jar with. So the list of all names is finite. */
const ROOTS: readonly string[] = HEADS.flatMap((head) => TAILS.filter((tail) => !jars(head, tail)).map((tail) => head + tail));

const made = (kind: NameKind, root: string, end: string) => {
  if (!FUSED.has(kind)) return `${root}-${end}`;
  // No doubled letter at the seam that the ending did not ask for.
  const fused = root.at(-1) === end[0] ? root + end.slice(1) : root + end;
  return kind === 'sea' ? `Mare ${fused}` : fused;
};

/** Whether a name made from this root may be dealt: nothing denied, nothing rude. */
const fair = (root: string, name: string) => !DENIED_ROOTS.has(root) && !DENIED.has(name) && !RUDE.test(name.replace(/^Mare /, ''));

/** A name the generator can make, with what it was made from. */
export interface MadeName { name: string; root: string; kind: NameKind; allowed: boolean }

/** Every name the generator can make for a kind, allowed or not: what the tests and the gazetteer comparison read. */
export function everyMade(kind: NameKind): MadeName[] {
  return ROOTS.flatMap((root) => ENDS[kind].map((end) => { const name = made(kind, root, end); return { name, root, kind, allowed: fair(root, name) }; }));
}

export const everyName = (kind: NameKind): string[] => everyMade(kind).map((m) => m.name);

export const NAME_KINDS = Object.keys(ENDS) as NameKind[];

let dealable: Set<string> | undefined;
/** Whether a name may be dealt: one the generator makes, not a known or real name's, and nothing rude in it. */
export function allowed(name: string): boolean {
  dealable ??= new Set(NAME_KINDS.flatMap((kind) => everyMade(kind).filter((m) => m.allowed).map((m) => m.name)));
  return dealable.has(name);
}

/**
 * A name of this kind, dealt by `random`, that is allowed, not in `taken`, and whose head no name in `taken` has: two
 * provinces of one map never read alike ("Kellost-mark" beside "Kellund-wold"). `taken` and `roots` are added to.
 */
export function dealName(kind: NameKind, random: () => number, taken: Set<string>, roots: Set<string>): string {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  for (let tries = 0; tries < 400; tries++) {
    const head = pick(HEADS);
    const tail = pick(TAILS);
    const root = head + tail;
    const name = made(kind, root, pick(ENDS[kind]));
    // After many tries a head may be used twice, but never a whole root.
    if (jars(head, tail) || !fair(root, name) || taken.has(name) || roots.has(root) || (tries < 200 && roots.has(head))) continue;
    taken.add(name);
    roots.add(root);
    roots.add(head);
    return name;
  }
  // Out of names: cannot happen with a map's two dozen, but a name must still come back.
  const spare = `${made(kind, 'Kellost', ENDS[kind][0])} ${taken.size + 1}`;
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
