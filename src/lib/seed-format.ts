// The JSON shape every seed source produces (generated realm, generated modern family, the real
// Smith archive). scripts/seed.ts loads one of these into its own SQLite file in data/.
//
// Dates are partial ISO strings: "1153", "1153-06", "1153-06-14". Approximate dates are prefixed
// with "~" ("~1153"). Absent means unknown.

export interface SeedTree {
  /** Short id used in URLs and as the database file name, e.g. "realm". */
  id: string;
  name: string;
  /** One line shown in the tree switcher. */
  tagline: string;
  /** Which theme the tree opens in by default. */
  theme: 'codex' | 'modern';
  houses: SeedHouse[];
  people: SeedPerson[];
  parents: SeedParent[];
  unions: SeedUnion[];
  stories: SeedStory[];
  contacts: SeedContact[];
  /** Coordinates for the place names used above, for the Atlas. Optional per place. */
  places?: SeedPlace[];
  /** The person the tree opens on (the "player character"). */
  focus: string;
}

export interface SeedHouse {
  id: string;
  name: string; // "House Valcourt" or "Smith"
  motto?: string;
  /** Procedural heraldry, rendered as SVG by the app. */
  arms: {
    field: Tincture;
    /** Optional second tincture for divided fields. */
    field2?: Tincture;
    division: 'plain' | 'per-pale' | 'per-fess' | 'per-bend' | 'quarterly' | 'chevron' | 'paly' | 'bendy' | 'saltire' | 'cross';
    charge: 'none' | 'lion' | 'eagle' | 'tower' | 'star' | 'crescent' | 'fleur' | 'key' | 'rose' | 'boar' | 'stag' | 'sword';
    chargeTincture: Tincture;
  };
  founder?: string; // person id
}

export type Tincture = 'or' | 'argent' | 'gules' | 'azure' | 'vert' | 'sable' | 'purpure';

export interface SeedPerson {
  id: string;
  given: string;
  surname?: string;
  house?: string; // house id
  sex?: 'm' | 'f' | 'x';
  born?: string;
  bornPlace?: string;
  died?: string;
  diedPlace?: string;
  /** False or absent with a death date means deceased; true means living. */
  living?: boolean;
  /** "the Bold", "the Pious" */
  epithet?: string;
  /** "King of Aquitaine", "Abbess of Fontevraud", "Rechtsanwältin" */
  title?: string;
  occupation?: string;
  /** Markdown biography. */
  bio?: string;
  /** Traits shown as small badges, CK3-style: "brave", "pious", "scholar", "gardener" ... */
  traits?: string[];
  /** Seed for the procedural portrait. */
  look?: { skin: number; hair: number; eyes: number; beard?: boolean; headwear?: 'crown' | 'circlet' | 'mitre' | 'veil' | 'hood' | 'none' };
  /** Everyday data. */
  nickname?: string;
  favourite?: string; // "Cheesecake, Dire Straits, gardening"
}

export interface SeedPlace {
  name: string;
  lat: number;
  lng: number;
  /** Two-letter country code, lower case. */
  country?: string;
}

export interface SeedParent {
  child: string;
  parent: string;
  kind?: 'biological' | 'adoptive' | 'foster' | 'step';
  /** For uncertain or disputed claims. */
  confidence?: 'certain' | 'probable' | 'disputed';
}

export interface SeedUnion {
  id: string;
  a: string;
  b: string;
  kind?: 'marriage' | 'partnership' | 'betrothal';
  start?: string;
  end?: string;
  endReason?: 'death' | 'divorce' | 'annulment' | 'separation';
  place?: string;
}

/** Wiki-style contributions about a person: what relatives add over time. */
export interface SeedStory {
  id: string;
  person: string;
  kind: 'note' | 'quote' | 'anecdote' | 'recipe' | 'memory';
  title?: string;
  body: string; // Markdown
  /** Display name of whoever contributed it ("Aunt Gisla", "Chronicle of Saint-Maixent"). */
  author: string;
  /** ISO datetime of the contribution. */
  at: string;
  /** For quotes: when/where it was said. */
  context?: string;
}

export interface SeedContact {
  person: string;
  kind: 'phone' | 'email' | 'address' | 'web' | 'messenger';
  label?: string; // "mobile", "home", "Signal"
  value: string;
}
