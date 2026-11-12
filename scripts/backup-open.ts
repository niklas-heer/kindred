// Opens an automatic backup (a `.kbak` file, docs/hosting-many-families.md "Backups") on this machine: decrypts it, checks it
// against its manifest, and writes the database as a SQLite file you can open with sqlite3 or put back by hand (the accounts
// database, or a family on Node). A Durable Object's backup (its rows as data) is loaded into a new SQLite file too.
//
//   KINDRED_BACKUP_KEY=... node scripts/backup-open.ts <file.kbak> [--out <file.db>]
//   KINDRED_SECRET=...     node scripts/backup-open.ts <file.kbak>     (when the server has no KINDRED_BACKUP_KEY)
//   node scripts/backup-open.ts <file.kbak> --secret-file data/secret  (Node's secret file)
//
// It never contacts anything. Without the right key the file does not open: that is the point of the key.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { compare, decodeDump, loadDump, schemaOf, tableCounts, type Exec } from '../src/lib/backup/dump.ts';
import { backupSecret, deriveBackupKey, open, readManifest, type Manifest } from '../src/lib/backup/kbak.ts';

/** Decrypts and checks a backup, writes it to `out` as a SQLite file, and returns its manifest and what the check found. */
export async function openToSqlite(bytes: Uint8Array, secret: string, out: string): Promise<{ manifest: Manifest; problem: string | null }> {
  const { manifest: header } = readManifest(bytes);
  const { manifest, plain } = await open(bytes, await deriveBackupKey(secret), header.scope, header.name);
  if (existsSync(out)) throw new Error(`${out} exists already: name another file with --out`);
  // Node's backup is the database file itself; a Durable Object's is its schema and rows, loaded into a new file.
  if (manifest.format === 'sqlite') writeFileSync(out, plain, { mode: 0o600 });
  const d = new DatabaseSync(out);
  try {
    const exec: Exec = (sql, ...params) => d.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
    if (manifest.format === 'dump') {
      d.exec('BEGIN');
      loadDump(exec, decodeDump(plain));
      d.exec('COMMIT');
    }
    const integrity = exec('PRAGMA integrity_check').map((r) => String(Object.values(r)[0]));
    const problem = integrity.join() !== 'ok' ? `integrity_check: ${integrity.slice(0, 3).join('; ')}` : compare(manifest.counts, manifest.schema, tableCounts(exec), schemaOf(exec));
    return { manifest, problem };
  } finally {
    d.close();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const [file] = args.filter((a, i) => !a.startsWith('--') && !['--out', '--secret-file'].includes(args[i - 1]!));
  if (!file) {
    console.error('usage: KINDRED_BACKUP_KEY=... node scripts/backup-open.ts <file.kbak> [--out <file.db>] [--secret-file <path>]');
    process.exit(2);
  }
  const secretFile = option('--secret-file');
  const { secret } = backupSecret((n) => process.env[n], secretFile ? () => readFileSync(secretFile, 'utf8').trim() : undefined);
  const out = resolve(option('--out') ?? basename(file).replace(/\.kbak$/, '') + '.db');
  const { manifest, problem } = await openToSqlite(new Uint8Array(readFileSync(file)), secret, out);
  const rows = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
  console.log(`${manifest.scope} ${manifest.name}: ${rows} rows in ${Object.keys(manifest.counts).length} tables, schema ${manifest.schema ?? 'none'} → ${out}`);
  if (problem) {
    console.error(`It does not match its manifest: ${problem}`);
    process.exit(1);
  }
}
