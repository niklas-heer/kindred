// A recipe's shape and its arithmetic (docs/recipes.md): what a recipe holds, the limits the form and the server share,
// how a pasted list of lines becomes rows, how amounts are scaled for more or fewer servings, and the recipe written out
// as Markdown. Pure, with no storage and no React, so the browser, the server and the test runner all load it.

import { namesInEveryLanguage, tablesVersion } from '../i18n/dictionary.ts';

// ---------- the shape ----------

/** One line of the list: "1 1/2 cups flour (sifted)". `amount` is kept as the writer typed it. */
export interface Ingredient { amount: string; unit: string; item: string; note: string }
/** A named part of the list ("For the dumplings"). A group with no name is the list's plain start. */
export interface IngredientGroup { name: string; items: Ingredient[] }
/** One step. `image` is the key of its picture (recipe/<uuid>.<ext>) or null. */
export interface RecipeStep { text: string; image: string | null }

/** What makes a story a recipe (tree migration 0031). */
export interface RecipeBody {
  /** Where it comes from, in the family's own words: "Grandma's", "from the back of the flour bag". */
  source: string;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  groups: IngredientGroup[];
  steps: RecipeStep[];
  /** Tips, or the story that goes with it. Markdown. */
  notes: string;
  tags: string[];
}

/** A picture of a recipe: its key and its size, for the frame's shape. */
export interface RecipePicture { key: string; width: number; height: number }

/** A recipe as a list shows it: the Cookbook, a card in the Chronicle or the feed, a person's page. */
export interface RecipeSummary {
  /** The story's id. */
  id: string;
  /** Whose recipe it is. */
  person: string;
  title: string;
  author: string;
  at: string;
  /** False for a recipe from before recipes had a form: free text, with none of the fields below. */
  structured: boolean;
  source: string;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  tags: string[];
  cover: RecipePicture | null;
  /** What is in it, for the Cookbook's search. */
  items: string[];
}

/** A recipe as its own page shows it. */
export interface RecipeDetail extends RecipeSummary, Omit<RecipeBody, 'source' | 'servings' | 'prepMinutes' | 'cookMinutes' | 'tags'> {
  /** The story's text: the whole recipe as Markdown, or the free text of a recipe from before. */
  body: string;
  /** The pictures of its steps, by key. */
  pictures: Record<string, RecipePicture>;
  /** The reader may change it (they wrote it, or their role edits). */
  editable: boolean;
  /** The reader may remove it. */
  removable: boolean;
}

// ---------- limits ----------

export const MAX_TITLE = 200;
export const MAX_SOURCE = 80;
export const MAX_SERVINGS = 999;
/** A week: a ferment or a cure can take that long. */
export const MAX_MINUTES = 10_080;
export const MAX_GROUPS = 12;
export const MAX_INGREDIENTS = 100;
export const MAX_AMOUNT = 20;
export const MAX_UNIT = 24;
export const MAX_ITEM = 120;
export const MAX_NOTE = 160;
export const MAX_GROUP_NAME = 80;
export const MAX_STEPS = 60;
export const MAX_STEP = 2000;
export const MAX_NOTES = 8000;
export const MAX_TAGS = 12;
export const MAX_TAG = 30;
/** "A few": the pictures the steps of one recipe may have. */
export const MAX_STEP_IMAGES = 6;
/** The long side of a cover as the browser sends it, of its small copy, and of a step's picture. */
export const COVER_EDGE = 1800;
export const COVER_THUMB_EDGE = 720;
export const STEP_EDGE = 1400;

// ---------- cleaning ----------

