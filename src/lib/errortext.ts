// What a failed request says to the reader. Server errors that are translation keys ("houses.err.not_found")
// are shown in the reader's language; an English message the dictionary has is translated; any other is shown as the server sent it.
import { translate, translateMessage, type Key, type Locale } from './i18n/dictionary.ts';

const KEY = /^[a-z]+(\.[a-zA-Z0-9_]+)+$/;

export function errorText(e: unknown, locale: Locale): string {
  const message = e instanceof Error ? e.message : String(e ?? '');
  // What each browser says when a request never got an answer.
  if (e instanceof TypeError && /^(Failed to fetch|Load failed|NetworkError\b)/.test(message)) return translate(locale, 'common.err_network');
  // A key, or an English sentence the dictionary knows ("Kerstin already has two parents.").
  return KEY.test(message) ? translate(locale, message as Key) : translateMessage(message, locale);
}
