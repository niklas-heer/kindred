import { translate, type Key } from '../i18n/dictionary.ts';
import type { Locale, Vars } from '../i18n/types.ts';

export function issueMessage(locale: Locale, issue: { code: Key; vars: Vars }): string {
  const vars = issue.vars.noteKey
    ? { ...issue.vars, note: translate(locale, issue.vars.noteKey as Key, issue.vars) }
    : issue.vars;
  return translate(locale, issue.code, vars);
}
