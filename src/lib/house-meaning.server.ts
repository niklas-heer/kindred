// A house's name meaning and its arms review, stored in the family's database (migration 0012). Reads are for the house
// pages and the list; the two writes go through `once` (the retry key) with guards for everything they read, so a write
// made on stale reads commits nothing. Callers check the role first (house-meaning.functions.ts, arms-fit.functions.ts).
import { db, guard, once, q, type Db, type OpKey } from './db.server';
import { chosenMeanings, fingerprintInput, type ArmsReview, type FitVerdict, type SavedMeaning, type SavedMeaningRow } from './house-meaning.ts';

interface MeaningRow {
  house: string;
  name: string;
  family_words: string;
  meanings: string;
  web_searched: number;
  note: string;
  saved_at: number;
  saved_by: string;
}

export interface ReviewRow {
  house: string;
  fingerprint: string;
  verdict: FitVerdict;
  reason: string;
  advice: string;
  locale: string;
  checked_at: number;
  checked_by: string;
  dismissed_fingerprint: string;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** A short hash of what a review read: the arms, the family's words and the chosen meanings. Forty hex digits. */
export async function fingerprint(arms: unknown, familyWords: string, chosen: SavedMeaningRow[]): Promise<string> {
  const text = fingerprintInput(arms, familyWords, chosen);
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 40);
}

