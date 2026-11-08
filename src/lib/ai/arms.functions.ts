// The two steps of arms from a surname, as server functions the Designer calls. Each checks the reader's role
// first (stewards: edit-house), like every other AI function; the feature switch and the budget are checked in
// adapterForFeature. The research's sources are the only outside text that reaches the browser, and it is data.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { armsV2Schema } from '../../components/heraldry/schema';
import { designMeaningSchema, toAiLocale } from './types';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const locale = z.string().max(8).optional();
const surname = z.string().trim().min(1).max(80);
const country = z.string().regex(/^[A-Z]{2}$/).optional();
/** The family's own words about the name: a sentence at most. Empty means none. */
const familyHint = z.string().trim().max(200).optional();
const guard = () => import('../auth/guard.server');

/** The most meanings one design call takes. The reader's screen holds to the same number, so it never asks for more. */
export const MAX_DESIGN_MEANINGS = 10;

/** Step one: what the surname may mean, across its languages and regions. Web search only when the family allows it. */
export const aiNameMeaning = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, surname, country, familyHint, locale }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./arms.server')).nameMeaning({
      tree: data.tree, surname: data.surname, country: data.country, familyHint: data.familyHint || undefined, locale: toAiLocale(data.locale),
    });
  });

/** Step two: 3–5 arms designs drawing on the meanings the reader chose (at most MAX_DESIGN_MEANINGS). */
export const aiArmsDesigns = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree, surname, country, familyHint, locale,
    meanings: z.array(designMeaningSchema).min(1).max(MAX_DESIGN_MEANINGS),
  }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-house');
    const designs = await (await import('./arms.server')).armsDesigns({
      tree: data.tree, surname: data.surname, country: data.country, familyHint: data.familyHint || undefined,
      meanings: data.meanings, locale: toAiLocale(data.locale),
    });
    await (await import('../stats/store.server')).countFeature(data.tree, m.user.id, 'arms.designed');
    return designs;
  });

/**
 * Step three: new arms from the saved meanings and what the steward's check asked for. Refinements keep the arms as they
 * are and add what the check names; fresh designs start again from the meanings. Stewards only, no web search.
 */
export const aiArmsRevisions = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree, surname, country, familyHint, locale,
    meanings: z.array(designMeaningSchema).min(1).max(MAX_DESIGN_MEANINGS),
    arms: armsV2Schema,
    feedback: z.object({ reason: z.string().trim().min(1).max(400), advice: z.string().trim().max(400) }),
  }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./arms.server')).armsRevisions({
      tree: data.tree, surname: data.surname, country: data.country, familyHint: data.familyHint || undefined,
      meanings: data.meanings, arms: data.arms, feedback: data.feedback, locale: toAiLocale(data.locale),
    });
  });
