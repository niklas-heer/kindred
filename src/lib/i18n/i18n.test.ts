import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { Kinship } from '../graph.ts';
import { plan } from '../../../scripts/i18n-scaffold.ts';
import {
  DUPLICATE_KEYS,
  KEYS,
  LANGUAGES,
  LOCALES,
  formatDate,
  kinshipLabel,
  localizeTitle,
  missingKeys,
  negotiateLocale,
  offeredLocales,
  ordinal,
  relativeTime,
  translate,
  translateMessage,
} from './dictionary.ts';

const areasUrl = new URL('./areas/', import.meta.url);
const areaFiles = readdirSync(areasUrl).filter((f) => f.endsWith('.ts')).sort();

test('every area exports English only, and every other language has one file per area and an up-to-date index', async () => {
  assert.ok(areaFiles.length >= 18, `expected the 18 areas, found ${areaFiles.length}`);
  for (const file of areaFiles) {
    const area = await import(new URL(file, areasUrl).href);
    assert.ok(area.en && typeof area.en === 'object', `${file} exports en`);
    assert.deepEqual(Object.keys(area).filter((k) => k !== 'en'), [], `${file}: another language belongs in locales/<locale>/${file}`);
  }
  assert.deepEqual(plan().map(([file]) => file), [], 'run `node scripts/i18n-scaffold.ts`');
});

test('the registry agrees with Intl: plural categories, and each locale is one Intl knows', () => {
  for (const locale of LOCALES) {
    const rules = new Intl.PluralRules(LANGUAGES[locale].intl);
    assert.deepEqual([...LANGUAGES[locale].plurals].sort(), [...rules.resolvedOptions().pluralCategories].sort(), `${locale}: plural categories`);
    assert.equal(Intl.getCanonicalLocales(locale)[0], locale, `${locale} is a canonical BCP 47 tag`);
    assert.equal(LANGUAGES[locale].shortMonths.length, 12);
  }
});

test('German imperatives are the full du-forms (“versuche”, “prüfe”, “speichere”), not the clipped ones', async () => {
  const clipped = /(?:^|[^\p{L}])(?:[Vv]ersuch (?:es|weniger|einen)|[Pp]rüf (?:die|es)|[Ww]ähl|[Ss]chreib|[Nn]utz|[Ff]üg|[Pp]robier|[Tt]ipp ihn|setz einen|[Kk]lick auf|speicher dann)(?=\s|$|[.,])/u;
  for (const file of areaFiles) {
    const german = (await import(new URL(`../locales/de/${file}`, areasUrl).href)).default;
    for (const [key, value] of Object.entries(german as Record<string, unknown>)) {
      const parts = typeof value === 'string' ? [value] : Object.values(value as Record<string, string>);
      for (const s of parts) assert.doesNotMatch(s, clipped, `${file.replace(/\.ts$/, '')}: ${key}`);
    }
  }
});

test('no key is defined in two areas', () => {
  assert.deepEqual(DUPLICATE_KEYS, []);
});

test('a language being translated falls back to English for every key it lacks', (t) => {
  for (const locale of LOCALES.filter((l) => !LANGUAGES[l].complete)) {
    const gaps = missingKeys(locale);
    t.diagnostic(`${locale} covers ${KEYS.length - gaps.length} of ${KEYS.length} keys`);
    if (gaps.length) assert.equal(translate(locale, gaps[0] as never, { count: 2 }), translate('en', gaps[0] as never, { count: 2 }));
  }
});

test('a plural chooses its form by the language’s CLDR category, and a category it leaves out takes other', async () => {
  const { pluralCategory } = await import('./dictionary.ts');
  // Polish: one for 1, few for 2-4 and 22-24, many for 5-21 and 0; English and German: one and other.
  assert.deepEqual([0, 1, 2, 4, 5, 12, 22, 25].map((n) => pluralCategory('pl', n)), ['many', 'one', 'few', 'few', 'many', 'many', 'few', 'many']);
  assert.deepEqual([1, 2].map((n) => pluralCategory('ja', n)), ['other', 'other']);
  assert.deepEqual([0, 1, 2].map((n) => pluralCategory('fr', n)), ['one', 'one', 'other']);
  assert.deepEqual([0, 1, 2].map((n) => pluralCategory('de', n)), ['other', 'one', 'other']);
});

test('a thrown English sentence still finds its key by any of its plural forms', () => {
  assert.equal(translateMessage('This language is not offered on this server.', 'de'), 'Diese Sprache gibt es auf diesem Server nicht.');
  assert.equal(translateMessage('3 new comments on your memory', 'de'), '3 neue Kommentare zu deiner Erinnerung');
});

