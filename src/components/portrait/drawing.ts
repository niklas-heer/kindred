// Turns a person into one cached SVG image. Hundreds of portraits render at once on the tree and
// every drawing is deterministic, so each is built once: a WeakMap per person record for the common
// re-render, and a key on the resolved appearance so relatives drawn alike share a string.
import { svgDataUri } from '~/lib/svg-data-uri';
import type { GPerson, House } from '~/lib/types';
import { avatarSvg, type Detail } from './avatar';
import { hash, resolveAppearance } from '../../lib/portrait-look';
import { dressOf } from './palette';

export type { Detail };
export const detailOf = (size: number): Detail => (size <= 40 ? 'sm' : size <= 72 ? 'md' : 'lg');

const drawings = new Map<string, string>();
const byPerson = new WeakMap<GPerson, Map<string, string>>();
const NOW = new Date().getFullYear();

export function drawingUri(p: GPerson, house: House | undefined, detail: Detail, at?: number): string {
  const known = byPerson.get(p);
  const short = `${house?.id ?? ''}|${detail}|${at ?? ''}`;
  const hit = known?.get(short);
  if (hit !== undefined) return hit;
  const uri = build(p, house, detail, at);
  if (known) known.set(short, uri);
  else byPerson.set(p, new Map([[short, uri]]));
  return uri;
}

function build(p: GPerson, house: House | undefined, detail: Detail, at?: number): string {
  const a = resolveAppearance(p, NOW, at);
  const dress = dressOf(house, hash(`${p.id}:dress`));
  const key = `${JSON.stringify(a)}|${dress.cloth}${dress.trim}${dress.metal}|${detail}`;
  let uri = drawings.get(key);
  if (uri === undefined) {
    // The editor makes a new drawing per change; keep the shared cache bounded.
    if (drawings.size > 4000) drawings.clear();
    uri = svgDataUri(avatarSvg(a, dress, detail));
    drawings.set(key, uri);
  }
  return uri;
}
