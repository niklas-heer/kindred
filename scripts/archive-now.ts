// Runs the nightly archive for one family from the command line, with the settings the job reads from the
// environment (docs/exchange.md, "The nightly archive"). Prints what it would change or did: the paths on stdout,
// the log on stderr. With --dry-run it reads the repository and writes nothing.
//   KINDRED_ARCHIVE_<ID>_REPO=owner/name KINDRED_ARCHIVE_<ID>_TOKEN=... node scripts/archive-now.ts <family> [--dry-run]
// Exit status: 0 when the archive is unchanged, committed or planned; 1 otherwise. The token is never printed.
import { store } from '../src/lib/db.server.ts';
import { archiveEnvPrefix, archiveTrees } from '../src/lib/jobs/archive.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tree = args.find((a) => !a.startsWith('-'));
if (!tree) {
  console.error('usage: node scripts/archive-now.ts <family> [--dry-run]');
  process.exit(2);
}

const families = store.treeIds();
if (!families.includes(tree)) {
  console.error(`no family "${tree}" here (families: ${families.join(', ') || 'none'})`);
  process.exit(1);
}

const env = (name: string) => process.env[name]?.trim() || undefined;
const [result] = await archiveTrees([tree], { env, now: new Date(), log: (m) => console.error(m) }, { dryRun });

if (result.status === 'unconfigured') {
  console.error(`${tree}: no archive is configured. Set ${archiveEnvPrefix(tree)}_REPO and ${archiveEnvPrefix(tree)}_TOKEN (docs/exchange.md).`);
  process.exit(1);
}
if (result.changes) {
  for (const path of result.changes.added) console.log(`${dryRun ? 'would add' : 'added'}     ${path}`);
  for (const path of result.changes.changed) console.log(`${dryRun ? 'would change' : 'changed'}   ${path}`);
  for (const path of result.changes.removed) console.log(`${dryRun ? 'would remove' : 'removed'}   ${path}`);
}
if (result.status === 'committed') console.log(`committed ${result.commit}`);
if (result.status === 'unchanged') console.log(`${tree}: nothing changed`);
process.exit(result.status === 'failed' ? 1 : 0);
