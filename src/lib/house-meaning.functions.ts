// Server functions for a house's name meaning and its arms review. Reading the meanings needs membership (every reader
// sees them); reading the reviews, saving the research and keeping the arms need the steward's `edit-house`, checked
// before anything else (see guard.server.ts). The AI check of the arms is in ai/arms-fit.functions.ts.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { nameMeaningSchema } from './ai/types';
import { MAX_SAVED_MEANINGS } from './house-meaning';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const id = z.string().min(1).max(100);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const guard = () => import('./auth/guard.server');

export { MAX_SAVED_MEANINGS };

const savedMeaning = nameMeaningSchema.extend({ chosen: z.boolean() });

export const getHouseMeanings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireMember(data.tree);
    return (await import('./house-meaning.server')).readMeanings(data.tree);
  });

export const houseMeaningsQuery = (tree: string) =>
  queryOptions({ queryKey: ['house-meanings', tree], queryFn: () => getHouseMeanings({ data: { tree } }) });

export const getArmsReviews = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./house-meaning.server')).readReviews(data.tree);
  });

export const armsReviewsQuery = (tree: string) =>
  queryOptions({ queryKey: ['arms-reviews', tree], queryFn: () => getArmsReviews({ data: { tree } }) });

/** Meanings the background task collected and nobody has chosen from yet. Stewards only: other readers see only what is saved. */
export const getCollectedMeanings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./house-meaning.server')).readCollected(data.tree);
  });

export const collectedMeaningsQuery = (tree: string) =>
  queryOptions({ queryKey: ['collected-meanings', tree], queryFn: () => getCollectedMeanings({ data: { tree } }) });

/** One click on one collected meaning: it is saved as the house's meaning, and only now may the arms be checked against it. */
export const chooseCollectedMeaning = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, house: id, opKey, meaning: id }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./house-meaning.server')).chooseCollected(data.tree, data.house, data.meaning, { key: data.opKey, user: m.user.id, payload: { house: data.house, meaning: data.meaning } });
  });

/** The steward wants none of the collected meanings: they go, and the task does not collect this name again. */
export const dismissCollectedMeanings = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, house: id, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./house-meaning.server')).dismissCollected(data.tree, data.house, { key: data.opKey, user: m.user.id, payload: { house: data.house } });
  });

export const saveHouseMeaning = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    house: id,
    opKey,
    name: z.string().trim().min(1).max(120),
    familyWords: z.string().trim().max(200),
    webSearched: z.boolean(),
    note: z.string().trim().max(400),
    meanings: z.array(savedMeaning).min(1).max(MAX_SAVED_MEANINGS),
  }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-house');
    const { tree: t, house, opKey: key, ...input } = data;
    if (!input.meanings.some((x) => x.chosen)) throw new Error('houses.meaning.err_none_chosen');
    if (new Set(input.meanings.map((x) => x.id)).size !== input.meanings.length) throw new Error('houses.meaning.err_bad_input');
    // The retry key is bound to this steward and to exactly what they sent (see `once`).
    return (await import('./house-meaning.server')).saveMeanings(t, house, input, { key, user: m.user.id, payload: input });
  });

/** The steward sealed arms picked from the suggestions: their decision settles the check, and no new check runs. */
export const settleArmsReview = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, house: id, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./house-meaning.server')).settleReview(data.tree, data.house, { key: data.opKey, user: m.user.id, payload: { house: data.house } });
  });

export const dismissArmsReview = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, house: id, opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-house');
    return (await import('./house-meaning.server')).dismissReview(data.tree, data.house, { key: data.opKey, user: m.user.id, payload: { house: data.house } });
  });
