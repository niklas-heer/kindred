// The server functions of recipes (docs/recipes.md): the family's cookbook, one recipe, and writing or changing one.
// Each checks the reader first. The reads are for every reader of the family, a share-link guest included, and apply
// "Protect living people" as stories do (recipes.server.ts); the write needs the same Action the browser asks `useCan()`
// about, so a guest, a viewer, a demo and a steward's preview are all refused. Removing a recipe is removing its story
// (`deleteStory` in api.ts), with the same Undo.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { isLocale, type Locale } from '../i18n/types';
import {
  MAX_AMOUNT, MAX_GROUPS, MAX_GROUP_NAME, MAX_INGREDIENTS, MAX_ITEM, MAX_MINUTES, MAX_NOTE, MAX_NOTES, MAX_SERVINGS, MAX_SOURCE, MAX_STEP, MAX_STEPS,
  MAX_STEP_IMAGES, MAX_TAG, MAX_TAGS, MAX_TITLE, MAX_UNIT, type RecipeDetail, type RecipeSummary, type RecipeWords,
} from './model';
import type { NewPicture, RecipePictures } from './recipes.server';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const storyId = z.string().min(1).max(80);
const personId = z.string().min(1).max(200);

const guard = () => import('../auth/guard.server');
const server = () => import('./recipes.server');

/** Any reader of the family: a member, or its share-link guest with the link's protection. */
async function reader(t: string) {
  const r = await (await guard()).requireReader(t);
  return { id: r.user?.id ?? '', name: r.user?.name ?? '', role: r.role, guest: r.guest, protectLiving: r.protectLiving };
}

// ---------- reads ----------

export const getCookbook = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<RecipeSummary[]> => (await server()).cookbook(data.tree, await reader(data.tree)));

export const cookbookQuery = (t: string) => queryOptions({ queryKey: ['cookbook', t], queryFn: () => getCookbook({ data: { tree: t } }), staleTime: 30_000 });

export const getRecipe = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: storyId }))
  .handler(async ({ data }): Promise<RecipeDetail | null> => (await server()).recipe(data.tree, data.id, await reader(data.tree)));

export const recipeQuery = (t: string, id: string) => queryOptions({ queryKey: ['recipe', t, id], queryFn: () => getRecipe({ data: { tree: t, id } }), staleTime: 30_000 });

// ---------- the save ----------

const line = (max: number) => z.string().max(max * 2);
const minutes = z.number().int().min(0).max(MAX_MINUTES).nullable();
const size = z.object({ width: z.number().int().min(1).max(8000), height: z.number().int().min(1).max(8000) });
/** What the form sends beside its pictures, as one JSON field. A little room over each limit: the server trims and holds them itself. */
const recipeData = z.object({
  id: storyId.optional(),
  person: personId,
  title: z.string().trim().min(1, 'recipes.err.title').max(MAX_TITLE),
  source: line(MAX_SOURCE).default(''),
  servings: z.number().int().min(1).max(MAX_SERVINGS).nullable().default(null),
  prepMinutes: minutes.default(null),
  cookMinutes: minutes.default(null),
  groups: z.array(z.object({
    name: line(MAX_GROUP_NAME).default(''),
    items: z.array(z.object({ amount: line(MAX_AMOUNT).default(''), unit: line(MAX_UNIT).default(''), item: line(MAX_ITEM).default(''), note: line(MAX_NOTE).default('') })).max(MAX_INGREDIENTS * 2),
  })).max(MAX_GROUPS * 2).default([]),
  steps: z.array(z.object({ text: z.string().max(MAX_STEP * 2).default(''), image: z.string().max(120).nullable().default(null) })).max(MAX_STEPS * 2).default([]),
  notes: z.string().max(MAX_NOTES * 2).default(''),
  tags: z.array(z.string().max(MAX_TAG * 2)).max(MAX_TAGS * 4).default([]),
  cover: z.enum(['keep', 'remove', 'new']).default('keep'),
  coverSize: size.optional(),
  stepSizes: z.record(z.string().regex(/^\d{1,2}$/), size).default({}),
  /** The language the writer's page is in: the headings of the written-out recipe are in it. */
  locale: z.string().max(16).optional(),
});

const field = (d: FormData, name: string) => {
  const v = d.get(name);
  return typeof v === 'string' ? v : '';
};

/** The headings of the written-out recipe (the story's body), in the writer's language. */
async function wordsFor(locale: Locale): Promise<RecipeWords> {
  const { translate } = await import('../i18n/dictionary');
  return {
    serves: (n) => translate(locale, 'recipes.serves', { count: n }),
    prep: translate(locale, 'recipes.prep'),
    cook: translate(locale, 'recipes.cook'),
    ingredients: translate(locale, 'recipes.ingredients'),
    method: translate(locale, 'recipes.method'),
    notes: translate(locale, 'recipes.notes'),
  };
}

/**
 * Writes a recipe, new or changed, with its pictures in the same request: `data` is the recipe as JSON, `cover` and
 * `coverThumb` the cover and its small copy, `step:<n>` the picture a step names as `new:<n>`. The browser has scaled
 * the pictures and dropped their EXIF and GPS; they are checked by their first bytes and cleaned again here.
 */
export const saveRecipe = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('expected form data');
    let json: unknown;
    try {
      json = JSON.parse(field(d, 'data'));
    } catch {
      throw new Error('recipes.err.invalid');
    }
    return { tree: tree.parse(d.get('tree')), form: d, recipe: recipeData.parse(json), opKey: opKey.parse(field(d, 'opKey') || undefined) };
  })
  .handler(async ({ data }): Promise<{ id: string }> => {
    const m = await (await guard()).requireCan(data.tree, 'add-story');
    const { form, recipe: r } = data;
    const { checkedPicture, checkedThumb } = await import('../picture-in');
    const pictures: RecipePictures = { steps: {} };
    const files: Record<string, File> = {};
    if (r.cover === 'new') {
      if (!r.coverSize) throw new Error('recipes.err.invalid');
      const cover = await checkedPicture(form.get('cover'), 8_000_000);
      const thumb = await checkedThumb(form.get('coverThumb'));
      files.cover = cover.file;
      pictures.cover = { bytes: cover.bytes, mime: cover.mime, ...r.coverSize, ...(thumb ? { thumb: { bytes: thumb.bytes, mime: thumb.mime } } : {}) };
    }
    const sent = r.steps.map((s) => /^new:(\d{1,2})$/.exec(s.image ?? '')?.[1]).filter((n): n is string => n !== undefined);
    if (sent.length > MAX_STEP_IMAGES) throw new Error('recipes.err.too_many_pictures');
    for (const n of new Set(sent)) {
      const at = r.stepSizes[n];
      if (!at) throw new Error('recipes.err.invalid');
      const picture = await checkedPicture(form.get(`step:${n}`), 6_000_000);
      files[`step:${n}`] = picture.file;
      pictures.steps[Number(n)] = { bytes: picture.bytes, mime: picture.mime, ...at } satisfies NewPicture;
    }
    const { coverSize: _c, stepSizes: _s, locale, ...input } = r;
    const who = { id: m.user.id, name: m.user.name, role: m.role };
    const op = data.opKey ? { key: data.opKey, user: m.user.id, payload: { tree: data.tree, recipe: r, files } } : undefined;
    return (await server()).saveRecipe(data.tree, who, input, pictures, await wordsFor(isLocale(locale) ? locale : 'en'), op);
  });
