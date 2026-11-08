// Writes a family as GEDCOM 5.5.1, from its Node database (data/<id>.db, or $KINDRED_DATA_DIR/<id>.db).
//   node scripts/export-gedcom.ts modern                  to stdout
//   node scripts/export-gedcom.ts modern -o modern.ged    to a file
// What GEDCOM cannot carry (stories, contacts, houses, pictures) is listed on stderr.
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { wrap } from '../src/lib/store/node.ts';
import { readTree } from '../src/lib/exchange/model.ts';
import { writeGedcom } from '../src/lib/exchange/gedcom.ts';

const args = process.argv.slice(2);
const tree = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-o');
const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : undefined;
if (!tree) {
  console.error('usage: node scripts/export-gedcom.ts <tree> [-o file.ged]');
  process.exit(2);
}

const data = process.env.KINDRED_DATA_DIR ? resolve(process.env.KINDRED_DATA_DIR) : resolve('data');
const path = join(data, `${tree}.db`);
if (!existsSync(path)) {
  console.error(`no family database at ${path}`);
  process.exit(1);
}
// Read-only: an export never migrates, checkpoints or otherwise writes the family's file.
const d = new DatabaseSync(path, { readOnly: true });
const model = await readTree(wrap(d));
d.close();
const { text, losses } = writeGedcom(model);
if (out) writeFileSync(out, text);
else process.stdout.write(text);
console.error(`${tree}: ${model.people.length} people, ${model.parents.length} parent links, ${model.unions.length} partnerships${out ? ` → ${out}` : ''}`);
for (const l of losses) console.error(`not in the file: ${l}`);
