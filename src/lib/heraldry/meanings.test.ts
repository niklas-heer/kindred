// Every tincture, stain, fur, ordinary, division and catalogue charge has its meaning in English, German and
// Afrikaans, each on one line, so nothing can go missing later. The ordinary and division lists are checked
// against their types at compile time (meanings.ts), so these tests walk the same keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../i18n/areas/heraldry.ts';
import { en as libraryEn } from '../i18n/areas/charge-library.ts';
import af from '../i18n/locales/af/heraldry.ts';
import afLibrary from '../i18n/locales/af/charge-library.ts';
import de from '../i18n/locales/de/heraldry.ts';
import deLibrary from '../i18n/locales/de/charge-library.ts';
import type { Key } from '../i18n/dictionary.ts';
import { CATEGORIES } from './catalogue.ts';
import { LIBRARY_CHARGES } from '../../components/heraldry/library/charges.gen.ts';
import { addLibraryCharges, allChargeDefs, chargeDef } from './registry.ts';
import {
  ACHIEVEMENT_MEANING, CATEGORY_MEANING, CHARGE_MEANING, DIVISION_MEANING, LINE_MEANING, ORDINARY_MEANING, SHIELD_MEANING, TINCTURE_MEANING,
  chargeMeaning, divisionMeaning, ordinaryMeaning, tinctureMeaning,
} from './meanings.ts';
import { blazonAchievement, blazonV2 } from './blazon.ts';
import { TINCTURES_V2 } from './tinctures.ts';
import { DIVISIONS_V2, HELMS, LINES_V2, ORDINARIES, SHIELDS } from './vocab.ts';
import type { ArmsV2 } from '../seed-format.ts';

const LANGUAGES = [['en', en], ['de', de], ['af', af]] as const;

// Every charge: the catalogue's, and the library's (which the client loads on demand).
addLibraryCharges(LIBRARY_CHARGES);
const CHARGES = allChargeDefs();

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

test('every charge, catalogue and library, resolves to an explanation in all three languages', () => {
  for (const c of CHARGES) assertAllLanguages(chargeMeaning(c.id), `charge ${c.id}`);
});

test('the specific charge lines name real catalogue charges, so none is orphaned', () => {
  for (const id of Object.keys(CHARGE_MEANING)) assert.ok(chargeDef(id), `no catalogue charge called ${id}`);
});

test('a charge without its own line falls back to its category, and an unknown one to objects', () => {
  const plain = CHARGES.find((c) => !CHARGE_MEANING[c.id])!;
  assert.equal(chargeMeaning(plain.id), CATEGORY_MEANING[plain.cat]);
  assert.equal(chargeMeaning('no-such-charge'), CATEGORY_MEANING.objects);
  for (const cat of CATEGORIES) assertAllLanguages(CATEGORY_MEANING[cat.id], `category ${cat.id}`);
});

test('every shield form, partition line and part of the achievement has a meaning in all three languages', () => {
  for (const s of SHIELDS) assertAllLanguages(SHIELD_MEANING[s.id], `shield ${s.id}`);
  for (const l of LINES_V2) if (l.id !== 'straight') assertAllLanguages(LINE_MEANING[l.id], `line ${l.id}`);
  for (const [part, key] of Object.entries(ACHIEVEMENT_MEANING)) assertAllLanguages(key, `achievement ${part}`);
});

// A German or Afrikaans name equal to its English one is an untranslated entry, unless the word really is the same in
// that language. These lists are those real words. A new name that matches English fails until it is translated or added.
const SHARED_WORDS = {
  de: new Set(['Rose', 'Hand', 'Helm', 'Hammer', 'Tiara', 'Nautilus', 'Wyvern', 'Pegasus', 'Hydra', 'Lotus', 'Purpur', 'Gecko', 'Salamander', 'Tiger', 'Flamingo', 'Kraken', 'Ankh', 'Arm', 'Banjo', 'Gong', 'Amethyst', 'Sextant', 'Fez', 'Piranha', 'Dodo', 'Kiwi', 'Ibis', 'Nest', 'Troll', 'Medusa', 'Obelisk', 'Palisade', 'Dolmen', 'Horus', 'Anubis', 'Bastet', 'Papyrus', 'Palette', 'Croissant', 'Avocado', 'Aubergine', 'Orange', 'Bonsai', 'Planet', 'Wind', 'Meteor', 'Gladius', 'Katana', 'Machete', 'Vase', 'Maracas', 'Tuba', 'Carnyx']),
  af: new Set(['Monsters', 'Estoile', 'Ram', 'Nautilus', 'Wyvern', 'Pegasus', 'Lotus', 'Helm', 'Pretzel', 'Tiara', 'Hand', 'Harp', 'Lantern', 'Bordure', 'Vair', 'Bison', 'Salamander', 'Kraken', 'Ankh', 'Arm', 'Banjo', 'Gong', 'Ham', 'Piranha', 'Dodo', 'Kiwi', 'Ibis', 'Medusa', 'Obelisk', 'Fort', 'Dolmen', 'Horus', 'Anubis', 'Bastet', 'Croissant', 'Bonsai', 'Wind', 'Sandstorm', 'Hut', 'Tent', 'Glaive', 'Gladius', 'Katana', 'Machete', 'Stiletto', 'Musket', 'Bed', 'Maracas', 'Tuba', 'Carnyx']),
};

