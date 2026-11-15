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
    for (const tree of ctx.trees) {
      try {
        expired += await expireSuggestions(tree, ctx.now);
        swept += await sweepOrphanFiles(tree, ctx.now);
      } catch {
        errors += 1;
      }
    }
    ctx.log(`expired ${expired} suggestions and swept ${swept} stray files, family errors ${errors}`);
  },
};
