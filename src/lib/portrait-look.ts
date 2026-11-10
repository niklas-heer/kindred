// What a portrait shows, resolved from the person and their recorded look: age, era, presentation and
// every part. Recorded fields win; the rest is chosen deterministically from the person's id, so a
// portrait never changes between renders, and a person seen at another age stays recognisably them.
import type { Key } from '~/lib/i18n/dictionary';
import type {
  Backdrop, BeardStyle, BrowStyle, ClothingStyle, Earrings, Expression, Extra, EyeShape, FaceShape, GlassesStyle, HairStyle, Headwear, Mark,
  MoustacheStyle, Necklace, NoseShape,
} from '~/lib/seed-format';
import type { GPerson, Look } from '~/lib/types';

export type { EyeShape, FaceShape, NoseShape };
export type Stage = 'baby' | 'child' | 'teen' | 'adult' | 'middle' | 'elder';
export type Era = 'early-medieval' | 'high-medieval' | 'renaissance' | 'c17' | 'c18' | 'c19' | 'c1900' | 'c1945' | 'c1970' | 'c2000';
export type Presentation = 'm' | 'f' | 'x';

/** The face measures from 0 to 10, where 5 is the average (see SeedLook). */
export const LEVEL_KEYS = ['jaw', 'noseSize', 'mouthWidth', 'mouthFullness', 'eyeSize', 'eyeSpacing', 'browHeight', 'earSize', 'hairline'] as const;
export type LevelKey = typeof LEVEL_KEYS[number];
export type Features = Record<LevelKey, number>;

// ---------- Palettes (indices are stored in Look; never reorder, only append) ----------

/** Skin: 0–5 fair to deep (the original six), 6 porcelain, 7 deepest, 8 neutral parchment, 9–14 the tones between and beyond. */
export const SKIN = [
  '#f3d5bd', '#e8bd98', '#d39f75', '#b77d52', '#8f5c3a', '#6a4129', '#fae3d3', '#4b2c1d', '#e9d6b9',
  '#f4cfc2', '#ecd0a8', '#d0ae80', '#c08e58', '#7b4a35', '#33201a',
];
/** Lightest to deepest, for the editor's row of swatches. */
export const SKIN_ORDER = [6, 9, 0, 10, 1, 11, 2, 12, 3, 4, 13, 5, 7, 14];
export const SKIN_NEUTRAL = 8;
export const SKIN_LABELS: Key[] = [
  'look.skin.fair', 'look.skin.light', 'look.skin.light_medium', 'look.skin.medium', 'look.skin.brown', 'look.skin.deep',
  'look.skin.porcelain', 'look.skin.deepest', 'look.skin.neutral',
  'look.skin.rosy', 'look.skin.sand', 'look.skin.olive', 'look.skin.golden', 'look.skin.russet', 'look.skin.ebony',
];
/** Tones that most often come with textured hair, and tones that freckle: what the automatic parts go by. */
const DEEP_SKIN = new Set([4, 5, 7, 13, 14]);
const FAIR_SKIN = new Set([0, 1, 6, 9, 10]);

/** Hair colours: 0–9 the natural ones a person without a recorded colour is given, 10–15 dyed, 16–17 two more natural ones. */
export const HAIR = [
  '#2b201b', '#4a3226', '#6b462d', '#8a5631', '#a7783f', '#d2ac69', '#a3482a', '#e4cf9a', '#17151a', '#c66c2e',
  '#7d2438', '#e07aa8', '#3d6fb8', '#7b57b3', '#2f8c84', '#ece5d0', '#dba36a', '#7a6a58',
];
/** How many colours the automatic choice draws from. Never change it: people without a recorded colour would change hair. */
const HAIR_AUTO = 10;
export const HAIR_ORDER = [8, 0, 1, 2, 17, 3, 4, 9, 6, 16, 5, 7, 15];
export const HAIR_DYED = [10, 11, 13, 12, 14];
export const HAIR_LABELS: Key[] = [
  'look.hair_colour.black', 'look.hair_colour.dark_brown', 'look.hair_colour.brown', 'look.hair_colour.chestnut',
  'look.hair_colour.light_brown', 'look.hair_colour.blond', 'look.hair_colour.auburn', 'look.hair_colour.flaxen',
  'look.hair_colour.jet', 'look.hair_colour.copper',
  'look.hair_colour.burgundy', 'look.hair_colour.pink', 'look.hair_colour.blue', 'look.hair_colour.violet', 'look.hair_colour.teal',
  'look.hair_colour.platinum', 'look.hair_colour.strawberry', 'look.hair_colour.ash',
];

export const EYES = ['#4a2e1c', '#6f4b2a', '#7a6a3a', '#4f7a4a', '#4f7fae', '#7d8b96', '#2f2420', '#a8742a', '#8db4d6', '#3f8a86'];
/** As HAIR_AUTO: the automatic choice draws from the first seven. */
const EYES_AUTO = 7;
export const EYE_ORDER = [6, 0, 1, 7, 2, 3, 9, 4, 8, 5];
export const EYE_LABELS: Key[] = [
  'look.eye.brown', 'look.eye.light_brown', 'look.eye.hazel', 'look.eye.green', 'look.eye.blue', 'look.eye.grey', 'look.eye.dark',
  'look.eye.amber', 'look.eye.light_blue', 'look.eye.blue_green',
];

/** Lipstick. A look without `lips` has natural lips. */
export const LIPS = ['#c0332f', '#d4687a', '#b5614a', '#7a2b3d', '#e08a6a'];
export const LIP_LABELS: Key[] = ['look.lips.red', 'look.lips.rose', 'look.lips.terracotta', 'look.lips.plum', 'look.lips.coral'];

/** Frames of glasses. */
export const FRAMES = ['#3a2a22', '#a8802f', '#9aa0a6', '#7a4a26', '#b03a3a', '#35558a'];
export const FRAME_LABELS: Key[] = ['look.frames.dark', 'look.frames.gold', 'look.frames.silver', 'look.frames.tortoise', 'look.frames.red', 'look.frames.blue'];