const oneLine = (s: unknown, max: number) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, max);
const words = (s: unknown, max: number) =>
  (typeof s === 'string' ? s : '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const whole = (n: unknown, min: number, max: number) => (typeof n === 'number' && Number.isFinite(n) && Math.round(n) >= min ? Math.min(max, Math.round(n)) : null);

/** A tag as it is compared: lower case, without accents. "Weihnachten" and "weihnachten" are one tag. */
export const foldTag = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();

/** Tags as they are kept: trimmed, without "#", none twice (whatever the case), at most MAX_TAGS. */
export function cleanTags(tags: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = oneLine(raw, MAX_TAG + 1).replace(/^#+/, '').replace(/,+$/, '').trim().slice(0, MAX_TAG);
    const key = foldTag(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * A recipe as it is stored, from whatever was sent: text trimmed and cut to its limits, rows with nothing in them
 * dropped (an ingredient needs an item, a step words or a picture), groups left empty dropped, numbers whole and in range.
 */
export function cleanRecipe(r: {
  source?: unknown; servings?: unknown; prepMinutes?: unknown; cookMinutes?: unknown; groups?: unknown; steps?: unknown; notes?: unknown; tags?: unknown;
}): RecipeBody {
  const groups: IngredientGroup[] = [];
  let count = 0;
  for (const g of Array.isArray(r.groups) ? r.groups.slice(0, MAX_GROUPS * 2) : []) {
    const items: Ingredient[] = [];
    for (const i of Array.isArray(g?.items) ? g.items : []) {
      if (count >= MAX_INGREDIENTS) break;
      const item = oneLine(i?.item, MAX_ITEM);
      if (!item) continue;
      items.push({ amount: oneLine(i?.amount, MAX_AMOUNT), unit: oneLine(i?.unit, MAX_UNIT), item, note: oneLine(i?.note, MAX_NOTE) });
      count += 1;
    }
    if (items.length && groups.length < MAX_GROUPS) groups.push({ name: oneLine(g?.name, MAX_GROUP_NAME), items });
  }
  const steps: RecipeStep[] = [];
  let pictures = 0;
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (steps.length >= MAX_STEPS) break;
    const text = words(s?.text, MAX_STEP);
    let image = typeof s?.image === 'string' && s.image ? s.image : null;
    if (image && pictures >= MAX_STEP_IMAGES) image = null;
    if (!text && !image) continue;
    if (image) pictures += 1;
    steps.push({ text, image });
  }
  return {
    source: oneLine(r.source, MAX_SOURCE),
    servings: whole(r.servings, 1, MAX_SERVINGS),
    prepMinutes: whole(r.prepMinutes, 0, MAX_MINUTES),
    cookMinutes: whole(r.cookMinutes, 0, MAX_MINUTES),
    groups,
    steps,
    notes: words(r.notes, MAX_NOTES),
    tags: cleanTags(Array.isArray(r.tags) ? r.tags : []),
  };
}

/** Whether a recipe says how to make something: at least one ingredient or one step. A name alone is not a recipe. */
export const hasSubstance = (r: RecipeBody) => r.groups.some((g) => g.items.length > 0) || r.steps.length > 0;

// ---------- amounts ----------

const VULGAR: Record<string, number> = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
const VULGAR_CHARS = Object.keys(VULGAR).join('');
/** A point between groups of three figures is a thousands separator, as German writes it: "1.000" is a thousand, "1.000,5" a thousand and a half. */
const THOUSANDS = String.raw`[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?`;
const NUM = String.raw`(?:${THOUSANDS}|\d+(?:[.,]\d+)?)`;
/** The value of a figure NUM matched: "1.000" is 1000, "1,5" and "1.5" are 1.5. */
const figure = (text: string) => Number(new RegExp(`^${THOUSANDS}$`).test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(',', '.'));
/** One number as people write it: "2", "1,5", "1/2", "1 1/2", "½", "1½", "1 ½". */
const ONE = String.raw`(?:${NUM}\s*[${VULGAR_CHARS}]|${NUM}\s+\d+\s*/\s*\d+|\d+\s*/\s*\d+|[${VULGAR_CHARS}]|${NUM})`;
/** A number, or a range of two: "2-3", "2 – 3", "2 to 3", "2 bis 3", "2 tot 3". */
const AMOUNT = String.raw`${ONE}(?:\s*(?:[-–—]|to|bis|tot)\s*${ONE})?`;
const AMOUNT_ONLY = new RegExp(String.raw`^\s*(${ONE})(?:\s*([-–—]|to|bis|tot)\s*(${ONE}))?\s*$`, 'i');

/** The value of one written number, or null: "1 1/2" is 1.5, "¾" is 0.75, "1,5" is 1.5, "1.000" is 1000. */
export function numberOf(text: string): number | null {
  const s = text.trim();
  let m = new RegExp(String.raw`^(${NUM})\s*([${VULGAR_CHARS}])$`).exec(s);
  if (m) return figure(m[1]!) + VULGAR[m[2]!]!;
  m = new RegExp(String.raw`^(${NUM})\s+(\d+)\s*/\s*(\d+)$`).exec(s);
  if (m) return Number(m[3]) ? figure(m[1]!) + Number(m[2]) / Number(m[3]) : null;
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  if (s.length === 1 && VULGAR[s] !== undefined) return VULGAR[s]!;
  m = new RegExp(`^${NUM}$`).exec(s);
  return m ? figure(s) : null;
}

const FRACTIONS: [number, string][] = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];

/**
 * A number as a cook reads it. A small amount that is a kitchen fraction is written as one ("1½", "¾"), unless `decimal`
 * (the writer wrote "1,5", so they get "3" and "0,75" back, never a fraction they did not use). Anything else is rounded
 * to what a scale or a jug can show: three figures at most, and whole numbers from a hundred.
 */
export function formatAmount(n: number, locale = 'en', decimal = false): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (!decimal && n < 20) {
    const base = Math.floor(n + 1e-9);
    const rest = n - base;
    if (rest < 0.02 && base) return String(base);
    const hit = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.02);
    if (hit) return `${base || ''}${hit[1]}`;
  }
  const rounded = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  // Less than a hundredth keeps its first figure ("0.004"), so a tiny amount never comes back as nothing or nought.
  return new Intl.NumberFormat(locale, rounded ? { maximumFractionDigits: 2, useGrouping: false } : { maximumSignificantDigits: 1, useGrouping: false }).format(rounded || n);
}

