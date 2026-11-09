// How far the tree canvas zooms, and what a card shows at each zoom. Kept apart from the canvas so the
// thresholds can be tested: they decide whether a family opens as portraits, name plates or shields.
import { CARD_H, ROW_H } from './layout.ts';

/**
 * What a card shows, from closest to farthest: `near` a portrait with name, title and years; `mid` a name
 * plate with larger type; `seal` the house shield with the given name under it; `far` the shield alone.
 */
export type Detail = 'far' | 'seal' | 'mid' | 'near';

/** Name sizes in world pixels at each level that shows one (card.css reads them as --name-near, --name-mid and --name-seal). */
export const NAME_PX = { near: 15, mid: 24, seal: 32 } as const;
/** Smallest name on screen we accept on a card or a name plate before dropping to a simpler level. */
export const MIN_TEXT_PX = 14;
/** Under a shield a single given name stays legible a little smaller; below this the shields stand alone. */
export const MIN_SEAL_PX = 11;

/**
 * Detail follows the size names actually reach on screen (zoom × font size), not fixed zoom steps.
 * With a little hysteresis, so cards don't flicker between levels while zooming near a threshold.
 */
export function detailFor(k: number, prev: Detail): Detail {
  const keep = 0.5; // px of slack before leaving the current level
  const order: Detail[] = ['far', 'seal', 'mid', 'near'];
  const held = (level: Detail) => (order.indexOf(prev) >= order.indexOf(level) ? keep : 0);
  if (k * NAME_PX.near >= MIN_TEXT_PX - held('near')) return 'near';
  if (k * NAME_PX.mid >= MIN_TEXT_PX - held('mid')) return 'mid';
  if (k * NAME_PX.seal >= MIN_SEAL_PX - held('seal')) return 'seal';
  return 'far';
}

/** The smallest zoom that still shows name plates (coming from a closer level). */
export const MID_K = (MIN_TEXT_PX - 0.5) / NAME_PX.mid;
/** When the whole tree won't fit at name plates, open at this zoom around the focus instead of shrinking it to tiles. */
export const READABLE_K = MIN_TEXT_PX / NAME_PX.mid + 0.01;
/** The smallest zoom that shows portraits and full cards. */
export const NEAR_K = MIN_TEXT_PX / NAME_PX.near + 0.005;
/** The closest the canvas zooms in. */
export const MAX_K = 2.2;

/** Coming from full cards, the level holds a little below its threshold (the hysteresis in `detailFor`); just inside that. */
const NEAR_HELD_K = (MIN_TEXT_PX - 0.5) / NAME_PX.near + 0.005;
/** Parents, a person and their children, whole: two rows and a card. */
const THREE_GENERATIONS = 2 * ROW_H + CARD_H;

/**
 * The zoom a tree opens at. `fitW` and `fitH` are the zooms at which the whole tree fits the free area across
 * and down; the free area is `width` by `height` screen pixels.
 *
 * - A tree that fits whole at full cards, or so nearly that a row or column just runs off the edge, opens on
 *   full cards, as large as fits and never past life size.
 * - A narrow tree (a family of a dozen over five generations) opens as large as still shows three generations
 *   whole, up to full cards, when every row fits across at that zoom; the outer generations run off the edge
 *   as they do in a large tree. It keeps full cards when three generations miss them by a few percent, inside
 *   the slack that level already has.
 * - Any other tree that fits at name plates opens whole, at name plates.
 * - A larger tree opens on readable name plates around the focus.
 * - A phone holds few cards across at any zoom, so it spends its height on type: as large as still shows
 *   three generations whole, up to a fifth above readable.
 */
export function openingZoom(fitW: number, fitH: number, width: number, height: number): number {
  const phone = width < 600;
  const fitK = Math.min(fitW, fitH);
  const three = height / THREE_GENERATIONS;
  if (fitK >= NEAR_K * 0.86) return Math.min(Math.max(fitK, NEAR_K), 1);
  const narrow = three >= NEAR_HELD_K ? Math.min(three, NEAR_K) : Math.max(three, READABLE_K);
  if (!phone && fitW >= narrow && narrow > fitK) return narrow;
  if (fitK >= MID_K) return fitK;
  return phone ? Math.max(READABLE_K, Math.min(READABLE_K * 1.2, three)) : READABLE_K;
}

/**
 * The farthest the canvas zooms out: a little past the whole tree in view (`fitK`), so the tree can be seen
 * with air around it but never shrinks to a smudge in an empty field. A tree of a few people, which fits when
 * zoomed far in, can still be taken out to where the shields stand alone; the largest dynasties stop at 4 %.
 */
export function minZoom(fitK: number): number {
  const shieldsAlone = (MIN_SEAL_PX / NAME_PX.seal) * 0.85;
  return Math.max(0.04, Math.min(fitK * 0.8, shieldsAlone));
}
