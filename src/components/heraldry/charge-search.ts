// Finds charges by words, in any language: the picker's search, and the candidates the AI is shown for the meanings a
// family chose. Pure, so the server and the test runner use the same matching as the picker.
import type { ChargeDef } from './catalogue.ts';
import { allChargeDefs, chargeWords } from './registry.ts';

/** Lower case, without accents: "Mühlrad" matches "muhlrad", "Schuhmacher" matches "schuhmacher". */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** The charges whose names, search words or category contain every word of the query. An empty query finds them all. */
export function searchCharges(query: string, defs: readonly ChargeDef[] = allChargeDefs()): ChargeDef[] {
  const words = tokens(query);
  if (!words.length) return [...defs];
  return defs.filter((c) => {
    const hay = fold(`${chargeWords(c)} ${c.cat}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Words too common to name a charge: articles, prepositions, and "name" and "family" in the three languages. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'its', 'their', 'name', 'names', 'means', 'family', 'trade',
  'sense', 'root', 'old', 'new', 'are', 'was', 'not', 'has', 'have', 'who', 'one', 'some', 'into', 'over', 'under',
  'der', 'die', 'das', 'und', 'von', 'mit', 'ein', 'eine', 'einer', 'dem', 'den', 'des', 'zur', 'zum', 'im', 'aus',
  'het', 'van', 'vir', 'een', 'met', 'uit', 'wat', 'ook', 'aan', 'deur',
]);

/** The words in some free text that can name a charge: lower-case tokens of three letters or more, without stop words. */
export function termsOf(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const w of tokens(t)) if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  return [...out];
}

/** A token of a charge's words names the term when they match, or when both are long enough to be one word's stem. */
const matches = (term: string, token: string) =>
  term === token || (term.length >= 5 && token.startsWith(term)) || (token.length >= 5 && term.startsWith(token));

/**
 * The charges that answer to some of the terms, the best first. A charge scores one for each term it answers to, so
 * "a boot-maker" finds the boot before a charge that only shares "maker". Charges that answer to none are left out.
 */
export function candidateCharges(terms: readonly string[], limit = 40, defs: readonly ChargeDef[] = allChargeDefs()): ChargeDef[] {
  if (!terms.length) return [];
  const scored: { def: ChargeDef; score: number; at: number }[] = [];
  defs.forEach((def, at) => {
    const own = tokens(`${chargeWords(def)} ${def.cat}`);
    let score = 0;
    for (const term of terms) if (own.some((k) => matches(term, k))) score++;
    if (score > 0) scored.push({ def, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, limit).map((s) => s.def);
}

/** General charges every shield may draw on when the meanings find no good one. Each must exist (see the test). */
export const STOCK_CHARGES = [
  'lion', 'eagle', 'crown', 'cross-patee', 'mullet', 'fleur', 'rose', 'castle', 'tower', 'sun', 'moon', 'star-north',
  'wheel', 'anchor', 'key', 'sword', 'bell', 'crescent', 'heart', 'hand', 'fish', 'horse', 'wolf', 'bear', 'stag',
  'boar', 'dove', 'swan', 'owl', 'raven', 'hawk', 'ship', 'church', 'house', 'mill-wheel', 'hammer', 'axe', 'book',
  'quill', 'scales', 'hourglass', 'compass', 'candle', 'cup', 'oak', 'pine', 'lily', 'trimount', 'annulet',
  'roundel', 'lozenge', 'escallop', 'dragon', 'griffin', 'unicorn', 'bridge', 'gate', 'crossbow',
];
