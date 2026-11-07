// Composes face and attire into one SVG image per person and caches it. Hundreds of portraits
// render at once on the tree, and every drawing is deterministic, so each is built only once.
import type { GPerson, House } from '~/lib/types';
import { attireDefs, attireSvg, eraOf, type Detail } from './attire';
import { faceOptions, faceSvg, hash } from './face';
import { dressOf } from './palette';

// Where lorelei's 100 × 100 drawing sits in the portrait: the bust fills the lower edge of the
// roundel. At list sizes the head is drawn larger, so a face still reads at 28 pixels.
const PLACE: Record<Detail, string> = {
  sm: 'translate(-1.5 -2) scale(1.03)',
  md: 'translate(6.1 -2) scale(.88)',
  lg: 'translate(7.6 -3) scale(.85)',
};

// The print: lines wobble a little (feTurbulence + feDisplacementMap) and a fine grain sits in
// the ink, so the flat vector reads as an engraving. One definition, baked into every cached
// drawing rather than applied live in CSS: the browser then rasterises it once per image, where a
// live turbulence filter on the tree cost about 70% more per frame while zooming. List sizes skip
// it; a wobble of a fraction of a pixel cannot be seen.
const PRINT: Record<Detail, string> = {
  sm: '',
  md: print(1.8, 0.9, 0.1),
  lg: print(1.6, 1.1, 0.14),
};

function print(wobble: number, grain: number, depth: number): string {
  return (
    `<filter id="print" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency=".07" numOctaves="2" seed="11" result="wob"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="wob" scale="${wobble}" xChannelSelector="R" yChannelSelector="G" result="moved"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${grain}" numOctaves="1" seed="3" result="noise"/>` +
    `<feColorMatrix in="noise" type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1" result="grain"/>` +
    `<feComposite in="moved" in2="grain" operator="arithmetic" k1="${depth}" k2="${1 - depth / 2}" result="inked"/>` +
    `<feComposite in="inked" in2="moved" operator="in"/>` +
    `</filter>`
  );
}

export const detailOf = (size: number): Detail => (size <= 40 ? 'sm' : size <= 72 ? 'md' : 'lg');

const drawings = new Map<string, string>();
// Person records are stable objects from the graph query: remember their drawings directly, so a
// re-render costs one lookup instead of rebuilding the options.
const byPerson = new WeakMap<GPerson, Map<string, string>>();

export function drawingUri(p: GPerson, house: House | undefined, detail: Detail): string {
  const known = byPerson.get(p);
  const short = `${house?.id ?? ''}|${detail}`;
  const hit = known?.get(short);
  if (hit !== undefined) return hit;
  const uri = build(p, house, detail);
  if (known) known.set(short, uri);
  else byPerson.set(p, new Map([[short, uri]]));
  return uri;
}

function build(p: GPerson, house: House | undefined, detail: Detail): string {
  const options = faceOptions(p, new Date().getFullYear());
  const era = eraOf(p);
  const key = `${JSON.stringify(options)}|${house?.id ?? ''}|${era}|${detail}|${p.sex ?? ''}`;
  let uri = drawings.get(key);
  if (uri === undefined) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<defs>${PRINT[detail]}${detail === 'lg' ? attireDefs() : ''}</defs>` +
      `<g${PRINT[detail] ? ' filter="url(#print)"' : ''}><g transform="${PLACE[detail]}">` +
      faceSvg(options) +
      attireSvg(era, dressOf(house, hash(`${p.id}:dress`)), detail, p.sex) +
      `</g></g>` +
      `</svg>`;
    uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    drawings.set(key, uri);
  }
  return uri;
}
