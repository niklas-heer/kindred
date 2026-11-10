// The feed's daily clean-up (docs/feed.md): every family's pictures uploaded for a post that was never made (the composer
// closed, the post refused) are deleted a day after their upload, from the table and from media storage
// (src/lib/feed/posts.server.ts `sweepLeftovers`). Nobody sees one meanwhile. A demo runs no daily jobs (run.server.ts).
import type { DailyJob } from './types.ts';

export const feedJob: DailyJob = {
  name: 'feed',
  async run(ctx) {
    const { sweepLeftovers } = await import('../feed/posts.server.ts');
    let removed = 0, errors = 0;
    for (const tree of ctx.trees) {
      try {
        removed += await sweepLeftovers(tree, ctx.now);
      } catch (e) {
        errors += 1;
        ctx.log(`family ${tree}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    ctx.log(`removed ${removed} pictures uploaded for posts never made, family errors ${errors}`);
  },
};
