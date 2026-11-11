// Journey 23: recipes. The steward writes a goulash in the Cookbook: a whole line typed into a row sorts itself, a pasted
// list becomes rows with a part of its own, and a picture goes with it. The recipe has its own page: the amounts double,
// a tick survives a reload, cooking mode walks through the steps, and the picture is the recipe's, not the Gallery's.
// It is in the Chronicle and on Today as a recipe; the composer's "Recipe" opens the same form; it can be changed, found
// by tag and by ingredient, removed and brought back with its picture. The page is checked at 390 px too.
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const ME = `${STEWARD.given} ${STEWARD.surname}`;
// An earlier journey (08) may have given the steward an epithet, which follows the name: "Ada Testerby the Merged".
const MINE = `${ME}(?: [^,]+?)?`;

test('recipes: write one with a picture, scale it, cook from it, find it, change it, remove it and undo', async ({ page, issues }) => {
  test.setTimeout(180_000);
  const tree = await openFamily(page);

  // ---------- the Cookbook, from the Chronicle ----------
  await page.goto(`/${tree}/chronicle`);
  await settled(page);
  await page.getByRole('link', { name: 'Cookbook' }).click();
  await page.waitForURL(new RegExp(`/${tree}/cookbook$`));
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Cookbook', level: 1 })).toBeVisible();
  await checkAxe(page, 'cookbook');

  // ---------- writing a recipe ----------
  await page.getByRole('button', { name: /^(Add a recipe|Write down the first recipe)$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'A new recipe' });
  await expect(form.getByLabel('What is it called?')).toBeFocused();
  // It is the writer's own unless they say otherwise.
  await expect(form.getByText(new RegExp(`^${MINE}$`))).toBeVisible();
  // Nothing in it yet: it says what is missing, and keeps the form.
  await form.getByRole('button', { name: 'Save the recipe' }).click();
  await expect(form.getByRole('alert')).toHaveText('Give the recipe a name first.');

  await form.getByLabel('What is it called?').fill('Goulash');
  await form.getByLabel('Where it comes from (optional)').fill('Oma Hilde’s');
  await form.getByRole('textbox', { name: 'Servings' }).fill('4');
  await form.getByLabel('Cooking: hours').fill('2');
  await form.getByLabel('Cooking: minutes').fill('30');

  // A whole line typed into the first box sorts itself, and Enter starts the next row.
  await form.getByLabel('Amount, row 1').fill('800 g beef, diced');
  await form.getByLabel('Amount, row 1').press('Enter');
  await expect(form.getByLabel('Amount, row 1')).toHaveValue('800');
  await expect(form.getByLabel('Unit, row 1')).toHaveValue('g');
  await expect(form.getByLabel('Ingredient, row 1')).toHaveValue('beef');
  await expect(form.getByLabel('How to prepare it, row 1')).toHaveValue('diced');
  await expect(form.getByLabel('Amount, row 2')).toBeFocused();
  // A pasted list becomes rows, and its heading a part of the list.
  await form.getByRole('button', { name: 'Paste a list' }).click();
  await form.getByRole('textbox', { name: 'Paste a list' }).fill('3 onions, sliced\n2 tbsp paprika\n\nTo serve:\n4 tbsp soured cream');
  await form.getByRole('button', { name: 'Make rows of it' }).click();
  await expect(form.getByLabel('Ingredient, row 2')).toHaveValue('onions');
  await expect(form.getByLabel('Unit, row 3')).toHaveValue('tbsp');
  await expect(form.getByLabel('Name of part 2 of the list')).toHaveValue('To serve');

  await form.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Brown the beef in batches.');
  await form.getByRole('button', { name: 'Add a step' }).click();
  await form.getByRole('textbox', { name: 'Step 2', exact: true }).fill('Add the onions and the paprika, and simmer for two hours.');
  await form.getByRole('textbox', { name: 'Notes', exact: true }).fill('Better the next day.');
  await form.getByRole('textbox', { name: 'Add a tag' }).fill('stew');
  await form.getByRole('textbox', { name: 'Add a tag' }).press('Enter');
  await expect(form.getByRole('button', { name: 'Remove the tag stew' })).toBeVisible();
  // The picture of the dish: the first file box of the form.
  await form.locator('input[type=file]').first().setInputFiles({ name: 'goulash.png', mimeType: 'image/png', buffer: PNG });
  await expect(form.getByRole('img', { name: 'The picture of the dish' })).toBeVisible();
  await checkAxe(page, 'cookbook, the recipe form');

  await form.getByRole('button', { name: 'Save the recipe' }).click();
  await page.waitForURL(new RegExp(`/${tree}/recipe/[0-9a-f-]+$`));
  await settled(page);
  const recipeUrl = page.url();

  // ---------- its own page ----------
  await expect(page.getByRole('heading', { name: 'Goulash', level: 1 })).toBeVisible();
  await expect(page.getByText('Oma Hilde’s')).toBeVisible();
  await expect(page.getByText('From the kitchen of')).toContainText(ME);
  const cover = page.getByRole('img', { name: 'Goulash, the finished dish' });
  await expect(cover).toBeVisible();
  const coverSrc = (await cover.getAttribute('src'))!;
  expect(coverSrc).toMatch(new RegExp(`^/api/recipe/${tree}/[0-9a-f-]+\\.jpg$`));
  const list = page.getByRole('region', { name: 'Ingredients' });
  await expect(list.getByText('800 g', { exact: true })).toBeVisible();
  await expect(list.getByRole('heading', { name: 'To serve' })).toBeVisible();
  await checkAxe(page, 'recipe');

  // Twice as much: the amounts follow, and so does the number of servings.
  await list.getByRole('button', { name: '2×' }).click();
  await expect(list.getByText('1600 g', { exact: true })).toBeVisible();
  await expect(list.getByText('8 tbsp', { exact: true })).toBeVisible();
  await expect(list.getByRole('textbox', { name: 'Servings' })).toHaveValue('8');
  await list.getByRole('button', { name: 'One serving fewer' }).click();
  await expect(list.getByText('1400 g', { exact: true })).toBeVisible();
  await list.getByRole('button', { name: '1×' }).click();
  await expect(list.getByText('800 g', { exact: true })).toBeVisible();

  // A tick is kept in this browser: it is still there after a reload.
  await list.getByRole('checkbox', { name: /beef/ }).check();
  await page.reload();
  await settled(page);
  await expect(page.getByRole('region', { name: 'Ingredients' }).getByRole('checkbox', { name: /beef/ })).toBeChecked();

  // ---------- cooking mode ----------
  await page.getByRole('button', { name: 'Start cooking' }).click();
  const cooking = page.getByRole('dialog', { name: 'Cooking: Goulash' });
  await expect(cooking.getByRole('heading', { name: 'Get everything ready' })).toBeVisible();
  // The tick made on the page is here too.
  await expect(cooking.getByRole('checkbox', { name: /beef/ })).toBeChecked();
  await checkAxe(page, 'recipe, cooking mode');
  await cooking.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(cooking.getByText('Step 1 of 2')).toBeVisible();
  await expect(cooking.getByText('Brown the beef in batches.')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(cooking.getByText('Step 2 of 2')).toBeVisible();
  await expect(cooking.getByText('That was the last step. Enjoy!')).toBeVisible();
  // The ingredients are one press away at every step.
  await cooking.getByRole('button', { name: 'Ingredients' }).click();
  await expect(cooking.getByRole('checkbox', { name: /onions/ })).toBeVisible();
  await cooking.getByRole('button', { name: 'Back' }).click();
  await cooking.getByRole('button', { name: 'Done' }).click();
  await expect(cooking).toBeHidden();

  // ---------- the picture is the recipe's, not the Gallery's ----------
  const file = coverSrc.split('/').pop()!;
  issues.allow(/Failed to load resource: the server responded with a status of 404/);
  expect((await page.request.get(coverSrc)).status(), 'the recipe serves its picture').toBe(200);
  expect((await page.request.get(`/api/media/${tree}/${file}`)).status(), 'the gallery does not').toBe(404);
  await page.goto(`/${tree}/gallery`);
  await settled(page);
  await expect(page.locator(`img[src*="${file.replace(/\.jpg$/, '')}"]`)).toHaveCount(0);

  // ---------- in the Chronicle and on Today, as a recipe ----------
  await page.goto(`/${tree}/chronicle`);
  await settled(page);
  const entry = page.locator('.chr-item').filter({ hasText: 'Goulash' });
  await expect(entry.getByText(new RegExp(`${MINE} shared a recipe from`))).toBeVisible();
  await expect(entry.getByText('Serves 4')).toBeVisible();
  await expect(entry.getByRole('link', { name: 'Open the recipe', exact: true })).toHaveAttribute('href', new URL(recipeUrl).pathname);
  await checkAxe(page, 'chronicle, with a recipe');
  await page.goto(`/${tree}/today`);
  await settled(page);
  await expect(page.getByRole('region', { name: 'From the family' }).locator('.chr-item').filter({ hasText: 'Goulash' }).getByRole('link', { name: 'Open the recipe', exact: true })).toBeVisible();

  // The composer's "Recipe" opens the same form, for the person chosen.
  await page.goto(`/${tree}/chronicle`);
  await settled(page);
  await page.getByRole('button', { name: 'Add a memory' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add a memory' });
  await add.getByRole('searchbox', { name: 'Who is it about?' }).fill(STEWARD.given);
  await add.getByRole('list', { name: 'Who is it about?' }).getByRole('button', { name: ME }).click();
  await add.getByRole('button', { name: 'Recipe', exact: true }).click();
  await expect(add.getByLabel('What is it called?')).toBeVisible();
  await expect(add.getByLabel('Amount, row 1')).toBeVisible();
  await add.getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toBeHidden();

  // ---------- changing it ----------
  await page.goto(recipeUrl);
  await settled(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit the recipe' });
  await expect(edit.getByLabel('Ingredient, row 1')).toHaveValue('beef');
  await edit.getByLabel('What is it called?').fill('Sunday goulash');
  await edit.getByRole('textbox', { name: 'Add a tag' }).fill('Sunday');
  await edit.getByRole('button', { name: 'Save the changes' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Sunday goulash', level: 1 })).toBeVisible();
  // The picture stayed.
  await expect(page.getByRole('img', { name: 'Sunday goulash, the finished dish' })).toHaveAttribute('src', coverSrc);

  // ---------- finding it ----------
  await page.getByRole('list', { name: 'Tags' }).getByRole('link', { name: 'Sunday' }).click();
  await page.waitForURL(/\/cookbook\?tag=Sunday$/);
  await settled(page);
  await expect(page.getByRole('button', { name: /^Sunday/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: '1 recipe fits' })).toBeVisible();
  const card = page.getByRole('link', { name: /Sunday goulash/ });
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('searchbox', { name: 'Search recipes and ingredients…' }).fill('paprika');
  await expect(card).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search recipes and ingredients…' }).fill('rhubarb zzz');
  await expect(page.getByText('Nothing matches')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(card).toBeVisible();

  // ---------- on a phone ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(recipeUrl);
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await checkAxe(page, 'recipe (390 px)');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit the recipe' }).getByLabel('Ingredient, row 1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the form fits at 390 px').toBe(true);
  await checkAxe(page, 'recipe form (390 px)');
  await page.getByRole('dialog', { name: 'Edit the recipe' }).getByRole('button', { name: 'Cancel' }).click();
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---------- removing it, and Undo ----------
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog', { name: 'Remove this recipe?' }).getByRole('button', { name: 'Remove the recipe' }).click();
  await page.waitForURL(new RegExp(`/${tree}/cookbook$`));
  await expect(page.getByRole('link', { name: /Sunday goulash/ })).toHaveCount(0);
  // Its picture is served to nobody while it is gone.
  expect((await page.request.get(coverSrc)).status()).toBe(404);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForURL(recipeUrl);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Sunday goulash', level: 1 })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Sunday goulash, the finished dish' })).toBeVisible();
  expect((await page.request.get(coverSrc)).status(), 'the picture is back with it').toBe(200);
});
