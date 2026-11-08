// Loads data/gazetteer.db (built by `mise run gazetteer`) into the D1 database bound as GAZETTEER, so that assisted place
// entry works on Workers. It is read-only there; this script is the only writer. Run it after the migrations (cf:migrate).
//   node scripts/gazetteer-to-d1.ts --local --env local     the local D1 that `mise run dev:cf` uses
//   node scripts/gazetteer-to-d1.ts --remote                the deployed database (needs `wrangler login`)
// Options: --source <file> (default data/gazetteer.db), --persist-to <dir> (wrangler's local state folder, for tests),
// --rows <n> (rows per file, default 5000). Each file is one `wrangler d1 execute`. The load starts by emptying the
// tables, so running it again replaces the data; the meta rows are written last, so a load that stops is not mistaken for
// a finished one. Attribution: GeoNames, CC BY 4.0 (docs/deploy-cloudflare.md).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gazetteerFiles, type NameRow, type PlaceRow } from './lib/gazetteer-load.ts';
import { where, wrangler, wranglerBindings } from './lib/wrangler.ts';

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const remote = args.includes('--remote');
const env = option('--env');
const source = resolve(option('--source') ?? 'data/gazetteer.db');
const persist = option('--persist-to');
const rowsPerFile = Number(option('--rows') ?? 5000);
if (!Number.isInteger(rowsPerFile) || rowsPerFile < 1) throw new Error('--rows must be a whole number');

const binding = wranglerBindings(env).d1.find((b) => b.binding === 'GAZETTEER');
if (!binding) {
  throw new Error(`wrangler.jsonc has no GAZETTEER database${env ? ` in the "${env}" environment` : ''}: see docs/deploy-cloudflare.md, "Places on Workers"`);
}
if (!existsSync(source)) throw new Error(`no gazetteer at ${source}: run mise run gazetteer first`);

const scope = [...where(remote, env), ...(persist ? ['--persist-to', persist] : [])];
const database = binding.database_name;
if (binding.migrations_dir) {
  console.log(`${binding.binding} (${database}): applying ${binding.migrations_dir}`);
  wrangler(['d1', 'migrations', 'apply', database, ...scope]);
}

const src = new DatabaseSync(source, { readOnly: true });
const counts = src.prepare('SELECT (SELECT count(*) FROM place) AS places, (SELECT count(*) FROM name) AS names').get() as { places: number; names: number };
const meta = src.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
const places = src.prepare('SELECT id, name, cc, admin1, lat, lng, pop FROM place ORDER BY id').iterate() as Iterable<PlaceRow>;
const names = src.prepare('SELECT key, id, alt FROM name ORDER BY key, id').iterate() as Iterable<NameRow>;

const dir = mkdtempSync(join(tmpdir(), 'kindred-gazetteer-'));
try {
  console.log(`loading ${counts.places.toLocaleString('en-GB')} places and ${counts.names.toLocaleString('en-GB')} names from ${source}`);
  let file = 0;
  for (const statements of gazetteerFiles({ meta, places, names }, rowsPerFile)) {
    const path = join(dir, `part-${String(++file).padStart(4, '0')}.sql`);
    writeFileSync(path, `${statements.join('\n')}\n`);
    wrangler(['d1', 'execute', database, '--file', path, ...scope], { quiet: true });
    console.log(`  file ${file}: ${statements.length} statement${statements.length === 1 ? '' : 's'}`);
  }

  // Check what the database now holds against the source, so a load that lost rows says so.
  const out = wrangler(['d1', 'execute', database, '--command', 'SELECT (SELECT count(*) FROM place) AS places, (SELECT count(*) FROM name) AS names', '--json', ...scope], { quiet: true });
  const held = JSON.parse(out.slice(out.indexOf('[')))[0].results[0] as { places: number; names: number };
  const wrong = [
    held.places !== counts.places ? `places: sent ${counts.places}, the database holds ${held.places}` : '',
    held.names !== counts.names ? `names: sent ${counts.names}, the database holds ${held.names}` : '',
  ].filter(Boolean);
  if (wrong.length) throw new Error(`the load did not arrive in full (${wrong.join('; ')}). Run it again.`);
  console.log(`done: ${database} holds ${held.places.toLocaleString('en-GB')} places and ${held.names.toLocaleString('en-GB')} names`);
} finally {
  src.close();
  rmSync(dir, { recursive: true, force: true });
}
