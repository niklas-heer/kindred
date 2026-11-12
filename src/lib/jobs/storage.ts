// Recounts the media storage of a few families a day (src/lib/operator/storage.server.ts): those never counted, such as every
// family of an install that had files before migration 0034, and those not counted for a month. Uploads and deletions keep
// the count themselves; this only corrects drift. A demo runs no daily jobs (run.server.ts).
import type { DailyJob } from './types.ts';

export const storageJob: DailyJob = {
  name: 'storage',
  async run(ctx) {
    const { dueForRecount, recount } = await import('../operator/storage.server.ts');
    let counted = 0, errors = 0;
    for (const tree of await dueForRecount(ctx.trees, 5, ctx.now.getTime())) {
      try {
        await recount(tree);
        counted += 1;
      } catch (e) {
        errors += 1;
        ctx.log(`family ${tree}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    ctx.log(`recounted the storage of ${counted} families, family errors ${errors}`);
  },
};
