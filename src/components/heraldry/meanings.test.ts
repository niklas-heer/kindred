// Every tincture, stain, fur, ordinary, division and catalogue charge has its meaning in English, German and
// Afrikaans, each on one line, so nothing can go missing later. The ordinary and division lists are checked
// against their types at compile time (meanings.ts), so these tests walk the same keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { af, de, en } from '../../lib/i18n/areas/heraldry.ts';
import type { Key } from '../../lib/i18n/dictionary.ts';
import { CHARGES_V2, CHARGE_BY_ID, CATEGORIES } from './catalogue.ts';
import {
  CATEGORY_MEANING, CHARGE_MEANING, DIVISION_MEANING, ORDINARY_MEANING, TINCTURE_MEANING,
  chargeMeaning, divisionMeaning, ordinaryMeaning, tinctureMeaning,
} from './meanings.ts';
import { TINCTURES_V2 } from './tinctures.ts';

const LANGUAGES = [['en', en], ['de', de], ['af', af]] as const;

/** Fails with the item's name and the language when a key has no text, or an empty one. */
function assertAllLanguages(key: Key, what: string) {
  for (const [lang, area] of LANGUAGES) {
    const text = (area as Record<string, unknown>)[key];
    assert.ok(typeof text === 'string' && text.trim().length > 0, `${what}: no ${lang} text for ${key}`);
  }
}

test('every tincture, stain and fur has a meaning in all three languages', () => {
  for (const t of TINCTURES_V2) assertAllLanguages(tinctureMeaning(t.id), `tincture ${t.id}`);
  assert.equal(Object.keys(TINCTURE_MEANING).length, TINCTURES_V2.length);
});

test('every ordinary has a meaning in all three languages', () => {
  for (const kind of Object.keys(ORDINARY_MEANING) as (keyof typeof ORDINARY_MEANING)[]) {
    assertAllLanguages(ordinaryMeaning(kind), `ordinary ${kind}`);
  }
  assert.equal(Object.keys(ORDINARY_MEANING).length, 15);
});

test('every common division has a meaning in all three languages', () => {
  for (const d of Object.keys(DIVISION_MEANING) as (keyof typeof DIVISION_MEANING)[]) {
    assertAllLanguages(divisionMeaning(d), `division ${d}`);
  }
  assert.equal(Object.keys(DIVISION_MEANING).length, 19);
});

test('every catalogue charge resolves to an explanation in all three languages', () => {
  for (const c of CHARGES_V2) assertAllLanguages(chargeMeaning(c.id), `charge ${c.id}`);
});

test('the specific charge lines name real catalogue charges, so none is orphaned', () => {
  for (const id of Object.keys(CHARGE_MEANING)) assert.ok(CHARGE_BY_ID[id], `no catalogue charge called ${id}`);
});

test('a charge without its own line falls back to its category, and an unknown one to objects', () => {
  const plain = CHARGES_V2.find((c) => !CHARGE_MEANING[c.id])!;
  assert.equal(chargeMeaning(plain.id), CATEGORY_MEANING[plain.cat]);
  assert.equal(chargeMeaning('no-such-charge'), CATEGORY_MEANING.objects);
  for (const cat of CATEGORIES) assertAllLanguages(CATEGORY_MEANING[cat.id], `category ${cat.id}`);
});

test('every meaning is one short line', () => {
  const keys = [
    ...TINCTURES_V2.map((t) => tinctureMeaning(t.id)),
    ...Object.values(ORDINARY_MEANING),
    ...Object.values(DIVISION_MEANING),
    ...Object.values(CATEGORY_MEANING),
    ...CHARGES_V2.map((c) => chargeMeaning(c.id)),
  ];
  for (const key of keys) {
    for (const [lang, area] of LANGUAGES) {
      const text = (area as Record<string, string>)[key];
      if (text === undefined) continue; // reported by the tests above
      assert.ok(!text.includes('\n'), `${lang} ${key} spans lines`);
      assert.ok(text.length <= 160, `${lang} ${key} is ${text.length} characters`);
    }
  }
});

test('the German meanings use "du", never "Sie"', () => {
  for (const [key, text] of Object.entries(de)) {
    if (!key.startsWith('heraldry.means.') || typeof text !== 'string') continue;
    assert.ok(!/\b(Sie|Ihnen|Ihre)\b/.test(text), `${key} uses the formal form`);
  }
});
