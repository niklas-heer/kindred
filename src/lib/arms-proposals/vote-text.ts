// An arms vote's words in a reader's language. Its question and its "keep" option are stored in English (the starter's
// fallback, read verbatim by the Markdown archive and the data request); the votes reads, the feed, "What's new" and the
// pushes about votes name them in the reader's or the device's language instead, with the house's name as it is now.
// Everything else of a vote (an ordinary vote's question, a proposal's name) is the family's own words and stays as written.
import { translate, type Locale } from '../i18n/dictionary.ts';

/** SQL for a vote aliased `v`: the house's name now when `v` is a house's arms vote, else NULL. Select it `AS house_name`. */
export const HOUSE_NAME_OF = (v: string) => `(SELECT h.name FROM house h WHERE ${v}.subject_kind = 'house' AND h.id = ${v}.subject)`;

interface Subject { subject_kind: string | null; house_name?: string | null }

/** A vote's question for this reader: an arms vote's in their language (as stored when its house is gone), any other as asked. */
export function questionIn(locale: Locale, v: Subject & { question: string }): string {
  return v.subject_kind === 'house' && v.house_name ? translate(locale, 'arms.vote.question', { house: v.house_name }) : v.question;
}

/** An option's label for this reader: an arms vote's "keep" option (the one with no proposal) in their language. */
export function labelIn(locale: Locale, v: Pick<Subject, 'subject_kind'>, o: { label: string; proposal?: string | null }): string {
  return v.subject_kind === 'house' && !o.proposal ? translate(locale, 'arms.vote.keep') : o.label;
}