/** A number of servings as typed into the box: "1,5" and "1.5" alike, more than none and at most 999; else null. */
export function parseServings(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 999 ? n : null;
}

/**
 * An amount for `factor` times the recipe: "1 1/2" at 2 is "3", "2-3" at ½ is "1–1½". Words that are not a number
 * ("a pinch", "some") come back as they are, and so does everything at a factor of 1: the writer's own spelling stands.
 */
export function scaleAmount(amount: string, factor: number, locale = 'en'): string {
  if (factor === 1 || !amount.trim()) return amount;
  const m = AMOUNT_ONLY.exec(amount);
  if (!m) return amount;
  const a = numberOf(m[1]!);
  const b = m[3] ? numberOf(m[3]) : null;
  if (a === null || (m[3] && b === null)) return amount;
  // A decimal comma or point is the writer's choice of decimals; a fraction or a whole number may come back as a fraction.
  const decimal = /\d[.,]\d/.test(amount);
  const one = formatAmount(a * factor, locale, decimal);
  return b === null ? one : `${one}–${formatAmount(b * factor, locale, decimal)}`;
}

/** The factor that turns a recipe for `base` servings into one for `wanted`. 1 when either is unknown. */
export const factorFor = (base: number | null, wanted: number | null) => (base && wanted && base > 0 && wanted > 0 ? wanted / base : 1);

// ---------- a pasted list ----------

