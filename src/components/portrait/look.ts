// What a portrait shows, resolved from the person and their recorded look: age, era, presentation and
// every part. Recorded fields win; the rest is chosen deterministically from the person's id, so a
// portrait never changes between renders, and a person seen at another age stays recognisably them.
import type {
  BeardStyle, BrowStyle, ClothingStyle, GlassesStyle, HairStyle, Headwear, Mark, MoustacheStyle,
} from '~/lib/seed-format';
import type { GPerson, Look } from '~/lib/types';

export type Stage = 'baby' | 'child' | 'teen' | 'adult' | 'middle' | 'elder';
export type Era = 'early-medieval' | 'high-medieval' | 'renaissance' | 'c17' | 'c18' | 'c19' | 'c1900' | 'c1945' | 'c1970' | 'c2000';
export type Presentation = 'm' | 'f' | 'x';
export type FaceShape = 'round' | 'oval' | 'square' | 'long' | 'heart';

// ---------- Palettes (indices are stored in Look; never reorder, only append) ----------

/** Skin: 0–5 fair to deep (the original six), 6 porcelain, 7 deepest, 8 neutral parchment. */
export const SKIN = ['#f3d5bd', '#e8bd98', '#d39f75', '#b77d52', '#8f5c3a', '#6a4129', '#fae3d3', '#4b2c1d', '#e9d6b9'];
export const SKIN_ORDER = [6, 0, 1, 2, 3, 4, 5, 7];
export const SKIN_NEUTRAL = 8;
export const SKIN_LABELS = ['Fair', 'Light', 'Light medium', 'Medium', 'Brown', 'Deep', 'Porcelain', 'Deepest', 'Neutral'];

/** Natural hair colours. */
export const HAIR = ['#2b201b', '#4a3226', '#6b462d', '#8a5631', '#a7783f', '#d2ac69', '#a3482a', '#e4cf9a', '#17151a', '#c66c2e'];
export const HAIR_ORDER = [8, 0, 1, 2, 3, 4, 9, 6, 5, 7];
export const HAIR_LABELS = ['Black', 'Dark brown', 'Brown', 'Chestnut', 'Light brown', 'Blond', 'Auburn', 'Flaxen', 'Jet', 'Copper'];

export const EYES = ['#4a2e1c', '#6f4b2a', '#7a6a3a', '#4f7a4a', '#4f7fae', '#7d8b96', '#2f2420'];
export const EYE_LABELS = ['Brown', 'Light brown', 'Hazel', 'Green', 'Blue', 'Grey', 'Dark'];

const GREY = '#b9b3aa';
const WHITE = '#ece8e0';
const POWDER = '#ebe6dc';

// ---------- Catalogues, for the editor ----------