test('no name in the panel stays in English when the language is German or Afrikaans', () => {
  const keys: Key[] = [
    ...TINCTURES_V2.map((t) => t.label), ...SHIELDS.map((s) => s.label), ...DIVISIONS_V2.map((d) => d.label),
    ...LINES_V2.map((l) => l.label), ...ORDINARIES.map((o) => o.label), ...HELMS.map((h) => h.label),
    ...CATEGORIES.map((c) => c.label),
  ];
  const areas = { en: { ...en, ...libraryEn }, de: { ...de, ...deLibrary }, af: { ...af, ...afLibrary } } as unknown as Record<string, Record<string, string>>;
  for (const lang of ['de', 'af'] as const) {
    const bad: string[] = [];
    for (const key of keys) if (areas[lang][key] === areas.en[key] && !SHARED_WORDS[lang].has(areas.en[key])) bad.push(`${key} (${areas.en[key]})`);
    for (const c of CHARGES) {
      const [english, local] = [areas.en[c.label], areas[lang][c.label]];
      if (local === english && !SHARED_WORDS[lang].has(english)) bad.push(`charge ${c.id} (${english})`);
    }
    assert.deepEqual(bad, [], `${lang}: still English`);
  }
});

const SAMPLE: ArmsV2 = {
  shield: 'swiss',
  field: { division: 'per-pale', tinctures: ['gules', 'argent'], line: 'wavy' },
  layers: [
    { type: 'ordinary', kind: 'fess', tincture: 'azure', line: 'straight' },
    { type: 'charge', charge: 'lion', tincture: 'or', count: 3, arrangement: 'auto', on: 'ordinary' },
  ],
};

test('the blazon follows the language and leaves no heraldic English behind', () => {
  assert.equal(blazonV2(SAMPLE), 'Per pale wavy gules and argent, on a fess azure three lions’ heads or');
  assert.equal(blazonV2(SAMPLE, 'de'), `Gespalten, gewellt ${de['heraldry.reading.of']} Rot und Silber; Balken in Blau, darauf 3 × ${de['heraldry.charge.lion']} in Gold`);
  assert.equal(blazonV2(SAMPLE, 'af'), `Per paal, golwend ${af['heraldry.reading.of']} keel en silwer; Fes in asuur, daarop 3 × ${af['heraldry.charge.lion']} in goud`);
  const ach = { helm: 'knight', mantling: ['gules', 'or'], crest: { charge: 'lion', tincture: 'or' }, motto: 'Treu' } as const;
  const words = blazonAchievement({ ...ach, mantling: [...ach.mantling] }, 'de');
  assert.match(words, /^Helm: Ritter\. Helmdecke: Rot und Gold\. Helmzier: .+ in Gold\. Wahlspruch: „Treu“\.$/);
  assert.doesNotMatch(words, /\b(of|and|Crest|Mantling)\b/);
});

test('every meaning is one short line', () => {
  const keys = [
    ...Object.values(SHIELD_MEANING),
    ...Object.values(LINE_MEANING),
    ...Object.values(ACHIEVEMENT_MEANING),
    ...TINCTURES_V2.map((t) => tinctureMeaning(t.id)),
    ...Object.values(ORDINARY_MEANING),
    ...Object.values(DIVISION_MEANING),
    ...Object.values(CATEGORY_MEANING),
    ...CHARGES.map((c) => chargeMeaning(c.id)),
  ];
  for (const key of keys) {
    for (const [lang, area] of LANGUAGES) {
      const text = (area as Record<string, unknown>)[key] as string | undefined;
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