/** Dyed cloth, for clothes, trims and hats: a little duller than paint, as the house colours are. */
export const CLOTH = [
  '#efe6d2', '#e0cfa2', '#9a9892', '#4a4a52', '#26242c', '#2c3a5a', '#3f6ea6', '#8fb5d6', '#2f7f7a', '#3f7a4a',
  '#6b6f3f', '#c9a03c', '#c9703a', '#a8343a', '#6f2434', '#d58a9e', '#6a4a8a', '#6e4b32', '#a8996e', '#6f7a6c',
];
export const CLOTH_LABELS: Key[] = [
  'look.cloth.white', 'look.cloth.cream', 'look.cloth.grey', 'look.cloth.charcoal', 'look.cloth.black', 'look.cloth.navy', 'look.cloth.blue',
  'look.cloth.sky', 'look.cloth.teal', 'look.cloth.green', 'look.cloth.olive', 'look.cloth.mustard', 'look.cloth.orange', 'look.cloth.red',
  'look.cloth.burgundy', 'look.cloth.pink', 'look.cloth.purple', 'look.cloth.brown', 'look.cloth.khaki', 'look.cloth.field_grey',
];

const GREY = '#b9b3aa';
const WHITE = '#ece8e0';
const POWDER = '#ebe6dc';

// ---------- Catalogues, for the editor ----------

/** A catalogue entry: its stored id, the i18n key of its label, and the group the editor lists it under. */
export type Opt<T extends string, G extends string = string> = { id: T; label: Key; group?: G };
const opts = <T extends string, G extends string>(group: G, ids: readonly T[], area: string): Opt<T, G>[] =>
  ids.map((id) => ({ id, label: `look.${area}.${id.replace(/-/g, '_')}` as Key, group }));

export type HairGroup = 'short' | 'medium' | 'long' | 'up' | 'textured' | 'thin' | 'period';
export const HAIR_STYLES: Opt<HairStyle, HairGroup>[] = [
  ...opts('short', ['buzz', 'cropped', 'short', 'side-part', 'swept', 'slicked', 'quiff', 'fade', 'pixie', 'bowl'] as const, 'hair'),
  ...opts('medium', ['bob', 'shoulder', 'mullet', 'curly'] as const, 'hair'),
  ...opts('long', ['long', 'fringe', 'wavy', 'curly-long'] as const, 'hair'),
  ...opts('up', ['ponytail', 'pigtails', 'braid', 'side-braid', 'crown-braid', 'bun', 'space-buns', 'chignon', 'beehive'] as const, 'hair'),
  ...opts('textured', ['coily', 'afro', 'locs', 'box-braids', 'cornrows'] as const, 'hair'),
  ...opts('thin', ['thinning', 'receding', 'bald'] as const, 'hair'),
  ...opts('period', ['periwig', 'powdered'] as const, 'hair'),
];
export const HAIR_GROUP_LABELS: Record<HairGroup, Key> = {
  short: 'look.group.hair_short', medium: 'look.group.hair_medium', long: 'look.group.hair_long', up: 'look.group.hair_up',
  textured: 'look.group.hair_textured', thin: 'look.group.hair_thin', period: 'look.group.hair_period',
};
export const BEARDS: Opt<BeardStyle>[] = opts('', ['none', 'stubble', 'short', 'full', 'long', 'goatee', 'circle', 'vandyke', 'soul-patch', 'chinstrap', 'sideburns', 'muttonchops'] as const, 'beard');
export const MOUSTACHES: Opt<MoustacheStyle>[] = opts('', ['none', 'thin', 'pencil', 'chevron', 'handlebar', 'imperial', 'horseshoe', 'walrus'] as const, 'moustache');
export const BROWS: Opt<BrowStyle>[] = opts('', ['soft', 'straight', 'arched', 'thick', 'thin', 'bushy'] as const, 'brows');
export const GLASSES: Opt<GlassesStyle>[] = opts('', ['none', 'round', 'oval', 'square', 'horn', 'browline', 'cat-eye', 'aviator', 'rimless', 'half', 'pince-nez', 'monocle', 'sunglasses'] as const, 'glasses');

export type HeadwearGroup = 'none' | 'everyday' | 'faith' | 'occasion' | 'work' | 'period' | 'realm';
export const HEADWEAR: Opt<Headwear, HeadwearGroup>[] = [
  ...opts('none', ['none'] as const, 'headwear'),
  ...opts('everyday', ['cap', 'beanie', 'sunhat', 'flatcap', 'beret', 'fedora', 'headband', 'bow', 'ushanka'] as const, 'headwear'),
  ...opts('faith', ['headscarf', 'hijab', 'headwrap', 'turban', 'kippah', 'kufi', 'veil', 'wimple', 'mitre'] as const, 'headwear'),
  ...opts('occasion', ['bridal-veil', 'flower-crown', 'tiara', 'mortarboard', 'tophat', 'boater'] as const, 'headwear'),
  ...opts('work', ['peaked-cap', 'hard-hat'] as const, 'headwear'),
  ...opts('period', ['bowler', 'cloche', 'bonnet', 'mobcap', 'tricorn', 'coif', 'hood'] as const, 'headwear'),
  ...opts('realm', ['crown', 'circlet'] as const, 'headwear'),
];
export const HEADWEAR_GROUP_LABELS: Record<HeadwearGroup, Key> = {
  none: 'look.group.none', everyday: 'look.group.everyday', faith: 'look.group.faith', occasion: 'look.group.occasion', work: 'look.group.work',
  period: 'look.group.period', realm: 'look.group.realm',
};
/** `coif` reads "Bonnet (Tudor)" and so on: a few labels predate the id-to-key rule and keep their keys. */

