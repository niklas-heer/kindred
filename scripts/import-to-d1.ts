// Moves a family from its local SQLite file into its D1 database, and its pictures into R2.
//   node scripts/import-to-d1.ts modern realm --env local --replace   the local D1 that `mise run dev:cf` uses
//   node scripts/import-to-d1.ts family --remote                     the deployed one (only when you mean it)
//   node scripts/import-to-d1.ts modern --plan                        what would be copied, touching no Cloudflare
// The family's file is data/<id>.db (`scripts/import-kindred.ts` and `scripts/seed.ts` can build one from a v1 archive). Its D1 database is the TREE_<ID> binding in wrangler.jsonc. The source file is not
// changed: a copy is brought up to date with migrations/ and its pictures moved out, then uploaded.
//
// What is copied, and in what order, is decided in scripts/lib/d1-transfer.ts (COPIED_TABLES): every table a
// family's data lives in, parents before the rows that refer to them. Left out on purpose: `op` (retry keys of
// changes already sent, which expire after 30 days) and `d1_migrations` (the target's own migration record).
// Pictures and research documents are every file under data/media/<tree>/ (gallery/, photo/ and research/ alike), uploaded to R2 under <tree>/<key>.
// After the rows are written, every copied table's count is read back from D1 and compared; a mismatch fails loudly.
//
// Accounts are not copied: passkeys belong to a host name, so the first person to open the deployed
// site sets it up (see /setup) and invites the others.
//
// Options: --env <name> (a wrangler environment), --remote (default: local), --replace (empty the copied tables
// of a D1 database that already holds a family first; its old pictures stay in R2), --from <file.db>,
// --plan (print what would be copied and uploaded, and change nothing in Cloudflare). A database that already has
// the family's details but no people (setup made them) is refused without --replace, up front (see existingFamilyProblem).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { movePhotosOut, openSqlite } from '../src/lib/store/node.ts';
import { COPY_ONLY, countMismatches, countSql, deleteSql, existingFamilyProblem, foreignKeyOrderErrors, insertSql, listFiles, planMedia, planTables, type MediaFile } from './lib/d1-transfer.ts';
import { treeBinding, where, wrangler, wranglerBindings } from './lib/wrangler.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const remote = flag('--remote');
const replace = flag('--replace');
const plan = flag('--plan');
const env = option('--env');
const from = option('--from');
const trees = args.filter((a, i) => !a.startsWith('--') && !['--env', '--from'].includes(args[i - 1]));
if (!trees.length) {
  console.error('usage: node scripts/import-to-d1.ts <tree>... [--env <name>] [--remote] [--replace] [--from <file.db>] [--plan]');
  process.exit(2);
}
if (from && trees.length > 1) throw new Error('--from takes one tree');

const bindings = wranglerBindings(env);
const bucket = bindings.r2.find((b) => b.binding === 'MEDIA')?.bucket_name;
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', pdf: 'application/pdf' };

/** The foreign keys of the copied tables, as `table → parent`, from the copy's own schema. */
const keysOf = (d: DatabaseSync, tables: string[]) =>
  tables.flatMap((t) => (d.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string }[]).map((r) => ({ table: t, parent: r.table })));

