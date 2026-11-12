// The daily retry of breach notices (src/lib/email/notify.server.ts, accounts migration 0057; docs/gdpr.md): a notice that did not
// reach a steward when the operator set it (email off, the limits, the provider failing) is tried again once a day while the
// breach is open and its notice shown, a limited number of times. The breach register shows how many it reached.
import type { DailyJob } from './types.ts';

export const breachNoticesJob: DailyJob = {
  name: 'breach-notices',
  async run(ctx) {
    const { deliverBreachNotices } = await import('../email/notify.server.ts');
    const r = await deliverBreachNotices(ctx.now.getTime());
    if (r.sent || r.left) ctx.log(`sent ${r.sent}, left ${r.left}`);
  },
};
