// The daily retention run (src/lib/gdpr/retention.server.ts, docs/gdpr.md "Retention"): counts what the server no longer
// needs and, once its operator has switched deletion on, deletes it. Until then it only reports.
import type { DailyJob } from './types.ts';

export const retentionJob: DailyJob = {
  name: 'retention',
  async run(ctx) {
    const { runRetention } = await import('../gdpr/retention.server.ts');
    const r = await runRetention(ctx.now.getTime(), { log: ctx.log });
    const c = r.counts;
    ctx.log(`${r.deleted ? 'deleted' : 'would delete'}: accounts ${c.accounts}, invitations ${c.invites}, family requests ${c.familyRequests}, data requests ${c.dataRequests}, terms records ${c.termsRecords}`);
  },
};
