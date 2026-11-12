// Imports a family into its Durable Object on a running Kindred Worker (docs/deploy-cloudflare.md, "Moving a family into a
// Durable Object"). A Durable Object is reached only through its Worker, so this reads the family here and sends its rows,
// as data (table, columns, values; never SQL), to POST /api/move/<tree> (src/lib/store/move.server.ts) as the person
// running it: KINDRED_SESSION is the value of their `kindred_session` cookie on that site.
//
//   KINDRED_SESSION=... node scripts/import-to-do.ts family --url https://family.example --from-d1 kindred-family --remote
//       A family of this install from its D1 database (wrangler d1 export), copied by one of its stewards: every table and
//       row, since its members, accounts and pictures stay where they are. Then remove the TREE_<ID> binding from
//       wrangler.jsonc and deploy again.
//   KINDRED_SESSION=... node scripts/import-to-do.ts family --url https://family.example --from data/family.db --remote
//       A family from a Node install, as a new family here: the tables and rows the D1 transfer copies (src/lib/store/
//       transfer.ts; accounts are not copied, so personal items, the history and the games' scores stay behind), and its
//       pictures go to the MEDIA bucket with wrangler. The person running it must be allowed to make families, and becomes
//       the family's steward.
//   KINDRED_SESSION=... node scripts/import-to-do.ts family --url https://family.example --from-backup family.json [--media <folder>]
//       A steward's backup (GET /api/backup/<tree>, scripts/backup-do.ts) restored as a new family, with the pictures from
//       <folder> (default: media/<tree>/ beside the file), as from a Node install.
//   --plan prints what would be sent and sends nothing; --replace empties a Durable Object that already holds a copy;
//   --accept-terms accepts the server's terms, which a server that has them asks of whoever makes a new family;
//   --env <name> picks a wrangler environment; --remote (the deployed D1 and R2) or local (default, the `local` state of
//   `mise run dev:cf`).
// The Worker writes the rows into a staged object that serves nothing, and publishes the family only when every table holds
// the number of rows announced at the start, under the same schema.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { movePhotosOut, openSqlite } from '../src/lib/store/node.ts';
import { COPY_ONLY, fromCell, importStatement, planTables, type FamilyBackup, type TableRows } from '../src/lib/store/transfer.ts';
import { listFiles, planMedia, type MediaFile } from './lib/d1-transfer.ts';
import { NEVER_SENT, schemaOf, tableOrder, tableRows } from './lib/do-transfer.ts';
import { where, wrangler, wranglerBindings } from './lib/wrangler.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const withValue = ['--url', '--from', '--from-d1', '--from-backup', '--media', '--env'];
const [tree] = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]!));
const url = option('--url')?.replace(/\/+$/, '');
const from = option('--from');
const fromD1 = option('--from-d1');
const fromBackup = option('--from-backup');
const env = option('--env');
const remote = flag('--remote');
const plan = flag('--plan');
const replace = flag('--replace');
const acceptTerms = flag('--accept-terms');
const session = process.env.KINDRED_SESSION?.trim();

if (!tree || !/^[a-z0-9-]{1,64}$/.test(tree) || [from, fromD1, fromBackup].filter(Boolean).length !== 1 || (!plan && !url)) {
  console.error('usage: KINDRED_SESSION=<cookie value> node scripts/import-to-do.ts <tree> --url <origin> (--from <file.db> | --from-d1 <database name> | --from-backup <file.json> [--media <folder>]) [--env <name>] [--remote] [--replace] [--accept-terms] [--plan]');
  process.exit(2);
}
if (!plan && !session) throw new Error('Set KINDRED_SESSION to the value of your kindred_session cookie on that site (docs/deploy-cloudflare.md).');

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', pdf: 'application/pdf' };

/** One step of the move, sent to the Worker as the person running this. */
async function send(body: object): Promise<Record<string, unknown>> {
  const res = await fetch(`${url}/api/move/${tree}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `kindred_session=${session}`, Origin: url!, 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${url} answered ${res.status} without JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${url} refused (${res.status}): ${String(data.error ?? text)}`);
  return data;
}

const keysOf = (d: DatabaseSync, tables: string[]) =>
  tables.flatMap((t) => (d.prepare(`PRAGMA foreign_key_list("${t}")`).all() as { table: string }[]).map((r) => ({ table: t, parent: r.table })));
const columnsOf = (d: DatabaseSync, t: string) => (d.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);

/** --plan stops here, after printing what would be sent. */
class PlanOnly extends Error {}

/** Loads a steward's backup into the migrated scratch file `d`, refusing one of another family or another schema. */
function loadBackup(d: DatabaseSync, file: string) {
  const backup = JSON.parse(readFileSync(resolve(file), 'utf8')) as FamilyBackup;
  if (backup.kindred !== 'family-backup' || backup.version !== 1 || !Array.isArray(backup.tables)) throw new Error(`${file} is not a Kindred family backup`);
  if (backup.tree !== tree) throw new Error(`the backup holds the family "${backup.tree}", not "${tree}"`);
  if (backup.schema !== schemaOf(d)) throw new Error(`the backup was made under the schema ${backup.schema}, and this checkout has ${schemaOf(d)}: restore it with the Kindred release that made it`);
  const present = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  const schema = new Map(present.filter((t) => !NEVER_SENT.test(t)).map((t) => [t, columnsOf(d, t)]));
  d.exec('BEGIN');
  for (const t of backup.tables) {
    const statement = d.prepare(importStatement(schema, t.table, t.columns));
    for (const r of t.rows) statement.run(...r.map(fromCell));
  }
  d.exec('COMMIT');
}

