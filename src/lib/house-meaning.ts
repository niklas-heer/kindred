// What a house's name means, and the steward's check that its arms still fit it: the shapes the server sends and the
// browser shows, and the rules that decide which badge a steward sees. Nothing here reads the database or calls a
// provider, so the test runner loads it directly (type imports only).
import type { NameMeaning } from './ai/types.ts';

export type FitVerdict = 'fits' | 'partly' | 'reconsider';
export const FIT_VERDICTS = ['fits', 'partly', 'reconsider'] as const;

/** A researched meaning as it was saved: the research's fields, and whether the steward chose it. */
export type SavedMeaningRow = NameMeaning & { chosen: boolean };

/** The most meanings one research keeps. The research itself returns at most eight, and the family's own words count as one. */
export const MAX_SAVED_MEANINGS = 12;

/** How many times the background task tries a name that keeps failing, before it leaves it for a steward to research by hand. */
export const MAX_COLLECT_FAILURES = 3;

/** The surname in a house's name: "House of Heer" is Heer. What the name research is asked about. */
export function surnameOf(name: string): string {
  return name.replace(/^(the\s+)?(house|haus|huis|hus|family|familie|clan)\s+(of\s+|von\s+)?/i, '').replace(/^the\s+/i, '').trim();
}

/**
 * What a steward's save keeps of an earlier background collection nobody chose from: `saved` as sent, then every collected
 * meaning it does not already have, unchosen, under an id of its own. Up to the number one research may hold.
 */
export function keepCollected(saved: SavedMeaningRow[], collected: SavedMeaningRow[]): SavedMeaningRow[] {
  if (collected.some((m) => m.chosen)) return saved;
  const key = (m: SavedMeaningRow) => `${m.root}|${m.meaning}`.toLowerCase();
  const seen = new Set(saved.map(key));
  const kept = [...saved];
  for (const m of collected) {
    if (kept.length >= MAX_SAVED_MEANINGS) break;
    if (seen.has(key(m))) continue;
    seen.add(key(m));
    kept.push({ ...m, id: `col${kept.length + 1}`, chosen: false });
  }
  return kept;
}

/** What a house's name means, as saved by a steward. Every house that has one is listed to every reader. */
export interface SavedMeaning {
  house: string;
  /** The name that was researched (the surname the arms were designed from). */
  name: string;
  /** The family's own words about the name, in their own language. Empty when they gave none. */
  familyWords: string;
  /** Whether the web was searched for the research: the sources are then real pages. */
  webSearched: boolean;
  /** The model's honest note about the research, if it gave one. */
  note: string;
  savedAt: number;
  meanings: SavedMeaningRow[];
}

/** The latest check of a house's arms against its meanings. Stewards only. */
export interface ArmsReview {
  house: string;
  verdict: FitVerdict;
  reason: string;
  /** What to change, when the arms do not fit. Empty when they fit. */
  advice: string;
  locale: string;
  checkedAt: number;
  /** The arms and the chosen meanings are still the ones the check read. */
  current: boolean;
  /** The steward kept these arms; this stays true only while `current`, so a change brings the check back. */
  dismissed: boolean;
  /** The steward sealed these arms from the suggestions: the reason and advice are about the arms before them, so they are not shown. */
  chosen: boolean;
}

/** What a steward did after a check. A later check reads these, so it cannot give the same advice again. */
export interface ArmsDecision {
  decision: 'chose' | 'kept';
  /** What the check had advised. Empty when it advised nothing, or no check had run. */
  advice: string;
  /** The arms the steward settled on. */
  blazon: string;
  fingerprint: string;
  at: number;
}

/**
 * Whether a check asks anything of a steward. Only a real problem does: arms that contradict the name or read badly. A
 * "partly" is a quiet idea, and a decision (a kept check, a chosen suggestion) stands until the arms or the meanings change.
 */
export const needsAttention = (r: ArmsReview | undefined): boolean => !!r && r.current && r.verdict === 'reconsider' && !r.dismissed;

/** The one badge a house shows a steward. A house gets at most one, so the list stays quiet. */
export type ReviewBadge = 'arms-review' | 'meanings-collected' | 'name-unresearched' | 'generated-arms';

/** The meanings a steward chose, in the order the research gave them (the family's own first). */
export function chosenMeanings(s: Pick<SavedMeaning, 'meanings'> | undefined): SavedMeaningRow[] {
  return s ? s.meanings.filter((m) => m.chosen) : [];
}

/** One line for a list: the family's words, else the first chosen meaning. Empty when nothing is saved. */
export function meaningLine(s: SavedMeaning | undefined): string {
  if (!s) return '';
  return s.familyWords || chosenMeanings(s)[0]?.meaning || '';
}

/**
 * Arms the steward has never drawn: the import and the seeds give a house arms with no design (`v2`), and the designer
 * stores a design (`v2`) for any house it changes. So a house without `v2` is still on the arms it started with.
 */
export function generatedArms(arms: object): boolean {
  return !(arms as { v2?: unknown }).v2;
}

/**
 * The badge a steward sees for one house, or none:
 *  - "Arms to review": the latest check of the current arms and meanings found a real problem (needsAttention);
 *  - "Meanings to choose": the background task collected meanings for this name and nobody has chosen from them;
 *  - "Name not researched": the name has no saved research (only once the arms feature is on: it is the only way to research);
 *  - "Using generated arms": the arms were never drawn, and no check has settled them (a fit or a kept check does).
 */
export function reviewBadge(o: { aiOn: boolean; researched: boolean; collected?: boolean; generated: boolean; review?: ArmsReview }): ReviewBadge | null {
  const r = o.review;
  if (needsAttention(r)) return 'arms-review';
  if (o.collected) return 'meanings-collected';
  if (o.aiOn && !o.researched) return 'name-unresearched';
  const settled = !!r && r.current && (r.verdict !== 'reconsider' || r.dismissed);
  if (o.generated && !settled) return 'generated-arms';
  return null;
}

/** The fingerprint's inputs, as the server hashes them: the arms, the family's words, and the chosen meanings' sense. */
export function fingerprintInput(arms: unknown, familyWords: string, chosen: Pick<NameMeaning, 'language' | 'root' | 'meaning' | 'attestation'>[]): string {
  return JSON.stringify({
    arms: sortKeys(arms),
    family: familyWords,
    chosen: chosen.map((m) => [m.language, m.root, m.meaning, m.attestation]),
  });
}

/** JSON with every object's keys sorted, so the same arms always give the same text. */
export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  }
  return v;
}