export type ClothingGroup = 'everyday' | 'best' | 'work' | 'traditional' | 'c19' | 'early' | 'children';
export const CLOTHING: Opt<ClothingStyle, ClothingGroup>[] = [
  ...opts('everyday', ['tshirt', 'shirt', 'polo', 'plaid', 'sweater', 'turtleneck', 'hoodie', 'cardigan', 'jacket', 'blouse', 'dress', 'stripes', 'knit'] as const, 'clothing'),
  ...opts('best', ['suit', 'suit-slim', 'waistcoat', 'tuxedo', 'pearls', 'wedding-dress'] as const, 'clothing'),
  ...opts('work', ['apron', 'overalls', 'white-coat', 'uniform', 'clerical'] as const, 'clothing'),
  ...opts('traditional', ['dirndl', 'folk-vest', 'kimono', 'sari', 'kurta', 'kaftan'] as const, 'clothing'),
  ...opts('c19', ['frock', 'victorian', 'coat', 'stays'] as const, 'clothing'),
  ...opts('early', ['tunic', 'cotehardie', 'gown', 'doublet', 'bodice', 'ruff', 'lace-collar'] as const, 'clothing'),
  ...opts('children', ['smock', 'sailor', 'pinafore', 'onesie'] as const, 'clothing'),
];
export const CLOTHING_GROUP_LABELS: Record<ClothingGroup, Key> = {
  everyday: 'look.group.everyday', best: 'look.group.best', work: 'look.group.work', traditional: 'look.group.traditional',
  c19: 'look.group.c19', early: 'look.group.early', children: 'look.group.children',
};
export const MARKS: Opt<Mark>[] = opts('', ['freckles', 'blush', 'dimples', 'mole', 'birthmark', 'vitiligo', 'cleft', 'scar', 'cheek-scar', 'lashes'] as const, 'mark');
export const FACE_SHAPES: Opt<FaceShape>[] = opts('', ['round', 'oval', 'square', 'long', 'heart', 'diamond', 'pear'] as const, 'face');
export const NOSE_SHAPES: Opt<NoseShape>[] = opts('', ['straight', 'aquiline', 'broad', 'snub', 'round', 'narrow'] as const, 'nose');
export const EYE_SHAPES: Opt<EyeShape>[] = opts('', ['round', 'almond', 'hooded', 'monolid', 'downturned'] as const, 'eyeshape');
export const EXPRESSIONS: Opt<Expression>[] = opts('', ['calm', 'smile', 'grin', 'stern'] as const, 'expression');
export const EARRINGS: Opt<Earrings>[] = opts('', ['none', 'studs', 'hoops', 'drops', 'pearls'] as const, 'earrings');
export const NECKLACES: Opt<Necklace>[] = opts('', ['none', 'chain', 'pendant', 'cross', 'pearls', 'beads'] as const, 'necklace');
export const EXTRAS: Opt<Extra>[] = opts('', ['hearing-aid', 'flower', 'brooch', 'medal', 'scarf', 'pipe', 'bindi', 'nose-stud'] as const, 'extra');
export const BACKDROPS: Opt<Backdrop>[] = opts('', ['plain', 'house', 'rays', 'drape', 'books', 'sky', 'hills', 'garden', 'sea', 'night'] as const, 'backdrop');
/** The names of the levels that are not face measures: greying and lines of age, 0 to 3. */
export const GREY_LABELS: Key[] = ['look.grey.none', 'look.grey.some', 'look.grey.grey', 'look.grey.white'];
export const LINES_LABELS: Key[] = ['look.lines.smooth', 'look.lines.hint', 'look.lines.lined', 'look.lines.deep'];
/** The labels of the numeric features, for the editor's sliders. */
export const LEVEL_LABELS: Record<LevelKey, Key> = {
  jaw: 'look.level.jaw', noseSize: 'look.level.nose_size', mouthWidth: 'look.level.mouth_width', mouthFullness: 'look.level.mouth_fullness',
  eyeSize: 'look.level.eye_size', eyeSpacing: 'look.level.eye_spacing', browHeight: 'look.level.brow_height', earSize: 'look.level.ear_size',
  hairline: 'look.level.hairline',
};


// ---------- Helpers ----------

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A stable number in [0, 1) for this person and slot. */
const roll = (id: string, slot: string) => hash(`${id}:${slot}`) / 4294967296;
const pick = <T,>(id: string, slot: string, xs: readonly T[]): T => xs[hash(`${id}:${slot}`) % xs.length];

export const yearOf = (s?: string) => {
  const m = s?.match(/\d{3,4}/);
  return m ? Number(m[0]) : undefined;
};

export function stageOf(age: number): Stage {
  return age <= 3 ? 'baby' : age <= 12 ? 'child' : age <= 19 ? 'teen' : age < 45 ? 'adult' : age < 65 ? 'middle' : 'elder';
}

export function eraOf(year: number): Era {
  return year < 1150 ? 'early-medieval' : year < 1450 ? 'high-medieval' : year < 1600 ? 'renaissance' : year < 1700 ? 'c17'
    : year < 1800 ? 'c18' : year < 1900 ? 'c19' : year < 1945 ? 'c1900' : year < 1970 ? 'c1945' : year < 2000 ? 'c1970' : 'c2000';
}
export const ERA_LABELS: Record<Era, Key> = {
  'early-medieval': 'look.era.early_medieval', 'high-medieval': 'look.era.high_medieval', renaissance: 'look.era.renaissance',
  c17: 'look.era.c17', c18: 'look.era.c18', c19: 'look.era.c19', c1900: 'look.era.c1900', c1945: 'look.era.c1945',
  c1970: 'look.era.c1970', c2000: 'look.era.c2000',
};

const MEDIEVAL = new Set<Era>(['early-medieval', 'high-medieval']);

/** The age the portrait shows: a fixed age, else age at death, else today's age. */
export function shownAge(p: GPerson, now: number, at?: number): number | undefined {
  if (at !== undefined) return at;
  if (p.look?.age !== undefined) return p.look.age;
  const born = yearOf(p.born);
  if (born === undefined) return undefined;
  const end = yearOf(p.died) ?? (p.living ? now : undefined);
  return end === undefined ? undefined : Math.max(0, end - born);
}

// ---------- The resolved appearance ----------

