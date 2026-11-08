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
    /**
     * Heraldry v2. When present it is the design and the fields above are its nearest v1 summary,
     * kept so older readers (and the dominant-colour helpers) still work. Absent: the v1 fields are the design.
     */
    v2?: ArmsV2;
  };
  founder?: string; // person id
}

export type Tincture = 'or' | 'argent' | 'gules' | 'azure' | 'vert' | 'sable' | 'purpure';

// ---------- Heraldry v2 (additive: every v1 coat of arms is still valid as it is) ----------

/** Stains: the rarer colours. They count as colours for the rule of tincture. */
export type Stain = 'murrey' | 'sanguine' | 'tenne' | 'carnation';
/** Furs, drawn as patterns. They may lie on metal or colour alike. */
export type Fur = 'ermine' | 'ermines' | 'erminois' | 'vair' | 'counter-vair' | 'potent';
/** Every tincture v2 can paint: the seven, the stains, the furs, and "proper" (a charge's natural colours). */
export type TinctureV2 = Tincture | Stain | Fur | 'proper';
export type ShieldShape = 'heater' | 'french' | 'iberian' | 'lozenge' | 'swiss' | 'kite';
export type PartitionLine = 'straight' | 'wavy' | 'indented' | 'embattled' | 'engrailed' | 'invected' | 'nebuly' | 'dancetty';
export type FieldDivision =
  | 'plain' | 'per-pale' | 'per-fess' | 'per-bend' | 'per-bend-sinister' | 'per-saltire' | 'quarterly' | 'per-chevron'
  | 'per-pall' | 'tierced-pale' | 'tierced-fess' | 'gyronny' | 'paly' | 'barry' | 'bendy' | 'bendy-sinister' | 'chequy'
  | 'lozengy' | 'fusilly';
export type OrdinaryKind =
  | 'chief' | 'base' | 'fess' | 'pale' | 'bend' | 'bend-sinister' | 'chevron' | 'cross' | 'saltire' | 'pall' | 'bordure'
  | 'orle' | 'canton' | 'pile' | 'quarter';
/** How several charges stand. `auto` picks the usual one for the count and the ordinaries around them. */
export type ChargeArrangement =
  | 'auto' | 'pale' | 'fess' | 'bend' | 'bend-sinister' | 'two-one' | 'one-two' | 'two-two' | 'saltire' | 'cross'
  | 'three-two-one' | 'orle' | 'seme';
export type HelmRank = 'none' | 'esquire' | 'knight' | 'peer' | 'royal';

export interface ArmsV2 {
  shield: ShieldShape;
  field: {
    division: FieldDivision;
    /** One for a plain field, two for most divisions, three for per pall and the tierced ones. */
    tinctures: TinctureV2[];
    line: PartitionLine;
    /** Paly, barry and bendy: how many pieces (4–10). Absent: 6. */
    pieces?: number;
  };
  /** Ordinaries and charges, painted in this order over the field. */
  layers: ArmsLayer[];
  /** The full achievement. Only drawn where a caller asks for it; small shields stay shield only. */
  achievement?: Achievement;
}

export type ArmsLayer = OrdinaryLayer | ChargeLayer;

export interface OrdinaryLayer {
  type: 'ordinary';
  kind: OrdinaryKind;
  tincture: TinctureV2;
  line: PartitionLine;
  /** Thin bands either side (fess, pale, bend, bend sinister, chevron). */
  cotised?: boolean;
  /** Takes the opposite tincture of the field division beneath each part. */
  counterchanged?: boolean;
}

export interface ChargeLayer {
  type: 'charge';
  /** A charge id from the heraldry catalogue, e.g. "lion", "mullet", "mill-wheel". */
  charge: string;
  tincture: TinctureV2;
  /** 1–9; ignored for semé. */
  count: number;
  arrangement: ChargeArrangement;
  /** Where the charges lie: on the field, on the ordinary just beneath this layer, in chief, or in base. */
  on: 'field' | 'ordinary' | 'chief' | 'base';
  /** Turned to face the sinister (the viewer's right). */
  contourne?: boolean;
  counterchanged?: boolean;
  /** Size relative to the usual, 0.6–1.4. Absent: 1. */
  scale?: number;
}

