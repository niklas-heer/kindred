// A house's name meaning and its arms review, stored in the family's database (migration 0012). Reads are for the house
// pages and the list; the two writes go through `once` (the retry key) with guards for everything they read, so a write
// made on stale reads commits nothing. Callers check the role first (house-meaning.functions.ts, arms-fit.functions.ts).
import { db, guard, once, q, type Db, type OpKey } from './db.server';
import type { NameResearch } from './ai/types.ts';
import { chosenMeanings, fingerprintInput, keepCollected, type ArmsDecision, type ArmsReview, type FitVerdict, type SavedMeaning, type SavedMeaningRow } from './house-meaning.ts';
import { blazonV2 } from '../components/heraldry/blazon';
import { asV2 } from '../components/heraldry/convert';
import './ai/arms-library.server';

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
  /** What stewards decided after earlier checks: a JSON list of ArmsDecision, oldest first (migration 0016). */
  history: string;
}

/** The most decisions a review remembers. */
const MAX_DECISIONS = 5;

/** The decisions stored on a review, oldest first. An unreadable or missing list is an empty one. */
export function parseDecisions(s: string | undefined): ArmsDecision[] {
  try {
    const list = JSON.parse(s ?? '[]') as ArmsDecision[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
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
  const dismissed = current && r.dismissed_fingerprint === fp;
  const last = parseDecisions(r.history).at(-1);
  return {
    house: r.house,
    verdict: r.verdict,
    reason: r.reason,
    advice: r.advice,
    locale: r.locale,
    checkedAt: r.checked_at,
    current,
    dismissed,
    chosen: dismissed && last?.decision === 'chose' && last.fingerprint === fp,
  };
}

/**
 * Every house's saved meaning, for every reader of the family. A row with no chosen meaning is not saved: it is what the
 * background task collected, a dismissed collection or a failed try, and it stays out of this list (see readCollected).
 */
export async function readMeanings(tree: string): Promise<Record<string, SavedMeaning>> {
  const rows = await db(tree).all<MeaningRow>('SELECT * FROM house_meaning');
  return Object.fromEntries(rows.map(toSaved).filter((s) => chosenMeanings(s).length > 0).map((s) => [s.house, s]));
}

/** Meanings the background task collected that a steward has not chosen from yet, by house. Stewards only: the caller checks the role. */
export async function readCollected(tree: string): Promise<Record<string, SavedMeaning>> {
  const rows = await db(tree).all<MeaningRow>("SELECT * FROM house_meaning WHERE meanings <> '[]'");
  return Object.fromEntries(rows.map(toSaved).filter((s) => s.meanings.length > 0 && chosenMeanings(s).length === 0).map((s) => [s.house, s]));
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
    const prior = await d.get<{ saved_at: number; meanings: string }>('SELECT saved_at, meanings FROM house_meaning WHERE house = ?', house);
    // A collection nobody chose from is not thrown away by the steward's own research: its meanings stay beside the new ones.
    const meanings = prior ? keepCollected(input.meanings, parseMeanings(prior.meanings)) : input.meanings;
    const saved: SavedMeaning = {
      house, name: input.name, familyWords: input.familyWords, webSearched: input.webSearched, note: input.note, savedAt: now, meanings,
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
          house, input.name, input.familyWords, JSON.stringify(meanings), input.webSearched ? 1 : 0, input.note, now, op.user,
        ),
      ],
      result: saved,
    };
  });
}

/**
 * Stores what the background task found for a name, with every meaning unchosen: nothing is saved for the family and no
 * arms check can read it until a steward chooses. Writes only over a house that has no row yet or only failed tries,
 * so a steward's research saved while the call was out stays as it is. One statement decides.
 */
export async function saveCollected(tree: string, house: string, o: { name: string; research: NameResearch; now: number }): Promise<void> {
  const meanings: SavedMeaningRow[] = o.research.meanings.map((m) => ({ ...m, chosen: false }));
  await db(tree).run(
    `INSERT INTO house_meaning (house, name, family_words, meanings, web_searched, note, saved_at, saved_by, collect_failures)
     VALUES (?, ?, '', ?, ?, ?, ?, 'ai-background', 0)
     ON CONFLICT(house) DO UPDATE SET name = excluded.name, meanings = excluded.meanings, web_searched = excluded.web_searched,
       note = excluded.note, saved_at = excluded.saved_at, saved_by = excluded.saved_by, collect_failures = 0
     WHERE house_meaning.meanings = '[]' AND house_meaning.collect_failures > 0`,
    house, o.name, JSON.stringify(meanings), o.research.webSearched ? 1 : 0, o.research.note ?? '', o.now,
  );
}

/** Counts a failed try for a name, so one that keeps failing is given up on (MAX_COLLECT_FAILURES). Only over a house with no meanings. */
export async function noteCollectFailure(tree: string, house: string, name: string, now: number): Promise<void> {
  await db(tree).run(
    `INSERT INTO house_meaning (house, name, saved_at, saved_by, collect_failures) VALUES (?, ?, ?, 'ai-background', 1)
     ON CONFLICT(house) DO UPDATE SET collect_failures = house_meaning.collect_failures + 1
     WHERE house_meaning.meanings = '[]' AND house_meaning.collect_failures > 0`,
    house, name, now,
  );
}

