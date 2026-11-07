import { useId } from 'react';
import type { Tincture } from '~/lib/seed-format';
import type { House } from '~/lib/types';
import { CHARGE_ICONS, type ChargeIconName } from './charges.gen';

export const TINCTURE_HEX: Record<Tincture, string> = {
  or: '#d4a53c',
  argent: '#e8e6df',
  gules: '#b3312c',
  azure: '#2d5aa0',
  vert: '#2f7a46',
  sable: '#26241f',
  purpure: '#7b3f7f',
};

const CHARGE_NAME: Record<Exclude<House['arms']['charge'], 'none'>, ChargeIconName> = {
  lion: 'lion',
  eagle: 'eagle-emblem',
  tower: 'tower-flag',
  star: 'star-formation',
  crescent: 'moon',
  fleur: 'fleur-de-lys',
  key: 'key',
  rose: 'rose',
  boar: 'boar',
  stag: 'stag-head',
  sword: 'broadsword',
};

// A default second tincture: metal on colour, colour on metal.
const METALS: ReadonlySet<Tincture> = new Set(['or', 'argent']);
function contrastOf(t: Tincture): Tincture {
  return METALS.has(t) ? 'gules' : 'argent';
}

// Heater shield inside a 100 x 120 box, inset so the dark outline is not clipped.
const SHIELD = 'M5 5H95V62C95 92 77 107 50 116C23 107 5 92 5 62Z';

/** The dominant tincture of a coat of arms: its primary field. Used for minimap dots and accents. */
export function houseColour(arms: House['arms']): string {
  return TINCTURE_HEX[arms.field];
}

/** Paints the field and the division, in colours `a` (field) and `b` (field2), over the whole box. */
function Division({ division, a, b }: { division: House['arms']['division']; a: string; b: string }) {
  switch (division) {
    case 'plain':
      return <rect width="100" height="120" fill={a} />;
    case 'per-pale':
      return (
        <>
          <rect width="50" height="120" fill={a} />
          <rect x="50" width="50" height="120" fill={b} />
        </>
      );
    case 'per-fess':
      return (
        <>
          <rect width="100" height="60" fill={a} />
          <rect y="60" width="100" height="60" fill={b} />
        </>
      );
    case 'per-bend':
      return (
        <>
          <rect width="100" height="120" fill={b} />
          <polygon points="0,0 100,0 100,120" fill={a} />
        </>
      );
    case 'quarterly':
      return (
        <>
          <rect width="100" height="120" fill={b} />
          <rect width="50" height="60" fill={a} />
          <rect x="50" y="60" width="50" height="60" fill={a} />
        </>
      );
    case 'chevron':
      return (
        <>
          <rect width="100" height="120" fill={a} />
          <polygon points="5,70 50,34 95,70 95,94 50,58 5,94" fill={b} />
        </>
      );
    case 'paly':
      return (
        <>
          <rect width="100" height="120" fill={a} />
          {[1, 3, 5].map((i) => (
            <rect key={i} x={(i * 100) / 6} width={100 / 6} height="120" fill={b} />
          ))}
        </>
      );
    case 'bendy':
      // Six bends running top-left to bottom-right, the same angle as per-bend's diagonal.
      return (
        <>
          <rect width="100" height="120" fill={a} />
          <g transform="translate(50 60) rotate(50.2)">
            {[1, 3, 5].map((i) => (
              <rect key={i} x="-200" y={-80 + (i * 160) / 6} width="400" height={160 / 6} fill={b} />
            ))}
          </g>
        </>
      );
    case 'saltire':
      return (
        <>
          <rect width="100" height="120" fill={a} />
          <path d="M0 0L100 120M100 0L0 120" fill="none" stroke={b} strokeWidth={24} />
        </>
      );
    case 'cross':
      return (
        <>
          <rect width="100" height="120" fill={a} />
          <rect x="38" width="24" height="120" fill={b} />
          <rect y="44" width="100" height="24" fill={b} />
        </>
      );
  }
}

/** A game-icons charge centred on the shield, about 55% of its width. */
function Charge({ name, colour }: { name: ChargeIconName; colour: string }) {
  const icon = CHARGE_ICONS[name];
  return (
    <>
      <svg x="25.8" y="31.2" width="50" height="50" viewBox={icon.viewBox} overflow="visible" color="#000" opacity=".45">
        <g dangerouslySetInnerHTML={{ __html: icon.body }} />
      </svg>
      <svg x="25" y="30" width="50" height="50" viewBox={icon.viewBox} overflow="visible" color={colour}>
        <g dangerouslySetInnerHTML={{ __html: icon.body }} />
      </svg>
    </>
  );
}

export function Arms({ arms, size = 32, title }: { arms: House['arms']; size?: number; title?: string }) {
  // useId contains characters that are awkward inside url(#…); keep only word characters.
  const id = useId().replace(/\W/g, '');
  const clip = `${id}-shield`;
  const sheen = `${id}-sheen`;
  const shade = `${id}-shade`;

  const a = TINCTURE_HEX[arms.field];
  const b = TINCTURE_HEX[arms.field2 ?? contrastOf(arms.field)];

  return (
    <svg
      className="arms"
      width={size}
      height={(size * 6) / 5}
      viewBox="0 0 100 120"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
        {/* Light from above, darker at the foot: reads as a lacquered metal plate. */}
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".42" />
          <stop offset=".4" stopColor="#fff" stopOpacity=".06" />
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".3" />
        </linearGradient>
        {/* Edge darkening, so the field curls away from the light. */}
        <radialGradient id={shade} cx=".5" cy=".42" r=".62">
          <stop offset=".62" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".38" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <Division division={arms.division} a={a} b={b} />
        {arms.charge !== 'none' ? <Charge name={CHARGE_NAME[arms.charge]} colour={TINCTURE_HEX[arms.chargeTincture]} /> : null}
        <rect width="100" height="120" fill={`url(#${sheen})`} />
        <rect width="100" height="120" fill={`url(#${shade})`} />
      </g>
      {/* Inner bevel: a pale line just inside the edge. */}
      <path
        d={SHIELD}
        transform="translate(50 60) scale(.93) translate(-50 -60)"
        fill="none"
        stroke="#fff"
        strokeOpacity=".35"
        strokeWidth={1.2}
      />
      <path d={SHIELD} fill="none" stroke="#17130d" strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}