type Opt<T extends string> = { id: T; label: string };
export const HAIR_STYLES: Opt<HairStyle>[] = [
  { id: 'cropped', label: 'Cropped' }, { id: 'short', label: 'Short' }, { id: 'side-part', label: 'Side part' },
  { id: 'swept', label: 'Swept' }, { id: 'quiff', label: 'Quiff' }, { id: 'curly', label: 'Curly' },
  { id: 'afro', label: 'Afro' }, { id: 'bowl', label: 'Bowl' }, { id: 'pixie', label: 'Pixie' }, { id: 'bob', label: 'Bob' },
  { id: 'shoulder', label: 'Shoulder' }, { id: 'long', label: 'Long' }, { id: 'wavy', label: 'Wavy' },
  { id: 'braid', label: 'Braids' }, { id: 'ponytail', label: 'Ponytail' }, { id: 'pigtails', label: 'Pigtails' },
  { id: 'bun', label: 'Bun' }, { id: 'chignon', label: 'Chignon' }, { id: 'periwig', label: 'Periwig' },
  { id: 'powdered', label: 'Powdered wig' }, { id: 'receding', label: 'Receding' }, { id: 'bald', label: 'Bald' },
];
export const BEARDS: Opt<BeardStyle>[] = [
  { id: 'none', label: 'None' }, { id: 'stubble', label: 'Stubble' }, { id: 'short', label: 'Short' }, { id: 'full', label: 'Full' },
  { id: 'long', label: 'Long' }, { id: 'goatee', label: 'Goatee' }, { id: 'vandyke', label: 'Van Dyke' }, { id: 'muttonchops', label: 'Mutton chops' },
];
export const MOUSTACHES: Opt<MoustacheStyle>[] = [
  { id: 'none', label: 'None' }, { id: 'thin', label: 'Thin' }, { id: 'chevron', label: 'Chevron' },
  { id: 'handlebar', label: 'Handlebar' }, { id: 'walrus', label: 'Walrus' },
];
export const BROWS: Opt<BrowStyle>[] = [
  { id: 'soft', label: 'Soft' }, { id: 'straight', label: 'Straight' }, { id: 'arched', label: 'Arched' },
  { id: 'thick', label: 'Thick' }, { id: 'thin', label: 'Thin' }, { id: 'bushy', label: 'Bushy' },
];
export const GLASSES: Opt<GlassesStyle>[] = [
  { id: 'none', label: 'None' }, { id: 'round', label: 'Round' }, { id: 'oval', label: 'Oval' }, { id: 'square', label: 'Square' },
  { id: 'browline', label: 'Browline' }, { id: 'half', label: 'Half-moon' },
];
export const HEADWEAR: Opt<Headwear>[] = [
  { id: 'none', label: 'None' }, { id: 'crown', label: 'Crown' }, { id: 'circlet', label: 'Circlet' }, { id: 'mitre', label: 'Mitre' },
  { id: 'veil', label: 'Veil' }, { id: 'wimple', label: 'Wimple' }, { id: 'hood', label: 'Hood' }, { id: 'coif', label: 'Coif' },
  { id: 'beret', label: 'Bonnet (Tudor)' }, { id: 'mobcap', label: 'Mob cap' }, { id: 'tricorn', label: 'Tricorn' },
  { id: 'tophat', label: 'Top hat' }, { id: 'bonnet', label: 'Bonnet' }, { id: 'flatcap', label: 'Flat cap' },
  { id: 'fedora', label: 'Fedora' }, { id: 'cloche', label: 'Cloche' }, { id: 'headscarf', label: 'Headscarf' },
  { id: 'beanie', label: 'Beanie' },
];
export const CLOTHING: Opt<ClothingStyle>[] = [
  { id: 'tunic', label: 'Tunic and cloak' }, { id: 'cotehardie', label: 'Cotehardie' }, { id: 'gown', label: 'Gown' },
  { id: 'doublet', label: 'Doublet' }, { id: 'bodice', label: 'Bodice' }, { id: 'ruff', label: 'Ruff' },
  { id: 'lace-collar', label: 'Lace collar' }, { id: 'coat', label: 'Coat and jabot' }, { id: 'stays', label: 'Fichu' },
  { id: 'frock', label: 'Frock coat' }, { id: 'victorian', label: 'High collar' }, { id: 'suit', label: 'Three-piece' },
  { id: 'blouse', label: 'Blouse' }, { id: 'suit-slim', label: 'Slim suit' }, { id: 'pearls', label: 'Dress and pearls' },
  { id: 'shirt', label: 'Open shirt' }, { id: 'turtleneck', label: 'Turtleneck' }, { id: 'sweater', label: 'Sweater' },
  { id: 'tshirt', label: 'T-shirt' }, { id: 'hoodie', label: 'Hoodie' }, { id: 'cardigan', label: 'Cardigan' },
  { id: 'smock', label: 'Smock' }, { id: 'sailor', label: 'Sailor suit' }, { id: 'pinafore', label: 'Pinafore' },
  { id: 'knit', label: 'Knit' }, { id: 'stripes', label: 'Stripes' }, { id: 'onesie', label: 'Romper' },
];
export const MARKS: Opt<Mark>[] = [
  { id: 'freckles', label: 'Freckles' }, { id: 'blush', label: 'Rosy cheeks' }, { id: 'dimples', label: 'Dimples' },
  { id: 'mole', label: 'Beauty mark' }, { id: 'scar', label: 'Scar' },
];

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
export const ERA_LABELS: Record<Era, string> = {
  'early-medieval': 'Early medieval', 'high-medieval': 'High medieval', renaissance: 'Renaissance', c17: '17th century',
  c18: '18th century', c19: '19th century', c1900: '1900–1945', c1945: '1945–1970', c1970: '1970–2000', c2000: '2000 onwards',
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
  /** Small per-person variations: mouth, nose, eye shape. */
  mouth: number;
  nose: number;
  eyeShape: number;
}

