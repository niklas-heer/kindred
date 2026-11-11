// The recipes' daily clean-up (docs/recipes.md): the pictures of a recipe that was removed stay for as long as the removal
// can be undone, marked and served to nobody; after 31 days they are deleted, from the table and from media storage
// (src/lib/recipes/recipes.server.ts `sweepRecipeImages`). A demo runs no daily jobs (run.server.ts).
import type { DailyJob } from './types.ts';

export const recipesJob: DailyJob = {
  name: 'recipes',
  async run(ctx) {
    const { sweepRecipeImages } = await import('../recipes/recipes.server.ts');
    let removed = 0, errors = 0;
    for (const tree of ctx.trees) {
      try {
        removed += await sweepRecipeImages(tree, ctx.now);
      } catch (e) {
        errors += 1;
        ctx.log(`family ${tree}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    ctx.log(`removed ${removed} pictures of recipes removed over a month ago, family errors ${errors}`);
  },
};