export interface Achievement {
  helm: HelmRank;
  /** Outside and lining. Absent: the field's first tincture and the first charge's. */
  mantling?: [TinctureV2, TinctureV2];
  /** A wreath of the two mantling tinctures under the crest. */
  torse?: boolean;
  crest?: { charge: string; tincture: TinctureV2 };
  /** Text on a scroll beneath the shield. */
  motto?: string;
  supporters?: { charge: string; tincture: TinctureV2 };
}

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
  look?: SeedLook;
  /** Everyday data. */
  nickname?: string;
  favourite?: string; // "Cheesecake, Dire Straits, gardening"
}

/**
 * How a person's generated portrait looks. `skin`, `hair` and `eyes` are palette indices (see
 * src/components/portrait/look.ts). Every other field is optional: absent means "automatic", chosen
 * from the person's sex, era and age, so older records stay valid and a fresh look ages with them.
 */
export interface SeedLook {
  /** Skin tone: 0–5 fair to deep, 6 porcelain, 7 deepest, 8 neutral parchment (not recorded). */
  skin: number;
  /** Natural hair colour, 0–9. Greying with age is applied on top unless `hairGreys` is false. */
  hair: number;
  /** Eye colour, 0–6. */
  eyes: number;
  /** Older records: true means bearded, false clean-shaven. `beardStyle` wins when set. */
  beard?: boolean;
  headwear?: Headwear;
  hairStyle?: HairStyle;
  /** False keeps the natural colour into old age. */
  hairGreys?: boolean;
  beardStyle?: BeardStyle;
  moustache?: MoustacheStyle;
  brows?: BrowStyle;
  glasses?: GlassesStyle;
  /** Overrides the era's clothing. */
  clothing?: ClothingStyle;
  /** Freckles and similar marks; an empty list means none (absent means automatic). */
  marks?: Mark[];
  /** The age the portrait shows. Absent: age at death, or today's age for the living. */
  age?: number;
}

export type Headwear =
  | 'none' | 'crown' | 'circlet' | 'mitre' | 'veil' | 'wimple' | 'hood' | 'coif' | 'beret' | 'mobcap' | 'tricorn'
  | 'tophat' | 'bonnet' | 'flatcap' | 'fedora' | 'cloche' | 'headscarf' | 'beanie';
export type HairStyle =
  | 'tuft' | 'cropped' | 'short' | 'side-part' | 'swept' | 'curly' | 'afro' | 'quiff' | 'bowl' | 'shoulder' | 'long'
  | 'wavy' | 'braid' | 'bun' | 'chignon' | 'bob' | 'pixie' | 'ponytail' | 'pigtails' | 'periwig' | 'powdered'
  | 'receding' | 'bald';
export type BeardStyle = 'none' | 'stubble' | 'short' | 'full' | 'long' | 'goatee' | 'vandyke' | 'muttonchops';
export type MoustacheStyle = 'none' | 'thin' | 'chevron' | 'handlebar' | 'walrus';
export type BrowStyle = 'soft' | 'straight' | 'arched' | 'thick' | 'thin' | 'bushy';
export type GlassesStyle = 'none' | 'round' | 'oval' | 'square' | 'browline' | 'half';
export type ClothingStyle =
  | 'tunic' | 'cotehardie' | 'gown' | 'doublet' | 'bodice' | 'ruff' | 'lace-collar' | 'coat' | 'stays' | 'frock'
  | 'victorian' | 'suit' | 'blouse' | 'suit-slim' | 'pearls' | 'shirt' | 'turtleneck' | 'sweater' | 'tshirt'
  | 'hoodie' | 'cardigan' | 'smock' | 'sailor' | 'pinafore' | 'knit' | 'stripes' | 'onesie';
export type Mark = 'freckles' | 'mole' | 'blush' | 'dimples' | 'scar';

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