function parseMeanings(s: string): SavedMeaningRow[] {
  try {
    const list = JSON.parse(s) as SavedMeaningRow[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function toSaved(r: MeaningRow): SavedMeaning {
  return {
    house: r.house,
    name: r.name,
    familyWords: r.family_words,
    webSearched: r.web_searched === 1,
    note: r.note,
    savedAt: r.saved_at,
    meanings: parseMeanings(r.meanings),
  };
}

/** A review as the browser gets it. It is current only when the arms and the chosen meanings are the ones it read. */
export function toReview(r: ReviewRow, fp: string): ArmsReview {
  const current = r.fingerprint === fp;
  return {
    house: r.house,
    verdict: r.verdict,
    reason: r.reason,
    advice: r.advice,
    locale: r.locale,
    checkedAt: r.checked_at,
    current,
    dismissed: current && r.dismissed_fingerprint === fp,
  };
}

/** Every house's saved meaning, for every reader of the family. */
export async function readMeanings(tree: string): Promise<Record<string, SavedMeaning>> {
  const rows = await db(tree).all<MeaningRow>('SELECT * FROM house_meaning');
  return Object.fromEntries(rows.map((r) => [r.house, toSaved(r)]));
}

/** Every house's latest arms review, with whether it is current and kept. Stewards only: the caller checks the role. */
export async function readReviews(tree: string): Promise<Record<string, ArmsReview>> {
  const rows = await db(tree).all<ReviewRow & { arms: string; family_words: string; meanings: string }>(
    `SELECT r.*, h.arms, m.family_words, m.meanings FROM house_arms_review r
       JOIN house h ON h.id = r.house JOIN house_meaning m ON m.house = r.house`,
  );
  const out: Record<string, ArmsReview> = {};
  for (const r of rows) {
    const fp = await fingerprint(JSON.parse(r.arms), r.family_words, chosenMeanings({ meanings: parseMeanings(r.meanings) }));
    out[r.house] = toReview(r, fp);
  }
  return out;
}

/** What a steward's check or dismissal read, with the guards that keep it true until its batch commits. */
export interface Snapshot {
  armsText: string;
  savedAt: number;
  saved: SavedMeaning;
  chosen: SavedMeaningRow[];
  fingerprint: string;
  review?: ReviewRow;
}

/** A house's arms, its saved meaning and its review as one read. Undefined when the house or its research is missing. */
export async function snapshot(d: Db, house: string): Promise<Snapshot | undefined> {
  const h = await d.get<{ arms: string }>('SELECT arms FROM house WHERE id = ?', house);
  const m = await d.get<MeaningRow>('SELECT * FROM house_meaning WHERE house = ?', house);
  if (!h || !m) return undefined;
  const saved = toSaved(m);
  const chosen = chosenMeanings(saved);
  const review = await d.get<ReviewRow>('SELECT * FROM house_arms_review WHERE house = ?', house);
  return {
    armsText: h.arms,
    savedAt: m.saved_at,
    saved,
    chosen,
    fingerprint: await fingerprint(JSON.parse(h.arms), saved.familyWords, chosen),
    review,
  };
}

/** The guards every write on a house's meaning or arms review restates: the arms and the research are still as read. */
export const sameArmsAndResearch = (house: string, s: Pick<Snapshot, 'armsText' | 'savedAt'>) => [
  guard('(SELECT arms FROM house WHERE id = ?) = ?', house, s.armsText),
  guard('(SELECT saved_at FROM house_meaning WHERE house = ?) = ?', house, s.savedAt),
];

export interface SaveMeaningInput {
  name: string;
  familyWords: string;
  webSearched: boolean;
  note: string;
  /** Every meaning the research returned, each with `chosen` for the ones the steward kept. */
  meanings: SavedMeaningRow[];
}

/**
 * Saves a house's research in place of any earlier one. Refused (nothing written) when the house is missing. A retry with
 * the same key gets the saved research back, not a second copy.
 */
export function saveMeanings(tree: string, house: string, input: SaveMeaningInput, op: OpKey, now = Date.now()): Promise<SavedMeaning> {
  return once(tree, op, 'saveHouseMeaning', async (d) => {
    if (!await d.get('SELECT id FROM house WHERE id = ?', house)) throw new Error('houses.err.not_found');
    const prior = await d.get<{ saved_at: number }>('SELECT saved_at FROM house_meaning WHERE house = ?', house);
    const saved: SavedMeaning = {
      house, name: input.name, familyWords: input.familyWords, webSearched: input.webSearched, note: input.note, savedAt: now, meanings: input.meanings,
    };
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM house WHERE id = ?)', house),
        prior
          ? guard('(SELECT saved_at FROM house_meaning WHERE house = ?) = ?', house, prior.saved_at)
          : guard('NOT EXISTS (SELECT 1 FROM house_meaning WHERE house = ?)', house),
        q(
          `INSERT INTO house_meaning (house, name, family_words, meanings, web_searched, note, saved_at, saved_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(house) DO UPDATE SET name = excluded.name, family_words = excluded.family_words, meanings = excluded.meanings,
             web_searched = excluded.web_searched, note = excluded.note, saved_at = excluded.saved_at, saved_by = excluded.saved_by`,
          house, input.name, input.familyWords, JSON.stringify(input.meanings), input.webSearched ? 1 : 0, input.note, now, op.user,
        ),
      ],
      result: saved,
    };
  });
}

/**
 * "Keep these arms": the steward has looked at the current check and keeps the arms. Only a current review can be kept, and
 * it stays kept only while the arms and the chosen meanings do not change.
 */
export function dismissReview(tree: string, house: string, op: OpKey): Promise<ArmsReview> {
  return once(tree, op, 'dismissArmsReview', async (d) => {
    const s = await snapshot(d, house);
    if (!s?.review) throw new Error('houses.meaning.err_no_review');
    if (s.review.fingerprint !== s.fingerprint) throw new Error('houses.meaning.err_stale');
    return {
      writes: [
        ...sameArmsAndResearch(house, s),
        guard('(SELECT fingerprint FROM house_arms_review WHERE house = ?) = ?', house, s.review.fingerprint),
        q('UPDATE house_arms_review SET dismissed_fingerprint = ? WHERE house = ?', s.fingerprint, house),
      ],
      result: toReview({ ...s.review, dismissed_fingerprint: s.fingerprint }, s.fingerprint),
    };
  });
}