export interface Appearance {
  stage: Stage;
  age: number;
  era: Era;
  pres: Presentation;
  face: FaceShape;
  skin: string;
  hair: string;
  /** The natural colour, for brows that grey later than the hair. */
  hairBase: string;
  hairStyle: HairStyle;
  brows: BrowStyle;
  eyes: string;
  beard: BeardStyle;
  moustache: MoustacheStyle;
  glasses: GlassesStyle;
  headwear: Headwear;
  clothing: ClothingStyle;
  marks: Mark[];
  /** 0 smooth, 1 a hint, 2 lined, 3 deeply lined. */
  lines: number;
  /** Mouth style, 0–3: a closed smile, full lips, an open smile, a thin line. */
  mouth: number;
  noseShape: NoseShape;
  eyeShape: EyeShape;
  /** The 0–10 measures, recorded or automatic. */
  feat: Features;
  /*
   * The parts below come only from a recorded look. Left out (or at their neutral value) they draw nothing, so a look
   * recorded before they existed draws as it always did.
   */
  /** A chosen expression; absent, the mouth above is drawn as it always was. */
  expression?: Expression;
  /** 0–10, 5 average. */
  build: number;
  /** Lipstick, as a colour. */
  lips?: string;
  earrings: Earrings;
  necklace: Necklace;
  extras: Extra[];
  /** Chosen colours: the frames of the glasses, the cloth, its trim and the headwear. Absent: as before. */
  frames?: string;
  cloth?: string;
  trim?: string;
  hat?: string;
  backdrop: Backdrop;
}

const NOSE_AUTO: NoseShape[] = ['straight', 'aquiline', 'broad', 'snub'];
const EYE_AUTO: EyeShape[] = ['round', 'almond', 'hooded'];

/** The automatic 0–10 measures for a person: a stable 2 to 8 around the average, from their id. */
export function autoFeatures(id: string): Features {
  const out = {} as Features;
  for (const k of LEVEL_KEYS) out[k] = 5 + Math.round((roll(id, `feat:${k}`) - 0.5) * 7);
  return out;
}

/** A 0–10 measure from the look, or its automatic value. */
function measure(look: Partial<Look>, id: string): Features {
  const auto = autoFeatures(id);
  const out = {} as Features;
  for (const k of LEVEL_KEYS) out[k] = look[k] ?? auto[k];
  return out;
}

/** Adult-only styles a child cannot have, with what they wear instead. */
const CHILD_HAIR: Partial<Record<HairStyle, HairStyle>> = {
  receding: 'short', bald: 'cropped', periwig: 'shoulder', powdered: 'short', quiff: 'swept', chignon: 'braid',
  thinning: 'short', slicked: 'side-part', beehive: 'bun',
};
/** Headwear a child or a teenager wears too. The rest is for grown-ups, and a child shown young wears none. */
const YOUNG_HEADWEAR = new Set<Headwear>([
  'circlet', 'bonnet', 'beanie', 'headscarf',
  'cap', 'sunhat', 'headband', 'bow', 'flower-crown', 'tiara', 'kippah', 'kufi', 'hijab', 'turban', 'headwrap', 'ushanka', 'mortarboard',
]);
/** Whether this headwear shows at this age: the editor says so when it does not. */
export const headwearShows = (h: Headwear, stage: Stage): boolean =>
  h === 'none' || stage === 'adult' || stage === 'middle' || stage === 'elder' || YOUNG_HEADWEAR.has(h);
/** Things only a grown-up carries. */
const ADULT_EXTRAS = new Set<Extra>(['pipe', 'medal']);

function autoHair(id: string, era: Era, stage: Stage, pres: Presentation, skin: number): HairStyle {
  const textured = DEEP_SKIN.has(skin);
  if (stage === 'baby') return 'tuft';
  if (stage === 'child') {
    const pre = era === 'early-medieval' || era === 'high-medieval' || era === 'renaissance';
    const m: HairStyle[] = pre ? ['bowl', 'short', 'curly'] : ['short', 'swept', 'curly', 'side-part'];
    const f: HairStyle[] = pre ? ['braid', 'long'] : era === 'c2000' || era === 'c1970' ? ['ponytail', 'pigtails', 'bob', 'long', 'curly'] : ['braid', 'pigtails', 'bob', 'long'];
    const x: HairStyle[] = ['bob', 'short', 'curly', 'swept'];
    const set = pres === 'm' ? m : pres === 'f' ? f : x;
    return textured && roll(id, 'tex') < 0.45 ? (pres === 'f' ? pick(id, 'th', ['afro', 'braid', 'pigtails'] as HairStyle[]) : 'curly') : pick(id, 'hair', set);
  }
  const BY: Record<Era, Record<Presentation, HairStyle[]>> = {
    'early-medieval': { m: ['shoulder', 'bowl', 'short', 'curly'], f: ['braid', 'long', 'braid'], x: ['shoulder', 'braid', 'bowl'] },
    'high-medieval': { m: ['bowl', 'shoulder', 'short', 'curly'], f: ['braid', 'chignon', 'long'], x: ['shoulder', 'bowl', 'chignon'] },
    renaissance: { m: ['bowl', 'shoulder', 'short', 'side-part'], f: ['chignon', 'braid', 'bun'], x: ['shoulder', 'chignon', 'short'] },
    c17: { m: ['periwig', 'shoulder', 'wavy', 'periwig'], f: ['chignon', 'wavy', 'bun'], x: ['wavy', 'shoulder', 'chignon'] },
    c18: { m: ['powdered', 'powdered', 'short'], f: ['bun', 'chignon', 'powdered'], x: ['powdered', 'bun', 'short'] },
    c19: { m: ['side-part', 'short', 'curly', 'swept'], f: ['chignon', 'bun', 'chignon'], x: ['side-part', 'chignon', 'short'] },
    c1900: { m: ['side-part', 'short', 'side-part'], f: ['bob', 'chignon', 'wavy', 'bun'], x: ['side-part', 'bob', 'short'] },
    c1945: { m: ['quiff', 'side-part', 'short'], f: ['wavy', 'bob', 'curly', 'ponytail'], x: ['side-part', 'bob', 'pixie'] },
    c1970: { m: ['shoulder', 'curly', 'short', 'swept', 'side-part'], f: ['long', 'wavy', 'curly', 'bob', 'shoulder'], x: ['shoulder', 'curly', 'pixie', 'bob'] },
    c2000: { m: ['short', 'swept', 'cropped', 'curly', 'side-part'], f: ['long', 'ponytail', 'bob', 'pixie', 'wavy', 'bun'], x: ['pixie', 'swept', 'bob', 'curly', 'cropped'] },
  };
  let style = pick(id, 'hair', BY[era][pres]);
  // Textured hair: curls, afros and braids, styled for the era.
  const modern = era === 'c1970' || era === 'c2000' || era === 'c1945';
  if (textured && roll(id, 'tex') < 0.55 && style !== 'powdered' && style !== 'periwig') {
    style = modern ? pick(id, 'th', (pres === 'f' ? ['afro', 'curly', 'braid', 'bun'] : pres === 'm' ? ['afro', 'cropped', 'curly'] : ['afro', 'curly', 'cropped']) as HairStyle[]) : pres === 'f' ? 'braid' : 'curly';
  }
  return style;
}

