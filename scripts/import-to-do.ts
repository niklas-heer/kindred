// Moves a family into its Durable Object on a running Kindred Worker (docs/deploy-cloudflare.md, "Moving a family into a
// Durable Object"). A Durable Object is reached only through its Worker, so this reads the family here and sends its rows to
// POST /api/move/<tree> (src/lib/store/move.server.ts) as the person running it: KINDRED_SESSION is the value of their
// `kindred_session` cookie on that site (a steward of the family, or for a new family someone who may make families).
//
//   KINDRED_SESSION=... node scripts/import-to-do.ts family --url https://family.example --from-d1 kindred-family --remote
//       A family of this install from its D1 database (wrangler d1 export): every table and row, since its members, accounts
//       and pictures stay where they are. Then remove the TREE_<ID> binding from wrangler.jsonc and deploy again.
//   KINDRED_SESSION=... node scripts/import-to-do.ts family --url https://family.example --from data/family.db --remote
//       A family from a Node install: the tables and rows the D1 transfer copies (scripts/lib/d1-transfer.ts; accounts are
//       not copied, so personal items, the history and the games' scores stay behind), and its pictures go to the MEDIA
//       bucket with wrangler. The person running it becomes the family's steward.
//   --plan prints what would be sent and sends nothing; --replace empties a Durable Object that already holds the family
//   (refused once that object serves a family with members); --env <name> picks a wrangler environment; --remote (the
//   deployed D1 and R2) or local (default, the `local` state of `mise run dev:cf`).
// The copy is checked: every table's count is read back from the Durable Object and compared with what was sent.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { movePhotosOut, openSqlite } from '../src/lib/store/node.ts';
import { COPY_ONLY, countMismatches, insertSql, listFiles, planMedia, planTables, type MediaFile } from './lib/d1-transfer.ts';
import { chunks, NEVER_SENT, tableOrder, upsertSql } from './lib/do-transfer.ts';
import { where, wrangler, wranglerBindings } from './lib/wrangler.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const withValue = ['--url', '--from', '--from-d1', '--env'];
const [tree] = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]!));
const url = option('--url')?.replace(/\/+$/, '');
const from = option('--from');
const fromD1 = option('--from-d1');
const env = option('--env');
const remote = flag('--remote');
const plan = flag('--plan');
const replace = flag('--replace');
const session = process.env.KINDRED_SESSION?.trim();

