// Builds data/gazetteer.db: every populated place on Earth with 500+ people (GeoNames cities500,
// CC BY 4.0, https://www.geonames.org), so the place picker can suggest towns without the network.
//   node scripts/gazetteer.ts        (mise run gazetteer)
// The downloads (~40 MB zipped, ~160 MB unpacked) go to a fresh temp directory and are deleted at the end;
// only the database (~30 MB) is kept. The app works without it: the picker then offers the tree's own places.
import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';

const BASE = 'https://download.geonames.org/export/dump/';
const OUT = resolve('data/gazetteer.db');

/** Lower case, no accents, punctuation as spaces: "Saint-Étienne" → "saint etienne". Keep in step with `foldPlace` in src/lib/db.server.ts. */
export function fold(s: string) {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss').replace(/[øœ]/g, (c) => (c === 'ø' ? 'o' : 'oe')).replace(/æ/g, 'ae').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/þ/g, 'th').replace(/ı/g, 'i')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
/** Also treats German transliterations as the same spelling, so "Muenchen" is just München. */
const loose = (s: string) => fold(s).replace(/([aou])e/g, '$1');

// Names worth searching by: Latin script, a sensible length, not a code ("MUC") or a link.
const LATIN = /^[\p{Script=Latin}\s'’.\-()]+$/u;
const useful = (a: string) => a.length >= 2 && a.length <= 48 && LATIN.test(a) && !/^[A-Z]{2,5}$/.test(a);
/** GeoNames region names that lost their spelling. */
const ADMIN1_FIX: Record<string, string> = { 'DE.01': 'Baden-Württemberg', 'DE.16': 'Berlin' };
const accents = (s: string) => s.replace(/[\x00-\x7f]/g, '').length;

async function download(name: string, dir: string) {
  const res = await fetch(BASE + name);
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status}`);
  const file = join(dir, name);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
  return file;
}

async function* lines(file: string) {
  for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) if (line && !line.startsWith('#')) yield line.split('\t');
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'gazetteer-'));
  try {
    console.log('downloading cities500.zip and admin1CodesASCII.txt from geonames.org…');
    const [zip, admin1File] = await Promise.all([download('cities500.zip', dir), download('admin1CodesASCII.txt', dir)]);
    const unzip = spawnSync('unzip', ['-q', '-o', zip, 'cities500.txt', '-d', dir], { stdio: 'inherit' });
    if (unzip.status !== 0) throw new Error('unzip failed');
    rmSync(zip);

    const admin1 = new Map<string, string>();
    for await (const [code, name] of lines(admin1File)) admin1.set(code, ADMIN1_FIX[code] ?? name);

    mkdirSync('data', { recursive: true });
    const tmp = `${OUT}.building`;
    rmSync(tmp, { force: true });
    const d = new DatabaseSync(tmp);
    d.exec(`
      PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT NOT NULL, cc TEXT, admin1 TEXT, lat REAL NOT NULL, lng REAL NOT NULL, pop INTEGER NOT NULL);
      -- One row per searchable spelling, folded. A prefix search is a range scan: key >= 'munc' AND key < 'munc￿'.
      -- alt is the spelling to show when it differs from the place's own name (Munich for München).
      CREATE TABLE name (key TEXT NOT NULL, id INTEGER NOT NULL, alt TEXT, PRIMARY KEY (key, id)) WITHOUT ROWID;
    `);
    const putPlace = d.prepare('INSERT INTO place (id, name, cc, admin1, lat, lng, pop) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const putName = d.prepare('INSERT OR IGNORE INTO name (key, id, alt) VALUES (?, ?, ?)');
    let places = 0, names = 0;
    d.exec('BEGIN');
    for await (const c of lines(join(dir, 'cities500.txt'))) {
      const [id, name, ascii, alternates, lat, lng, , , cc, , a1, , , , pop] = c;
      const gid = Number(id);
      putPlace.run(gid, name, cc ? cc.toLowerCase() : null, admin1.get(`${cc}.${a1}`) ?? null, Number(lat), Number(lng), Number(pop) || 0);
      places++;
      const own = loose(name);
      // The place's own spelling first, so it wins a key it shares with an alternate.
      for (const n of [name, ascii]) if (fold(n)) names += Number(putName.run(fold(n), gid, null).changes);
      // One spelling per folded key, preferring the accented one: München over Munchen.
      const alts = new Map<string, string>();
      for (const raw of alternates ? alternates.split(',') : []) {
        const a = raw.trim();
        const k = fold(a);
        if (!k || k === fold(name) || k === fold(ascii) || !useful(a)) continue;
        const had = alts.get(k);
        if (had === undefined ? alts.size < 30 : accents(a) > accents(had)) alts.set(k, a);
      }
      for (const [k, a] of alts) names += Number(putName.run(k, gid, loose(a) === own ? null : a).changes);
    }
    d.exec('COMMIT');
    d.exec('CREATE INDEX place_by_lat ON place (lat)');
    d.prepare("INSERT INTO meta (key, value) VALUES ('source', ?), ('built', ?)").run('GeoNames cities500 (CC BY 4.0, geonames.org)', new Date().toISOString());
    d.exec('ANALYZE; VACUUM');
    d.close();
    // A stale write-ahead log beside the old file would be replayed onto the new one.
    for (const x of ['-wal', '-shm', '-journal']) rmSync(OUT + x, { force: true });
    renameSync(tmp, OUT);
    console.log(`wrote ${OUT}: ${places.toLocaleString('en-GB')} places, ${names.toLocaleString('en-GB')} searchable names`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!existsSync('package.json')) throw new Error('run from the project root');
await main();
