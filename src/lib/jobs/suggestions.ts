// The suggestions' daily job: for every family, waiting suggestions older than EXPIRY_DAYS expire (their pending files deleted
// from storage), and stored objects no suggestion or source names are swept (src/lib/suggestions/expiry.server.ts). It runs
// whether or not push is set up: the reviewers' push goes out when a suggestion is made, not from here. A family whose clean-up
// fails is skipped. A demo runs no daily jobs (run.server.ts).
import type { DailyJob } from './types.ts';

export const suggestionsJob: DailyJob = {
  name: 'suggestions',
  async run(ctx) {
    const { expireSuggestions, sweepOrphanFiles } = await import('../suggestions/expiry.server.ts');
    let expired = 0, swept = 0, errors = 0;
    // Separate tries: a failing expiry does not skip the sweep, nor one family the next.
    const attempt = async (tree: string, work: () => Promise<number>) => {
      try {
        return await work();
      } catch (e) {
        errors += 1;
        ctx.log(`family ${tree}: ${e instanceof Error ? e.message : 'failed'}`);
        return 0;
      }
    };
    for (const tree of ctx.trees) {
      expired += await attempt(tree, () => expireSuggestions(tree, ctx.now));
      swept += await attempt(tree, () => sweepOrphanFiles(tree, ctx.now));
    }
    ctx.log(`expired ${expired} suggestions and swept ${swept} stray files, family errors ${errors}`);
  },
};