test('plural entries choose one or other by count in each language', () => {
  assert.equal(translate('en', 'common.people', { count: 1 }), '1 person');
  assert.equal(translate('en', 'common.people', { count: 3 }), '3 people');
  assert.equal(translate('de', 'common.people', { count: 3 }), '3 Personen');
  assert.equal(translate('af', 'common.people', { count: 1 }), '1 persoon');
  assert.equal(translate('af', 'common.people', { count: 3 }), '3 mense');
});

test('placeholders are filled and left alone when absent', () => {
  assert.equal(translate('af', 'account.signedIn', { email: 'a@b.c' }), 'Aangemeld as a@b.c');
  assert.equal(translate('de', 'account.signedIn', {}), 'Angemeldet als {email}');
});

test('negotiation accepts Afrikaans and keeps the best supported language', () => {
  assert.equal(negotiateLocale('af-ZA,af;q=0.9,en;q=0.8'), 'af');
  assert.equal(negotiateLocale('fr-FR, de;q=0.5, en;q=0.3', ['en', 'de', 'af']), 'de');
  assert.equal(negotiateLocale('fr-FR', ['en', 'de', 'af']), 'en');
  assert.equal(negotiateLocale(''), 'en');
});

test('negotiation offers only the instance’s languages, and finds a regional or script tag’s language', () => {
  const all = [...LOCALES];
  assert.equal(negotiateLocale('pt-PT,pt;q=0.9', all), 'pt-BR', 'Portuguese finds the only Portuguese');
  assert.equal(negotiateLocale('zh-CN', all), 'zh-Hans');
  assert.equal(negotiateLocale('zh-Hans-SG', all), 'zh-Hans');
  assert.equal(negotiateLocale('zh-TW, ja;q=0.5', all), 'ja', 'Traditional Chinese is not zh-Hans');
  assert.equal(negotiateLocale('de-CH, fr;q=0.9', ['en', 'fr']), 'fr', 'German turned off: the next one the reader asks for');
  assert.equal(negotiateLocale('de-CH', ['en']), 'en');
  assert.equal(negotiateLocale('NL-be;q=0.8, xx', all), 'nl', 'tags in any case');
});

test('an instance offers English always, and only complete languages, whatever its setting says', () => {
  const complete = LOCALES.filter((l) => LANGUAGES[l].complete);
  assert.deepEqual(offeredLocales(null), complete, 'no setting: every complete language');
  assert.deepEqual(offeredLocales('en'), ['en']);
  assert.deepEqual(offeredLocales('af,xx'), ['en', 'af']);
  assert.deepEqual(offeredLocales(LOCALES.join(',')), complete, 'an incomplete language is never offered');
});

test('ordinals follow each language’s rule', () => {
  assert.equal(ordinal(50, 'en'), '50th');
  assert.equal(ordinal(50, 'de'), '50.');
  assert.equal(ordinal(1, 'fr'), '1er');
  assert.equal(ordinal(2, 'fr'), '2e');
  assert.equal(ordinal(50, 'ja'), '第50');
});

test('a moment formats with a date and time style, as the history rows ask for', () => {
  const text = formatDate('2026-11-10T09:30:00Z', 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  assert.match(text, /10 Nov 2026/);
  assert.match(text, /09:30/);
  assert.equal(formatDate('2026-11-10T09:30:00Z', 'de', { timeZone: 'UTC' }), '10. November 2026');
});

test('dates and relative times follow the Afrikaans locale', () => {
  assert.equal(formatDate('1985-06-14', 'af'), '14 Junie 1985');
  assert.equal(formatDate('~1900', 'af'), 'ong. 1900');
  assert.equal(relativeTime(null, 'af'), 'nooit');
  assert.match(relativeTime(Date.now() - 3 * 86_400_000, 'af'), /3 dae gelede/);
});

test('kinship words exist in Afrikaans and German, English stays as the graph labels it', () => {
  const k = (label: string) => ({ label }) as Kinship;
  assert.equal(kinshipLabel(k('mother'), 'af'), 'ma');
  assert.equal(kinshipLabel(k('grandmother'), 'af'), 'ouma');
  assert.equal(kinshipLabel(k('mother-in-law'), 'af'), 'skoonma');
  assert.equal(kinshipLabel(k('cousin'), 'af'), 'neef/niggie');
  assert.equal(kinshipLabel(k('second cousin once removed'), 'af'), 'tweede neef/niggie een keer verwyder');
  assert.equal(kinshipLabel(k('mother'), 'de'), 'Mutter');
  assert.equal(kinshipLabel(k('mother'), 'en'), 'mother');
});

test('page titles translate their section word in both directions', () => {
  assert.equal(localizeTitle('Sign in · Kindred', 'af'), 'Meld aan · Kindred');
  assert.equal(localizeTitle('Meld aan · Kindred', 'en'), 'Sign in · Kindred');
  assert.equal(localizeTitle('Anmelden · Kindred', 'de'), 'Anmelden · Kindred');
  assert.equal(localizeTitle('Tree · Kindred', 'de'), 'Stammbaum · Kindred');
});
