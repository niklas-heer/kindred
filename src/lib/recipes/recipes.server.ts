// Recipes on the server (docs/recipes.md, tree migration 0031). A recipe is a story of kind 'recipe' with a row in
// `recipe`; the functions in recipes.functions.ts check who is asking first, and these keep the data true.
//
// - Reading. Every reader of the family reads recipes, as they read stories, and by the same rule: a share-link guest
//   whose link protects living people gets no recipe of a living person, neither its words nor its pictures.
// - Writing. A contributor writes one; its writer and anyone who edits may change it. One request carries the recipe and
//   its pictures, so no picture is ever stored waiting for a recipe that may not come: a refused save gives them back.
// - Pictures. The cover and the steps' pictures are in media storage under recipe/ (the cover's small copy under
//   recipe-thumb/), listed in `recipe_image`, and never in the gallery. A picture a change replaces is deleted with the
//   change. A removed recipe's pictures are only marked (the trigger of migration 0031), so Undo brings them back; the
//   daily job deletes what stayed gone for 31 days (`sweepRecipeImages`).
// - Every change is a `once` plan with its history row (kind `story`), so a demo and a steward's preview refuse it.
import { fail } from '../auth/guard.server';
import { forbidden } from '../auth/errors';
import { added, change, db, guard, media, newMediaKey, once, personExists, q, type Db, type OpKey, type Query } from '../db.server';
import { LIVING_IDS } from '../protect-living.ts';
import { can, type Role } from '../roles';
import {
  cleanRecipe, hasSubstance, ingredientLine, recipeMarkdown, ENGLISH_WORDS, MAX_STEP_IMAGES, MAX_TITLE, RECIPE_KEY,
  type IngredientGroup, type RecipeBody, type RecipeDetail, type RecipePicture, type RecipeStep, type RecipeSummary, type RecipeWords,
} from './model.ts';

/** Who is asking: a member (their account id, the name they show, their role) or a guest, with their link's protection. */
export interface RecipeReader { id: string; name: string; role: Role; guest?: boolean; protectLiving?: boolean }

/** How long a removed recipe's pictures are kept: as long as its removal can be undone (the `op` table's 30 days), and a day. */
export const GONE_KEEP_MS = 31 * 86_400_000;

interface Row {
  id: string; person: string; title: string | null; body: string; author: string; at: string; author_account: string | null;
  structured: string | null; source: string | null; servings: number | null; prep_minutes: number | null; cook_minutes: number | null;
  ingredients: string | null; steps: string | null; notes: string | null; tags: string | null; cover: string | null;
  cover_width: number | null; cover_height: number | null;
}

const COLUMNS = `s.id, s.person, s.title, s.body, s.author, s.at, s.author_account, r.story AS structured, r.source, r.servings, r.prep_minutes,
  r.cook_minutes, r.ingredients, r.steps, r.notes, r.tags, r.cover, i.width AS cover_width, i.height AS cover_height`;
const FROM = `FROM story s LEFT JOIN recipe r ON r.story = s.id LEFT JOIN recipe_image i ON i.key = r.cover AND i.gone_at IS NULL`;
/** The recipes this reader may read, as a condition on `s`. */
const visible = (protectLiving: boolean | undefined) => `s.kind = 'recipe'${protectLiving ? ` AND s.person NOT IN (${LIVING_IDS})` : ''}`;

