// A house's AI-written text in the reader's language: its researched name meanings and its arms check. What may be translated,
// how a model's answer is checked, and how a translation is laid over the original for display. Pure: the browser imports it,
// and the test runner loads it directly. The storing and the model call are in ai/house-translation.server.ts.
//
// A translation is only ever shown. Whatever is saved back to the server, or sent to a model, must come from the original.
import { z } from 'zod';
import { cutText } from './ai/trim.ts';
import type { NameMeaning } from './ai/types.ts';
import type { SavedMeaning } from './house-meaning.ts';

/** The words of one meaning that are translated. The root, the sources and how sure it is stay as they are. */
export interface RowText { id: string; language: string; meaning: string; ideas: string[] }
export interface MeaningsSource { note: string; meanings: RowText[] }
export interface ReviewSource { reason: string; advice: string }

/** A translated piece keeps what it was made from (`of`), so a translation of older text is never laid over newer text. */
export interface RowTranslation { of: string; language: string; meaning: string; ideas: string[] }
export interface MeaningTranslation { note: string; noteOf: string; rows: Record<string, RowTranslation> }
export interface ReviewTranslation { of: string; reason: string; advice: string }

/** One reader's translations, by house. */
export interface HouseTranslations { meanings: Record<string, MeaningTranslation>; reviews: Record<string, ReviewTranslation> }

const rowText = (m: Pick<NameMeaning, 'id' | 'language' | 'meaning' | 'ideas'>): RowText => ({ id: m.id, language: m.language, meaning: m.meaning, ideas: m.ideas.map((i) => i.idea) });
const rowOf = (r: RowText) => JSON.stringify([r.language, r.meaning, r.ideas]);
const reviewOf = (r: ReviewSource) => JSON.stringify([r.reason, r.advice]);

/** What can be translated of a research, or undefined when there is nothing. The family's own words are theirs: they stay out. */
export function meaningsSource(s: Pick<SavedMeaning, 'note' | 'meanings'>): MeaningsSource | undefined {
  const meanings = s.meanings.filter((m) => m.attestation !== 'family').map(rowText);
  return meanings.length || s.note.trim() ? { note: s.note, meanings } : undefined;
}

/** What can be translated of an arms check, or undefined when it says nothing. */
export function reviewSource(r: ReviewSource): ReviewSource | undefined {
  return r.reason.trim() || r.advice.trim() ? { reason: r.reason, advice: r.advice } : undefined;
}

const meaningsReply = z.object({
  same: z.boolean(),
  note: z.string().overwrite(cutText(400)),
  meanings: z.array(z.object({
    id: z.string(),
    language: z.string().overwrite(cutText(80)),
    meaning: z.string().overwrite(cutText(200)),
    ideas: z.array(z.string().overwrite(cutText(160))),
  })),
});

const reviewReply = z.object({ same: z.boolean(), reason: z.string().overwrite(cutText(400)), advice: z.string().overwrite(cutText(400)) });

/** A checked answer: the text was already in that language, or its translation. */
export type Checked<T> = { same: true } | { same: false; content: T };

/** The model's answer for a research. Undefined unless it gives every meaning, by its id, with every piece the original has. */
export function checkMeanings(source: MeaningsSource, json: unknown): Checked<MeaningTranslation> | undefined {
  const parsed = meaningsReply.safeParse(json);
  if (!parsed.success) return undefined;
  if (parsed.data.same) return { same: true };
  const reply = new Map(parsed.data.meanings.map((m) => [m.id, m]));
  const rows: Record<string, RowTranslation> = {};
  for (const m of source.meanings) {
    const r = reply.get(m.id);
    if (!r || !r.meaning.trim() || r.ideas.length !== m.ideas.length || r.ideas.some((i) => !i.trim())) return undefined;
    if (m.language.trim() && !r.language.trim()) return undefined;
    rows[m.id] = { of: rowOf(m), language: r.language.trim(), meaning: r.meaning.trim(), ideas: r.ideas.map((i) => i.trim()) };
  }
  const note = parsed.data.note.trim();
  if (source.note.trim() && !note) return undefined;
  return { same: false, content: { note, noteOf: source.note, rows } };
}

/** The model's answer for an arms check. Undefined unless it gives every piece the original has. */
export function checkReview(source: ReviewSource, json: unknown): Checked<ReviewTranslation> | undefined {
  const parsed = reviewReply.safeParse(json);
  if (!parsed.success) return undefined;
  if (parsed.data.same) return { same: true };
  const reason = parsed.data.reason.trim();
  const advice = parsed.data.advice.trim();
  if ((source.reason.trim() && !reason) || (source.advice.trim() && !advice)) return undefined;
  return { same: false, content: { of: reviewOf(source), reason, advice } };
}

/** The meaning as the reader sees it: translated when a translation of exactly this text exists, otherwise the original. */
export function translateRow<T extends NameMeaning>(m: T, t: MeaningTranslation | undefined): T {
  const row = t?.rows[m.id];
  if (!row || m.attestation === 'family' || row.of !== rowOf(rowText(m))) return m;
  return { ...m, language: row.language || m.language, meaning: row.meaning || m.meaning, ideas: m.ideas.map((i, k) => ({ ...i, idea: row.ideas[k] || i.idea })) };
}

export const translateNote = (note: string, t: MeaningTranslation | undefined): string => (t && t.note && t.noteOf === note ? t.note : note);

/** A saved research as the reader sees it. For display only. */
export function translateSaved(s: SavedMeaning, t: MeaningTranslation | undefined): SavedMeaning {
  return t ? { ...s, note: translateNote(s.note, t), meanings: s.meanings.map((m) => translateRow(m, t)) } : s;
}

/** An arms check as the reader sees it. For display only: suggestions from the check are asked for with the original. */
export function translateReview<T extends ReviewSource>(r: T, t: ReviewTranslation | undefined): T {
  return t && t.of === reviewOf(r) ? { ...r, reason: t.reason || r.reason, advice: t.advice || r.advice } : r;
}
