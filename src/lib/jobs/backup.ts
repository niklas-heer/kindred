// The automatic backups (src/lib/backup/backup.server.ts, docs/hosting-many-families.md "Backups"): every day, each family and
// the accounts database that is due, the most stale first, within the run's time budget; then each one's retention, and the
// backups of families deleted longer ago than the grace period. Weekly, the restore drill: the newest backup of the accounts
// and of one family (rotating) restored into a scratch database and checked. A demo runs no daily jobs (run.server.ts).
import type { DailyJob } from './types.ts';

export const backupJob: DailyJob = {
  name: 'backup',
  async run(ctx) {
    const { runBackups } = await import('../backup/backup.server.ts');
    const r = await runBackups({ trees: ctx.trees, now: ctx.now, log: ctx.log });
    ctx.log(`made ${r.made}, failed ${r.failed}, not reached ${r.left}, past retention ${r.pruned}, of deleted families ${r.expired}`);
    if (r.failed) throw new Error(`${r.failed} backups failed`);
  },
};

export const backupDrillJob: DailyJob = {
  name: 'backup-drill',
  async run(ctx) {
    const { runDrill } = await import('../backup/backup.server.ts');
    const r = await runDrill({ trees: ctx.trees, now: ctx.now, log: ctx.log });
    ctx.log(r.drilled.length ? `drilled ${r.drilled.length}, failed ${r.failed}` : 'not due');
    if (r.failed) throw new Error(`${r.failed} restore drills failed`);
  },
};
