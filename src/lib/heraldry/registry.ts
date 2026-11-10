// Every charge the heraldry knows: the catalogue's own (in the main bundle) and the library's (loaded on demand, see
// art.ts; on the server they are added at start). A library charge is unknown until its metadata is added, so a
// lookup before that returns undefined and the caller shows the id, then re-renders when the library arrives.
//
// Pure (no React, no `~` imports), so the test runner and the server load it.
import { translate } from '../i18n/dictionary.ts';
import type { Locale } from '../i18n/types.ts';
import { CHARGE_BY_ID, CHARGES_V2, type ChargeDef } from './catalogue.ts';

const library = new Map<string, ChargeDef>();

/** Adds library charges. Adding one twice is harmless. */
export function addLibraryCharges(defs: readonly ChargeDef[]): void {
  for (const d of defs) library.set(d.id, d);
}

/** A charge by id: from the catalogue, or from the library once its metadata is in. */
export function chargeDef(id: string): ChargeDef | undefined {
  return CHARGE_BY_ID[id] ?? library.get(id);
}

/** Every charge known so far: the catalogue's first, then the library's. */
export function allChargeDefs(): ChargeDef[] {
  return [...CHARGES_V2, ...library.values()];
}

/** A charge's name in a language: its own name for a library charge, its translated label for a catalogue charge. */
export function chargeLabel(def: ChargeDef, locale: Locale): string {
  return def.name ? def.name[locale] : translate(locale, def.label!);
}

/** The name of a charge by id, or the id itself while the charge is unknown. */
export function chargeName(id: string, locale: Locale): string {
  const def = chargeDef(id);
  return def ? chargeLabel(def, locale) : id;
}

/** Every word a charge answers to in every language (its names and its search words), lower case, for matching. */
export function chargeWords(def: ChargeDef): string {
  const names = def.name ? [def.name.en, def.name.de, def.name.af] : [translate('en', def.label!), translate('de', def.label!), translate('af', def.label!)];
  return [...names, def.id.replace(/-/g, ' '), def.keys ?? ''].join(' ');
}
