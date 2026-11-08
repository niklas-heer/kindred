// Where a charge's drawing comes from: a classic shape, a core glyph in the main bundle, or the library,
// which loads on demand. Shields that need a library glyph draw without it for a moment, then fill in.
import { useEffect, useSyncExternalStore } from 'react';
import { CHARGE_ICONS } from '../charges.gen';
import { CHARGE_BY_ID } from './catalogue';
import { CLASSIC, CLASSIC_VIEWBOX } from './classic';

export interface Art {
  viewBox: string;
  body: string;
}

type Library = Record<string, Art>;
let library: Library | undefined;
let loading: Promise<Library> | undefined;
const listeners = new Set<() => void>();

/** Loads the charge library once. The editor calls it on open; shields call it when they meet a library charge. */
export function loadLibrary(): Promise<Library> {
  if (library) return Promise.resolve(library);
  loading ??= import('./library.gen').then((m) => {
    library = m.LIBRARY;
    for (const l of listeners) l();
    return library;
  });
  return loading;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True once the library is in. The server and hydration always see false, so the markup matches. */
export function useLibraryReady(): boolean {
  return useSyncExternalStore(subscribe, () => library !== undefined, () => false);
}

/** A glyph by its game-icons name, from the core set or the loaded library. */
export function glyph(gi: string): Art | undefined {
  return (CHARGE_ICONS as Record<string, Art>)[gi] ?? library?.[gi];
}

/** The drawing of a charge by catalogue id, or undefined while its library glyph is still loading. */
export function chargeArtV2(id: string): Art | undefined {
  const c = CHARGE_BY_ID[id];
  if (!c) return CLASSIC[id] ? { viewBox: CLASSIC_VIEWBOX, body: CLASSIC[id] } : undefined;
  if (!c.gi) return CLASSIC[id] ? { viewBox: CLASSIC_VIEWBOX, body: CLASSIC[id] } : undefined;
  return glyph(c.gi);
}

/** True when drawing these charges needs the library. */
export function needsLibrary(ids: Iterable<string>, extraGlyphs: Iterable<string> = []): boolean {
  for (const id of ids) {
    const c = CHARGE_BY_ID[id];
    if (c?.gi && !(c.gi in CHARGE_ICONS)) return true;
  }
  for (const g of extraGlyphs) if (!(g in CHARGE_ICONS)) return true;
  return false;
}

/** Re-renders the caller when the library arrives, and asks for it when `needed`. */
export function useLibrary(needed: boolean): boolean {
  const ready = useLibraryReady();
  useEffect(() => {
    if (needed && !ready) void loadLibrary();
  }, [needed, ready]);
  return ready;
}
