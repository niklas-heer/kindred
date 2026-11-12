// node --test src/lib/store/durable.test.ts — families in Durable Objects (./durable.ts) on the real Cloudflare driver in
// local workerd: made on demand, migrated once and in order, upgraded by a new migration file, dropped, listed beside a bound
// D1 family, refused in a demo, and kept in their jurisdiction. Each phase restarts the Worker on the same local state, as a
// deploy does. Nothing contacts Cloudflare (Miniflare only, in a scratch folder).
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { workerRuntime } from '../../../scripts/lib/wrangler.ts';
import { esbuildMigrations } from './migrations-bundle.ts';

const work = mkdtempSync(join(tmpdir(), 'kindred-durable-'));
after(() => rmSync(work, { recursive: true, force: true }));

const MIGRATIONS = join(process.cwd(), 'migrations');
const treeFiles = readdirSync(join(MIGRATIONS, 'tree')).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();

/** The test Worker, bundled with the tree migrations from `treeDir`. */
async function bundle(treeDir?: string) {
  const out = await build({
    entryPoints: ['src/lib/store/durable.worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'esnext',
    conditions: ['workerd', 'worker'],
    mainFields: ['module', 'main'],
    external: ['cloudflare:*', 'node:*'],
    plugins: [esbuildMigrations(MIGRATIONS, treeDir ? { tree: treeDir } : {})],
  });
  return out.outputFiles[0].text;
}

/** Runs one case in a fresh Worker on the shared local state, then stops it. */
async function phase(name: string, files: string[], opts: { code?: string; vars?: Record<string, string> } = {}) {
  const worker = new Miniflare(convertV4MiniflareOptions({
    ...workerRuntime(),
    modules: [{ type: 'ESModule', path: 'worker.mjs', contents: opts.code ?? (await bundle()) }],
    durableObjects: { FAMILIES: { className: 'FamilyStore', useSQLite: true } },
    // An empty D1 database bound as a family from before Durable Objects; the accounts live in a Durable Object.
    d1Databases: { TREE_OLD: 'durable-test-old' },
    r2Buckets: { MEDIA: 'durable-test-media' },
    bindings: opts.vars ?? {},
    resourcePersistencePath: join(work, 'state'),
    cf: false,
  }));
  try {
    const res = await worker.dispatchFetch(`http://durable.test/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(files) });
    assert.equal(res.status, 200, await res.text());
  } finally {
    await worker.dispose();
  }
}

test('a family is made on demand, migrated once and in order, and recorded', { timeout: 60_000 }, () => phase('a family is made on demand and listed', treeFiles));

test('bound D1 families and Durable Object families are listed together', { timeout: 60_000 }, () => phase('bound D1 families and Durable Object families are listed together', treeFiles));

test('a batch is atomic in a Durable Object, and a blob round-trips', { timeout: 60_000 }, () => phase('a failing batch writes nothing, and a blob comes back as the same bytes', treeFiles));

test('after an upgrade only the new migration file is applied, before anything is answered', { timeout: 60_000 }, async () => {
  const tree = join(work, 'tree-upgraded');
  cpSync(join(MIGRATIONS, 'tree'), tree, { recursive: true });
  const added = '9999_upgrade_probe.sql';
  // Two statements and a comment, as migration files have.
  writeFileSync(join(tree, added), '-- a migration a later release adds\nCREATE TABLE upgrade_probe (id TEXT PRIMARY KEY);\nINSERT INTO upgrade_probe (id) VALUES (\'one\');\n');
  await phase('an upgrade applies only the new migration', [...treeFiles, added], { code: await bundle(tree) });
});

test('a dropped family is gone, unlisted, and can be made again empty', { timeout: 60_000 }, () => phase('a dropped family is gone and can be made again empty', treeFiles));

test('an import is staged, bound to its account, values only, and published only when complete', { timeout: 60_000 }, () => phase('a family is imported step by step, staged until it is complete', treeFiles));

test('a demo refuses to make, change or drop a Durable Object family', { timeout: 60_000 }, () => phase('a demo refuses to make, change or drop a family', treeFiles, { vars: { KINDRED_DEMO: '1' } }));

test('changing KINDRED_JURISDICTION after the first family is refused', { timeout: 60_000 }, () => phase('a changed jurisdiction is refused', treeFiles, { vars: { KINDRED_JURISDICTION: 'eu' } }));
