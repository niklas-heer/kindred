import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { browserTable, localeOfId, tableModule } from './browser-tables.ts';
import { hasLocale, KEYS, LANGUAGES, LOCALES, loadLocale, tableOf, translate } from './dictionary.ts';

const dir = fileURLToPath(new URL('./', import.meta.url));

test('each browser table holds exactly the words the server translates with', async () => {
  for (const locale of LOCALES) {
    const table = await browserTable(dir, locale);
    // Every area file is part of the catalog, and nothing else: the browser and the server know the same keys (all of them
    // for a complete language, a part for one being translated, which falls back to English for the rest).
    if (LANGUAGES[locale].complete) assert.deepEqual(Object.keys(table).sort(), [...KEYS].sort(), `${locale}: the same keys as the catalog`);
    else assert.deepEqual(Object.keys(table).filter((k) => !KEYS.includes(k as never)), [], `${locale}: no key the catalog lacks`);
    assert.deepEqual(table, { ...tableOf(locale) }, `${locale}: the same words as the server's`);
    for (const key of KEYS) {
      const entry = table[key];
      if (entry === undefined) continue;
      // The form a count of 2 takes in this language (Polish has "few" there, where English has "other").
      const text = typeof entry === 'string' ? entry : ((entry as Record<string, string>)[new Intl.PluralRules(LANGUAGES[locale].intl).select(2)] ?? entry.other);
      // A wedding year a language leaves unnamed is written "" (docs/translating.md); every other text has words.
      if (!(key.startsWith('almanac.wedding.') && text === '')) assert.equal(translate(locale, key, { count: 2 }).length > 0, true, `${locale}: ${key} is empty`);
      if (!/\{/.test(text)) assert.equal(translate(locale, key, { count: 2 }), text, `${locale}: ${key}`);
    }
  }
});

test('a table module evaluates to its table', async () => {
  const table = { 'a.b': 'It\'s "quoted"   and </script>', 'a.c': { one: '{count} thing', other: '{count} things' } };
  const url = `data:text/javascript,${encodeURIComponent(tableModule(table))}`;
  assert.deepEqual((await import(url)).default, table);
});

test('only the known languages are virtual table ids', () => {
  assert.equal(localeOfId('virtual:kindred-locale/de'), 'de');
  assert.equal(localeOfId('\0virtual:kindred-locale/af'), 'af');
  assert.equal(localeOfId('virtual:kindred-locale/pt-BR'), 'pt-BR');
  assert.equal(localeOfId('virtual:kindred-locale/xx'), null);
  assert.equal(localeOfId('./catalog.ts'), null);
});

test('the server has every language at once, so loading one resolves without fetching', async () => {
  for (const locale of LOCALES) {
    assert.equal(hasLocale(locale), true);
    await loadLocale(locale);
  }
});
