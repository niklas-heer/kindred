// A public demo on Node in one step (docs/self-host.md, "A public demo"): makes the two invented families into a demo data
// folder of their own, fresh each time, then starts the built server on it with KINDRED_DEMO=1.
//   mise run demo                       builds the Node server, then runs this (http://localhost:4901)
//   node scripts/demo.ts --data-only    only the data: the Docker image's demo profile uses this (compose.yaml)
// The data folder is KINDRED_DATA_DIR when set, else .demo/data in this folder. It is never data/: the demo's folder is
// emptied before every run, and data/ holds real families. PORT and HOST are passed on to the server as they are.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSqlite } from '../src/lib/store/node.ts';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const dataOnly = process.argv.includes('--data-only');
const data = resolve(process.env.KINDRED_DATA_DIR || join(root, '.demo', 'data'));
if (data === resolve(root, 'data')) {
  console.error('[demo] KINDRED_DATA_DIR is the data/ folder, which holds real families. Point it at a folder of its own.');
  process.exit(2);
}

const node = (args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (r.status !== 0) throw new Error(`node ${args.join(' ')} failed`);
};

// 1. The invented families, generated as `mise run data` does, into a folder emptied first. Emptied rather than removed: in
// Docker it is a volume's mount point.
mkdirSync(data, { recursive: true });
for (const entry of readdirSync(data)) rmSync(join(data, entry), { recursive: true, force: true });
node(['scripts/gen-realm.ts']);
node(['scripts/gen-modern.ts']);
node(['scripts/seed.ts', '--force', 'data/seed/realm.json', 'data/seed/modern.json'], { ...process.env, KINDRED_DATA_DIR: data });
// The accounts database, made now so the server never has to (a demo writes nothing).
openSqlite(join(data, 'accounts.db'), 'accounts', { create: true }).close();
console.log(`[demo] the invented families are in ${data}`);
if (dataOnly) process.exit(0);

// 2. The server, as a demo.
if (!existsSync(join(root, 'dist', 'server', 'server.js'))) {
  console.error('[demo] no server build. Run: mise run demo (which builds it), or mise run build:node first.');
  process.exit(1);
}
const server = spawn(process.execPath, ['server/node.ts'], { stdio: 'inherit', env: { ...process.env, KINDRED_DEMO: '1', KINDRED_DATA_DIR: data, KINDRED_JOBS: 'off' } });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
