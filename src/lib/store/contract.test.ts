// node --test src/lib/store/contract.test.ts — the same database contract (./contract.cases.ts) on both drivers:
// node:sqlite in this process, and the real Cloudflare driver and `once` inside workerd on local D1. The D1 databases
// are migrated by `wrangler d1 migrations apply`, the command a deploy runs. Nothing here contacts Cloudflare: the
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

const work = mkdtempSync(join(tmpdir(), 'kindred-contract-'));
process.env.KINDRED_DATA_DIR = join(work, 'node');
process.env.KINDRED_ACCOUNTS_DB = join(work, 'node', 'accounts.db');

const { contractCases, schemas, TREE } = await import('./contract.cases.ts');
const { store } = await import('./index.ts');
store.ensureTree(TREE);
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
  });
  worker = new Miniflare(convertV4MiniflareOptions({
    ...workerRuntime(),
    modules: [{ type: 'ESModule', path: 'worker.mjs', contents: bundle.outputFiles[0].text }],
    d1Databases: { [accounts.binding]: accounts.database_id, [family.binding]: family.database_id },
    r2Buckets: { MEDIA: r2[0].bucket_name },
    resourcePersistencePath: join(state, 'v3'),
    cf: false,
  }));
  await worker.ready;
}, { timeout: 120_000 });

after(async () => {
  await worker?.dispose();
  rmSync(work, { recursive: true, force: true });
});

const inWorkerd = (path: string) => worker.dispatchFetch(`http://contract.test/${encodeURIComponent(path)}`, { method: 'POST' });

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

  test('applying them again changes nothing, as every deploy now does', () => {
    assert.match(again, /No migrations to apply/);
  });
});