const list = <T>(json: string | null): T[] => {
  try {
    const v = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
};

function summaryOf(r: Row): RecipeSummary {
  const groups = list<IngredientGroup>(r.ingredients);
  return {
    id: r.id, person: r.person, title: r.title ?? '', author: r.author, at: r.at, structured: r.structured !== null,
    source: r.source ?? '', servings: r.servings, prepMinutes: r.prep_minutes, cookMinutes: r.cook_minutes, tags: list<string>(r.tags),
    cover: r.cover && r.cover_width && r.cover_height ? { key: r.cover, width: r.cover_width, height: r.cover_height } : null,
    items: groups.flatMap((g) => (Array.isArray(g?.items) ? g.items.map((x) => x.item) : [])),
  };
}

/** May this reader change the recipe: they wrote it and may still write, or their role edits. Never a guest. */
const mayChange = (who: RecipeReader, row: { author_account: string | null }) =>
  !who.guest && !!who.id && (can(who.role, 'edit-person') || (can(who.role, 'add-story') && row.author_account === who.id));

// ---------- reads ----------

/** The family's cookbook, newest first: every recipe this reader may read, the ones from before the form among them. */
export async function cookbook(tree: string, who: RecipeReader): Promise<RecipeSummary[]> {
  const rows = await db(tree).all<Row>(`SELECT ${COLUMNS} ${FROM} WHERE ${visible(who.protectLiving)} ORDER BY s.at DESC, s.id LIMIT 2000`);
  return rows.map(summaryOf);
}

/** One recipe, or null when there is none this reader may read. */
export async function recipe(tree: string, id: string, who: RecipeReader): Promise<RecipeDetail | null> {
  const d = db(tree);
  const [rows, pictures] = (await d.readBatch([
    q(`SELECT ${COLUMNS} ${FROM} WHERE s.id = ? AND ${visible(who.protectLiving)}`, id),
    q('SELECT key, width, height FROM recipe_image WHERE story = ? AND gone_at IS NULL', id),
  ])) as unknown as [Row[], RecipePicture[]];
  const r = rows[0];
  if (!r) return null;
  const known = new Map(pictures.map((p) => [p.key, p]));
  // A step names a picture only while the picture is there.
  const steps = list<RecipeStep>(r.steps).map((s) => ({ text: typeof s?.text === 'string' ? s.text : '', image: s?.image && known.has(s.image) ? s.image : null }));
  return {
    ...summaryOf(r),
    groups: list<IngredientGroup>(r.ingredients),
    steps,
    notes: r.notes ?? '',
    body: r.body,
    pictures: Object.fromEntries(steps.filter((s) => s.image).map((s) => [s.image!, { key: s.image!, width: known.get(s.image!)!.width, height: known.get(s.image!)!.height }])),
    editable: mayChange(who, r),
    removable: !who.guest && can(who.role, 'edit-person'),
  };
}

/**
 * The stored picture to serve for a recipe key, or undefined: the picture, or for `thumb` a cover's small copy. Only a
 * picture of a recipe that is there, and that this reader may read, is found.
 */
export async function recipePicture(tree: string, key: string, thumb: boolean, protectLiving = false): Promise<{ key: string; mime: string } | undefined> {
  if (!RECIPE_KEY.test(key)) return undefined;
  const row = await db(tree).get<{ mime: string; thumb: string | null }>(
    `SELECT i.mime, i.thumb FROM recipe_image i JOIN story s ON s.id = i.story WHERE i.key = ? AND i.gone_at IS NULL AND ${visible(protectLiving)}`, key);
  if (!row) return undefined;
  // The small copy is a JPEG the browser made (checked as a picture on the way in); a seeded family's is a painted PNG.
  return thumb && row.thumb ? { key: row.thumb, mime: row.thumb.endsWith('.png') ? 'image/png' : row.thumb.endsWith('.webp') ? 'image/webp' : 'image/jpeg' } : { key, mime: row.mime };
}

// ---------- writing ----------

/** A picture as it arrives with a save: checked and cleaned bytes, and the size the browser measured. */
export interface NewPicture { bytes: Uint8Array; mime: string; width: number; height: number; thumb?: { bytes: Uint8Array; mime: string } }

/**
 * A recipe as the form sends it. A step's `image` is the key of a picture the recipe already has, `new:<n>` for the
 * picture sent as `pictures.steps[n]`, or null. `cover` says what becomes of the cover.
 */
export interface RecipeInput extends Omit<RecipeBody, 'steps'> {
  /** The story to change; absent for a new recipe. */
  id?: string;
  person: string;
  title: string;
  steps: { text: string; image: string | null }[];
  cover: 'keep' | 'remove' | 'new';
}
export interface RecipePictures { cover?: NewPicture; steps: Record<number, NewPicture> }

const historyFields = (title: string, person: string, r: RecipeBody, cover: string | null) => ({
  title, person, source: r.source, servings: r.servings, prep: r.prepMinutes, cook: r.cookMinutes,
  ingredients: r.groups.flatMap((g) => [...(g.name ? [`${g.name}:`] : []), ...g.items.map((i) => ingredientLine(i))]).join('\n'),
  steps: r.steps.map((s, n) => `${n + 1}. ${s.text}`).join('\n'),
  notes: r.notes, tags: r.tags.join(', '), cover: cover ?? '', pictures: r.steps.map((s) => s.image ?? '').join(','),
});

/**
 * Writes a recipe: a new one, or a change to one the reader may change. `words` are the headings of the written-out
 * recipe (the story's body), in the writer's language. Answers with the story's id.
 */
export function saveRecipe(tree: string, who: RecipeReader, input: RecipeInput, pictures: RecipePictures, words: RecipeWords = ENGLISH_WORDS, op?: OpKey): Promise<{ id: string }> {
  if (who.guest || !who.id || !can(who.role, 'add-story')) throw fail(forbidden('add-story', 'contributor'));
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (!title) throw new Error('recipes.err.title');
  return once(tree, op, 'saveRecipe', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', input.person))) throw new Error('Person not found.');
    const had = input.id ? await existing(d, input.id) : null;
    if (input.id && !had) throw new Error('recipes.err.gone');
    if (had && !mayChange(who, had.story)) throw fail(forbidden('edit-person', 'editor'));
    const mine = new Map((had?.images ?? []).map((i) => [i.key, i]));
    // The steps' pictures it would have, the ones it keeps and the new ones together, counted before anything is uploaded.
    const named = input.steps.filter((s) => {
      const sent = /^new:(\d{1,2})$/.exec(s.image ?? '');
      return sent ? !!pictures.steps[Number(sent[1])] : !!s.image && mine.has(s.image);
    }).length;
    if (named > MAX_STEP_IMAGES) throw new Error('recipes.err.too_many_pictures');

    // The pictures first, as every upload: the rows that name them are kept only if the batch commits.
    const stored: string[] = [];
    const put = async (key: string, bytes: Uint8Array, mime: string) => { await media.put(tree, key, bytes, mime); stored.push(key); };
    const abandon = () => Promise.all(stored.map((k) => media.delete(tree, k).catch(() => {}))).then(() => {});
    const fresh: { key: string; mime: string; width: number; height: number; thumb: string | null }[] = [];
    try {
      const steps: RecipeStep[] = [];
      for (const s of input.steps) {
        const sent = /^new:(\d{1,2})$/.exec(s.image ?? '');
        const picture = sent ? pictures.steps[Number(sent[1])] : undefined;
        if (picture) {
          const key = newMediaKey('recipe', picture.mime);
          await put(key, picture.bytes, picture.mime);
          fresh.push({ key, mime: picture.mime, width: picture.width, height: picture.height, thumb: null });
          steps.push({ text: s.text, image: key });
        } else {
          // A key is only ever one of this recipe's own pictures.
          steps.push({ text: s.text, image: s.image && mine.has(s.image) ? s.image : null });
        }
      }
      let cover = input.cover === 'keep' && had?.recipe?.cover && mine.has(had.recipe.cover) ? had.recipe.cover : null;
      if (input.cover === 'new' && pictures.cover) {
        const p = pictures.cover;
        cover = newMediaKey('recipe', p.mime);
        await put(cover, p.bytes, p.mime);
        let thumb: string | null = null;
        if (p.thumb) {
          thumb = newMediaKey('recipe-thumb', p.thumb.mime);
          await put(thumb, p.thumb.bytes, p.thumb.mime);
        }
        fresh.push({ key: cover, mime: p.mime, width: p.width, height: p.height, thumb });
      }

      const body = cleanRecipe({ ...input, steps });
      if (!hasSubstance(body)) throw new Error('recipes.err.empty');
      const text = recipeMarkdown(body, words);
      const id = had?.story.id ?? crypto.randomUUID();
      const at = new Date().toISOString();
      const kept = new Set([cover, ...body.steps.map((s) => s.image)].filter((k): k is string => !!k));
      // What the recipe had and no longer names goes: its rows in this batch, its files after it.
      const dropped = [...mine.values()].filter((i) => !kept.has(i.key));

      const writes: Query[] = [];
      if (had) {
        // The story as it was read: a change in between (another save, a removal) makes this plan decide again.
        writes.push(guard("EXISTS (SELECT 1 FROM story WHERE id = ? AND kind = 'recipe' AND title IS ? AND body = ? AND person = ?)", id, had.story.title, had.story.body, had.story.person));
        // And its cover as it was read: two saves changing only the cover must not both win, or one's picture is lost.
        writes.push(guard('(SELECT cover FROM recipe WHERE story = ?) IS ?', id, had.recipe?.cover ?? null));
        writes.push(personExists(input.person));
        writes.push(q('UPDATE story SET title = ?, body = ?, person = ? WHERE id = ?', title, text, input.person, id));
      } else {
        writes.push(personExists(input.person));
        // Signed with the writer's own name from their account, and the account, so they can be told about answers.
        writes.push(q("INSERT INTO story (id, person, kind, title, body, author, at, context, author_account) VALUES (?, ?, 'recipe', ?, ?, ?, ?, NULL, ?)", id, input.person, title, text, who.name, at, who.id));
      }
      writes.push(q(
        `INSERT INTO recipe (story, source, servings, prep_minutes, cook_minutes, ingredients, steps, notes, tags, cover, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (story) DO UPDATE SET source = excluded.source, servings = excluded.servings, prep_minutes = excluded.prep_minutes, cook_minutes = excluded.cook_minutes,
           ingredients = excluded.ingredients, steps = excluded.steps, notes = excluded.notes, tags = excluded.tags, cover = excluded.cover, updated_at = excluded.updated_at`,
        id, body.source, body.servings, body.prepMinutes, body.cookMinutes, JSON.stringify(body.groups), JSON.stringify(body.steps), body.notes, JSON.stringify(body.tags), cover, at));
      for (const f of fresh) writes.push(q('INSERT INTO recipe_image (key, story, mime, width, height, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', f.key, id, f.mime, f.width, f.height, f.thumb, at));
      for (const g of dropped) writes.push(q('DELETE FROM recipe_image WHERE key = ?', g.key));

      const now = historyFields(title, input.person, body, cover);
      return {
        writes,
        history: had
          ? change('story', id, had.recipe ? historyFields(had.story.title ?? '', had.story.person, had.recipe.body, had.recipe.cover) : { title: had.story.title ?? '', person: had.story.person, notes: had.story.body }, now,
            { person: input.person, label: title, opaque: ['cover', 'pictures'] })
          : [added('story', id, { person: input.person, label: title })],
        result: { id },
        abandon,
        after: async () => {
          for (const g of dropped) for (const k of [g.key, g.thumb]) if (k) await media.delete(tree, k).catch((e) => console.error('recipes.err.delete_failed', k, e));
        },
      };
    } catch (e) {
      await abandon();
      throw e;
    }
  });
}

