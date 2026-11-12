// The automatic backups on Node (./db.ts BackupStore, src/lib/backup/): `VACUUM INTO` a temporary file (a consistent copy,
// made while the family keeps being used), gzipped and encrypted (src/lib/backup/kbak.ts) to
// <KINDRED_BACKUP_DIR or data/backups>/<scope>/<name>.kbak, with its manifest beside it as <name>.json (readable without the
// key; the same manifest is in the file's authenticated header). The temporary copy is unencrypted, so it is made in the data
// folder, which holds the databases in the clear anyway (data/.backup-tmp/, mode 700, the file 600), never under
// KINDRED_BACKUP_DIR, which may be a disk or a share the data is not on; it is removed when done, and what a crash left is
// removed when the server starts. A drill opens the backup as an in-memory SQLite database and runs PRAGMA integrity_check;
// nothing from it is ever served. A restore runs the same checks first, then writes the database file into place after closing
// the family's connection (into a new id: only where no file is), and the next request opens and migrates it as usual.
import { chmodSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ACCOUNTS_SCOPE, backupSecret, checkBackup, deriveBackupKey, nameTime, open, seal, type BackupKey } from '../backup/kbak.ts';
import { compare, schemaOf, tableCounts, type Exec } from '../backup/dump.ts';
import type { BackupStore, Db, DrillResult } from './db.ts';

export interface NodeBackupDeps {
  dataDir: () => string;
  treePath: (id: string) => string;
  /** The family's (or, for `_accounts`, the accounts') database. */
  db: (scope: string) => Db;
  /** Closes a family's open connection, so its file can be replaced. */
  closeTree: (id: string) => void;
  secret: () => string;
}

const execOf = (d: DatabaseSync): Exec => (sql, ...params) => d.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];

/** Where a backup's unencrypted copy is made while it is sealed. */
const tempDir = (dataDir: string) => join(dataDir, '.backup-tmp');

/**
 * Removes what a backup or a restore that stopped part-way left: the unencrypted copies in data/.backup-tmp/, copies an older
 * version made beside the backups (`<backups>/<scope>/.<name>-<uuid>.db`), half-written files (`*.tmp-<uuid>`) and restores
 * that never reached their place (`data/<id>.db.restore-<uuid>`). Run when the server starts, before any backup can be running.
 */