/** Thinning with age, for some men: about one in four at 40, more than half by 70. */
function thinning(id: string, style: HairStyle, age: number, pres: Presentation): HairStyle {
  if (pres !== 'm' || style === 'periwig' || style === 'powdered' || age < 35) return style;
  const r = roll(id, 'bald');
  const p = Math.min(0.6, (age - 30) / 65);
  if (r >= p) return style;
  return age >= 62 && r < p * 0.4 ? 'bald' : 'receding';
}

function autoBeard(id: string, era: Era, legacy: boolean | undefined, pres: Presentation, stage: Stage): [BeardStyle, MoustacheStyle] {
  const adult = stage === 'adult' || stage === 'middle' || stage === 'elder';
  if (!adult || pres !== 'm' || legacy === false) return ['none', 'none'];
  const bearded = legacy === true || roll(id, 'beard') < 0.5;
  // Clean-shaven eras keep a moustache now and then; bearded records still get a beard.
  const BEARD: Record<Era, BeardStyle[]> = {
    'early-medieval': ['full', 'long', 'short', 'full'], 'high-medieval': ['full', 'short', 'long'],
    renaissance: ['full', 'short', 'vandyke'], c17: ['vandyke', 'goatee', 'vandyke'], c18: ['short', 'stubble'],
    c19: ['full', 'muttonchops', 'long', 'short'], c1900: ['short', 'full'], c1945: ['short', 'goatee'],
    c1970: ['full', 'short', 'goatee'], c2000: ['stubble', 'short', 'full'],
  };
  const MOUSTACHE: Record<Era, MoustacheStyle[]> = {
    'early-medieval': ['chevron', 'walrus'], 'high-medieval': ['chevron'], renaissance: ['chevron', 'thin'],
    c17: ['thin', 'handlebar'], c18: ['none'], c19: ['walrus', 'handlebar', 'chevron'], c1900: ['chevron', 'handlebar', 'thin'],
    c1945: ['thin', 'chevron'], c1970: ['chevron', 'walrus'], c2000: ['chevron'],
  };
  if (bearded) {
    const b = pick(id, 'bs', BEARD[era]);
    const m = b === 'goatee' || b === 'vandyke' || b === 'muttonchops' || b === 'stubble' ? (b === 'muttonchops' ? 'walrus' : b === 'stubble' ? 'none' : 'thin') : pick(id, 'ms', MOUSTACHE[era]);
    return [b, b === 'vandyke' ? 'none' : m];
  }
  // Moustache alone: common 1850–1945, rarer elsewhere.
  const mOnly = era === 'c19' || era === 'c1900' ? 0.45 : era === 'c1970' || era === 'c1945' ? 0.18 : MEDIEVAL.has(era) ? 0.1 : 0.06;
  return roll(id, 'mo') < mOnly && legacy === undefined ? ['none', pick(id, 'ms', MOUSTACHE[era]) === 'none' ? 'chevron' : pick(id, 'ms', MOUSTACHE[era])] : ['none', 'none'];
}

function autoHeadwear(id: string, era: Era, stage: Stage, pres: Presentation): Headwear {
  const r = roll(id, 'hw');
  if (stage === 'baby') return era !== 'c1970' && era !== 'c2000' && r < 0.3 ? 'bonnet' : 'none';
  if (stage === 'child' || stage === 'teen') return era === 'c2000' && r < 0.06 ? 'beanie' : 'none';
  const f = pres === 'f';
  const m = pres === 'm';
  switch (era) {
    case 'early-medieval':
      return f && r < 0.35 ? 'veil' : m && r < 0.08 ? 'hood' : 'none';
    case 'high-medieval':
      return f && r < 0.2 ? 'wimple' : f && r < 0.38 ? 'veil' : m && r < 0.08 ? 'hood' : m && r < 0.16 ? 'coif' : 'none';
    case 'renaissance':
      return f && r < 0.35 ? 'coif' : m && r < 0.22 ? 'beret' : 'none';
    case 'c17':
      return f && r < 0.15 ? 'coif' : 'none';
    case 'c18':
      return f && r < 0.25 ? 'mobcap' : m && r < 0.12 ? 'tricorn' : 'none';
    case 'c19':
      return f && r < 0.12 ? 'bonnet' : m && r < 0.1 ? 'tophat' : 'none';
    case 'c1900':
      return f && r < 0.14 ? 'cloche' : m && r < 0.1 ? 'flatcap' : m && r < 0.2 ? 'fedora' : 'none';
    case 'c1945':
      return f && r < 0.06 ? 'headscarf' : m && r < 0.06 ? 'fedora' : 'none';
    default:
      return 'none';
  }
}

