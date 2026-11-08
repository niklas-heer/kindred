// The assistant's web lookup. The chat never gives the provider its web search: a lookup is a separate request whose
// only input is a fixed neutral instruction and the query. Before a query is sent, the guard refuses one that names a
// living person (full name, current or birth, or a nickname) or carries a private detail of this tree.
import { person } from '../db.server';
import type { GPerson } from '../types';
import { isolatedSearch, type AiAdapter } from './adapters';

/** The instruction every lookup runs under. It names no family and carries no tree data: that is the point. */
export const LOOKUP_SYSTEM = 'You answer one question from the web: a fact of history, language, a trade, a custom, a place or a past event. Answer in at most five short sentences, in English. You know nothing about any family, household or person. Do not guess who the question is about.';
/** Searches one lookup may run. The budget reserves for these. */
export const LOOKUP_SEARCHES = 2;
/** A private value shorter than this is ignored by the guard: short values match too much of a query to be a secret. */
const MIN_PRIVATE = 4;

export interface PrivacyGuard {
  /** Full names (given plus surname, current and birth, both orders) of living people, normalised. */
  names: string[];
  /** Nicknames of living people, normalised. Matched as whole words. */
  nicknames: string[];
  /** Values of private fields in the tree, normalised, at least MIN_PRIVATE characters. */
  privates: string[];
}

export type Refusal = 'living-name' | 'nickname' | 'private';

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The guard's lists for one tree. Reads every private field, so it runs per lookup, not per message. */
export async function privacyGuard(tree: string, people: GPerson[]): Promise<PrivacyGuard> {
  const names = new Set<string>();
  const nicknames = new Set<string>();
  const privates = new Set<string>();
  for (const p of people) {
    if (p.living) {
      const current = [p.currentGiven ?? p.given, p.currentSurname ?? p.surname];
      const birth = [p.given, p.surname];
      for (const [given, surname] of [current, birth]) {
        // A surname alone is allowed: only a given name together with a surname counts as a full name.
        if (!given?.trim() || !surname?.trim()) continue;
        names.add(norm(`${given} ${surname}`));
        names.add(norm(`${surname} ${given}`));
      }
      if (p.nickname?.trim()) nicknames.add(norm(p.nickname));
    }
    const detail = await person(tree, p.id, true);
    for (const f of detail.fields) {
      if (!f.private) continue;
      for (const v of Object.values(f.value ?? {})) {
        if (typeof v === 'string' && norm(v).length >= MIN_PRIVATE) privates.add(norm(v));
      }
    }
  }
  return { names: [...names], nicknames: [...nicknames], privates: [...privates] };
}

/** Why a query may not go to the web, or null when it may. Works on the query text alone. */
export function refusal(g: PrivacyGuard, query: string): Refusal | null {
  const q = norm(query);
  if (g.names.some((n) => q.includes(n))) return 'living-name';
  if (g.nicknames.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}($|[^\\p{L}\\p{N}])`, 'u').test(q))) return 'nickname';
  if (g.privates.some((v) => q.includes(v))) return 'private';
  return null;
}

/** What the reader and the model are told about a refusal. It names the kind of detail, never the detail. */
export const REFUSAL_REASON: Record<Refusal, string> = {
  'living-name': 'the query names a living person (a full name)',
  nickname: 'the query names a living person by a nickname',
  private: 'the query contains a private detail of this family',
};

/** One lookup: the query alone, under the fixed instruction, with the family's own budget reserved for it. */
export async function isolatedLookup(adapter: AiAdapter, query: string): Promise<{ text: string; sources: { url: string; title?: string }[]; searches: number }> {
  const r = await isolatedSearch(adapter, { system: LOOKUP_SYSTEM, prompt: query, maxUses: LOOKUP_SEARCHES, maxTokens: 600 });
  return { text: r.text.trim(), sources: r.sources ?? [], searches: r.searches };
}
