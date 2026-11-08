// node --test src/lib/gazetteer.test.ts — which place names the gazetteer places with certainty. A synthetic gazetteer
// (a few towns with the same names as real ones) is built in a temporary folder and read through the Node driver, so
// nothing under data/ is touched. The matching rules are the point: a name that could be two towns is never placed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-gazetteer-test-'));
const gazetteerPath = join(dir, 'gazetteer.db');
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_GAZETTEER = gazetteerPath;

// The same tables the D1 migration and scripts/gazetteer.ts make.
const g = new DatabaseSync(gazetteerPath);
g.exec(readFileSync(join(process.cwd(), 'migrations', 'gazetteer', '0001_gazetteer.sql'), 'utf8'));
g.exec(`
  INSERT INTO place (id, name, cc, admin1, lat, lng, pop) VALUES
    (1, 'Hamburg', 'de', 'Hamburg', 53.55, 9.99, 1800000),
    (2, 'Hamburg', 'us', 'New York', 42.7, -78.8, 11000),
    (3, 'Frankfurt am Main', 'de', 'Hessen', 50.11, 8.68, 700000),
    (4, 'Frankfurt (Oder)', 'de', 'Brandenburg', 52.35, 14.55, 58000),
    (5, 'München', 'de', 'Bayern', 48.14, 11.58, 1450000),
    (6, 'Springfield', 'us', 'Illinois', 39.8, -89.6, 116000),
    (7, 'Springfield', 'us', 'Missouri', 37.2, -93.3, 169000),
    (8, 'Paris', 'fr', 'Île-de-France', 48.85, 2.35, 2100000),
    (9, 'Paris', 'us', 'Texas', 33.66, -95.55, 25000),
    (10, 'Oslo', 'no', 'Oslo', 59.91, 10.75, 690000);
  INSERT INTO name (key, id, alt) VALUES
    ('hamburg', 1, NULL), ('hamburg', 2, NULL),
    ('frankfurt am main', 3, NULL), ('frankfurt oder', 4, NULL), ('frankfurt', 3, NULL), ('frankfurt', 4, NULL),
    ('munchen', 5, NULL), ('munich', 5, 'Munich'),
    ('springfield', 6, NULL), ('springfield', 7, NULL),
    ('paris', 8, NULL), ('paris', 9, NULL),
    ('oslo', 10, NULL);
`);
g.close();

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { splitPlace, countryCodeOf, locatePlaces, gazetteer } = await load<typeof import('./gazetteer.server.ts')>('/src/lib/gazetteer.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a place name is split into its town and its last part as the country', () => {
  assert.deepEqual(splitPlace('Hamburg, Hamburg, Germany'), { town: 'Hamburg', country: 'Germany' });
  assert.deepEqual(splitPlace('Oslo'), { town: 'Oslo', country: null });
  assert.deepEqual(splitPlace(' , '), { town: '', country: null });
});

test('a country is found by its name in English, German and Afrikaans, or by its code', () => {
  assert.equal(countryCodeOf('Germany'), 'DE');
  assert.equal(countryCodeOf('Deutschland'), 'DE');
  assert.equal(countryCodeOf('Duitsland'), 'DE');
  assert.equal(countryCodeOf('DE'), 'DE');
  assert.equal(countryCodeOf('Narnia'), null);
});

test('the gazetteer is found through the Node driver', () => {
  assert.ok(gazetteer(), 'the synthetic gazetteer should open');
});

test('a town with one match is placed, with its country', async () => {
  const hits = await locatePlaces(gazetteer()!, ['München, Germany', 'Munich, Germany', 'Oslo']);
  assert.deepEqual(hits.get('München, Germany'), { lat: 48.14, lng: 11.58, country: 'de' });
  // "Munich" is an alternate spelling of München and finds the same single town.
  assert.equal(hits.get('Munich, Germany')?.country, 'de');
  assert.equal(hits.get('Oslo')?.country, 'no');
});

test('a town name shared by more than one town is not placed, unless the country tells them apart', async () => {
  const hits = await locatePlaces(gazetteer()!, [
    'Springfield',
    'Springfield, Illinois',
    'Frankfurt, Germany',
    'Hamburg',
    'Hamburg, Germany',
    'Paris, Texas, United States',
    'Paris, France',
    'Paris, Hungary',
  ]);
  assert.equal(hits.has('Springfield'), false, 'two Springfields');
  assert.equal(hits.has('Springfield, Illinois'), false, 'a region is not a country, so still two towns');
  assert.equal(hits.has('Frankfurt, Germany'), false, 'two towns of that name in Germany');
  assert.equal(hits.has('Hamburg'), false, 'two Hamburgs, and no country to choose');
  assert.equal(hits.get('Hamburg, Germany')?.country, 'de', 'the German Hamburg, not the one in the United States');
  assert.equal(hits.get('Paris, Texas, United States')?.country, 'us', 'the country picks Paris in Texas');
  assert.equal(hits.get('Paris, France')?.country, 'fr');
  assert.equal(hits.has('Paris, Hungary'), false, 'no Paris in Hungary');
});

test('a name with no match, or a name too short to search, is left out', async () => {
  const hits = await locatePlaces(gazetteer()!, ['Atlantis, Germany', 'X', '']);
  assert.equal(hits.size, 0);
});
