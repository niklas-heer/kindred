// Writes a family as a Kindred Markdown archive (the v1 format, readable by scripts/import-kindred.ts), into a
// folder, with the portraits copied from data/media/<id>/.
//   node scripts/export-markdown.ts modern archive/modern
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { wrap } from '../src/lib/store/node.ts';
import { readTree } from '../src/lib/exchange/model.ts';
import { markdownArchive, noteNames, portraitPath } from '../src/lib/exchange/markdown.ts';

const [tree, dest] = process.argv.slice(2);
if (!tree || !dest) {
  console.error('usage: node scripts/export-markdown.ts <tree> <folder>');
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

const names = noteNames(model.people);
const have = new Set<string>();
for (const p of model.people) {
  const at = portraitPath(p, names);
  if (!at || !p.portrait) continue;
  const from = join(data, 'media', tree, p.portrait.key);
  if (!existsSync(from)) continue;
  mkdirSync(dirname(join(dest, at)), { recursive: true });
  copyFileSync(from, join(dest, at));
  have.add(at);
}
const { files, losses } = markdownArchive(model, have);
for (const f of files) {
  const to = join(dest, f.path);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, f.data);
}
console.error(`${tree}: ${model.people.length} notes and ${have.size} portraits → ${dest}`);
for (const l of losses) console.error(`not in the archive: ${l}`);
