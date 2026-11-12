// node --test src/lib/store/contract.test.ts — the same database contract (./contract.cases.ts) on every driver:
// node:sqlite in this process, and the real Cloudflare driver and `once` inside workerd, once on local D1 and once on
// local Durable Objects (./durable.ts, the family and the accounts each in its own). The D1 databases are migrated by
// `wrangler d1 migrations apply`, the command a deploy runs; the Durable Objects migrate themselves. Nothing here contacts Cloudflare: the
// credentials are removed, proxies point at a closed port, and every file lives in a scratch folder. Miniflare and
// esbuild come with wrangler, which keeps them on the same workerd a deploy is built for.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { offlineEnv, workerRuntime, wranglerBindings } from '../../../scripts/lib/wrangler.ts';
import { esbuildMigrations } from './migrations-bundle.ts';

const work = mkdtempSync(join(tmpdir(), 'kindred-contract-'));
process.env.KINDRED_DATA_DIR = join(work, 'node');
process.env.KINDRED_ACCOUNTS_DB = join(work, 'node', 'accounts.db');

const { contractCases, schemas, TREE } = await import('./contract.cases.ts');
const { store } = await import('./index.ts');
await store.ensureTree(TREE);
store.accounts();

const WRANGLER = join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js');
const state = join(work, 'd1');
const { d1, r2 } = wranglerBindings('local');
const accounts = d1.find((x) => x.binding === 'ACCOUNTS')!;
const family = d1.find((x) => x.binding === `TREE_${TREE.toUpperCase()}`)!;

/** Runs the migration command a deploy runs, against a local database in the scratch folder. */
function applyMigrations(name: string) {
  const r = spawnSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', name, '--local', '--env', 'local', '--persist-to', state], { encoding: 'utf8', env: offlineEnv() });
  assert.equal(r.status, 0, `wrangler d1 migrations apply ${name}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

let worker: Miniflare;
let durableWorker: Miniflare;
let again = '';

before(async () => {
  for (const database of [accounts, family]) applyMigrations(database.database_name);
  again = applyMigrations(family.database_name);

  const bundle = await build({
    entryPoints: ['src/lib/store/contract.worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'esnext',
    conditions: ['workerd', 'worker'],
    mainFields: ['module', 'main'],
    external: ['cloudflare:*', 'node:*'],
    plugins: [esbuildMigrations(join(process.cwd(), 'migrations'))],
  });
  const modules = [{ type: 'ESModule' as const, path: 'worker.mjs', contents: bundle.outputFiles[0].text }];
  worker = new Miniflare(convertV4MiniflareOptions({
    ...workerRuntime(),
    modules,
    d1Databases: { [accounts.binding]: accounts.database_id, [family.binding]: family.database_id },
    r2Buckets: { MEDIA: r2[0].bucket_name },
    resourcePersistencePath: join(state, 'v3'),
    cf: false,
  }));
  // The same Worker with no D1 at all: the family and the accounts in Durable Objects, as a new install has them.
  durableWorker = new Miniflare(convertV4MiniflareOptions({
    ...workerRuntime(),
    modules,
    durableObjects: { FAMILIES: { className: 'FamilyStore', useSQLite: true } },
    r2Buckets: { MEDIA: 'kindred-contract-durable-media' },
    resourcePersistencePath: join(work, 'durable'),
    cf: false,
  }));
  await Promise.all([worker.ready, durableWorker.ready]);
  const made = await durableWorker.dispatchFetch('http://contract.test/setup', { method: 'POST' });
  assert.equal(made.status, 200, await made.text());
}, { timeout: 120_000 });

after(async () => {
  await worker?.dispose();
  await durableWorker?.dispose();
  rmSync(work, { recursive: true, force: true });
});

const inWorkerd = (path: string, on = worker) => on.dispatchFetch(`http://contract.test/${encodeURIComponent(path)}`, { method: 'POST' });

describe('node:sqlite', () => {
  for (const [name, run] of Object.entries(contractCases)) test(name, run);
});

describe('local D1 in workerd', () => {
  for (const name of Object.keys(contractCases)) {
    test(name, async () => {
      const res = await inWorkerd(name);
      const text = await res.text();
      assert.equal(res.status, 200, text);
    });
  }
});

describe('local Durable Objects in workerd', () => {
  for (const name of Object.keys(contractCases)) {
    test(name, async () => {
      const res = await inWorkerd(name, durableWorker);
      const text = await res.text();
      assert.equal(res.status, 200, text);
    });
  }
});

describe('migrations', () => {
  const files = (dir: string) => readdirSync(join('migrations', dir)).filter((f) => f.endsWith('.sql')).sort();

  test('both drivers end up with the same schema, from every migration file', async () => {
    const res = await inWorkerd('schemas');
    const onD1 = JSON.parse(await res.text()) as Awaited<ReturnType<typeof schemas>>;
    const onNode = await schemas();
    assert.deepEqual(onD1.tree.applied, files('tree'));
    assert.deepEqual(onD1.accounts.applied, files('accounts'));
    assert.deepEqual(onD1, onNode);
  });

  test('a Durable Object ends up with the same schema and the same migration record', async () => {
    const res = await inWorkerd('schemas', durableWorker);
    const onDo = JSON.parse(await res.text()) as Awaited<ReturnType<typeof schemas>>;
    assert.deepEqual(onDo.tree.applied, files('tree'));
    assert.deepEqual(onDo.accounts.applied, files('accounts'));
    assert.deepEqual(onDo, await schemas());
  });

  test('applying them again changes nothing, as every deploy now does', () => {
    assert.match(again, /No migrations to apply/);
  });
});
