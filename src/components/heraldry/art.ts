// Where a charge's drawing comes from: a classic shape, a core glyph in the main bundle, or the library. The library
// loads on demand: its charges' metadata once (library/charges.gen.ts), and each category's glyphs when a charge of
// that category, or a helm, is drawn (library/glyphs/<category>.gen.ts). A shield draws without a glyph it is still
// waiting for, then fills in; a component that draws charges calls useLibrary with them, and re-renders as they arrive.
import { useEffect, useSyncExternalStore } from 'react';
import { CHARGE_ICONS } from '../charges.gen';
import { CHARGE_BY_ID, type ChargeDef } from './catalogue';
import { CLASSIC, CLASSIC_VIEWBOX } from './classic';
import { addLibraryCharges, chargeDef } from './registry';

export interface Art {
  viewBox: string;
  body: string;
}

type Glyphs = Record<string, Art>;

/** The glyph modules, one per category. Vite splits each into its own chunk; a shield loads only the ones it draws. */
const CATEGORY_GLYPHS: Record<string, () => Promise<{ GLYPHS: Glyphs }>> = {
  crosses: () => import('./library/glyphs/crosses.gen'),
  beasts: () => import('./library/glyphs/beasts.gen'),
  birds: () => import('./library/glyphs/birds.gen'),
  sea: () => import('./library/glyphs/sea.gen'),
  monsters: () => import('./library/glyphs/monsters.gen'),
  plants: () => import('./library/glyphs/plants.gen'),
  celestial: () => import('./library/glyphs/celestial.gen'),
  weapons: () => import('./library/glyphs/weapons.gen'),
  tools: () => import('./library/glyphs/tools.gen'),
  buildings: () => import('./library/glyphs/buildings.gen'),
  crowns: () => import('./library/glyphs/crowns.gen'),
  objects: () => import('./library/glyphs/objects.gen'),
  faith: () => import('./library/glyphs/faith.gen'),
  body: () => import('./library/glyphs/body.gen'),
  music: () => import('./library/glyphs/music.gen'),
};

const glyphs: Glyphs = {};
const loadedCategories = new Set<string>();
const pendingCategories = new Map<string, Promise<void>>();
let metaReady = false;
let metaPending: Promise<void> | undefined;

// A version number the components subscribe to: it moves whenever a part of the library arrives.
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const changed = () => {
  version++;
  for (const listener of listeners) listener();
};

function loadMeta(): Promise<void> {
  if (metaReady) return Promise.resolve();
  metaPending ??= import('./library/charges.gen').then(
    (m) => {
      addLibraryCharges(m.LIBRARY_CHARGES);
      metaReady = true;
      changed();
    },
    (e: unknown) => {
      metaPending = undefined;
      throw e;
    },
  );
  return metaPending;
}

function loadCategory(cat: string): Promise<void> {
  if (loadedCategories.has(cat)) return Promise.resolve();
  let p = pendingCategories.get(cat);
  if (!p) {
    const load = CATEGORY_GLYPHS[cat];
    p = load
      ? load().then(
        (m) => {
          Object.assign(glyphs, m.GLYPHS);
          loadedCategories.add(cat);
          changed();
        },
        (e: unknown) => {
          pendingCategories.delete(cat);
          throw e;
        },
      )
      : Promise.resolve();
    pendingCategories.set(cat, p);
  }
  return p;
}

/** The library's metadata is needed for any charge the catalogue does not know, and for the picker's search. */
export function libraryMetaLoaded(): boolean {
  return metaReady;
}

/**
 * Loads what the given charges need: the metadata when one is unknown (or when none is given: the picker's search
 * needs every name), and the glyph module of each category they draw from. `cats` names extra categories, such as
 * the weapons module for the achievement's helms.
 */
export async function ensureLibrary(ids: readonly string[] = [], cats: readonly string[] = []): Promise<void> {
  if (!ids.length || ids.some((id) => !chargeDef(id))) await loadMeta();
  const need = new Set(cats);
  for (const id of ids) {
    const d = chargeDef(id);
    if (d?.gi && d.cat !== 'classic' && !(d.gi in CHARGE_ICONS)) need.add(d.cat);
  }
  await Promise.all([...need].map(loadCategory));
}

/** A glyph by its game-icons name, from the core set or the loaded library. */
export function glyph(gi: string): Art | undefined {
  return (CHARGE_ICONS as Record<string, Art>)[gi] ?? glyphs[gi];
}

/** The drawing of a charge by catalogue id, or undefined while its library glyph is still loading. */
export function chargeArtV2(id: string): Art | undefined {
  const c = chargeDef(id);
  if (!c || !c.gi) return CLASSIC[id] ? { viewBox: CLASSIC_VIEWBOX, body: CLASSIC[id] } : undefined;
  return glyph(c.gi);
}

/** True when the given charges, and the given categories, are all drawable now. */
export function libraryReady(ids: readonly string[] = [], cats: readonly string[] = []): boolean {
  for (const id of ids) {
    const d = chargeDef(id);
    // A charge nobody knows is not waiting on anything once the metadata is in; it is drawn as the classic shape or not at all.
    if (!d) {
      if (!metaReady) return false;
      continue;
    }
    if (d.gi && d.cat !== 'classic' && !(d.gi in CHARGE_ICONS) && !(d.gi in glyphs)) return false;
  }
  return cats.every((c) => loadedCategories.has(c));
}

/** Re-renders the caller as the library changes, loads what `ids` and `cats` need, and says whether it is all there. */
export function useLibrary(ids: readonly string[] = [], cats: readonly string[] = []): boolean {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const key = `${ids.join(',')}|${cats.join(',')}`;
  useEffect(() => {
    if (!libraryReady(ids, cats)) void ensureLibrary(ids, cats).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return libraryReady(ids, cats);
}

/** Where a renderer looks up its drawings. */
export interface ArtSource {
  charge: (id: string) => Art | undefined;
  glyph: (gi: string) => Art | undefined;
  def: (id: string) => ChargeDef | undefined;
}

const LOADED: ArtSource = { charge: chargeArtV2, glyph, def: chargeDef };
/** The drawings in the main bundle: the same on the server and in every browser, whatever has loaded so far. */
const BUNDLED: ArtSource = {
  charge: (id) => {
    const c = CHARGE_BY_ID[id];
    if (!c?.gi) return CLASSIC[id] ? { viewBox: CLASSIC_VIEWBOX, body: CLASSIC[id] } : undefined;
    return (CHARGE_ICONS as Record<string, Art>)[c.gi];
  },
  glyph: (gi) => (CHARGE_ICONS as Record<string, Art>)[gi],
  def: (id) => CHARGE_BY_ID[id],
};

/**
 * useLibrary for code that draws, and is rendered on the server. The library is a cache filled by whatever the page
 * has drawn so far, so it can hold a glyph the server never had by the time a part of the page hydrates. The server's
 * snapshot is always 0, so the server and the hydrating render both draw from the main bundle, and the library's
 * drawings appear in the re-render React does straight after.
 */
export function useArt(ids: readonly string[] = [], cats: readonly string[] = []): ArtSource {
  const seen = useSyncExternalStore(subscribe, () => version, () => 0);
  useLibrary(ids, cats);
  return seen === 0 ? BUNDLED : LOADED;
}

/** Re-renders the caller when the library's metadata arrives, and asks for it. For the picker, which lists every charge. */
export function useLibraryMeta(): boolean {
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    if (!metaReady) void loadMeta().catch(() => undefined);
  }, []);
  return metaReady;
}