interface ImageRow { key: string; thumb: string | null }

/** A recipe as a change finds it: its story, its row when it has one (a recipe from before has none), its pictures. */
async function existing(d: Db, id: string) {
  const [stories, recipes, images] = (await d.readBatch([
    q("SELECT id, person, title, body, author_account FROM story WHERE id = ? AND kind = 'recipe'", id),
    q('SELECT source, servings, prep_minutes, cook_minutes, ingredients, steps, notes, tags, cover FROM recipe WHERE story = ?', id),
    q('SELECT key, thumb FROM recipe_image WHERE story = ? AND gone_at IS NULL', id),
  ])) as unknown as [
    { id: string; person: string; title: string | null; body: string; author_account: string | null }[],
    { source: string; servings: number | null; prep_minutes: number | null; cook_minutes: number | null; ingredients: string; steps: string; notes: string; tags: string; cover: string | null }[],
    ImageRow[],
  ];
  const story = stories[0];
  if (!story) return null;
  const r = recipes[0];
  return {
    story,
    recipe: r ? {
      cover: r.cover,
      body: cleanRecipe({ source: r.source, servings: r.servings, prepMinutes: r.prep_minutes, cookMinutes: r.cook_minutes, groups: list(r.ingredients), steps: list(r.steps), notes: r.notes, tags: list(r.tags) }),
    } : null,
    images,
  };
}