/** Adult-only styles a child cannot have, with what they wear instead. */
const CHILD_HAIR: Partial<Record<HairStyle, HairStyle>> = {
  receding: 'short', bald: 'cropped', periwig: 'shoulder', powdered: 'short', quiff: 'swept', chignon: 'braid',
};

function autoHair(id: string, era: Era, stage: Stage, pres: Presentation, skin: number): HairStyle {
  const textured = skin === 4 || skin === 5 || skin === 7;
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
  const hairIdx = look.hair ?? hash(`${id}:hair`);
  const hairBase = HAIR[((hairIdx % HAIR.length) + HAIR.length) % HAIR.length];

  let hairStyle = look.hairStyle ?? autoHair(id, era, stage, pres, skinIdx);
  if (stage === 'baby') hairStyle = 'tuft';
  else if (!adult) hairStyle = CHILD_HAIR[hairStyle] ?? hairStyle;
  else if (!look.hairStyle) hairStyle = thinning(id, hairStyle, age, pres);

  const greys = look.hairGreys !== false;
  const hair = hairStyle === 'powdered' ? POWDER : greyed(hairBase, age, id, greys);

  const [autoB, autoM] = autoBeard(id, era, look.beard, pres, stage);
  const beard = adult ? look.beardStyle ?? autoB : 'none';
  const moustache = adult ? look.moustache ?? autoM : 'none';

  const browsAuto: BrowStyle = stage === 'elder' && pres === 'm' && roll(id, 'bb') < 0.5 ? 'bushy'
    : pick(id, 'brows', (pres === 'f' ? ['arched', 'soft', 'thin'] : pres === 'm' ? ['straight', 'thick', 'soft'] : ['soft', 'straight']) as BrowStyle[]);

  const glasses = look.glasses ?? (adult || stage === 'teen' ? autoGlasses(id, year, age) : 'none');
  let headwear = look.headwear ?? autoHeadwear(id, era, stage, pres);
  // Crowns, mitres and veils are for grown-ups; a child shown young wears none.
  if (!adult && look.headwear && look.headwear !== 'circlet' && look.headwear !== 'bonnet' && look.headwear !== 'beanie' && look.headwear !== 'headscarf') headwear = 'none';
  let clothing = look.clothing ?? autoClothing(id, era, stage, pres, year);
  if (stage === 'baby' && look.clothing) clothing = autoClothing(id, era, stage, pres, year);

  const fair = skinIdx === 0 || skinIdx === 6 || skinIdx === 1;
  const ginger = hairIdx % HAIR.length === 6 || hairIdx % HAIR.length === 9;
  const autoMarks: Mark[] = [];
  if (roll(id, 'fr') < (ginger ? 0.6 : fair ? 0.18 : 0.04)) autoMarks.push('freckles');
  if (roll(id, 'mole') < 0.08) autoMarks.push('mole');
  if (roll(id, 'dimp') < 0.12) autoMarks.push('dimples');
  const marks = look.marks ?? autoMarks;

  const face: FaceShape = !adult ? 'round' : pick(id, 'face', (pres === 'f' ? ['oval', 'heart', 'round', 'oval'] : pres === 'm' ? ['square', 'oval', 'long', 'round'] : ['oval', 'round', 'heart']) as FaceShape[]);
  const lines = age >= 75 ? 3 : age >= 62 ? 2 : age >= 48 ? 1 : 0;

  return {
    stage, age, era, pres, face,
    skin: SKIN[skinIdx % SKIN.length] ?? SKIN[SKIN_NEUTRAL],
    hair, hairBase, hairStyle,
    brows: look.brows ?? browsAuto,
    eyes: EYES[((look.eyes ?? hash(`${id}:eyes`)) % EYES.length + EYES.length) % EYES.length],
    beard, moustache, glasses, headwear, clothing, marks, lines,
    mouth: hash(`${id}:mouth`) % 4,
    nose: hash(`${id}:nose`) % 4,
    eyeShape: hash(`${id}:eyeshape`) % 3,
  };
}