function autoClothing(id: string, era: Era, stage: Stage, pres: Presentation, year: number): ClothingStyle {
  if (stage === 'baby') return era === 'c1970' || era === 'c2000' || era === 'c1945' ? 'onesie' : 'smock';
  if (stage === 'child') {
    if (year < 1800) return 'smock';
    if (year < 1870) return pres === 'f' ? 'pinafore' : 'smock';
    if (year < 1945) return pres === 'f' ? pick(id, 'cl', ['pinafore', 'sailor'] as ClothingStyle[]) : 'sailor';
    if (year < 1970) return 'knit';
    return pick(id, 'cl', ['stripes', 'tshirt', 'hoodie', 'stripes'] as ClothingStyle[]);
  }
  const f = pres === 'f';
  const x = pres === 'x';
  const teen = stage === 'teen';
  switch (era) {
    case 'early-medieval': return f ? 'gown' : 'tunic';
    case 'high-medieval': return f ? 'gown' : x ? 'tunic' : pick(id, 'cl', ['cotehardie', 'tunic'] as ClothingStyle[]);
    case 'renaissance': return f ? 'bodice' : year > 1560 && !x ? 'ruff' : 'doublet';
    case 'c17': return f ? pick(id, 'cl', ['lace-collar', 'bodice'] as ClothingStyle[]) : year < 1625 ? 'ruff' : 'lace-collar';
    case 'c18': return f ? 'stays' : 'coat';
    case 'c19': return f ? 'victorian' : 'frock';
    case 'c1900': return f ? 'blouse' : teen || x ? 'sweater' : 'suit';
    case 'c1945': return f ? pick(id, 'cl', ['pearls', 'blouse', 'cardigan'] as ClothingStyle[]) : x ? 'sweater' : teen ? 'knit' : pick(id, 'cl', ['suit-slim', 'suit-slim', 'sweater'] as ClothingStyle[]);
    case 'c1970': return teen ? pick(id, 'cl', ['tshirt', 'sweater'] as ClothingStyle[]) : f ? pick(id, 'cl', ['blouse', 'turtleneck', 'sweater', 'cardigan'] as ClothingStyle[]) : pick(id, 'cl', (x ? ['shirt', 'sweater', 'turtleneck'] : ['shirt', 'sweater', 'turtleneck', 'suit-slim']) as ClothingStyle[]);
    case 'c2000': return teen ? pick(id, 'cl', ['hoodie', 'tshirt'] as ClothingStyle[]) : stage === 'elder' ? pick(id, 'cl', ['cardigan', 'sweater', 'shirt'] as ClothingStyle[]) : pick(id, 'cl', (f ? ['tshirt', 'sweater', 'blouse', 'cardigan'] : ['tshirt', 'shirt', 'sweater', 'hoodie']) as ClothingStyle[]);
  }
}

function autoGlasses(id: string, year: number, age: number): GlassesStyle {
  if (year < 1880 || age < 13) return 'none';
  const p = age >= 60 ? 0.42 : age >= 45 ? 0.3 : year >= 1950 ? 0.12 : 0.05;
  if (roll(id, 'gl') >= p) return 'none';
  const set: GlassesStyle[] = year < 1945 ? ['round', 'oval', 'round'] : year < 1970 ? ['browline', 'square', 'round'] : year < 2000 ? ['square', 'oval', 'round'] : ['square', 'round', 'oval'];
  return age >= 70 && roll(id, 'gh') < 0.3 ? 'half' : pick(id, 'gls', set);
}

/** Natural colour, greyed by age: salt and pepper from the mid-forties, grey by 65, white by 80. */
function greyed(base: string, age: number, id: string, greys: boolean): string {
  if (!greys || age < 40) return base;
  const onset = 40 + roll(id, 'grey') * 18; // some grey early, some late
  const t = Math.max(0, Math.min(1, (age - onset) / 28));
  if (t === 0) return base;
  return t < 0.75 ? mixHex(base, GREY, t / 0.75) : mixHex(GREY, WHITE, (t - 0.75) / 0.25);
}