// ---------- the daily clean-up ----------

/** The daily job's part: the pictures of recipes removed more than 31 days before `now` go, from the table and from storage. */
export async function sweepRecipeImages(tree: string, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - GONE_KEEP_MS).toISOString();
  let total = 0;
  for (;;) {
    const n = await once(tree, undefined, 'sweepRecipeImages', async (d) => {
      const rows = await d.all<ImageRow>('SELECT key, thumb FROM recipe_image WHERE gone_at IS NOT NULL AND gone_at < ? ORDER BY gone_at LIMIT 200', before);
      return {
        // Only while still gone: a recipe restored in between keeps its pictures.
        writes: rows.map((r) => q('DELETE FROM recipe_image WHERE key = ? AND gone_at IS NOT NULL', r.key)),
        // The recipe's removal is in the history; its pictures going later is not news.
        history: [],
        result: rows.length,
        after: async () => {
          const left = new Set((await d.all<{ key: string }>(`SELECT key FROM recipe_image WHERE key IN (${rows.map(() => '?').join(', ') || 'NULL'})`, ...rows.map((r) => r.key))).map((r) => r.key));
          for (const r of rows) if (!left.has(r.key)) for (const k of [r.key, r.thumb]) if (k) await media.delete(tree, k).catch((e) => console.error('recipes.err.delete_failed', k, e));
        },
      };
    });
    total += n;
    if (n < 200) return total;
  }
}
