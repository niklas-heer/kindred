// The daily clean-up of "Ask to join" (src/lib/auth/join.server.ts): requests nobody answered in 30 days go with their pending
// accounts and passkeys, and a guest browser's usage goes 90 days after its last visit.
import type { DailyJob } from './types.ts';

export const joinJob: DailyJob = {
  name: 'join',
  run: async (ctx) => {
    const { pruneJoin } = await import('../auth/join.server.ts');
    await pruneJoin(ctx.now.getTime());
  },
};