export function mixHex(a: string, b: string, t: number): string {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Everything the drawing needs. `now` is the current year; `at` shows the person at another age
 * (the editor's life stages, or a chronicle entry).
 */
export function resolveAppearance(p: GPerson, now: number, at?: number): Appearance {
  const look: Partial<Look> = p.look ?? {};
  const id = p.id;
  const pres: Presentation = p.sex === 'm' || p.sex === 'f' ? p.sex : 'x';
  const born = yearOf(p.born) ?? (yearOf(p.died) !== undefined ? yearOf(p.died)! - 55 : undefined);
  const age = Math.max(0, Math.round(shownAge(p, now, at) ?? (born !== undefined && !p.living ? 50 : 38)));
  // Fashion of the year shown, though people keep the fashions of their prime: past 35, the clothes
  // move on at half speed.
  const year = born !== undefined ? born + Math.min(age, 35) + Math.max(0, age - 35) * 0.5 : p.living ? now - 10 : 1900;
  const era = eraOf(year);
  const stage = stageOf(age);
  const adult = stage === 'adult' || stage === 'middle' || stage === 'elder';

  const skinIdx = p.look ? look.skin ?? SKIN_NEUTRAL : SKIN_NEUTRAL;
  const hairIdx = paletteIndex(look.hair, hash(`${id}:hair`), HAIR.length, HAIR_AUTO);
  const hairBase = HAIR[hairIdx];
  const dyed = HAIR_DYED.includes(hairIdx);

  let hairStyle = look.hairStyle ?? autoHair(id, era, stage, pres, skinIdx);
  if (stage === 'baby') hairStyle = 'tuft';
  else if (!adult) hairStyle = CHILD_HAIR[hairStyle] ?? hairStyle;
  else if (!look.hairStyle) hairStyle = thinning(id, hairStyle, age, pres);

  // A recorded level of grey wins; otherwise hair greys with age, unless it is dyed or the look says it never does.
  const greys = look.hairGreys !== false && !dyed;
  const hair = hairStyle === 'powdered' ? POWDER : look.grey !== undefined ? greyLevel(hairBase, look.grey) : greyed(hairBase, age, id, greys);

  const [autoB, autoM] = autoBeard(id, era, look.beard, pres, stage);
  const beard = adult ? look.beardStyle ?? autoB : 'none';
  const moustache = adult ? look.moustache ?? autoM : 'none';

  const browsAuto: BrowStyle = stage === 'elder' && pres === 'm' && roll(id, 'bb') < 0.5 ? 'bushy'
    : pick(id, 'brows', (pres === 'f' ? ['arched', 'soft', 'thin'] : pres === 'm' ? ['straight', 'thick', 'soft'] : ['soft', 'straight']) as BrowStyle[]);

  const glasses = look.glasses ?? (adult || stage === 'teen' ? autoGlasses(id, year, age) : 'none');
  let headwear = look.headwear ?? autoHeadwear(id, era, stage, pres);
  // Crowns, mitres and veils are for grown-ups; a child shown young wears none.
  if (look.headwear && !headwearShows(look.headwear, stage)) headwear = 'none';
  let clothing = look.clothing ?? autoClothing(id, era, stage, pres, year);
  if (stage === 'baby' && look.clothing) clothing = autoClothing(id, era, stage, pres, year);

  const fair = FAIR_SKIN.has(skinIdx);
  const ginger = hairIdx === 6 || hairIdx === 9 || hairIdx === 16;
  const autoMarks: Mark[] = [];
  if (roll(id, 'fr') < (ginger ? 0.6 : fair ? 0.18 : 0.04)) autoMarks.push('freckles');
  if (roll(id, 'mole') < 0.08) autoMarks.push('mole');
  if (roll(id, 'dimp') < 0.12) autoMarks.push('dimples');
  const marks = look.marks ?? autoMarks;

  const autoFace: FaceShape = !adult ? 'round' : pick(id, 'face', (pres === 'f' ? ['oval', 'heart', 'round', 'oval'] : pres === 'm' ? ['square', 'oval', 'long', 'round'] : ['oval', 'round', 'heart']) as FaceShape[]);
  const face = look.face ?? autoFace;
  const lines = look.lines ?? (age >= 75 ? 3 : age >= 62 ? 2 : age >= 48 ? 1 : 0);
  const extras = (look.extras ?? []).filter((x) => adult || !ADULT_EXTRAS.has(x));

  return {
    stage, age, era, pres, face,
    skin: SKIN[skinIdx % SKIN.length] ?? SKIN[SKIN_NEUTRAL],
    hair, hairBase, hairStyle,
    brows: look.brows ?? browsAuto,
    eyes: EYES[paletteIndex(look.eyes, hash(`${id}:eyes`), EYES.length, EYES_AUTO)],
    beard, moustache, glasses, headwear, clothing, marks, lines,
    mouth: hash(`${id}:mouth`) % 4,
    noseShape: look.noseShape ?? NOSE_AUTO[hash(`${id}:nose`) % 4],
    eyeShape: look.eyeShape ?? EYE_AUTO[hash(`${id}:eyeshape`) % 3],
    feat: measure(look, id),
    ...(look.expression ? { expression: look.expression } : {}),
    build: look.build ?? 5,
    ...(look.lips !== undefined && LIPS[look.lips] ? { lips: LIPS[look.lips] } : {}),
    earrings: look.earrings ?? 'none',
    necklace: look.necklace ?? 'none',
    extras,
    ...(look.frames !== undefined && FRAMES[look.frames] ? { frames: FRAMES[look.frames] } : {}),
    ...(look.clothColour !== undefined && CLOTH[look.clothColour] ? { cloth: CLOTH[look.clothColour] } : {}),
    ...(look.trimColour !== undefined && CLOTH[look.trimColour] ? { trim: CLOTH[look.trimColour] } : {}),
    ...(look.hatColour !== undefined && CLOTH[look.hatColour] ? { hat: CLOTH[look.hatColour] } : {}),
    backdrop: look.backdrop ?? 'plain',
  };
}

/**
 * A palette index: the recorded one when the palette has it, else the automatic one. Automatic (and any number a look
 * recorded before the palette grew) wraps within the first `auto` colours, exactly as it did when those were all there were.
 */
function paletteIndex(recorded: number | undefined, automatic: number, size: number, auto: number): number {
  if (recorded !== undefined && Number.isInteger(recorded) && recorded >= 0 && recorded < size) return recorded;
  const v = recorded ?? automatic;
  return ((v % auto) + auto) % auto;
}

/** A chosen level of grey: 0 the natural colour, 1 salt and pepper, 2 grey, 3 white. */
function greyLevel(base: string, level: number): string {
  return level <= 0 ? base : level === 1 ? mixHex(base, GREY, 0.5) : level === 2 ? GREY : WHITE;
}

/** The level of grey a person's hair shows at this age when nothing is recorded, for the editor's "automatic". */
export function autoGrey(p: GPerson, now: number, at?: number): number {
  const a = resolveAppearance({ ...p, look: p.look ? { ...p.look, grey: undefined } : undefined }, now, at);
  if (a.hair === a.hairBase) return 0;
  return a.hair === WHITE ? 3 : a.hair === GREY ? 2 : 1;
}

/** The look as it would be filled in automatically, for an editor starting from nothing. */
export function defaultLook(p: GPerson): Look {
  return {
    skin: p.look?.skin ?? SKIN_NEUTRAL,
    hair: p.look?.hair ?? hash(`${p.id}:hair`) % HAIR_AUTO,
    eyes: p.look?.eyes ?? hash(`${p.id}:eyes`) % EYES_AUTO,
    ...(p.look?.beard !== undefined ? { beard: p.look.beard } : {}),
    ...(p.look?.headwear ? { headwear: p.look.headwear } : {}),
  };
}

const ids = <T extends string>(xs: Opt<T>[]) => new Set<string>(xs.map((x) => x.id));
const VALID = {
  hairStyle: ids(HAIR_STYLES), beardStyle: ids(BEARDS), moustache: ids(MOUSTACHES), brows: ids(BROWS),
  glasses: ids(GLASSES), headwear: ids(HEADWEAR), clothing: ids(CLOTHING),
  face: ids(FACE_SHAPES), noseShape: ids(NOSE_SHAPES), eyeShape: ids(EYE_SHAPES),
  expression: ids(EXPRESSIONS), earrings: ids(EARRINGS), necklace: ids(NECKLACES), backdrop: ids(BACKDROPS),
};
const MARK_IDS = ids(MARKS);
const EXTRA_IDS = ids(EXTRAS);
/** The numbered parts and how many values each has. */
const INDEXED = { grey: 4, lines: 4, lips: LIPS.length, frames: FRAMES.length, clothColour: CLOTH.length, trimColour: CLOTH.length, hatColour: CLOTH.length } as const;
const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : undefined);
/** A 0–10 measure: a whole number, or undefined (automatic). */
const level = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10 ? v : undefined);

