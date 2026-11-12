/**
 * The guard for "everything works in every language". It fails when a screen shows English written into the code,
 * when server code throws a sentence the dictionary cannot translate, or when a complete language fails a translation
 * check (src/lib/i18n/check.ts, the same checks `node scripts/i18n-check.ts` runs): a key missing, an entry still the
 * English text, the formal address, placeholders or plural forms that do not match.
 *
 * Fixing a failure means adding the words to src/lib/i18n/areas/ and to each complete language's locales/<locale>/ file.
 * The lists below are for genuine exceptions only, each with its reason; a language's own exceptions are in its
 * glossary (glossary/<locale>.json, `sameAsEnglish`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buttonKeys, checkLocale, type Finding } from './check.ts';
import { COMPLETE_LOCALES, KEYS, localizeTitle, translate, translateMessage, type Key } from './dictionary.ts';
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

const sourceFiles = readdirSync(src, { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$|routeTree\.gen|^lib\/i18n\/(?:areas\/|locales\/|hardcoded-scan|check\.ts)/.test(f));

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

test('every complete language passes every translation check', (t) => {
  const buttons = buttonKeys();
  const errors: Finding[] = [];
  for (const locale of COMPLETE_LOCALES.filter((l) => l !== 'en')) {
    const findings = checkLocale(locale, buttons);
    errors.push(...findings.filter((f) => f.severity === 'error'));
    const warnings = findings.filter((f) => f.severity === 'warning');
    t.diagnostic(`${locale}: ${warnings.length} warnings for a person to look at (node scripts/i18n-check.ts ${locale})`);
  }
  assert.deepEqual(errors.map((f) => `${f.locale} ${f.check} ${f.key ?? ''}: ${f.detail}`), []);
});

test('a year in a sentence is never grouped like a large number', () => {
  assert.equal(translate('de', 'life.born', { year: 1985 }), 'geb. 1985');
  assert.equal(translate('en', 'atlas.first_recorded', { year: 1985 }), 'First recorded in 1985');
});
