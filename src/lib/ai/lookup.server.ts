// The assistant's web lookup. The chat never gives the provider its web search: a lookup is a separate request whose
// only input is a fixed neutral instruction and the query. Before a query is sent, the guard refuses one that names a
// living person (a given name with their surname, current or birth, or a nickname), carries a private detail of this
// tree the reader may see, carries a web address or a search operator, or carries a long number such as a telephone.
// The guard compares words, folded (see `wordsOf`), so spelling variants and punctuation do not get past it.
import { db } from '../db.server';
import type { GPerson } from '../types';
import { isolatedSearch, type AiAdapter } from './adapters';

/** The instruction every lookup runs under. It names no family and carries no tree data: that is the point. */
export const LOOKUP_SYSTEM = 'You answer one question from the web: a fact of history, language, a trade, a custom, a place or a past event. Answer in at most five short sentences, in English. You know nothing about any family, household or person. Do not guess who the question is about.';
/** Searches one lookup may run. The budget reserves for these. */
export const LOOKUP_SEARCHES = 2;
/** A private value with fewer letters and digits than this is ignored: short values match too much of a query to be a secret. */
const MIN_PRIVATE = 4;
/** A nickname with fewer letters than this is ignored, for the same reason. */
const MIN_NICKNAME = 3;
/** The shortest given-name word and surname word that count. Shorter ones are initials. */
const MIN_GIVEN = 3;
const MIN_SURNAME = 2;
/**
 * Name particles. They are not a surname's own word: "van" in "van der Merwe" names the Merwe family, not every van. So a
 * query is not refused for a particle alone ("Jan van Riebeeck" is not "Jan van der Merwe"). A surname that is only particles
 * keeps them, so "Lisa Van" is still a name.
 */
const PARTICLES = new Set(['van', 'von', 'vom', 'zu', 'zum', 'zur', 'de', 'der', 'den', 'des', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'du', 'le', 'la', 'les', 'ten', 'ter', 'te', 'op', 'het', 'bin', 'ibn', 'al', 'el', 'af', 'av']);

/** What the guard holds for one tree. Built once per lookup from the people and, for a reader who may see them, the private fields. */
export interface PrivacyGuard {
  /** One entry per living person with a given name and a surname: the words of their names, current and birth. */
  living: { given: string[]; surname: string[] }[];
  /** The nicknames of living people, as words. A query that has every word of one names that person. */
  nicknames: string[][];
  /** The values of editors' fields the reader may see, as words. A query that has every word of one carries that value. Personal fields are never in here: a refusal must not tell anyone one exists. */
  privates: string[][];
}

export type Refusal = 'living-name' | 'nickname' | 'private' | 'web-address' | 'long-number';

/** The words of a text, folded for comparison: lower case, no diacritics, ß as ss, and an umlaut as its vowel or as the vowel
 *  with e (ä, ae and a are one word; Müller, Mueller and Muller too). Punctuation and spaces divide words. A format character
 *  (a zero-width space or joiner) divides words in one reading and is dropped in the other, so both readings are checked. */
function wordsOf(text: string, joined: boolean): string[] {
  const folded = text
    .normalize('NFKD')
    .replace(/\p{Cf}/gu, joined ? '' : ' ')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss');
  return folded
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.replace(/ae|oe|ue/g, (m) => m[0]));
}

/** Every word a text can be read as: the split reading and the joined one. */
const foldedWords = (text: string): Set<string> => new Set([...wordsOf(text, false), ...wordsOf(text, true)]);

/** The letters and digits of a text, for the length rules. */
const alnum = (s: string) => [...s].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;

/**
 * The guard's lists for one tree. A reader who may not see private fields gets none of them: a refusal never tells such a
 * reader that a private value exists. Reads the private fields in one query, and only when the reader may see them.
 */
