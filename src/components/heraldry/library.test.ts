// The charge library: its size, its drawings, its names in three languages, and the search the picker and the AI share.
// The metadata and every category's glyphs are loaded here as the client loads them, so a missing drawing fails a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARGE_ICONS } from '../charges.gen.ts';
import { CATEGORIES, CHARGES_V2, type ChargeCategory } from './catalogue.ts';
import { candidateCharges, searchCharges, STOCK_CHARGES, termsOf } from './charge-search.ts';
import { LIBRARY_CHARGES } from './library/charges.gen.ts';
import { addLibraryCharges, allChargeDefs, chargeDef, chargeLabel } from './registry.ts';

addLibraryCharges(LIBRARY_CHARGES);
const ALL = allChargeDefs();

/** Each category's glyph module, loaded as the client loads it. Classic shapes have no glyph. */
async function glyphModules(): Promise<Map<ChargeCategory, Record<string, { viewBox: string; body: string }>>> {
  const out = new Map<ChargeCategory, Record<string, { viewBox: string; body: string }>>();
  for (const c of CATEGORIES) {
    if (c.id === 'classic') continue;
    const m = await import(`./library/glyphs/${c.id}.gen.ts`) as { GLYPHS: Record<string, { viewBox: string; body: string }> };
    out.set(c.id, m.GLYPHS);
  }
  return out;
}

test('the library brings the heraldry to 800 to 1,200 charges in all', () => {
  assert.ok(ALL.length >= 800 && ALL.length <= 1200, `${ALL.length} charges`);
  assert.equal(CHARGES_V2.length + LIBRARY_CHARGES.length, ALL.length);
});

test('no two charges share an id, and a library charge never repeats a catalogue charge', () => {
  const ids = ALL.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of LIBRARY_CHARGES) assert.equal(CHARGES_V2.some((k) => k.id === c.id), false, c.id);
});

test('every charge has a drawing: a core glyph, or its category module’s glyph', async () => {
  const modules = await glyphModules();
  for (const c of ALL) {
    if (!c.gi) continue; // a classic shape, drawn in classic.ts
    if (c.gi in CHARGE_ICONS) continue;
    const glyph = modules.get(c.cat)?.[c.gi];
    assert.ok(glyph, `${c.id}: no glyph ${c.gi} in the ${c.cat} module`);
    assert.ok(glyph.body.length > 0 && glyph.viewBox.length > 0, `${c.id}: empty glyph`);
  }
});

test('every library charge names itself in English, German and Afrikaans, and has search words', () => {
  for (const c of LIBRARY_CHARGES) {
    assert.ok(c.name, `${c.id}: no names`);
    for (const lang of ['en', 'de', 'af'] as const) assert.ok(c.name![lang].trim().length > 0, `${c.id}: no ${lang} name`);
    assert.ok(c.keys && c.keys.trim().length > 0, `${c.id}: no search words`);
  }
  // The eager charges resolve in all three languages too, through their i18n labels.
  for (const c of CHARGES_V2) for (const lang of ['en', 'de', 'af'] as const) assert.ok(chargeLabel(c, lang).trim().length > 0, `${c.id} ${lang}`);
});

test('the three new categories are listed and every category has at least one charge', () => {
  for (const id of ['faith', 'body', 'music'] as const) assert.ok(CATEGORIES.some((c) => c.id === id), id);
  for (const c of CATEGORIES) {
    if (c.id === 'classic') continue;
    assert.ok(ALL.some((d) => d.cat === c.id), `no charge in ${c.id}`);
  }
});

test('a boot-maker’s meaning puts the boot among the candidates, first', () => {
  const terms = termsOf('boot-maker or shoemaker’s trade name, from Middle Dutch bote (boot)', 'a boot-maker’s trade');
  const found = candidateCharges(terms, 40).map((c) => c.id);
  assert.ok(found.includes('boot'), `candidates: ${found.join(' ')}`);
  assert.ok(found.indexOf('boot') < 3, `the boot is not near the top: ${found.slice(0, 6).join(' ')}`);
});

test('a look-alike is not a candidate: a boat for "boot", or a rock for "sturdy"', () => {
  // The name "Botha" sounds near "boat", and a boat text is no reason to draw a boot, nor a boot a boat.
  const boat = candidateCharges(termsOf('a boat, the sound of the name'), 40).map((c) => c.id);
  assert.equal(boat.includes('boot'), false, 'a boat text must not offer the boot');
  assert.equal(boat.includes('fishing-boat'), true, 'a boat text offers the boats');
  assert.equal(candidateCharges(termsOf('sturdy, dependable footing'), 40).map((c) => c.id).includes('rock'), false);
});

test('German and Afrikaans words find their charges, with or without accents', () => {
  const finds = (q: string, id: string) => assert.ok(searchCharges(q).some((c) => c.id === id), `"${q}" finds ${id}`);
  finds('Stiefel', 'boot');
  finds('Schuhmacher', 'boot');
  finds('Skoenmaker', 'boot');
  finds('Amboss', 'anvil');
  finds('Mühlrad', 'mill-wheel');
  finds('muehlrad', 'mill-wheel');
  finds('Storch', 'stork');
  finds('ooievaar', 'stork');
  finds('Libelle', 'dragonfly');
  finds('Waterjuffer', 'dragonfly');
  finds('Lieweheersbesie', 'ladybird');
  finds('Ystervark', 'porcupine');
  finds('Spaarvarkie', 'piggy-bank');
  finds('Hangslot', 'padlock');
  finds('Stammbaum', 'family-tree');
  finds('Stamboom', 'family-tree');
});

test('the search reads every word of the query, and an empty query finds all', () => {
  assert.equal(searchCharges('').length, ALL.length);
  const both = searchCharges('wolf head').map((c) => c.id);
  assert.ok(both.every((id) => chargeDef(id)), 'every hit is a charge');
  assert.ok(searchCharges('no such charge anywhere xyzzy').length === 0);
});

test('every general stock charge exists, so the model is never offered a dead id', () => {
  for (const id of STOCK_CHARGES) assert.ok(chargeDef(id), `stock charge ${id} does not exist`);
});
