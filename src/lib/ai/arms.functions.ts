// The two steps of arms from a surname, as server functions the Designer calls. Each checks the reader's role
// first (stewards: edit-house), like every other AI function; the feature switch and the budget are checked in
// adapterForFeature. The research's sources are the only outside text that reaches the browser, and it is data.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { designMeaningSchema, toAiLocale } from './types';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const locale = z.string().max(8).optional();
const surname = z.string().trim().min(1).max(80);
const country = z.string().regex(/^[A-Z]{2}$/).optional();
/** The family's own words about the name: a sentence at most. Empty means none. */
const familyHint = z.string().trim().max(200).optional();
const guard = () => import('../auth/guard.server');

/** Step one: what the surname may mean, across its languages and regions. Web search only when the family allows it. */
export const aiNameMeaning = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, surname, country, familyHint, locale }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./arms.server')).nameMeaning({
      tree: data.tree, surname: data.surname, country: data.country, familyHint: data.familyHint || undefined, locale: toAiLocale(data.locale),
    });
  });

/** Step two: 3–5 arms designs drawing on the meanings the reader chose (at most ten). */
export const aiArmsDesigns = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree, surname, country, familyHint, locale,
    meanings: z.array(designMeaningSchema).min(1).max(10),
  }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./arms.server')).armsDesigns({
      tree: data.tree, surname: data.surname, country: data.country, familyHint: data.familyHint || undefined,
      meanings: data.meanings, locale: toAiLocale(data.locale),
    });
  });