// Units as people write them, in the languages the app has (the dictionary's recipes.unitWords: a list of words per
// language). Matched as a whole word after the amount, any case ("EL" and "el"), with an optional full stop ("Msp.", "tbsp.").
// The pattern covers the languages this page has, and is rebuilt when another arrives.
let lineFor: { version: number; line: RegExp } | undefined;
function lineRegExp(): RegExp {
  const version = tablesVersion();
  if (lineFor?.version === version) return lineFor.line;
  const units = namesInEveryLanguage('recipes.unitWords').flatMap((list) => list.split(',')).map((u) => u.trim()).filter(Boolean);
  // Longest first, so "tbsp" is not read as "t" and "eetlepels" not as "e".
  const unitWord = [...new Set(units)].sort((x, y) => y.length - x.length).map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // A unit is a whole word: "2 t sugar" has one, "2 tomatoes" has none.
  const line = new RegExp(String.raw`^(${AMOUNT})?\s*(?:(${unitWord})\.?(?=\s|$))?\s*(.*)$`, 'iu');
  lineFor = { version, line };
  return line;
}

/** A line that names a part of the list rather than something in it: "For the dough:", "## Sauce", "SAUCE". */
function headingOf(line: string): string | null {
  const hash = /^#{1,6}\s+(.+)$/.exec(line);
  if (hash) return hash[1]!.replace(/:$/, '').trim();
  const bold = /^(?:\*\*|__)(.+?)(?:\*\*|__):?$/.exec(line);
  if (bold) return bold[1]!.replace(/:$/, '').trim();
  if (/:$/.test(line) && !new RegExp(`^${AMOUNT}`, 'i').test(line)) return line.slice(0, -1).trim();
  return null;
}

/** One line as a row: "800 g Rindfleisch, gewürfelt" is 800, g, Rindfleisch, gewürfelt. A line of words alone is the item. */
export function parseIngredient(raw: string): Ingredient {
  // A list mark is not part of the line: "- ", "* ", "• ", "[ ] ", and "1. " or "1) " when something follows.
  const line = raw.replace(/\s+/g, ' ').trim().replace(/^(?:[-*•·▪◦‣–]|\[[ xX]?\])\s+/, '').replace(/^\d{1,2}[.)]\s+(?=\S)/, '');
  const m = lineRegExp().exec(line);
  let amount = (m?.[1] ?? '').trim();
  let unit = m?.[2] ?? '';
  let rest = (m?.[3] ?? line).trim();
  // Without a number before it, a short word is a word ("E" in a name), and only a longer one a unit ("Prise Salz").
  if (unit && !amount && unit.length <= 3) { rest = line; unit = ''; }
  // "2 cloves" names the thing by its unit.
  if (!rest && unit) { rest = unit; unit = ''; }
  // A number alone, or one too long to be an amount: the whole line is the item.
  if (!rest || amount.length > MAX_AMOUNT) return { amount: '', unit: '', item: line.slice(0, MAX_ITEM), note: '' };
  // What follows a comma, or stands in brackets at the end, is how to prepare it.
  let note = '';
  const paren = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(rest);
  if (paren && paren[1]!.trim()) { rest = paren[1]!.trim(); note = paren[2]!.trim(); }
  const comma = rest.indexOf(', ');
  if (comma > 0) { note = [rest.slice(comma + 2).trim(), note].filter(Boolean).join(', '); rest = rest.slice(0, comma).trim(); }
  return { amount: amount.replace(/\s+/g, ' '), unit: unit.slice(0, MAX_UNIT), item: rest.slice(0, MAX_ITEM), note: note.slice(0, MAX_NOTE) };
}

/**
 * A pasted list as groups of rows: one line a row, blank lines skipped, a line that ends in a colon (or is a Markdown
 * heading) the name of the group that follows.
 */
export function parseIngredientLines(text: string): IngredientGroup[] {
  const groups: IngredientGroup[] = [];
  let current: IngredientGroup | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const heading = headingOf(line);
    if (heading !== null) {
      current = { name: heading.slice(0, MAX_GROUP_NAME), items: [] };
      groups.push(current);
      continue;
    }
    if (!current) { current = { name: '', items: [] }; groups.push(current); }
    current.items.push(parseIngredient(line));
  }
  return groups.filter((g) => g.items.length > 0);
}