export function clearBackupTemps(dataDir: string, backupDir = process.env.KINDRED_BACKUP_DIR?.trim() ? resolve(process.env.KINDRED_BACKUP_DIR.trim()) : join(dataDir, 'backups')): void {
  rmSync(tempDir(dataDir), { recursive: true, force: true });
  if (existsSync(dataDir)) {
    for (const f of readdirSync(dataDir)) if (/\.db\.restore-[0-9a-f-]+$/.test(f)) rmSync(join(dataDir, f), { force: true });
  }
  if (!existsSync(backupDir)) return;
  for (const scope of readdirSync(backupDir, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    for (const f of readdirSync(join(backupDir, scope.name))) {
      if (/^\..*\.db(-journal|-wal|-shm)?$/.test(f) || /\.tmp-[0-9a-f-]+$/.test(f)) rmSync(join(backupDir, scope.name, f), { force: true });
    }
  }
}

/** A backup's database checked as a drill checks it: PRAGMA integrity_check, then its rows and schema against the manifest. */
function checkPlain(manifest: { counts: Record<string, number>; schema: string | null }, plain: Uint8Array): string | null {
  const scratch = new DatabaseSync(':memory:');
  try {
    scratch.deserialize(plain);
    const exec = execOf(scratch);
    const integrity = exec('PRAGMA integrity_check').map((r) => String(Object.values(r)[0]));
    if (integrity.join() !== 'ok') return `integrity_check: ${integrity.slice(0, 3).join('; ')}`;
    return compare(manifest.counts, manifest.schema, tableCounts(exec), schemaOf(exec));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    scratch.close();
  }
}

export function nodeBackups(deps: NodeBackupDeps): BackupStore {
  try {
    clearBackupTemps(deps.dataDir());
  } catch {
    // No data folder yet (or a test that has not set one): nothing can have been left in it.
  }
  const dir = (scope: string) => join(process.env.KINDRED_BACKUP_DIR?.trim() ? resolve(process.env.KINDRED_BACKUP_DIR.trim()) : join(deps.dataDir(), 'backups'), scope);
  const file = (scope: string, name: string) => {
    checkBackup(scope, name);
    return join(dir(scope), `${name}.kbak`);
  };
  let cached: { secret: string; key: Promise<BackupKey> } | undefined;
  const key = () => {
    const { secret } = backupSecret((n) => process.env[n], deps.secret);
    if (cached?.secret !== secret) cached = { secret, key: deriveBackupKey(secret) };
    return cached.key;
  };
  /** Writes a file whole or not at all. */
  const put = (path: string, bytes: Uint8Array | string) => {
    const tmp = `${path}.tmp-${crypto.randomUUID()}`;
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, path);
  };
  const opened = async (scope: string, name: string) => {
    const path = file(scope, name);
    if (!existsSync(path)) throw new Error('The backup file is gone.');
    return open(new Uint8Array(readFileSync(path)), await key(), scope, name);
  };

  return {
    where: 'files',
    covers: () => 'backup',

    async take(scope, name) {
      const path = file(scope, name);
      mkdirSync(dir(scope), { recursive: true, mode: 0o700 });
      const temp = tempDir(deps.dataDir());
      mkdirSync(temp, { recursive: true, mode: 0o700 });
      chmodSync(temp, 0o700);
      const tmp = join(temp, `${crypto.randomUUID()}.db`);
      try {
        // An empty file of mode 600 first: VACUUM INTO writes into it and keeps its mode.
        writeFileSync(tmp, '', { mode: 0o600, flag: 'wx' });
        await deps.db(scope).run('VACUUM INTO ?', tmp);
        const copy = new DatabaseSync(tmp, { readOnly: true });
        let counts: Record<string, number>, schema: string | null;
        try {
          counts = tableCounts(execOf(copy));
          schema = schemaOf(execOf(copy));
        } finally {
          copy.close();
        }
        const created = new Date(nameTime(name)).toISOString();
        const { bytes, manifest } = await seal({ scope, name, created, format: 'sqlite', schema, counts }, new Uint8Array(readFileSync(tmp)), await key());
        put(path, bytes);
        put(path.replace(/\.kbak$/, '.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        return { manifest, bytes: bytes.length };
      } finally {
        for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(tmp + suffix, { force: true });
      }
    },

    async read(scope, name) {
      const path = file(scope, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },

    async write(scope, name, bytes) {
      mkdirSync(dir(scope), { recursive: true, mode: 0o700 });
      put(file(scope, name), bytes);
    },

    async remove(scope, name) {
      const path = file(scope, name);
      rmSync(path, { force: true });
      rmSync(path.replace(/\.kbak$/, '.json'), { force: true });
    },

    async drill(scope, name): Promise<DrillResult> {
      const check = 'integrity_check' as const;
      let manifest, plain;
      try {
        ({ manifest, plain } = await opened(scope, name));
      } catch (e) {
        return { ok: false, problem: e instanceof Error ? e.message : String(e), check };
      }
      const problem = checkPlain(manifest, plain);
      return { ok: problem === null, problem, check };
    },

    async restore(scope, name, into, opts) {
      if (scope === ACCOUNTS_SCOPE || into === ACCOUNTS_SCOPE) throw new Error('The accounts database is restored by hand (docs/self-host.md, "Backups").');
      const { manifest, plain } = await opened(scope, name);
      if (!('meta' in manifest.counts)) throw new Error('The backup holds no family.');
      const problem = checkPlain(manifest, plain);
      if (problem) throw new Error(`The backup does not pass its checks, so nothing was replaced: ${problem}`);
      const path = deps.treePath(into);
      const tmp = `${path}.restore-${crypto.randomUUID()}`;
      writeFileSync(tmp, plain, { mode: 0o600 });
      try {
        if (opts?.over) {
          deps.closeTree(into);
          for (const suffix of ['-wal', '-shm']) rmSync(path + suffix, { force: true });
          renameSync(tmp, path);
        } else {
          // Into a new id: a link fails when the file exists, so a family made there meanwhile is never written over.
          try {
            linkSync(tmp, path);
          } catch (e) {
            if ((e as { code?: string }).code === 'EEXIST') throw new Error(`${into} already holds a family; only a restore over it replaces it`);
            throw e;
          }
        }
      } finally {
        rmSync(tmp, { force: true });
      }
      return null;
    },
  };
}