const tmp = mkdtempSync(join(tmpdir(), `kindred-do-${tree}-`));
try {
  const copy = join(tmp, `${tree}.db`);
  if (fromD1) {
    // The rows as SQL (wrangler writes the schema in an order SQLite cannot load), into a scratch file migrated from
    // migrations/tree. A row the migrations seeded, and the migration record itself, are replaced by the source's.
    // `d1 export` has no --persist-to: a local export reads the default local state (.wrangler/state). This SQL is run
    // here, on this machine, into the scratch file; what goes to the Worker are the rows read back from it.
    const dump = join(tmp, 'dump.sql');
    wrangler(['d1', 'export', fromD1, remote ? '--remote' : '--local', ...(env ? ['--env', env] : []), '--no-schema', '--output', dump], { quiet: true });
    const d = openSqlite(copy, 'tree', { create: true });
    d.exec('BEGIN');
    d.exec('PRAGMA defer_foreign_keys = ON');
    d.exec(readFileSync(dump, 'utf8').replace(/^INSERT INTO "/gm, 'INSERT OR REPLACE INTO "'));
    d.exec('COMMIT');
    d.close();
  } else if (fromBackup) {
    const d = openSqlite(copy, 'tree', { create: true });
    loadBackup(d, fromBackup);
    d.close();
  } else {
    const src = new DatabaseSync(resolve(from!), { readOnly: true });
    src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    src.close();
  }
  const d = openSqlite(copy, 'tree');
  const id = (d.prepare("SELECT value FROM meta WHERE key = 'id'").get() as { value: string } | undefined)?.value;
  if (id !== tree) throw new Error(`the source holds the family "${id}", not "${tree}"`);
  const schema = schemaOf(d);

  const present = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name).filter((t) => !NEVER_SENT.test(t));
  const batches: TableRows[] = [];
  const sent: Record<string, number> = {};
  const add = (t: string, cols: string[], cond?: string) => {
    const got = tableRows(d, t, cols, cond);
    batches.push(...got.batches);
    sent[t] = got.count;
  };
  let media: MediaFile[] = [];
  if (fromD1) {
    // The same install: its members, accounts and pictures stay, so every table and row goes, the seeded ones replaced.
    for (const t of tableOrder(present, keysOf(d, present))) add(t, columnsOf(d, t));
  } else {
    // Another install, or a backup: what the D1 transfer copies, and the pictures beside the file.
    const moved: MediaFile[] = [];
    movePhotosOut(d, tree, (key, bytes) => {
      const file = join(tmp, 'moved', key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      moved.push({ key, file });
    });
    for (const t of planTables(present).copy) add(t, columnsOf(d, t).filter((c) => !(t === 'photo' && c === 'data')), COPY_ONLY[t]);
    const keys = (t: string, col: string) => (present.includes(t) ? (d.prepare(`SELECT "${col}" AS k FROM "${t}" WHERE "${col}" IS NOT NULL`).all() as { k: string }[]).map((r) => r.k) : []);
    const named = [...keys('photo', 'key'), ...keys('media', 'key'), ...keys('media', 'thumb'), ...keys('portrait', 'key'), ...keys('research_document', 'key'), ...keys('recipe_image', 'key'), ...keys('recipe_image', 'thumb')];
    const folder = fromBackup ? (option('--media') ?? join(dirname(resolve(fromBackup)), 'media', tree)) : join(dirname(resolve(from!)), 'media', tree);
    media = planMedia(named, [...moved, ...listFiles(folder)]);
  }
  d.close();

  const rows = Object.values(sent).reduce((a, b) => a + b, 0);
  console.log(`${tree}: ${Object.entries(sent).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  console.log(`${tree}: ${rows} rows in ${batches.length} requests under ${schema}${media.length ? `, ${media.length} pictures` : ''} → ${url ?? '(plan only)'}`);
  if (plan) throw new PlanOnly();

  const begun = await send({ step: 'begin', replace, acceptTerms, schema, tables: sent });
  const importId = String(begun.import);
  for (const [i, b] of batches.entries()) {
    await send({ step: 'rows', import: importId, ...b });
    process.stdout.write(`\r${tree}: sent ${i + 1}/${batches.length}`);
  }
  process.stdout.write('\n');
  await send({ step: 'finish', import: importId });
  console.log(`${tree}: all ${Object.keys(sent).length} tables hold the rows sent; the import is published`);

  if (media.length) {
    const bucket = wranglerBindings(env).r2.find((b) => b.binding === 'MEDIA')?.bucket_name;
    if (!bucket) throw new Error('wrangler.jsonc has no MEDIA bucket for the pictures');
    for (const m of media) wrangler(['r2', 'object', 'put', `${bucket}/${tree}/${m.key}`, '--file', m.file, '--content-type', MIME[m.key.split('.').pop()!] ?? 'application/octet-stream', ...where(remote, env)], { quiet: true });
    console.log(`${tree}: ${media.length} pictures → R2 ${bucket}`);
  }
  console.log(begun.serving
    ? `${tree}: the Durable Object serves the family now${begun.mode === 'new' ? ', and you are its steward' : ''}.`
    : `${tree}: copied. The D1 binding ${`TREE_${tree.toUpperCase().replace(/-/g, '_')}`} still serves it: remove it from wrangler.jsonc and deploy again to switch.`);
} catch (e) {
  if (!(e instanceof PlanOnly)) throw e;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