for (const tree of trees) {
  const binding = treeBinding(tree);
  const target = bindings.d1.find((b) => b.binding === binding);
  if (!target && !plan) throw new Error(`wrangler.jsonc${env ? ` (env ${env})` : ''} has no D1 binding ${binding} for the tree ${tree}`);
  const source = resolve(from ?? `data/${tree}.db`);
  console.log(`\n${tree}: ${source} → D1 ${target?.database_name ?? binding} (${plan ? 'plan only' : remote ? 'remote' : 'local'})`);

  // A private copy, brought up to date, with its pictures moved out to a temporary folder.
  const tmp = mkdtempSync(join(tmpdir(), `kindred-d1-${tree}-`));
  try {
    const copy = join(tmp, `${tree}.db`);
    const src = new DatabaseSync(source, { readOnly: true });
    src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    src.close();
    const d = openSqlite(copy, 'tree');
    const id = (d.prepare("SELECT value FROM meta WHERE key = 'id'").get() as { value: string } | undefined)?.value;
    if (id !== tree) throw new Error(`${source} holds the tree "${id}", not "${tree}"`);

    const moved: MediaFile[] = [];
    movePhotosOut(d, tree, (key, bytes) => {
      const file = join(tmp, 'moved', key);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, bytes);
      moved.push({ key, file });
    });

    const tables = planTables((d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const order = foreignKeyOrderErrors(tables.copy, keysOf(d, tables.copy));
    if (order.length) throw new Error(`The table order in scripts/lib/d1-transfer.ts is wrong: ${order.join('; ')}`);

    const columns = new Map<string, string[]>();
    const rows = new Map<string, Record<string, unknown>[]>();
    for (const t of tables.copy) {
      const cols = (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).filter((c) => !(t === 'photo' && c === 'data'));
      columns.set(t, cols);
      rows.set(t, d.prepare(`SELECT ${cols.join(', ')} FROM ${t}${COPY_ONLY[t] ? ` WHERE ${COPY_ONLY[t]}` : ''}`).all() as Record<string, unknown>[]);
    }
    const stay = (d.prepare("SELECT count(*) AS n FROM person_field WHERE visibility = 'personal'").get() as { n: number }).n;
    if (stay) console.log(`${tree}: ${stay} personal ${stay === 1 ? 'item stays' : 'items stay'} in the source database: accounts are not copied, so nobody could read ${stay === 1 ? 'it' : 'them'} on the target`);
    // Pictures the family names (portraits and gallery) must all have a file; the folder's files all go up.
    const named = [...rows.get('photo')!, ...rows.get('media')!, ...rows.get('portrait')!, ...rows.get('research_document')!].map((r) => r.key)
      .concat(rows.get('media')!.map((r) => r.thumb))
      .filter((k): k is string => typeof k === 'string');
    // The pictures are in the media folder beside the family's file: data/media/<tree>, or with --from the folder beside
    // that file when it has one (a demo's scratch folder, scripts/demo.ts), else data/media/<tree> as before.
    const beside = from ? join(dirname(resolve(from)), 'media', tree) : null;
    const onDisk = listFiles(beside && existsSync(beside) ? beside : resolve('data/media', tree)).map((f) => ({ key: f.key, file: f.file }));
    const media = planMedia(named, [...moved, ...onDisk]);
    d.close();

    const sent = Object.fromEntries(tables.copy.map((t) => [t, rows.get(t)!.length]));
    console.log(`${tree}: ${tables.copy.map((t) => `${t} ${sent[t]}`).join(', ')}`);
    console.log(`${tree}: left out on purpose: ${tables.leftOut.join(', ')}`);
    const folders = new Map<string, number>();
    for (const m of media) folders.set(m.key.split('/')[0], (folders.get(m.key.split('/')[0]) ?? 0) + 1);
    console.log(`${tree}: ${media.length} pictures (${[...folders].map(([f, n]) => `${f}/ ${n}`).join(', ') || 'none'})`);
    if (plan) continue;

    // The target's schema comes from the same migrations.
    wrangler(['d1', 'migrations', 'apply', target!.database_name, ...where(remote, env)]);
    const out = wrangler(['d1', 'execute', target!.database_name, ...where(remote, env), '--json', '--command', 'SELECT (SELECT count(*) FROM person) AS people, (SELECT count(*) FROM meta) AS meta'], { quiet: true });
    const before = ((JSON.parse(out) as { results: { people: number; meta: number }[] }[])[0]?.results[0] ?? { people: 0, meta: 0 });
    const problem = existingFamilyProblem({ people: before.people ?? 0, meta: before.meta ?? 0 }, target!.database_name, replace);
    if (problem) throw new Error(problem);

    const sql: string[] = [...(replace ? deleteSql(tables.copy) : [])];
    for (const t of tables.copy) sql.push(...insertSql(t, columns.get(t)!, rows.get(t)!));
    const file = join(tmp, 'import.sql');
    writeFileSync(file, sql.join('\n') + '\n');
    wrangler(['d1', 'execute', target!.database_name, ...where(remote, env), '--file', file], { quiet: true });

    // Read back what the target holds, table by table, and refuse to call it done when a count differs.
    const check = wrangler(['d1', 'execute', target!.database_name, ...where(remote, env), '--json', '--command', countSql(tables.copy)], { quiet: true });
    const held = ((JSON.parse(check) as { results: Record<string, number>[] }[])[0]?.results[0] ?? {}) as Record<string, number>;
    const bad = countMismatches(sent, held);
    if (bad.length) {
      throw new Error(`${tree}: the target does not hold what was sent (${bad.join('; ')}). No pictures were uploaded. Fix the cause, then run again with --replace.`);
    }
    console.log(`${tree}: all ${tables.copy.length} tables hold the rows sent`);

    if (media.length && !bucket) throw new Error('wrangler.jsonc has no MEDIA bucket for the pictures');
    for (const m of media) {
      const type = MIME[m.key.split('.').pop()!] ?? 'application/octet-stream';
      wrangler(['r2', 'object', 'put', `${bucket}/${tree}/${m.key}`, '--file', m.file, '--content-type', type, ...where(remote, env)], { quiet: true });
    }
    if (media.length) console.log(`${tree}: ${media.length} pictures → R2 ${bucket}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
