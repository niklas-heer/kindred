// Fills the D1 databases of a Cloudflare demo (deploy/demo/wrangler.jsonc) with the two invented families, fresh:
//   mise run demo:cf                        local: workerd's D1 in deploy/demo/.wrangler/state (the `local` environment)
//   mise run demo:cf -- --remote            the deployed demo's databases (needs `wrangler login` and the ids filled in)
// Options: --remote, --env <name> (default `local` without --remote), --config <file> (default deploy/demo/wrangler.jsonc),
// --persist-to <folder> (local state; default deploy/demo/.wrangler/state).
// Steps: the families are generated into a scratch folder (scripts/demo.ts --data-only), the migrations are applied to every
// database of the configuration (scripts/cf-migrate.ts), then each family replaces what its database held
// (scripts/import-to-d1.ts --replace). The accounts database stays empty: a demo has no accounts.
// It refuses --remote while the configuration still has a placeholder id, and it never reads data/.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
process.chdir(root);
const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const remote = args.includes('--remote');
const env = option('--env') ?? (remote ? undefined : 'local');
const config = option('--config') ?? 'deploy/demo/wrangler.jsonc';
const persist = option('--persist-to') ?? (remote ? undefined : 'deploy/demo/.wrangler/state');
const FAMILIES = ['realm', 'modern'];

if (remote && /REPLACE-WITH-D1-ID/.test(readFileSync(config, 'utf8'))) {
  console.error(`[demo:cf] ${config} still has REPLACE-WITH-D1-ID: create the databases and paste their ids first (docs/deploy-cloudflare.md, "A public demo").`);
  process.exit(2);
}

const wranglerEnv = { ...process.env, KINDRED_WRANGLER_CONFIG: config, ...(persist ? { KINDRED_WRANGLER_PERSIST: persist } : {}) };
const node = (script: string[], extra: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(process.execPath, script, { stdio: 'inherit', env: { ...wranglerEnv, ...extra } });
  if (r.status !== 0) throw new Error(`node ${script.join(' ')} failed`);
};
const where = [remote ? '--remote' : '--local', ...(env ? ['--env', env] : [])];

const scratch = mkdtempSync(join(tmpdir(), 'kindred-demo-d1-'));
try {
  node(['scripts/demo.ts', '--data-only'], { KINDRED_DATA_DIR: scratch });
  node(['scripts/cf-migrate.ts', ...where]);
  for (const tree of FAMILIES) node(['scripts/import-to-d1.ts', tree, '--from', join(scratch, `${tree}.db`), '--replace', ...where]);
  console.log(`\n[demo:cf] ${FAMILIES.join(' and ')} are in the ${remote ? 'deployed' : 'local'} D1 databases of ${config}${env ? ` (env ${env})` : ''}.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
