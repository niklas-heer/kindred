// The character editor's rules, apart from its screen: the steps it can take back and forward, "Surprise me", and the
// ready-made looks. Pure functions over a Look, so they are tested without a browser (portrait-editor.test.ts).
import type { Key } from '~/lib/i18n/dictionary';
import type { ClothingStyle, GlassesStyle, HairStyle, Headwear } from '~/lib/seed-format';
import type { GPerson, Look } from '~/lib/types';
import { LEVEL_KEYS, SKIN_NEUTRAL, SKIN_ORDER, defaultLook, resolveAppearance, type Era, type Presentation, type Stage } from './portrait-look';

// ---------- steps ----------

/** An editing session: where it started, where it is, and the steps either side. `undefined` is "nothing recorded yet". */
export interface Draft {
  start: Look | undefined;
  now: Look | undefined;
  past: (Look | undefined)[];
  future: (Look | undefined)[];
}

/** The most steps kept. An evening of trying things on stays undoable; the list still ends somewhere. */
export const MAX_STEPS = 200;

const same = (a: Look | undefined, b: Look | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const startDraft = (look: Look | undefined): Draft => ({ start: look, now: look, past: [], future: [] });

/** A change. It becomes one step back, and whatever had been undone can no longer be redone. A change to the same look is no step. */
export function commit(d: Draft, next: Look | undefined): Draft {
  if (same(d.now, next)) return d;
  return { ...d, now: next, past: [...d.past, d.now].slice(-MAX_STEPS), future: [] };
}

export const canUndo = (d: Draft) => d.past.length > 0;
export const canRedo = (d: Draft) => d.future.length > 0;
/** Whether there is anything to save, or to go back from. */
export const changed = (d: Draft) => !same(d.now, d.start);

export function undo(d: Draft): Draft {
  if (!canUndo(d)) return d;
  return { ...d, now: d.past[d.past.length - 1], past: d.past.slice(0, -1), future: [d.now, ...d.future] };
}

export function redo(d: Draft): Draft {
  if (!canRedo(d)) return d;
  return { ...d, now: d.future[0], past: [...d.past, d.now], future: d.future.slice(1) };
}

/** "Back to how it was": the look the session started with, as a step of its own, so it can be undone like any other. */
export const revert = (d: Draft): Draft => commit(d, d.start);

// ---------- Surprise me ----------

/** A number in [0, 1). Math.random in the editor; a fixed sequence in a test. */
export type Rand = () => number;

const pickOf = <T,>(rand: Rand, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
const MODERN = new Set<Era>(['c1945', 'c1970', 'c2000']);
/** Headwear that says who someone is, not what they put on that morning: it stays through a surprise. */
const KEPT_HEADWEAR = new Set<Headwear>(['crown', 'circlet', 'mitre', 'wimple', 'hijab', 'turban', 'kippah', 'kufi', 'headwrap']);

/** Hair and eye colours that go with a skin tone often enough to be believed. Indices into HAIR and EYES. */
function coloursFor(skin: number): { hair: number[]; eyes: number[] } {
  const depth = SKIN_ORDER.indexOf(skin);
  if (depth < 0) return { hair: [8, 0, 1, 2, 3, 4, 5, 6, 7, 9, 16, 17], eyes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
  if (depth >= 9) return { hair: [8, 8, 0, 0, 1], eyes: [6, 6, 0, 0, 1] };
  if (depth >= 5) return { hair: [8, 0, 0, 1, 1, 2, 3], eyes: [6, 0, 0, 1, 2, 7] };
  return { hair: [0, 1, 2, 2, 3, 4, 4, 5, 6, 7, 9, 16, 17], eyes: [0, 1, 2, 3, 4, 4, 5, 8, 9, 7] };
}

/** Parts the portrait's own automatic choice never makes, which a surprise may bring in for the right time and person. */
function laterHair(era: Era, pres: Presentation, stage: Stage, deep: boolean): HairStyle[] {
  const child = stage === 'child' || stage === 'teen';
  if (deep) return pres === 'm' ? ['coily', 'fade', 'buzz', ...(MODERN.has(era) ? ['locs', 'cornrows'] as const : [])] : ['coily', 'cornrows', ...(MODERN.has(era) ? ['locs', 'box-braids', 'curly-long'] as const : ['crown-braid'] as const)];
  if (era === 'c2000') return pres === 'm' ? ['fade', 'buzz', 'slicked'] : child ? ['space-buns', 'fringe', 'side-braid'] : ['fringe', 'curly-long', 'side-braid'];
  if (era === 'c1970') return pres === 'm' ? ['mullet', 'slicked'] : ['fringe', 'curly-long', 'beehive'];
  if (era === 'c1945' || era === 'c1900') return pres === 'm' ? ['slicked'] : child ? ['crown-braid', 'side-braid'] : ['crown-braid', 'beehive'];
  return pres === 'm' ? [] : ['crown-braid', 'side-braid'];
}

function laterClothes(era: Era, pres: Presentation, stage: Stage): ClothingStyle[] {
  if (stage === 'baby' || stage === 'child') return era === 'c2000' || era === 'c1970' ? ['overalls', 'plaid', 'polo'] : [];
  if (era === 'c2000') return pres === 'f' ? ['dress', 'jacket', 'plaid'] : ['polo', 'plaid', 'jacket'];
  if (era === 'c1970') return pres === 'f' ? ['dress', 'jacket'] : ['polo', 'plaid', 'jacket'];
  if (era === 'c1945' || era === 'c1900') return pres === 'f' ? ['dress', 'apron'] : ['waistcoat', 'overalls'];
  return [];
}

function laterGlasses(era: Era, pres: Presentation): GlassesStyle[] {
  if (era === 'c2000') return ['horn', 'rimless', 'aviator'];
  if (era === 'c1970') return pres === 'f' ? ['cat-eye', 'horn'] : ['aviator', 'horn'];
  if (era === 'c1945') return pres === 'f' ? ['cat-eye'] : ['horn'];
  return ['pince-nez'];
}

/**
 * "Surprise me": a believable relative. The person stays who they are: their sex, their dates and so their era, the age
 * the portrait shows, the skin they have (or one shade either side, as kin differ), and headwear that is part of who
 * they are (a crown, a hijab). Everything else is drawn afresh, the way the portrait would draw a stranger of the same
 * time and age, with the later parts mixed in where they fit.
 */
export function surprise(person: GPerson, current: Look | undefined, now: number, rand: Rand, at?: number): Look {
  const from = current ?? defaultLook(person);
  // Skin: theirs, or a neighbour's. A person nobody has given a tone gets one.
  const order = SKIN_ORDER;
  const here = order.indexOf(from.skin);
  const skin = from.skin === SKIN_NEUTRAL || here < 0 ? pickOf(rand, order) : rand() < 0.7 ? from.skin : order[Math.max(0, Math.min(order.length - 1, here + (rand() < 0.5 ? -1 : 1)))];
  const colours = coloursFor(skin);
  const base: Look = { skin, hair: pickOf(rand, colours.hair), eyes: pickOf(rand, colours.eyes), ...(from.age !== undefined ? { age: from.age } : {}) };

  // A stranger with their dates: the portrait's own automatic choices, made for an id nobody has.
  const a = resolveAppearance({ ...person, id: `surprise-${Math.floor(rand() * 1e9)}`, look: base }, now, at);
  const next: Look = {
    ...base,
    brows: a.brows, face: a.face, noseShape: a.noseShape, eyeShape: a.eyeShape, marks: a.marks,
    beardStyle: a.beard, moustache: a.moustache, glasses: a.glasses, clothing: a.clothing, headwear: a.headwear,
  };
  if (a.hairStyle !== 'tuft') next.hairStyle = a.hairStyle;
  for (const k of LEVEL_KEYS) next[k] = a.feat[k];

  const deep = SKIN_ORDER.indexOf(skin) >= 9;
  const adult = a.stage === 'adult' || a.stage === 'middle' || a.stage === 'elder';
  const hairs = laterHair(a.era, a.pres, a.stage, deep);
  if (a.stage !== 'baby' && hairs.length && rand() < (deep ? 0.6 : 0.3)) next.hairStyle = pickOf(rand, hairs);
  const clothes = laterClothes(a.era, a.pres, a.stage);
  if (clothes.length && rand() < 0.35) next.clothing = pickOf(rand, clothes);
  if (a.glasses !== 'none' && rand() < 0.4) next.glasses = pickOf(rand, laterGlasses(a.era, a.pres));
  // People in old photographs sat still and unsmiling; later they smile.
  const r = rand();
  next.expression = MODERN.has(a.era) ? (r < 0.4 ? 'smile' : r < 0.6 ? 'grin' : r < 0.9 ? 'calm' : 'stern') : r < 0.5 ? 'calm' : r < 0.8 ? 'stern' : 'smile';
  if (adult && a.pres === 'f' && rand() < (MODERN.has(a.era) || a.era === 'c1900' ? 0.45 : 0.15)) next.earrings = pickOf(rand, ['studs', 'pearls', 'hoops', 'drops'] as const);
  if (adult && a.pres === 'f' && !['pearls', 'victorian', 'turtleneck', 'ruff'].includes(next.clothing ?? '') && rand() < 0.2) next.necklace = pickOf(rand, ['chain', 'pendant', 'pearls', 'beads'] as const);
  if (a.stage === 'elder' && MODERN.has(a.era) && rand() < 0.12) next.extras = ['hearing-aid'];
  if (rand() < 0.1) next.build = rand() < 0.5 ? 3 : 8;

  if (from.headwear && KEPT_HEADWEAR.has(from.headwear)) {
    next.headwear = from.headwear;
    if (from.hatColour !== undefined) next.hatColour = from.hatColour;
  }
  return next;
}

// ---------- ready-made looks ----------

/** The parts a ready-made look sets. The face itself (skin, eyes, hair colour, shapes, measures, marks, build) is never touched. */
export type Outfit = Pick<Look, 'hairStyle' | 'grey' | 'beardStyle' | 'moustache' | 'glasses' | 'frames' | 'headwear' | 'hatColour' | 'clothing' | 'clothColour' | 'trimColour' | 'expression' | 'lips' | 'earrings' | 'necklace' | 'extras' | 'backdrop'>;
const OUTFIT_KEYS: (keyof Outfit)[] = ['hairStyle', 'grey', 'beardStyle', 'moustache', 'glasses', 'frames', 'headwear', 'hatColour', 'clothing', 'clothColour', 'trimColour', 'expression', 'lips', 'earrings', 'necklace', 'extras', 'backdrop'];

export interface Preset {
  id: string;
  label: Key;
  /** Whom it is drawn for first. Anybody may wear it: this only orders the list. */
  pres?: 'm' | 'f';
  /** The times it belongs to. Absent: any time since photographs. */
  eras?: Era[];
  /** For a child, or for a grown-up (the default). */
  child?: boolean;
  outfit: Outfit;
}

const SINCE_PHOTOS: Era[] = ['c19', 'c1900', 'c1945', 'c1970', 'c2000'];
const REALM: Era[] = ['early-medieval', 'high-medieval', 'renaissance'];

export const PRESETS: Preset[] = [
  { id: 'grandfather-1950', label: 'character.preset.grandfather_1950', pres: 'm', eras: ['c1900', 'c1945', 'c1970'], outfit: { hairStyle: 'slicked', grey: 2, glasses: 'browline', clothing: 'cardigan', extras: ['pipe'], expression: 'calm', beardStyle: 'none', moustache: 'none' } },
  { id: 'grandmother-1950', label: 'character.preset.grandmother_1950', pres: 'f', eras: ['c1900', 'c1945', 'c1970'], outfit: { hairStyle: 'bun', grey: 2, glasses: 'cat-eye', clothing: 'pearls', earrings: 'pearls', expression: 'smile' } },
  { id: 'sunday-1900-m', label: 'character.preset.sunday_1900', pres: 'm', eras: ['c19', 'c1900'], outfit: { hairStyle: 'side-part', moustache: 'handlebar', beardStyle: 'none', clothing: 'waistcoat', expression: 'stern', backdrop: 'drape' } },
  { id: 'sunday-1900-f', label: 'character.preset.sunday_1900', pres: 'f', eras: ['c19', 'c1900'], outfit: { hairStyle: 'chignon', clothing: 'victorian', extras: ['brooch'], expression: 'stern', backdrop: 'drape' } },
  { id: 'bride', label: 'character.preset.bride', pres: 'f', outfit: { hairStyle: 'chignon', headwear: 'bridal-veil', clothing: 'wedding-dress', necklace: 'pearls', earrings: 'pearls', expression: 'smile' } },
  { id: 'groom', label: 'character.preset.groom', pres: 'm', outfit: { hairStyle: 'side-part', clothing: 'tuxedo', extras: ['flower'], expression: 'smile' } },
  { id: 'soldier', label: 'character.preset.soldier', outfit: { hairStyle: 'cropped', headwear: 'peaked-cap', clothing: 'uniform', clothColour: 19, extras: ['medal'], expression: 'stern' } },
  { id: 'farmer', label: 'character.preset.farmer', outfit: { headwear: 'flatcap', clothing: 'overalls', expression: 'calm', backdrop: 'hills' } },
  { id: 'teacher', label: 'character.preset.teacher', outfit: { glasses: 'round', clothing: 'waistcoat', expression: 'calm', backdrop: 'books' } },
  { id: 'doctor', label: 'character.preset.doctor', eras: ['c1900', 'c1945', 'c1970', 'c2000'], outfit: { glasses: 'rimless', clothing: 'white-coat', expression: 'calm' } },
  { id: 'midsummer', label: 'character.preset.midsummer', pres: 'f', outfit: { hairStyle: 'crown-braid', headwear: 'flower-crown', clothing: 'dirndl', expression: 'smile', backdrop: 'garden' } },
  { id: 'seaside', label: 'character.preset.seaside', outfit: { headwear: 'sunhat', clothing: 'stripes', expression: 'grin', backdrop: 'sea' } },
  { id: 'seventies', label: 'character.preset.seventies', eras: ['c1945', 'c1970', 'c2000'], outfit: { hairStyle: 'long', headwear: 'headband', glasses: 'round', frames: 1, clothing: 'kaftan', necklace: 'beads', expression: 'smile' } },
  { id: 'eighties', label: 'character.preset.eighties', eras: ['c1970', 'c2000'], outfit: { hairStyle: 'mullet', glasses: 'aviator', clothing: 'jacket', clothColour: 6, expression: 'grin' } },
  { id: 'graduate', label: 'character.preset.graduate', eras: ['c1900', 'c1945', 'c1970', 'c2000'], outfit: { headwear: 'mortarboard', clothing: 'suit-slim', expression: 'smile' } },
  { id: 'today', label: 'character.preset.today', eras: ['c2000'], outfit: { hairStyle: 'fade', clothing: 'hoodie', expression: 'smile' } },
  { id: 'schoolchild-1930', label: 'character.preset.schoolchild', child: true, eras: ['c19', 'c1900', 'c1945'], outfit: { clothing: 'sailor', headwear: 'bow', expression: 'calm' } },
  { id: 'kid-today', label: 'character.preset.kid_today', child: true, eras: ['c1970', 'c2000'], outfit: { clothing: 'overalls', headwear: 'cap', expression: 'grin' } },
  { id: 'powdered', label: 'character.preset.powdered', eras: ['c17', 'c18'], outfit: { hairStyle: 'powdered', clothing: 'coat', expression: 'calm', backdrop: 'drape' } },
  { id: 'crowned', label: 'character.preset.crowned', eras: REALM, outfit: { headwear: 'crown', clothing: 'tunic', expression: 'stern', backdrop: 'house' } },
  { id: 'court', label: 'character.preset.court', eras: REALM, outfit: { headwear: 'circlet', clothing: 'cotehardie', expression: 'calm', backdrop: 'house' } },
  { id: 'church', label: 'character.preset.church', eras: REALM, outfit: { headwear: 'mitre', clothing: 'gown', expression: 'calm' } },
  { id: 'hood', label: 'character.preset.traveller', eras: REALM, outfit: { headwear: 'hood', clothing: 'tunic', expression: 'calm', backdrop: 'hills' } },
];

/**
 * The ready-made looks offered for this person as shown: those of their time and their stage of life, the ones drawn
 * for their sex first. A child is offered the children's, a grown-up the rest.
 */
export function presetsFor(person: GPerson, look: Look | undefined, now: number, at?: number): Preset[] {
  const a = resolveAppearance({ ...person, look }, now, at);
  if (a.stage === 'baby') return [];
  const young = a.stage === 'child' || (a.stage === 'teen' && a.age < 16);
  const fits = PRESETS.filter((p) => !!p.child === young && (p.eras ?? SINCE_PHOTOS).includes(a.era));
  const rank = (p: Preset) => (p.pres === undefined ? 1 : p.pres === a.pres ? 0 : 2);
  return fits.map((p, i) => ({ p, i })).sort((x, y) => rank(x.p) - rank(y.p) || x.i - y.i).map(({ p }) => p);
}

/** Puts a ready-made look on: its parts replace what was worn, and the face stays exactly as it was. */
export function applyPreset(look: Look, preset: Preset): Look {
  const next: Look = { ...look };
  for (const k of OUTFIT_KEYS) delete next[k];
  return { ...next, ...preset.outfit };
}
