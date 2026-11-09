// Applies migrations/ to every D1 database in wrangler.jsonc: the same files the Node driver applies to
// data/*.db when it opens them (src/lib/store/node.ts).
//   node scripts/cf-migrate.ts --env local     the local D1 databases `mise run dev:cf` uses
//   node scripts/cf-migrate.ts --remote        the deployed ones (needs `wrangler login`)
import { where, wrangler, wranglerBindings } from './lib/wrangler.ts';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined;

for (const db of wranglerBindings(env).d1) {
  if (!db.migrations_dir) continue;
  console.log(`\n${db.binding} (${db.database_name}): ${db.migrations_dir}`);
  wrangler(['d1', 'migrations', 'apply', db.database_name, ...where(remote, env)]);
}
