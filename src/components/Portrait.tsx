import { lorelei } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import type { GPerson, Look } from '~/lib/types';
import { CHARGE_ICONS, type ChargeIconName } from './charges.gen';

const HEADWEAR_ICON: Partial<Record<NonNullable<Look['headwear']>, ChargeIconName>> = {
  crown: 'crown',
  circlet: 'laurel-crown',
  mitre: 'pope-crown',
};

// Lorelei colours are hex without '#'. Skin runs fair to deep; greys cover ageing hair.
const SKIN = ['f6dcc6', 'ecc3a2', 'dca483', 'c48762', 'a06a46', '7d4d30'];
const HAIR = ['1d1915', '3b2a20', '6a4e35', '8a5a3a', 'b98a52', 'd9b77a', 'a4441f'];
const GREY = ['bdbdbd', 'd3d3d3', 'ececec'];

type LoreleiOptions = Parameters<typeof lorelei.create>[0]['options'];
type Variant<K extends keyof LoreleiOptions> = LoreleiOptions[K] extends (infer V)[] | undefined ? V : never;
const variants = <T extends string>(...n: number[]): T[] => n.map((i) => `variant${String(i).padStart(2, '0')}` as T);

// Lorelei hair variants, sorted from the 48 on the contact sheet by how far they fall.
const HAIR_LONG = variants<Variant<'hair'>>(10, 13, 15, 16, 19, 21, 23, 29, 30, 31, 32, 33, 35, 37, 40, 41, 42, 45, 48);
const HAIR_SHORT = variants<Variant<'hair'>>(1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 17, 20, 22, 25, 27, 28, 34, 39, 43, 47);
const HAIR_ANY = variants<Variant<'hair'>>(...Array.from({ length: 48 }, (_, i) => i + 1));
const BEARD = variants<Variant<'beard'>>(1, 2);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const yearOf = (s?: string) => {
  const m = s?.match(/\d{3,4}/);
  return m ? Number(m[0]) : undefined;
};

/** Age at death, or current age for the living. Undefined when the birth year or the end is unknown. */
function ageOf(p: GPerson, now: number): number | undefined {
  const born = yearOf(p.born);
  if (born === undefined) return undefined;
  const end = yearOf(p.died) ?? (p.living ? now : undefined);
  return end === undefined ? undefined : end - born;
}

function avatarOptions(p: GPerson, now: number) {
  // Without a recorded look we don't guess anyone's appearance: a neutral parchment tone instead.
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
    beard: BEARD,
    beardProbability: beard,
    skinColor: [known ? SKIN[look.skin % SKIN.length] : 'e6dccb'],
    hairColor: [grey ? GREY[look.hair % GREY.length] : HAIR[look.hair % HAIR.length]],
    earringsProbability: 0,
    frecklesProbability: 0,
    glassesProbability: 0,
    hairAccessoriesProbability: 0,
  };
}

// Hundreds of portraits render at once and each one is deterministic, so generate each SVG once.
const avatars = new Map<string, string>();

function avatarUri(p: GPerson): string {
  const options = avatarOptions(p, new Date().getFullYear());
  const key = JSON.stringify(options);
  let uri = avatars.get(key);
  if (uri === undefined) {
    uri = createAvatar(lorelei, options).toDataUri();
    avatars.set(key, uri);
  }
  return uri;
}

export function Portrait({ person, tree, size = 96, frame = true }: { person: GPerson; tree: string; size?: number; frame?: boolean }) {
  const headwear = person.look?.headwear;
  const badge = headwear && HEADWEAR_ICON[headwear] ? CHARGE_ICONS[HEADWEAR_ICON[headwear]] : null;
  const src = person.photo
    ? `/api/photo/${tree}/${person.id}?v=${encodeURIComponent(person.photo)}`
    : avatarUri(person);
  const name = [person.given, person.surname].filter(Boolean).join(' ');

  return (
    <span className={frame ? 'portrait is-framed' : 'portrait'} style={{ width: size, height: size }}>
      <span className="portrait-face">
        <img
          className={person.living ? 'portrait-img' : 'portrait-img is-dead'}
          src={src}
          alt={name}
          loading={person.photo ? 'lazy' : undefined}
          decoding="async"
          draggable={false}
        />
      </span>
      {badge ? (
        // Centred on the top edge, so the crown sits half above the frame, as in CK3.
        <svg
          className="portrait-crown"
          viewBox={badge.viewBox}
          width={size * 0.36}
          height={size * 0.36}
          style={{ top: -size * 0.18 }}
          aria-hidden="true"
        >
          <g dangerouslySetInnerHTML={{ __html: badge.body }} />
        </svg>
      ) : null}
    </span>
  );
}
