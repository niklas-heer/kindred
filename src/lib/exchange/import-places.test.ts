// node --test src/lib/exchange/import-places.test.ts — an import gives the Atlas its places from the gazetteer, but only where
// the match is certain, never changes a pin the family already has, and never changes the place's text. A synthetic
// gazetteer in a temporary folder stands in for data/gazetteer.db; the family is a scratch file under a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-import-places-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_GAZETTEER = join(dir, 'gazetteer.db');

// A small gazetteer: Hamburg in two countries (so "Hamburg, Germany" is certain and "Hamburg" alone is not), Frankfurt twice
// in Germany (never certain), and one Oslo.
const g = new DatabaseSync(process.env.KINDRED_GAZETTEER);
g.exec(readFileSync(join(process.cwd(), 'migrations', 'gazetteer', '0001_gazetteer.sql'), 'utf8'));
g.exec(`
  INSERT INTO place (id, name, cc, admin1, lat, lng, pop) VALUES
    (1, 'Hamburg', 'de', 'Hamburg', 53.55, 9.99, 1800000),
    (2, 'Hamburg', 'us', 'New York', 42.7, -78.8, 11000),
    (3, 'Frankfurt am Main', 'de', 'Hessen', 50.11, 8.68, 700000),
    (4, 'Frankfurt (Oder)', 'de', 'Brandenburg', 52.35, 14.55, 58000),
    (5, 'Oslo', 'no', 'Oslo', 59.91, 10.75, 690000);
  INSERT INTO name (key, id, alt) VALUES ('hamburg', 1, NULL), ('hamburg', 2, NULL), ('frankfurt', 3, NULL), ('frankfurt', 4, NULL), ('oslo', 5, NULL);
`);
g.close();

const { openSqlite } = await import('../store/node.ts');
const { db } = await import('../db.server.ts');
const { previewImport, applyImport } = await import('./import.server.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

// Anna was born in Hamburg, Germany; Bernd in Oslo, which the family already has a pin for; Clara in Frankfurt, Germany (two
// towns of that name in Germany, so no pin); Anna and Bernd married in Frankfurt, Germany.
const GEDCOM = [
  '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 NAME Anna /Beispiel/', '1 SEX F', '1 BIRT', '2 DATE 1900', '2 PLAC Hamburg, Germany',
  '0 @I2@ INDI', '1 NAME Bernd /Beispiel/', '1 SEX M', '1 BIRT', '2 DATE 1898', '2 PLAC Oslo',
  '0 @I3@ INDI', '1 NAME Clara /Beispiel/', '1 SEX F', '1 BIRT', '2 DATE 1930', '2 PLAC Frankfurt, Germany',
  '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 MARR', '2 PLAC Frankfurt, Germany', '1 CHIL @I3@',
  '0 TRLR',
].join('\n');

/** An empty family with one pin already on the Atlas: Oslo, at coordinates of the family's own choosing. */
function family(id: string) {
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Scratch ${id}'), ('tagline', 'test'), ('theme', 'modern'), ('focus', '');
    INSERT INTO place (name, lat, lng, country) VALUES ('Oslo', 1.5, 2.5, NULL);
  `);
  d.close();
}

test('the preview says how many places would be placed, and writes nothing', async () => {
  family('preview');
  const p = await previewImport('preview', GEDCOM);
  assert.equal(p.places.gazetteer, true);
  assert.equal(p.places.located, 1, 'Hamburg, Germany is the one certain town');
  assert.equal(p.places.unplaced, 1, 'Frankfurt, Germany has two towns of that name');
  assert.equal(p.places.alreadyPinned, 1, 'Oslo already has a pin');
  assert.deepEqual(p.places.unplacedNames, ['Frankfurt, Germany']);
  assert.deepEqual((await db('preview').all('SELECT name FROM place ORDER BY name')).map((r) => ({ ...r })), [{ name: 'Oslo' }], 'nothing was written');
});

test('the import places the certain towns, keeps the family pins and the text, and reports the counts', async () => {
  family('apply');
  const result = await applyImport('apply', GEDCOM, undefined, false);
  assert.deepEqual(result.places, { located: 1, unplaced: 1 });
  assert.equal(result.people, 3);

  const pins = await db('apply').all<{ name: string; lat: number; lng: number; country: string | null }>('SELECT name, lat, lng, country FROM place ORDER BY name');
  assert.deepEqual(
    pins.map((p) => ({ ...p })),
    [
      { name: 'Hamburg, Germany', lat: 53.55, lng: 9.99, country: 'de' },
      { name: 'Oslo', lat: 1.5, lng: 2.5, country: null },
    ],
    'the new pin is the German Hamburg; Oslo keeps the family’s own coordinates',
  );
  // The text is what the file says: the person's birth place is the name, unchanged.
  const anna = await db('apply').get<{ born_place: string }>("SELECT born_place FROM person WHERE given = 'Anna'");
  assert.equal(anna?.born_place, 'Hamburg, Germany');
  assert.equal((await db('apply').get<{ n: number }>('SELECT count(*) AS n FROM place'))?.n, 2);
});
