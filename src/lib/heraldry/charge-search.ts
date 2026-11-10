// Finds charges by words, in any language: the picker's search, and the candidates the AI is shown for the meanings a
// family chose. Pure, so the server and the test runner use the same matching as the picker.
import type { ChargeDef } from './catalogue.ts';
import { allChargeDefs, chargeWords } from './registry.ts';

/** Lower case, without accents: "Mühlrad" matches "muhlrad", "Schuhmacher" matches "schuhmacher". */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** A charge's own words, folded and split, kept per charge so a keystroke does not fold the library again. */
const ownCache = new WeakMap<ChargeDef, string[]>();
function ownTokens(def: ChargeDef): string[] {
  let own = ownCache.get(def);
  if (!own) ownCache.set(def, (own = tokens(`${chargeWords(def)} ${def.cat}`)));
  return own;
}

/** Every word the charges know: what tells a whole word ("staff") from a word still being typed ("staf…"). */
function vocabularyOf(defs: readonly ChargeDef[]): Set<string> {
  const out = new Set<string>();
  for (const d of defs) for (const t of ownTokens(d)) out.add(t);
  return out;
}

/** German and Dutch endings and linking letters: "Stiefels", "Schuhmachers", the "s" in "Amtsstab". */
const ENDING = /^(e|en|er|ern|es|ens|n|s)$/;
const LINK = /^(es|en|er|e|n|s)/;

/**
 * The rest of a longer word after a whole word: an ending, or another word the charges know, so "Stamm" leads into
 * "Stammbaum" and "Amt" into "Amtsstab", but "staff" does not lead into "Staffelei", whose "elei" is no word.
 */
function restIsWord(rest: string, vocab: Set<string>): boolean {
  if (ENDING.test(rest) || (rest.length >= 3 && vocab.has(rest))) return true;
  const link = LINK.exec(rest)?.[0];
  return !!link && rest.length - link.length >= 3 && vocab.has(rest.slice(link.length));
}

/**
 * A longer word begins with a shorter one as its stem. A shorter word the charges do not know as a whole (a word being
 * typed, or a stem like "schuh") may begin any longer word; a whole word only one that goes on with an ending or a word.
 */
function stemOf(short: string, long: string, vocab: Set<string>): boolean {
  return long.startsWith(short) && (!vocab.has(short) || restIsWord(long.slice(short.length), vocab));
}

/**
 * A query word names a charge's token when they are the same, when the token ends with it (the head of a compound:
 * "Stiefel" in "Eisenstiefel", "Rad" in "Mühlrad"), or when it is the token's stem. A word the charges do not know
 * as a whole may still sit anywhere in a token, as the picker's search did while a word is half typed.
 */
function searchMatches(word: string, token: string, vocab: Set<string>): boolean {
  if (token === word || token.endsWith(word) || stemOf(word, token, vocab)) return true;
  return !vocab.has(word) && token.includes(word);
}

/** The charges whose names, search words or category name every word of the query. An empty query finds them all. */
export function searchCharges(query: string, defs: readonly ChargeDef[] = allChargeDefs()): ChargeDef[] {
  const words = tokens(query);
  if (!words.length) return [...defs];
  const vocab = vocabularyOf(defs);
  return defs.filter((c) => {
    const own = ownTokens(c);
    return words.every((w) => own.some((t) => searchMatches(w, t, vocab)));
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

/**
 * A token of a charge's words names the term when they match, or when the shorter is long enough to be the longer
 * one's stem: "schuhmacher" for "schuhmachers", but not "staff" for "staffelei" (see stemOf).
 */
const matches = (term: string, token: string, vocab: Set<string>) =>
  term === token || (term.length >= 5 && stemOf(term, token, vocab)) || (token.length >= 5 && stemOf(token, term, vocab));

/**
 * The charges that answer to some of the terms, the best first. A charge scores one for each term it answers to, so
 * "a boot-maker" finds the boot before a charge that only shares "maker". Charges that answer to none are left out.
 */
export function candidateCharges(terms: readonly string[], limit = 40, defs: readonly ChargeDef[] = allChargeDefs()): ChargeDef[] {
  if (!terms.length) return [];
  const scored: { def: ChargeDef; score: number; at: number }[] = [];
  const vocab = vocabularyOf(defs);
  defs.forEach((def, at) => {
    const own = ownTokens(def);
    let score = 0;
    for (const term of terms) if (own.some((k) => matches(term, k, vocab))) score++;
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
