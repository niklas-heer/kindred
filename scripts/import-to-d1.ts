// Loads a family from its local SQLite file into its D1 database, and its pictures into R2.
//   node scripts/import-to-d1.ts modern realm --env local --replace   the local D1 that `mise run dev:cf` uses
//   node scripts/import-to-d1.ts smith --remote                     the deployed one (only when you mean it)
// The family's file is data/<id>.db (for the Kindred archive in ../family-archive, `mise run data` builds
// data/smith.db). Its D1 database is the TREE_<ID> binding in wrangler.jsonc. The source file is not
// changed: a copy is brought up to date with migrations/ and its pictures moved out, then uploaded.
// Accounts are not copied: passkeys belong to a host name, so the first person to open the deployed
// site sets it up (see /setup) and invites the others.
//
// Options: --env <name> (a wrangler environment), --remote (default: local), --replace (empty a D1
// database that already holds a family first; its old pictures stay in R2), --from <file.db>.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { movePhotosOut, openSqlite } from '../src/lib/store/node.ts';
import { treeBinding, where, wrangler, wranglerBindings } from './lib/wrangler.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const remote = flag('--remote');
const replace = flag('--replace');
const env = option('--env');
const from = option('--from');
const trees = args.filter((a, i) => !a.startsWith('--') && !['--env', '--from'].includes(args[i - 1]));
if (!trees.length) {
  console.error('usage: node scripts/import-to-d1.ts <tree>... [--env <name>] [--remote] [--replace] [--from <file.db>]');
  process.exit(2);
}
if (from && trees.length > 1) throw new Error('--from takes one tree');

/** Tables in the order their foreign keys need. `op` (retry keys) is not copied. */
const TABLES = ['meta', 'house', 'person', 'parent', 'partnership', 'story', 'contact', 'place', 'photo'];

const literal = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const bindings = wranglerBindings(env);
const bucket = bindings.r2.find((b) => b.binding === 'MEDIA')?.bucket_name;

for (const tree of trees) {
  const binding = treeBinding(tree);
  const target = bindings.d1.find((b) => b.binding === binding);
  if (!target) throw new Error(`wrangler.jsonc${env ? ` (env ${env})` : ''} has no D1 binding ${binding} for the tree ${tree}`);
  const source = resolve(from ?? `data/${tree}.db`);
  console.log(`\n${tree}: ${source} → D1 ${target.database_name} (${remote ? 'remote' : 'local'})`);

  // A private copy, brought up to date and with its pictures moved out to a temporary folder.
  const tmp = mkdtempSync(join(tmpdir(), `kindred-d1-${tree}-`));
  try {
    const copy = join(tmp, `${tree}.db`);
    const src = new DatabaseSync(source, { readOnly: true });
    src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    src.close();
    const d = openSqlite(copy, 'tree');
    const id = (d.prepare("SELECT value FROM meta WHERE key = 'id'").get() as { value: string } | undefined)?.value;
    if (id !== tree) throw new Error(`${source} holds the tree "${id}", not "${tree}"`);
    const pictures: { key: string; file: string }[] = [];
    movePhotosOut(d, tree, (key, bytes) => {
      const file = join(tmp, 'media', key);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, bytes);
      pictures.push({ key, file });
    });
    // Pictures already in data/media/<tree>/ (uploaded since media storage) go up too.
    for (const { key } of d.prepare('SELECT key FROM photo WHERE key IS NOT NULL').all() as { key: string }[]) {
      if (!pictures.some((p) => p.key === key)) pictures.push({ key, file: resolve('data/media', tree, key) });
    }

    // The target's schema comes from the same migrations.
    wrangler(['d1', 'migrations', 'apply', target.database_name, ...where(remote, env)]);
    const out = wrangler(['d1', 'execute', target.database_name, ...where(remote, env), '--json', '--command', 'SELECT count(*) AS n FROM person'], { quiet: true });
    const had = (JSON.parse(out) as { results: { n: number }[] }[])[0]?.results[0]?.n ?? 0;
    if (had && !replace) throw new Error(`${target.database_name} already holds ${had} people; pass --replace to overwrite it`);

    const sql: string[] = [];
    if (replace) for (const t of ['op', ...TABLES].reverse()) sql.push(`DELETE FROM ${t};`);
    let rows = 0;
    for (const t of TABLES) {
      const cols = (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).filter((c) => !(t === 'photo' && c === 'data'));
      for (const r of d.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all() as Record<string, unknown>[]) {
        sql.push(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => literal(r[c])).join(', ')});`);
        rows++;
      }
    }
    d.close();
    const file = join(tmp, 'import.sql');
    writeFileSync(file, sql.join('\n') + '\n');
    wrangler(['d1', 'execute', target.database_name, ...where(remote, env), '--file', file], { quiet: true });
    console.log(`${tree}: ${rows} rows`);

    if (pictures.length && !bucket) throw new Error('wrangler.jsonc has no MEDIA bucket for the pictures');
    const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
    for (const p of pictures) {
      const type = MIME[p.key.split('.').pop()!] ?? 'application/octet-stream';
      wrangler(['r2', 'object', 'put', `${bucket}/${tree}/${p.key}`, '--file', p.file, '--content-type', type, ...where(remote, env)], { quiet: true });
    }
    if (pictures.length) console.log(`${tree}: ${pictures.length} pictures → R2 ${bucket}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
