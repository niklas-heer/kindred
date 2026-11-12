// The automatic backups on Node (./db.ts BackupStore, src/lib/backup/): `VACUUM INTO` a temporary file (a consistent copy,
// made while the family keeps being used), gzipped and encrypted (src/lib/backup/kbak.ts) to
// <KINDRED_BACKUP_DIR or data/backups>/<scope>/<name>.kbak, with its manifest beside it as <name>.json (readable without the
// key; the same manifest is in the file's authenticated header). A drill opens the backup as an in-memory SQLite database and
// runs PRAGMA integrity_check; nothing from it is ever served. A restore writes the database file into place after closing the
// family's connection, and the next request opens and migrates it as usual.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

export function nodeBackups(deps: NodeBackupDeps): BackupStore {
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
      const tmp = join(dir(scope), `.${name}-${crypto.randomUUID()}.db`);
      try {
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
        rmSync(tmp, { force: true });
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
      const scratch = new DatabaseSync(':memory:');
      try {
        scratch.deserialize(plain);
        const exec = execOf(scratch);
        const integrity = exec('PRAGMA integrity_check').map((r) => String(Object.values(r)[0]));
        if (integrity.join() !== 'ok') return { ok: false, problem: `integrity_check: ${integrity.slice(0, 3).join('; ')}`, check };
        return { ok: true, problem: compare(manifest.counts, manifest.schema, tableCounts(exec), schemaOf(exec)), check };
      } catch (e) {
        return { ok: false, problem: e instanceof Error ? e.message : String(e), check };
      } finally {
        scratch.close();
      }
    },

    async restore(scope, name, into) {
      if (scope === ACCOUNTS_SCOPE || into === ACCOUNTS_SCOPE) throw new Error('The accounts database is restored by hand (docs/self-host.md, "Backups").');
      const { plain } = await opened(scope, name);
      const path = deps.treePath(into);
      const tmp = `${path}.restore-${crypto.randomUUID()}`;
      writeFileSync(tmp, plain, { mode: 0o600 });
      deps.closeTree(into);
      for (const suffix of ['-wal', '-shm']) rmSync(path + suffix, { force: true });
      renameSync(tmp, path);
      return null;
    },
  };
}