/** The look as it would be filled in automatically, for an editor starting from nothing. */
export function defaultLook(p: GPerson): Look {
  return {
    skin: p.look?.skin ?? SKIN_NEUTRAL,
    hair: p.look?.hair ?? hash(`${p.id}:hair`) % HAIR.length,
    eyes: p.look?.eyes ?? hash(`${p.id}:eyes`) % EYES.length,
    ...(p.look?.beard !== undefined ? { beard: p.look.beard } : {}),
    ...(p.look?.headwear ? { headwear: p.look.headwear } : {}),
  };
}

const ids = <T extends string>(xs: Opt<T>[]) => new Set<string>(xs.map((x) => x.id));
const VALID = {
  hairStyle: ids(HAIR_STYLES), beardStyle: ids(BEARDS), moustache: ids(MOUSTACHES), brows: ids(BROWS),
  glasses: ids(GLASSES), headwear: ids(HEADWEAR), clothing: ids(CLOTHING),
};
const MARK_IDS = ids(MARKS);
const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : undefined);

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
  if (Array.isArray(o.marks)) out.marks = [...new Set(o.marks.filter((m): m is Mark => typeof m === 'string' && MARK_IDS.has(m)))];
  const age = int(o.age, 121);
  if (age !== undefined) out.age = age;
  return out;
}

/**
 * For "generate a matching avatar" (wave 2): the Look fields a vision model should fill from a photo,
 * with the allowed values. Run the reply through `sanitizeLook`, then merge it over the person's
 * current look so era-driven choices (headwear, clothing) and a fixed age stay as they were.
 *
 * - Fill: skin, hair, eyes, hairStyle, hairGreys, brows, beardStyle, moustache, glasses, marks.
 *   These describe the face and do not depend on when the photo was taken.
 * - Leave out: headwear and clothing (the portrait dresses people for the era shown, and a photo's
 *   hat or jumper is rarely who they are), and age (a photo of a 30-year-old should not freeze a
 *   person who lived to 90). `beard` is a legacy field; use beardStyle.
 * - Colours are palette indices: pick the nearest swatch, never a hex value. For hair in a photo of
 *   an older person, give the natural colour if it can be told, else the nearest and hairGreys: true.
 */
export const PHOTO_LOOK_FIELDS = {
  skin: { kind: 'index', of: SKIN_LABELS.slice(0, SKIN_NEUTRAL) },
  hair: { kind: 'index', of: HAIR_LABELS },
  eyes: { kind: 'index', of: EYE_LABELS },
  hairStyle: { kind: 'one', of: HAIR_STYLES.map((o) => o.id) },
  hairGreys: { kind: 'boolean' },
  brows: { kind: 'one', of: BROWS.map((o) => o.id) },
  beardStyle: { kind: 'one', of: BEARDS.map((o) => o.id) },
  moustache: { kind: 'one', of: MOUSTACHES.map((o) => o.id) },
  glasses: { kind: 'one', of: GLASSES.map((o) => o.id) },
  marks: { kind: 'many', of: MARKS.map((o) => o.id) },
} as const;
