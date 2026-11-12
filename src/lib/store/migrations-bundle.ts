// The migration files a Durable Object applies to itself (./durable.ts), bundled into the Worker at build time: the
// module `virtual:kindred/migrations` exports `{ tree, accounts }`, each the files of migrations/<kind>/ in order as
// `{ name, sql }`. vite.config.ts serves it to the build, and the tests that bundle a Worker with esbuild serve it too
// (`esbuildMigrations`). Build-time only: it reads folders, so it never reaches a Worker or the browser.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'esbuild';

export const MIGRATIONS_MODULE = 'virtual:kindred/migrations';

/** The files of one kind, in order, with the same pattern the Node driver applies (node.ts, migrationFiles). */
export function migrationSet(dir: string): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/** The module's source for a migrations folder (`migrations/` by default). `dirs` replaces a kind's folder (the upgrade test). */
export function migrationsModule(root: string, dirs: Partial<Record<'tree' | 'accounts', string>> = {}): string {
  const set = (kind: 'tree' | 'accounts') => migrationSet(dirs[kind] ?? join(root, kind));
  return `export default ${JSON.stringify({ tree: set('tree'), accounts: set('accounts') })};\n`;
}

/** The files the module was made from, so a dev server reloads when one is added. */
export const migrationFilesOf = (root: string) => (['tree', 'accounts'] as const).flatMap((k) => migrationSet(join(root, k)).map((m) => join(root, k, m.name)));

/** An esbuild plugin that serves the module (src/lib/store/contract.test.ts, durable.test.ts). */
export function esbuildMigrations(root: string, dirs: Partial<Record<'tree' | 'accounts', string>> = {}): Plugin {
  return {
    name: 'kindred-migrations',
    setup(build) {
      build.onResolve({ filter: /^virtual:kindred\/migrations$/ }, (a) => ({ path: a.path, namespace: 'kindred-migrations' }));
      build.onLoad({ filter: /.*/, namespace: 'kindred-migrations' }, () => ({ contents: migrationsModule(root, dirs), loader: 'js' }));
    },
  };
}