/** A pasted method as steps: one paragraph or line a step, without the numbers it came with ("1.", "2)", "Step 3:"). */
export function parseStepLines(text: string): string[] {
  const body = text.replace(/\r\n?/g, '\n').trim();
  // Paragraphs when the text has them; else its lines.
  const parts = /\n\s*\n/.test(body) ? body.split(/\n\s*\n/) : body.split('\n');
  return parts
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim().replace(/^(?:[-*•]\s+|\d{1,2}[.):]\s+|(?:step|schritt|stap)\s+\d{1,2}[.:)]?\s+)/i, '').trim())
    .filter(Boolean)
    .map((p) => p.slice(0, MAX_STEP));
}

// ---------- words ----------

/** One ingredient as a line of text, scaled: "1,6 kg beef, diced". */
export function ingredientLine(i: Ingredient, factor = 1, locale = 'en'): string {
  const lead = [scaleAmount(i.amount, factor, locale), i.unit, i.item].filter(Boolean).join(' ');
  return i.note ? `${lead}, ${i.note}` : lead;
}

/** Minutes as a cook says them: 20 is "20 min", 90 is "1 h 30 min", 120 is "2 h". The unit words are the same in all three languages. */
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** The words the written-out recipe needs, in one language. */
export interface RecipeWords { serves: (n: number) => string; prep: string; cook: string; ingredients: string; method: string; notes: string }

export const ENGLISH_WORDS: RecipeWords = { serves: (n) => `Serves ${n}`, prep: 'Preparation', cook: 'Cooking', ingredients: 'Ingredients', method: 'Method', notes: 'Notes' };

/**
 * The whole recipe as Markdown: a line of facts, the ingredients as a list (its groups in bold), the method numbered, and
 * the notes. This is the story's `body`, so the Chronicle's search, the assistant, a translation and the archive all read
 * the recipe; the picture is not in it. What the family typed is escaped where Markdown would read it as markup.
 */
export function recipeMarkdown(r: RecipeBody, w: RecipeWords = ENGLISH_WORDS): string {
  const esc = (s: string) => s.replace(/[\\`*_[\]<>]/g, '\\$&');
  const out: string[] = [];
  const facts = [
    r.source ? esc(r.source) : '',
    r.servings ? w.serves(r.servings) : '',
    r.prepMinutes !== null ? `${w.prep} ${minutesText(r.prepMinutes)}` : '',
    r.cookMinutes !== null ? `${w.cook} ${minutesText(r.cookMinutes)}` : '',
  ].filter(Boolean);
  if (facts.length) out.push(`*${facts.join(' · ')}*`, '');
  if (r.groups.length) {
    out.push(`**${w.ingredients}**`, '');
    for (const g of r.groups) {
      if (g.name) out.push(`*${esc(g.name)}*`, '');
      for (const i of g.items) out.push(`- ${esc(ingredientLine(i))}`);
      out.push('');
    }
  }
  if (r.steps.length) {
    out.push(`**${w.method}**`, '');
    r.steps.forEach((s, n) => out.push(`${n + 1}. ${esc(s.text).replace(/\n+/g, ' ')}`));
    out.push('');
  }
  if (r.notes) out.push(`**${w.notes}**`, '', r.notes, '');
  return out.join('\n').trim();
}

// ---------- pictures ----------

/** A recipe picture's key as the server makes it: recipe/<uuid>.<ext>. */
export const RECIPE_KEY = /^recipe\/[a-z0-9-]{1,80}\.(?:jpg|png|webp)$/;

/** Where a recipe's picture is fetched: /api/recipe/<tree>/<uuid>.<ext>, with ?size=thumb for a cover's small copy. */
export function recipeImageUrl(tree: string, key: string, size: 'full' | 'thumb' = 'full') {
  return `/api/recipe/${tree}/${key.replace(/^recipe\//, '')}${size === 'thumb' ? '?size=thumb' : ''}`;
}
