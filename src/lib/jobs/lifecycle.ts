// The daily lifecycle run (src/lib/lifecycle/lifecycle.server.ts, docs/hosting-many-families.md "Lifecycle"): warns the stewards
// of a quiet family, makes it read-only, marks it due for deletion and, when the operator chose automatic deletion, deletes it
// after a final notice. Does nothing while the lifecycle is off, which it is until the operator turns it on.
import type { DailyJob } from './types.ts';

export const lifecycleJob: DailyJob = {
  name: 'lifecycle',
  async run(ctx) {
    const { runLifecycle } = await import('../lifecycle/lifecycle.server.ts');
    const r = await runLifecycle(ctx.now.getTime(), { log: ctx.log });
    if (!r) return;
    const c = r.counts;
    ctx.log(`warned ${c.warn}, cleared ${c.clear}, read-only ${c.readonly}, due ${c.due}, final notices ${c['final-notice']}, deleted ${c.delete}, kept ${c.kept}, failed ${c.failed}`);
  },
};