export async function privacyGuard(tree: string, people: GPerson[], seePrivate: boolean): Promise<PrivacyGuard> {
  const living: PrivacyGuard['living'] = [];
  const nicknames: string[][] = [];
  // A name's words, and the same name written as one word ("Hanspeter", "vanderberg"), both count.
  const nameWords = (text: string | null | undefined, min: number): string[] => {
    const parts = wordsOf(text ?? '', false);
    return [...new Set([...parts, ...wordsOf(text ?? '', true), parts.join('')])].filter((w) => w.length >= min);
  };
  // A surname's words without its particles, unless nothing else is left (see PARTICLES).
  const surnameWords = (text: string | null | undefined): string[] => {
    const all = nameWords(text, MIN_SURNAME);
    // Judged on the written words: the joined form of "De La" ("dela") is not a word of its own.
    const hasOwn = wordsOf(text ?? '', false).some((w) => w.length >= MIN_SURNAME && !PARTICLES.has(w));
    return hasOwn ? all.filter((w) => !PARTICLES.has(w)) : all;
  };
  for (const p of people) {
    if (!p.living) continue;
    // Current and birth names both count, and in any mix: a given name from one with the surname from the other is still a name.
    const given = new Set([...nameWords(p.given, MIN_GIVEN), ...nameWords(p.currentGiven, MIN_GIVEN), ...(p.furtherGiven ?? []).flatMap((n) => nameWords(n, MIN_GIVEN))]);
    const surname = new Set([...surnameWords(p.surname), ...surnameWords(p.currentSurname)]);
    if (given.size && surname.size) living.push({ given: [...given], surname: [...surname] });
    if (p.nickname && alnum(p.nickname) >= MIN_NICKNAME) nicknames.push(wordsOf(p.nickname, false));
  }
  const privates: string[][] = [];
  if (seePrivate) {
    const rows = await db(tree).all<{ type: string; value: string }>("SELECT type, value FROM person_field WHERE visibility = 'editors'");
    for (const r of rows) {
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(r.value) as Record<string, unknown>;
      } catch {
        continue;
      }
      for (const [key, v] of Object.entries(value ?? {})) {
        if (typeof v !== 'string') continue;
        // A city or a country is not a private detail: "history of Stellenbosch" is a general question. Street and postcode are.
        if (r.type === 'address' && (key === 'city' || key === 'country')) continue;
        if (alnum(v) >= MIN_PRIVATE) privates.push(wordsOf(v, false));
      }
    }
  }
  return { living, nicknames, privates };
}

/** A web address, a link, or a search operator (site:, inurl:…). */
const WEB_ADDRESS = /https?:\/\/|\bwww\.|[\p{L}\p{N}]\.\p{L}{2,}|\b(?:site|inurl|intitle|allintitle|allinurl|filetype|related):/iu;
/** The query with its digits only, spaces and punctuation gone: how a telephone number is written, however it is spaced. */
const digitsOnly = (q: string) => q.normalize('NFKD').replace(/[\s\p{P}\p{S}\p{Cf}]/gu, '');

/** Why a query may not go to the web, or null when it may. Works on the query text alone. */
export function refusal(g: PrivacyGuard, query: string): Refusal | null {
  if (WEB_ADDRESS.test(query.replace(/\p{Cf}/gu, ''))) return 'web-address';
  if (/\d{6,}/.test(digitsOnly(query))) return 'long-number';
  const words = foldedWords(query);
  if (g.living.some((p) => p.given.some((w) => words.has(w)) && p.surname.some((w) => words.has(w)))) return 'living-name';
  if (g.nicknames.some((ws) => ws.every((w) => words.has(w)))) return 'nickname';
  if (g.privates.some((ws) => ws.every((w) => words.has(w)))) return 'private';
  return null;
}

/** What the reader and the model are told about a refusal. It names the kind of detail, never the detail. */
export const REFUSAL_REASON: Record<Refusal, string> = {
  'living-name': 'the query names a living person (a given name with their surname)',
  nickname: 'the query names a living person by a nickname',
  private: 'the query contains a private detail of this family',
  'web-address': 'the query contains a web address or a site search',
  'long-number': 'the query contains a long number, such as a telephone number',
};

/** One lookup: the query alone, under the fixed instruction, with the family's own budget reserved for it. */
export async function isolatedLookup(adapter: AiAdapter, query: string): Promise<{ text: string; sources: { url: string; title?: string }[]; searches: number }> {
  const r = await isolatedSearch(adapter, { system: LOOKUP_SYSTEM, prompt: query, maxUses: LOOKUP_SEARCHES, maxTokens: 600 });
  return { text: r.text.trim(), sources: r.sources ?? [], searches: r.searches };
}
