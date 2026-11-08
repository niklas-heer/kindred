// node --test scripts/lib/gazetteer-load.test.ts — the gazetteer's D1 load: the SQL it writes runs on the migrated schema,
// copies every row, escapes what needs escaping, and can be run again. Nothing here reaches wrangler or Cloudflare.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { gazetteerFiles, literal, type NameRow, type PlaceRow } from './gazetteer-load.ts';

const MIGRATION = readFileSync(join(import.meta.dirname, '..', '..', 'migrations', 'gazetteer', '0001_gazetteer.sql'), 'utf8');

/** A small gazetteer shaped like the one scripts/gazetteer.ts builds, with awkward names in it. */
function source(places: number) {
  const rows: PlaceRow[] = [];
  const names: NameRow[] = [];
  for (let i = 1; i <= places; i++) {
    rows.push({ id: i, name: i === 1 ? "München" : i === 2 ? "O'Brien-Ville" : `Town ${i}`, cc: i % 2 ? 'de' : null, admin1: null, lat: 50 + i / 1000, lng: 8 + i / 1000, pop: 1000 * i });
    names.push({ key: i === 1 ? 'muenchen' : `town ${i}`, id: i, alt: i === 1 ? 'Munich' : null });
    names.push({ key: `town ${i} alt`, id: i, alt: `Town ${i} alias` });
  }
  return {
    meta: [{ key: 'source', value: 'GeoNames cities500 (CC BY 4.0, geonames.org)' }, { key: 'built', value: '2026-11-08T00:00:00.000Z' }],
    places: rows,
    names,
  };
}

function migrated(): DatabaseSync {
  const d = new DatabaseSync(':memory:');
  d.exec(MIGRATION);
  return d;
}

test('the load writes every row, with the names and the meta, and the schema the app reads', () => {
  const d = migrated();
  const src = source(250);
  let files = 0;
  for (const statements of gazetteerFiles(src, 300)) {
    files++;
    d.exec(statements.join('\n'));
  }
  // 300 rows a file: the clear, the places, the names in several files, then the meta. More than one file of names.
  assert.ok(files > 3, `expected several files, got ${files}`);
  const counts = d.prepare('SELECT (SELECT count(*) FROM place) AS places, (SELECT count(*) FROM name) AS names, (SELECT count(*) FROM meta) AS meta').get();
  assert.deepEqual({ ...counts }, { places: 250, names: 500, meta: 2 });
  assert.deepEqual({ ...d.prepare("SELECT name, cc FROM place WHERE id = 2").get() }, { name: "O'Brien-Ville", cc: null });
  assert.equal(d.prepare("SELECT value FROM meta WHERE key = 'source'").get()?.value, 'GeoNames cities500 (CC BY 4.0, geonames.org)');
  // The search reads the name table by its key: the exact spelling and the alternate both find München.
  const hit = d.prepare('SELECT p.name, n.alt FROM name n JOIN place p ON p.id = n.id WHERE n.key = ?').get('muenchen');
  assert.deepEqual({ ...hit }, { name: 'München', alt: 'Munich' });
});

test('running the load again replaces the data rather than doubling it', () => {
  const d = migrated();
  for (let run = 0; run < 2; run++) {
    for (const statements of gazetteerFiles(source(40), 100)) d.exec(statements.join('\n'));
  }
  assert.equal(d.prepare('SELECT count(*) AS n FROM place').get()?.n, 40);
  assert.equal(d.prepare('SELECT count(*) AS n FROM name').get()?.n, 80);
  assert.equal(d.prepare('SELECT count(*) AS n FROM meta').get()?.n, 2);
});

test('the first file empties the tables and the meta rows come last', () => {
  const files = [...gazetteerFiles(source(3), 5000)];
  assert.deepEqual(files[0], ['DELETE FROM name;', 'DELETE FROM place;', 'DELETE FROM meta;']);
  assert.match(files[files.length - 1][0], /^INSERT INTO meta/);
});

test('literals are quoted and escaped, and a value that is not a finite number is refused', () => {
  assert.equal(literal("it's"), "'it''s'");
  assert.equal(literal(null), 'NULL');
  assert.equal(literal(-1.5), '-1.5');
  assert.throws(() => literal(Number.NaN), /not a finite number/);
});
