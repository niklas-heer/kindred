// Saves a steward's backup of one family from a running Kindred (GET /api/backup/<tree>; docs/deploy-cloudflare.md,
// "Backups"), signed in as that steward: KINDRED_SESSION is the value of their `kindred_session` cookie on the site.
//
//   KINDRED_SESSION=... node scripts/backup-do.ts family --url https://family.example [--out backups/family.json]
//
// The file holds the family's records as data, as a move to another install copies them (no accounts, so no personal items,
// history or games' scores). Restore it as a new family with scripts/import-to-do.ts --from-backup. The pictures are not in
// it: copy the MEDIA bucket's <tree>/ objects as the guide describes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const [tree] = args.filter((a, i) => !a.startsWith('--') && !['--url', '--out'].includes(args[i - 1]!));
const url = option('--url')?.replace(/\/+$/, '');
const session = process.env.KINDRED_SESSION?.trim();
if (!tree || !/^[a-z0-9-]{1,64}$/.test(tree) || !url || !session) {
  console.error('usage: KINDRED_SESSION=<cookie value> node scripts/backup-do.ts <tree> --url <origin> [--out <file.json>]');
  process.exit(2);
}
const res = await fetch(`${url}/api/backup/${tree}`, { headers: { Cookie: `kindred_session=${session}`, 'Sec-Fetch-Site': 'same-origin' } });
const body = await res.text();
if (!res.ok) throw new Error(`${url} refused (${res.status}): ${body.slice(0, 200)}`);
const backup = JSON.parse(body) as { tree: string; schema: string; tables: { table: string; rows: unknown[] }[] };
if (backup.tree !== tree) throw new Error(`the answer is not a backup of ${tree}`);
const out = resolve(option('--out') ?? `backups/${tree}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body);
console.log(`${tree}: ${backup.tables.reduce((n, t) => n + t.rows.length, 0)} rows in ${backup.tables.length} tables under ${backup.schema} → ${out}`);
