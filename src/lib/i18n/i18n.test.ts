import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { Kinship } from '../graph.ts';
import {
  DUPLICATE_KEYS,
  KEYS,
  formatDate,
  kinshipLabel,
  localizeTitle,
  missingKeys,
  negotiateLocale,
  relativeTime,
  translate,
} from './dictionary.ts';

const areasUrl = new URL('./areas/', import.meta.url);
const areaFiles = readdirSync(areasUrl).filter((f) => f.endsWith('.ts')).sort();

test('every area module exports en, de and af, and en and de have the same keys', async (t) => {
  assert.ok(areaFiles.length >= 18, `expected the 18 areas, found ${areaFiles.length}`);
  for (const file of areaFiles) {
    const area = await import(new URL(file, areasUrl).href);
    const name = file.replace(/\.ts$/, '');
    assert.ok(area.en && typeof area.en === 'object', `${name} exports en`);
    assert.ok(area.de && typeof area.de === 'object', `${name} exports de`);
    assert.ok(area.af && typeof area.af === 'object', `${name} exports af`);
    const en = Object.keys(area.en).sort();
    const de = Object.keys(area.de).sort();
    assert.deepEqual(de, en, `${name}: de has the same keys as en (missing: ${en.filter((k) => !de.includes(k))}, extra: ${de.filter((k) => !en.includes(k))})`);
    const afKeys = Object.keys(area.af);
    const afMissing = en.filter((k) => !afKeys.includes(k));
    const extra = afKeys.filter((k) => !en.includes(k));
    assert.deepEqual(extra, [], `${name}: af has no keys that en lacks`);
    t.diagnostic(`${name}: af covers ${afKeys.length} of ${en.length} keys${afMissing.length ? `; falls back to English for ${afMissing.join(', ')}` : ''}`);
  }
});

test('German imperatives are the full du-forms (“versuche”, “prüfe”, “speichere”), not the clipped ones', async () => {
  const clipped = /(?:^|[^\p{L}])(?:[Vv]ersuch (?:es|weniger|einen)|[Pp]rüf (?:die|es)|[Ww]ähl|[Ss]chreib|[Nn]utz|[Ff]üg|[Pp]robier|[Tt]ipp ihn|setz einen|[Kk]lick auf|speicher dann)(?=\s|$|[.,])/u;
  for (const file of areaFiles) {
    const area = await import(new URL(file, areasUrl).href);
    for (const [key, value] of Object.entries(area.de as Record<string, unknown>)) {
      const parts = typeof value === 'string' ? [value] : Object.values(value as Record<string, string>);
      for (const s of parts) assert.doesNotMatch(s, clipped, `${file.replace(/\.ts$/, '')}: ${key}`);
    }
  }
});

test('no key is defined in two areas', () => {
  assert.deepEqual(DUPLICATE_KEYS, []);
});

test('every English key has a German entry; Afrikaans gaps are reported and fall back to English', (t) => {
  assert.deepEqual(missingKeys('de'), []);
  const gaps = missingKeys('af');
  t.diagnostic(`af covers ${KEYS.length - gaps.length} of ${KEYS.length} keys; missing: ${gaps.join(', ') || 'none'}`);
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
  assert.equal(negotiateLocale('fr-FR, de;q=0.5, en;q=0.3'), 'de');
  assert.equal(negotiateLocale('fr-FR'), 'en');
  assert.equal(negotiateLocale(''), 'en');
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