/** The guards for a change to a collection: its row is the one read, and nobody has chosen from it. */
const unchosen = async (d: Db, house: string): Promise<{ row: MeaningRow; saved: SavedMeaning }> => {
  const row = await d.get<MeaningRow>('SELECT * FROM house_meaning WHERE house = ?', house);
  if (!row) throw new Error('houses.meaning.err_not_researched');
  const saved = toSaved(row);
  if (chosenMeanings(saved).length > 0) throw new Error('houses.meaning.err_stale');
  return { row, saved };
};

/**
 * One or several collected meanings become the house's possible origins. The rest stay, unchosen, for the research panel. Refused when
 * the house has no collection, or someone chose from it already. Nothing else runs here: the arms are checked after this,
 * by the existing check, at the steward's request.
 */
export function chooseCollected(tree: string, house: string, picked: string | string[], op: OpKey, now = Date.now()): Promise<SavedMeaning> {
  return once(tree, op, 'chooseCollectedMeaning', async (d) => {
    const { row, saved } = await unchosen(d, house);
    const ids = new Set(Array.isArray(picked) ? picked : [picked]);
    if (ids.size === 0 || [...ids].some((id) => !saved.meanings.some((m) => m.id === id))) throw new Error('houses.meaning.err_bad_input');
    const meanings = saved.meanings.map((m) => ({ ...m, chosen: ids.has(m.id) }));
    return {
      writes: [
        guard('(SELECT saved_at FROM house_meaning WHERE house = ?) = ?', house, row.saved_at),
        q('UPDATE house_meaning SET meanings = ?, saved_at = ?, saved_by = ? WHERE house = ?', JSON.stringify(meanings), now, op.user, house),
      ],
      result: { ...saved, savedAt: now, meanings },
    };
  });
}

/** The steward wants none of them: the collection goes, and the empty row keeps the task from collecting this name again. */
export function dismissCollected(tree: string, house: string, op: OpKey, now = Date.now()): Promise<void> {
  return once(tree, op, 'dismissCollectedMeanings', async (d) => {
    const { row } = await unchosen(d, house);
    return {
      writes: [
        guard('(SELECT saved_at FROM house_meaning WHERE house = ?) = ?', house, row.saved_at),
        q("UPDATE house_meaning SET meanings = '[]', note = '', web_searched = 0, collect_failures = 0, saved_at = ?, saved_by = ? WHERE house = ?", now, op.user, house),
      ],
      result: undefined,
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
    const history = withDecision(s, 'kept');
    return {
      writes: [
        ...sameArmsAndResearch(house, s),
        guard('(SELECT fingerprint FROM house_arms_review WHERE house = ?) = ?', house, s.review.fingerprint),
        q('UPDATE house_arms_review SET dismissed_fingerprint = ?, history = ? WHERE house = ?', s.fingerprint, history, house),
      ],
      result: toReview({ ...s.review, dismissed_fingerprint: s.fingerprint, history }, s.fingerprint),
    };
  });
}

/** The review's decisions as stored text, with this one added: what the check had advised, and the arms now. */
function withDecision(s: Snapshot, decision: ArmsDecision['decision'], now = Date.now()): string {
  const entry: ArmsDecision = { decision, advice: s.review?.advice ?? '', blazon: blazonV2(asV2(JSON.parse(s.armsText))), fingerprint: s.fingerprint, at: now };
  return JSON.stringify([...parseDecisions(s.review?.history), entry].slice(-MAX_DECISIONS));
}

/**
 * The steward sealed arms picked from the suggestions: that settles the check. The review now stands for these arms and is
 * kept, so nothing is asked of the steward and no check runs, until the arms or the meanings change or they press "Check
 * again". Its reason and advice stay as the record of what was advised; the card does not show them (`chosen`).
 */
export function settleReview(tree: string, house: string, op: OpKey, now = Date.now()): Promise<ArmsReview> {
  return once(tree, op, 'settleArmsReview', async (d) => {
    const s = await snapshot(d, house);
    if (!s) throw new Error('houses.meaning.err_not_researched');
    const history = withDecision(s, 'chose', now);
    const row: ReviewRow = {
      house, verdict: 'fits', reason: '', advice: '', locale: 'en', checked_at: now, checked_by: op.user,
      ...s.review, fingerprint: s.fingerprint, dismissed_fingerprint: s.fingerprint, history,
    };
    return {
      writes: [
        ...sameArmsAndResearch(house, s),
        q(
          `INSERT INTO house_arms_review (house, fingerprint, verdict, reason, advice, locale, checked_at, checked_by, dismissed_fingerprint, history)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(house) DO UPDATE SET fingerprint = excluded.fingerprint, dismissed_fingerprint = excluded.dismissed_fingerprint, history = excluded.history`,
          house, row.fingerprint, row.verdict, row.reason, row.advice, row.locale, row.checked_at, row.checked_by, row.dismissed_fingerprint, row.history,
        ),
      ],
      result: toReview(row, s.fingerprint),
    };
  });
}
