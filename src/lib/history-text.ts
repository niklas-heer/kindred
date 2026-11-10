// The history's words: one whole sentence per line ("Mara added 3 photos"), the name of a changed field, and a value as a
// reader reads it. Shared by the pages and the weekly push, so both say the same. No React here.
import type { Key } from './i18n/dictionary.ts';
import type { Vars } from './i18n/types.ts';
import type { HistoryAction, HistoryKind, HistoryValue } from './history.ts';

type T = (key: Key, vars?: Vars) => string;

/** The author as a sentence names them: Kindred itself when no account made the change. */
export const authorName = (t: T, author: string) => author || t('history.kindred');

/** "{author} added {count} photos", as one sentence in the reader's language. */
export const lineText = (t: T, line: { author: string; kind: HistoryKind; action: HistoryAction; count: number }) =>
  t(`history.s.${line.kind}.${line.action}` as Key, { author: authorName(t, line.author), count: line.count });

/** The fields the history knows the name of. Any other is shown as it is stored. */
const FIELD_NAMES = new Set([
  'given', 'further_given', 'surname', 'current_given', 'current_surname', 'nickname', 'sex', 'born', 'born_place', 'died', 'died_place',
  'living', 'title', 'epithet', 'occupation', 'bio', 'house', 'look', 'photo', 'painted', 'display', 'prefer_avatar', 'label', 'value',
  'visibility', 'kind', 'start', 'end', 'end_reason', 'place', 'type', 'date', 'end_date', 'note', 'author', 'publication', 'reference',
  'document', 'media', 'source', 'page', 'quality', 'transcription', 'taken', 'caption', 'album', 'name', 'motto', 'arms', 'law', 'head',
  'heir', 'country', 'members', 'meaning', 'pin', 'tagline', 'summary', 'private', 'body', 'notes', 'people', 'parents', 'unions',
  'events', 'sources', 'citations',
]);

export const fieldName = (t: T, name: string) => (FIELD_NAMES.has(name) ? t(`history.f.${name}` as Key) : name);

/** A stored value as a reader reads it: yes and no for a switch, the level's name for who sees a field, the words of a list. */
export function valueText(t: T, name: string, v: HistoryValue): string {
  if (v === null || v === '') return t('history.empty_value');
  if (name === 'living' || name === 'private' || name === 'prefer_avatar') return t(v === 1 || v === '1' ? 'history.v.yes' : 'history.v.no');
  if (name === 'visibility' && (v === 'personal' || v === 'editors' || v === 'family')) return t(`field.vis.${v}` as Key);
  if (name === 'display' && (v === 'drawing' || v === 'photo' || v === 'portrait')) return t(`history.v.${v}` as Key);
  if (name === 'further_given' && typeof v === 'string' && v.startsWith('[')) {
    try {
      return (JSON.parse(v) as string[]).join(' ');
    } catch {
      return v;
    }
  }
  return String(v);
}