/**
 * A Look from untrusted input (a form, an import, an AI reply): unknown values are dropped, so the
 * portrait falls back to automatic for them. Returns undefined when nothing usable is left.
 */
export function sanitizeLook(input: unknown): Look | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const out: Look = { skin: int(o.skin, SKIN.length) ?? SKIN_NEUTRAL, hair: int(o.hair, HAIR.length) ?? 0, eyes: int(o.eyes, EYES.length) ?? 0 };
  if (typeof o.beard === 'boolean') out.beard = o.beard;
  if (typeof o.hairGreys === 'boolean') out.hairGreys = o.hairGreys;
  for (const k of Object.keys(VALID) as (keyof typeof VALID)[]) {
    const v = o[k];
    if (typeof v === 'string' && VALID[k].has(v)) (out as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of LEVEL_KEYS) {
    const v = level(o[k]);
    if (v !== undefined) out[k] = v;
  }
  if (Array.isArray(o.marks)) out.marks = [...new Set(o.marks.filter((m): m is Mark => typeof m === 'string' && MARK_IDS.has(m)))];
  if (Array.isArray(o.extras)) {
    const extras = [...new Set(o.extras.filter((x): x is Extra => typeof x === 'string' && EXTRA_IDS.has(x)))];
    if (extras.length) out.extras = extras;
  }
  for (const k of Object.keys(INDEXED) as (keyof typeof INDEXED)[]) {
    const v = int(o[k], INDEXED[k]);
    if (v !== undefined) out[k] = v;
  }
  const build = level(o.build);
  if (build !== undefined) out.build = build;
  const age = int(o.age, 121);
  if (age !== undefined) out.age = age;
  return out;
}

/**
 * For "generate a matching avatar" (wave 2): the Look fields a vision model should fill from a photo,
 * with the allowed values. Run the reply through `sanitizeLook`, then merge it over the person's
 * current look so era-driven choices (headwear, clothing) and a fixed age stay as they were.
 *
 * - Fill: skin, hair, eyes, hairStyle, hairGreys, brows, beardStyle, moustache, glasses, marks, and the
 *   face itself: face, noseShape, eyeShape and the 0–10 measures. Each measure's `what` tells the model
 *   what to look at; a measure the photo cannot show (ears under hair) should be left out.
 *   These describe the face and do not depend on when the photo was taken.
 * - Leave out: headwear and clothing (the portrait dresses people for the era shown, and a photo's
 *   hat or jumper is rarely who they are), and age (a photo of a 30-year-old should not freeze a
 *   person who lived to 90). `beard` is a legacy field; use beardStyle.
 * - Colours are palette indices: pick the nearest swatch, never a hex value. For hair in a photo of
 *   an older person, give the natural colour if it can be told, else the nearest and hairGreys: true.
 * - The lists grow with the portrait: a hair style, a pair of glasses or a mark added to the catalogue is offered to the
 *   model at once. Parts that are a choice and not a likeness (expression, jewellery, colours of clothes, a backdrop)
 *   are never asked for.
 */
export const PHOTO_LOOK_FIELDS = {
  skin: { kind: 'index', of: SKIN_LABELS },
  hair: { kind: 'index', of: HAIR_LABELS },
  eyes: { kind: 'index', of: EYE_LABELS },
  hairStyle: { kind: 'one', of: HAIR_STYLES.map((o) => o.id) },
  hairGreys: { kind: 'boolean' },
  brows: { kind: 'one', of: BROWS.map((o) => o.id) },
  beardStyle: { kind: 'one', of: BEARDS.map((o) => o.id) },
  moustache: { kind: 'one', of: MOUSTACHES.map((o) => o.id) },
  glasses: { kind: 'one', of: GLASSES.map((o) => o.id) },
  marks: { kind: 'many', of: MARKS.map((o) => o.id) },
  face: {
    kind: 'one', of: FACE_SHAPES.map((o) => o.id),
    what: 'the outline of the face: round (soft, wide cheeks and chin), oval (longer, narrower chin), square (flat jaw, angular corners), long (narrow and tall), heart (wide forehead, pointed chin)',
  },
  noseShape: {
    kind: 'one', of: NOSE_SHAPES.map((o) => o.id),
    what: 'the profile of the nose: straight (a flat bridge), aquiline (a bump on the bridge), broad (wide nostrils and a rounded tip), snub (short, turned up at the tip)',
  },
  eyeShape: {
    kind: 'one', of: EYE_SHAPES.map((o) => o.id),
    what: 'the eye opening: round (wide open, lid not heavy), almond (outer corners lift a little), hooded (the upper lid hangs over the eye)',
  },
  jaw: { kind: 'level', min: 0, max: 10, what: 'how wide the jaw and cheeks are at the bottom of the face: 0 narrow and pointed, 5 average, 10 broad and square' },
  noseSize: { kind: 'level', min: 0, max: 10, what: 'the size of the nose from bridge to tip and across the nostrils: 0 small, 5 average, 10 large' },
  mouthWidth: { kind: 'level', min: 0, max: 10, what: 'the width of the mouth at rest, corner to corner: 0 narrow, 5 average, 10 wide' },
  mouthFullness: { kind: 'level', min: 0, max: 10, what: 'how full the lips are: 0 thin, 5 average, 10 full' },
  eyeSize: { kind: 'level', min: 0, max: 10, what: 'how large the eyes are when open: 0 small or narrow, 5 average, 10 large and wide open' },
  eyeSpacing: { kind: 'level', min: 0, max: 10, what: 'the gap between the eyes: 0 close together, 5 average, 10 wide apart' },
  browHeight: { kind: 'level', min: 0, max: 10, what: 'how high the brows sit above the eyes: 0 low and close, 5 average, 10 high' },
  earSize: { kind: 'level', min: 0, max: 10, what: 'the size of the ears if they show: 0 small, 5 average, 10 large; leave out if hidden' },
  hairline: { kind: 'level', min: 0, max: 10, what: 'where the hair starts on the forehead: 0 high or receded, 5 average, 10 low and close to the brows' },
} as const;
