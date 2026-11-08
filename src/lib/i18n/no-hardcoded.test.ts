/**
 * The guard for "everything works in every language". It fails when a screen shows English written into the code,
 * when server code throws a sentence the dictionary cannot translate, when a key is missing in German or Afrikaans,
 * or when a German or Afrikaans entry is still the English text.
 *
 * Fixing a failure means adding the words to src/lib/i18n/areas/ in all three languages. The lists below are for
 * genuine exceptions only, each with its reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYS, LOCALES, localizeTitle, missingKeys, translate, translateMessage, type Key, type Locale } from './dictionary.ts';
import { scan } from './hardcoded-scan.ts';

const src = fileURLToPath(new URL('../../', import.meta.url));

/** Developer pages and code whose messages only an operator or developer sees, in logs. */
const NOT_READER_FACING = [
  /^routes\/ui(?:_\.character)?\.tsx$/, // the design-system reference pages
  /^lib\/store\//, // storage set-up and developer errors
  /^lib\/jobs\//, // background jobs write to the server log
  /^lib\/auth\/(?:access|trees)\.server\.ts$/, // deployment settings, read at start
  /^components\/ui\/Tabs\.tsx$/, // misuse of the component
];

/** Text that is the same in every language. `file|text`; each needs a reason. */
const SAME_IN_EVERY_LANGUAGE = new Set([
  'routes/__root.tsx|Kindred', // the product's name
  'routes/index.tsx|Kindred', // the product's name
  'routes/setup.tsx|XXXX-XXXX-XXXX-XXXX', // the shape of the setup code
  'routes/$tree/access.tsx|name@example.com', // an address
  'routes/$tree/research_.$project.tsx|PDF', // a file format
  'routes/$tree/settings.import.tsx|GEDCOM', // a file format
  'routes/$tree/settings.import.tsx|Markdown', // a file format
  'components/PlaceInput.tsx|Uppsala, Porto…', // places, not words
  'components/heraldry/Designer.tsx|Fide et labore', // a Latin motto
]);

/** A value may equal the English when it is more than one word only for these. Single words are usually cognates. */
const SAME_AS_ENGLISH: Record<'de' | 'af', ReadonlySet<string>> = {
  de: new Set(['houses.mottoLabel', 'look.beard.vandyke']), // "Motto (optional)"; a beard named after a painter
  af: new Set(['gallery.album_count', 'needed.stopEsc', 'look.beard.vandyke']), // "{count} in album"; "Stop (Esc)"
};

/** Everyday interface words that are never the same in German or Afrikaans, so one word is enough to fail. */
const NEVER_THE_SAME = new Set(['save', 'cancel', 'delete', 'remove', 'edit', 'add', 'close', 'open', 'back', 'next', 'previous', 'search', 'loading', 'retry', 'confirm', 'share', 'download', 'upload', 'settings', 'help', 'yes', 'no', 'done', 'error', 'warning']);

const sourceFiles = readdirSync(src, { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$|routeTree\.gen|^lib\/i18n\/(?:areas\/|hardcoded-scan)/.test(f));

const translatable = (text: string) => KEYS.includes(text as Key) || translateMessage(text, 'de') !== text;
const titled = (text: string) => localizeTitle(text, 'de') !== text;

test('no screen shows English written into the code, and no server sentence is out of the dictionary’s reach', () => {
  const problems: string[] = [];
  for (const file of sourceFiles) {
    if (NOT_READER_FACING.some((p) => p.test(file))) continue;
    for (const f of scan(readFileSync(join(src, file), 'utf8'), file, translatable, titled)) {
      if (SAME_IN_EVERY_LANGUAGE.has(`${file}|${f.text}`)) continue;
      problems.push(`src/${relative('.', file)}:${f.line} [${f.kind}] ${f.text}`);
    }
  }
  assert.deepEqual(problems, [], `Move these into src/lib/i18n/areas/ (en, de, af):\n${problems.join('\n')}`);
});

test('every key exists in German and in Afrikaans', () => {
  assert.deepEqual(missingKeys('de'), [], 'missing in de');
  assert.deepEqual(missingKeys('af'), [], 'missing in af');
});

test('no German or Afrikaans entry is still the English text', () => {
  /** The words of a message, without placeholders, numbers, symbols, addresses and web names. */
  const wordsOf = (text: string) =>
    text.replace(/\{\w+\}/g, ' ').replace(/\S+[@.]\S+/g, ' ').match(/\p{L}{2,}/gu) ?? [];
  const problems: string[] = [];
  for (const locale of ['de', 'af'] as const) {
    for (const key of KEYS) {
      if (SAME_AS_ENGLISH[locale].has(key)) continue;
      for (const count of [1, 2]) {
        const english = translate('en', key, { count });
        if (translate(locale, key, { count }) !== english) continue;
        const words = wordsOf(english);
        if (words.length > 1 || (words.length === 1 && NEVER_THE_SAME.has(words[0].toLowerCase()))) problems.push(`${locale} ${key}: ${english}`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('German says du and Afrikaans says jy, in every entry', () => {
  // A capital mid-sentence is the polite form; a sentence may still begin with "Sie" or "Ihre" for "they" and "their".
  const formal: Record<'de' | 'af', RegExp> = { de: /[\p{Ll},] (?:Sie|Ihr|Ihre[mnrs]?|Ihnen)\b/u, af: /(?:^|[\s(])[Uu](?:[\s.,!?)]|$)/u };
  const problems: string[] = [];
  for (const locale of ['de', 'af'] as const) {
    for (const key of KEYS) {
      const text = translate(locale, key, { count: 2 });
      if (formal[locale].test(text)) problems.push(`${locale} ${key}: ${text}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('placeholders are the same in every language', () => {
  // {count} may be spelled out in a singular; {article} is English's "a" or "an".
  const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].filter((p) => p !== 'count' && p !== 'article').sort().join();
  const problems: string[] = [];
  for (const locale of LOCALES as readonly Locale[]) {
    for (const key of KEYS) {
      for (const count of [1, 2]) {
        const expected = placeholders(translate('en', key, { count }));
        const actual = placeholders(translate(locale, key, { count }));
        if (expected !== actual) problems.push(`${locale} ${key}: ${actual} vs ${expected}`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('a year in a sentence is never grouped like a large number', () => {
  assert.equal(translate('de', 'life.born', { year: 1985 }), 'geb. 1985');
  assert.equal(translate('en', 'atlas.first_recorded', { year: 1985 }), 'First recorded in 1985');
});
