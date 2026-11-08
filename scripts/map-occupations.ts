// Gives existing free-text occupations their vocabulary code (src/lib/occupations.ts), one family at a time.
//   node scripts/map-occupations.ts <tree> [--dry-run]     one family database (data/<tree>.db)
//   node scripts/map-occupations.ts --all [--dry-run]      every family database in the data folder
// Decision: a one-off script, not part of migration-on-open. Migrations are SQL that runs the same on SQLite and
// D1; matching needs the vocabulary's labels in every language, which only JavaScript has. Run it once after
// deploying 0006_occupation. It is idempotent: it only looks at people whose code is still NULL.
// It NEVER changes the free text (`occupation`) or any timestamp. A text is mapped only when it names exactly one
// entry (an exact or case-insensitive match against any language's label); anything else stays free text.
// KINDRED_DATA_DIR selects the data folder, as in the other scripts.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSqlite, wrap } from '../src/lib/store/node.ts';
import { occupationForText } from '../src/lib/occupations.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const tree = args.find((a) => !a.startsWith('-'));
if (!all && !tree) {
  console.error('usage: node scripts/map-occupations.ts <tree> [--dry-run]   or   --all [--dry-run]');
  process.exit(2);
}

const data = process.env.KINDRED_DATA_DIR ? resolve(process.env.KINDRED_DATA_DIR) : resolve('data');
// Every family database in the folder. accounts.db and gazetteer.db are not families and never get tree migrations.
const NOT_FAMILIES = new Set(['accounts.db', 'gazetteer.db']);
const trees = all
  ? readdirSync(data).filter((f) => /^[a-z0-9-]+\.db$/.test(f) && !NOT_FAMILIES.has(f)).map((f) => f.slice(0, -3))
  : [tree!];

for (const id of trees) {
  const path = join(data, `${id}.db`);
  if (!existsSync(path)) {
    console.error(`no family database at ${path}`);
    process.exitCode = 1;
    continue;
  }
  const d = openSqlite(path, 'tree'); // brings the file up to date with migrations first
  const store = wrap(d);
  const people = await store.all<{ id: string; occupation: string }>(
    "SELECT id, occupation FROM person WHERE occupation IS NOT NULL AND trim(occupation) <> '' AND occupation_code IS NULL",
  );
  const mapped: string[] = [];
  let kept = 0;
  for (const p of people) {
    const entry = occupationForText(p.occupation);
    if (!entry) {
      kept++;
      continue;
    }
    if (!dryRun) await store.run('UPDATE person SET occupation_code = ? WHERE id = ? AND occupation_code IS NULL', entry.id, p.id);
    mapped.push(`${p.occupation} → ${entry.id}`);
  }
  console.log(`${id}: ${mapped.length} ${dryRun ? 'would be mapped' : 'mapped'}, ${kept} left as free text`);
  for (const line of mapped.slice(0, 20)) console.log(`  ${line}`);
  if (mapped.length > 20) console.log(`  …and ${mapped.length - 20} more`);
  d.close();
}