if (!tree || !/^[a-z0-9-]{1,64}$/.test(tree) || (!from && !fromD1) || (from && fromD1) || (!plan && !url)) {
  console.error('usage: KINDRED_SESSION=<cookie value> node scripts/import-to-do.ts <tree> --url <origin> (--from <file.db> | --from-d1 <database name>) [--env <name>] [--remote] [--replace] [--plan]');
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

const tmp = mkdtempSync(join(tmpdir(), `kindred-do-${tree}-`));
try {
  const copy = join(tmp, `${tree}.db`);
  if (fromD1) {
    // The rows as SQL (wrangler writes the schema in an order SQLite cannot load), into a scratch file migrated from
    // migrations/tree. A row the migrations seeded, and the migration record itself, are replaced by the source's.
    // `d1 export` has no --persist-to: a local export reads the default local state (.wrangler/state).
    const dump = join(tmp, 'dump.sql');
    wrangler(['d1', 'export', fromD1, remote ? '--remote' : '--local', ...(env ? ['--env', env] : []), '--no-schema', '--output', dump], { quiet: true });
    const d = openSqlite(copy, 'tree', { create: true });
    d.exec('BEGIN');
    d.exec('PRAGMA defer_foreign_keys = ON');
    d.exec(readFileSync(dump, 'utf8').replace(/^INSERT INTO "/gm, 'INSERT OR REPLACE INTO "'));
    d.exec('COMMIT');
    d.close();
  } else {
    const src = new DatabaseSync(resolve(from!), { readOnly: true });
    src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    src.close();
  }
  const d = openSqlite(copy, 'tree');
  const id = (d.prepare("SELECT value FROM meta WHERE key = 'id'").get() as { value: string } | undefined)?.value;
  if (id !== tree) throw new Error(`the source holds the family "${id}", not "${tree}"`);

  const present = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name).filter((t) => !NEVER_SENT.test(t));
  const statements: string[] = [];
  const sent: Record<string, number> = {};
  let media: MediaFile[] = [];
  if (fromD1) {
    // The same install: its members, accounts and pictures stay, so every table and row goes, the seeded ones replaced.
    for (const t of tableOrder(present, keysOf(d, present))) {
      const rows = d.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
      statements.push(...upsertSql(t, columnsOf(d, t), rows));
      sent[t] = rows.length;
    }
  } else {
    // Another install: what the D1 transfer copies, and the pictures beside the file.
    const moved: MediaFile[] = [];
    movePhotosOut(d, tree, (key, bytes) => {
      const file = join(tmp, 'moved', key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      moved.push({ key, file });
    });
    const tables = planTables(present);
    for (const t of tables.copy) {
      const cols = columnsOf(d, t).filter((c) => !(t === 'photo' && c === 'data'));
      const rows = d.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t}"${COPY_ONLY[t] ? ` WHERE ${COPY_ONLY[t]}` : ''}`).all() as Record<string, unknown>[];
      statements.push(...insertSql(t, cols, rows));
      sent[t] = rows.length;
    }
    const keys = (t: string, col: string) => (present.includes(t) ? (d.prepare(`SELECT "${col}" AS k FROM "${t}" WHERE "${col}" IS NOT NULL`).all() as { k: string }[]).map((r) => r.k) : []);
    const named = [...keys('photo', 'key'), ...keys('media', 'key'), ...keys('media', 'thumb'), ...keys('portrait', 'key'), ...keys('research_document', 'key'), ...keys('recipe_image', 'key'), ...keys('recipe_image', 'thumb')];
    media = planMedia(named, [...moved, ...listFiles(join(dirname(resolve(from!)), 'media', tree))]);
  }
  d.close();

  const requests = chunks(statements);
  console.log(`${tree}: ${Object.entries(sent).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  console.log(`${tree}: ${statements.length} rows in ${requests.length} requests${media.length ? `, ${media.length} pictures` : ''} → ${url ?? '(plan only)'}`);
  if (plan) throw new PlanOnly();

  const begun = await send({ step: 'begin', replace });
  for (const [i, statements] of requests.entries()) {
    await send({ step: 'rows', statements });
    process.stdout.write(`\r${tree}: sent ${i + 1}/${requests.length}`);
  }
  process.stdout.write('\n');
  const done = await send({ step: 'finish', tables: Object.keys(sent) });
  const bad = countMismatches(sent, done.counts as Record<string, number>);
  if (bad.length) throw new Error(`${tree}: the Durable Object does not hold what was sent (${bad.join('; ')}). Run again with --replace.`);
  console.log(`${tree}: all ${Object.keys(sent).length} tables hold the rows sent`);

  if (media.length) {
    const bucket = wranglerBindings(env).r2.find((b) => b.binding === 'MEDIA')?.bucket_name;
    if (!bucket) throw new Error('wrangler.jsonc has no MEDIA bucket for the pictures');
    for (const m of media) wrangler(['r2', 'object', 'put', `${bucket}/${tree}/${m.key}`, '--file', m.file, '--content-type', MIME[m.key.split('.').pop()!] ?? 'application/octet-stream', ...where(remote, env)], { quiet: true });
    console.log(`${tree}: ${media.length} pictures → R2 ${bucket}`);
  }
  console.log(begun.serving
    ? `${tree}: the Durable Object serves the family now.`
    : `${tree}: copied. The D1 binding ${`TREE_${tree.toUpperCase().replace(/-/g, '_')}`} still serves it: remove it from wrangler.jsonc and deploy again to switch.`);
} catch (e) {
  if (!(e instanceof PlanOnly)) throw e;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
