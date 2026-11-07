// The face: DiceBear "lorelei" geometry, held to calm, dignified expressions and recoloured as
// ink line work on a warm wash, so it reads as an engraving rather than a sticker.
import { lorelei } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import type { GPerson } from '~/lib/types';
import { INK } from './palette';

type LoreleiOptions = Parameters<typeof lorelei.create>[0]['options'];
type Variant<K extends keyof LoreleiOptions> = LoreleiOptions[K] extends (infer V)[] | undefined ? V : never;
const variants = <T extends string>(...n: number[]): T[] => n.map((i) => `variant${String(i).padStart(2, '0')}` as T);

// Picked from a contact sheet of every variant: both eyes open and looking ahead, a closed or
// faintly smiling mouth, level brows. No winks, grins, tongues, side-eyes or scowls.
const EYES = variants<Variant<'eyes'>>(2, 4, 6, 10, 12, 13, 16, 20, 21, 24);
const EYEBROWS = variants<Variant<'eyebrows'>>(1, 2, 4, 5, 6, 7, 9, 10);
const MOUTH: Variant<'mouth'>[] = ['happy01', 'happy02', 'happy03', 'happy13', 'happy14', 'sad09'];

// Hair variants, sorted from the 48 on the contact sheet by how far they fall.
const HAIR_LONG = variants<Variant<'hair'>>(10, 13, 15, 16, 19, 21, 23, 29, 30, 31, 32, 33, 35, 37, 40, 41, 42, 45, 48);
const HAIR_SHORT = variants<Variant<'hair'>>(1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 17, 20, 22, 25, 27, 28, 34, 39, 43, 47);
const HAIR_ANY = variants<Variant<'hair'>>(...Array.from({ length: 48 }, (_, i) => i + 1));
const BEARD = variants<Variant<'beard'>>(1, 2);

// Skin runs fair to deep, each tone warmed slightly towards parchment so it sits on the page like a
// wash of ink rather than a flat sticker colour. Without a recorded look we don't guess anyone's
// appearance: a neutral parchment instead.
const SKIN = ['f2dcc3', 'e6c4a2', 'd2a37e', 'b8835c', '956442', '704a32'];
const PARCHMENT = 'eadcc0';
// Hair: inks and earth pigments; greys cover ageing hair.
const HAIR = ['241c16', '3d2c21', '624a35', '7f5838', 'a98552', 'cdb07c', '8f4a2a'];
const GREY = ['a9a39a', 'c4beb3', 'ddd7cb'];

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const yearOf = (s?: string) => {
  const m = s?.match(/\d{3,4}/);
  return m ? Number(m[0]) : undefined;
};

/** Age at death, or current age for the living. Undefined when the birth year or the end is unknown. */
export function ageOf(p: GPerson, now: number): number | undefined {
  const born = yearOf(p.born);
  if (born === undefined) return undefined;
  const end = yearOf(p.died) ?? (p.living ? now : undefined);
  return end === undefined ? undefined : end - born;
}

export function faceOptions(p: GPerson, now: number) {
  const known = !!p.look;
  const look = p.look ?? { skin: 0, hair: hash(`${p.id}:hair`), eyes: 0 };
  const age = ageOf(p, now);
  const child = age !== undefined && age < 16;
  const grey = age !== undefined && age >= 60;
  // A recorded beard wins. Otherwise an adult man is bearded about half the time.
  const beard = child || p.sex !== 'm' ? 0 : look.beard === undefined ? 50 : look.beard ? 100 : 0;
  return {
    seed: p.id,
    hair: p.sex === 'f' ? HAIR_LONG : p.sex === 'm' ? HAIR_SHORT : HAIR_ANY,
    eyes: EYES,
    eyebrows: EYEBROWS,
    mouth: MOUTH,
    beard: BEARD,
    beardProbability: beard,
    skinColor: [known ? SKIN[look.skin % SKIN.length] : PARCHMENT],
    hairColor: [grey ? GREY[look.hair % GREY.length] : HAIR[look.hair % HAIR.length]],
    earringsProbability: 0,
    frecklesProbability: 0,
    glassesProbability: 0,
    hairAccessoriesProbability: 0,
  };
}

/** The lorelei drawing as a nested <svg> filling a 100 × 100 box, line work in ink. */
export function faceSvg(options: ReturnType<typeof faceOptions>): string {
  return createAvatar(lorelei, options)
    .toString()
    .replace(/<metadata[\s\S]*?<\/metadata>/, '')
    .replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '<svg width="100" height="100"')
    .replace(/fill="#000(000)?"/g, `fill="${INK}"`);
}
