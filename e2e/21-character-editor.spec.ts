// Journey 21: the character editor. Open a person's drawn portrait, change parts with the pointer and with the keyboard,
// use "Surprise me" and take it back, compare with before, save, and see the new portrait on the tree while a relative's
// stays as it was.
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const FULL = `${STEWARD.given} ${STEWARD.surname}`;
const CHILD = 'Cleo';

test('a look is changed in the character editor, saved, and shown on the tree', async ({ page }) => {
  await openFamily(page);

  // A relative, so there is someone whose portrait must not change.
  await page.getByRole('button', { name: `Add a child of ${FULL}` }).click();
  const add = page.getByRole('dialog', { name: `Add a child of ${FULL}` });
  await add.getByLabel('Given name').fill(CHILD);
  await add.getByRole('button', { name: /Create new/ }).last().click();
  await expect(add).toBeHidden();

  const onTree = (name: string) => page.locator('.card', { hasText: name }).first().locator('img.portrait-img');
  await expect(onTree(CHILD)).toBeVisible();
  const before = { steward: await onTree(FULL).getAttribute('src'), child: await onTree(CHILD).getAttribute('src') };

  // The drawn portrait in the panel opens the editor.
  await page.locator('.card', { hasText: FULL }).first().locator('.card-hit').click();
  await expect(page.getByRole('heading', { name: FULL, level: 2, exact: true })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^Change how ${STEWARD.given}`) }).click();
  const editor = page.getByRole('dialog', { name: `Appearance of ${STEWARD.given}` });
  await expect(editor).toBeVisible();
  const hero = editor.locator('.ce-hero img');
  const start = await hero.getAttribute('src');
  const save = editor.getByRole('button', { name: 'Save appearance' });
  await expect(save).toBeDisabled();
  await checkAxe(page, 'character editor');

  // With the pointer: a hair style. The choice is pressed, and the large portrait is another drawing. (A beehive, because
  // the automatic choice never makes one: a style it does make could be the one the steward already has.)
  await editor.getByRole('tab', { name: 'Hair', exact: true }).click();
  const beehive = editor.getByRole('button', { name: 'Beehive', exact: true });
  await beehive.click();
  await expect(beehive).toHaveAttribute('aria-pressed', 'true');
  await expect(hero).not.toHaveAttribute('src', start!);
  await expect(save).toBeEnabled();

  // With the keyboard: along the categories with the arrow keys, an eye colour with Enter, a measure with the arrows.
  await editor.getByRole('tab', { name: 'Hair', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(editor.getByRole('tab', { name: 'Eyes', exact: true })).toHaveAttribute('aria-selected', 'true');
  const green = editor.getByRole('button', { name: 'Green', exact: true });
  await green.focus();
  await page.keyboard.press('Enter');
  await expect(green).toHaveAttribute('aria-pressed', 'true');
  const size = editor.getByRole('slider', { name: 'Eye size' });
  const sizeBefore = Number(await size.inputValue());
  await size.focus();
  await page.keyboard.press(sizeBefore < 10 ? 'ArrowRight' : 'ArrowLeft');
  await expect(size).not.toHaveValue(String(sizeBefore));
  // Undo from the keyboard takes the measure back and leaves the eye colour.
  await green.focus();
  await page.keyboard.press('Control+z');
  await expect(size).toHaveValue(String(sizeBefore));
  await expect(green).toHaveAttribute('aria-pressed', 'true');
  const chosen = await hero.getAttribute('src');

  // "Surprise me" is one step: Undo brings back exactly what was chosen, Redo the surprise.
  await editor.getByRole('button', { name: 'Surprise me' }).click();
  await expect(hero).not.toHaveAttribute('src', chosen!);
  const surprised = await hero.getAttribute('src');
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(hero).toHaveAttribute('src', chosen!);
  await editor.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(hero).toHaveAttribute('src', surprised!);
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();

  // Compare shows how it was, without losing what is being made.
  const compare = editor.getByRole('button', { name: 'Compare with before' });
  await compare.click();
  await expect(editor.getByText('Before', { exact: true })).toBeVisible();
  await expect(hero).toHaveAttribute('src', start!);
  await compare.click();
  await expect(hero).toHaveAttribute('src', chosen!);

  // A ready-made look changes what is worn; the eye colour chosen above stays.
  await editor.getByRole('tab', { name: 'Looks', exact: true }).click();
  await editor.getByRole('button', { name: 'By the sea', exact: true }).click();
  await editor.getByRole('tab', { name: 'Eyes', exact: true }).click();
  await expect(green).toHaveAttribute('aria-pressed', 'true');

  await save.click();
  await expect(editor).toBeHidden();

  // The tree shows the new portrait for the steward, and the child's is the drawing it was.
  await expect(onTree(FULL)).not.toHaveAttribute('src', before.steward!);
  await expect(onTree(CHILD)).toHaveAttribute('src', before.child!);

  // It is still there after a reload, and the editor opens on what was saved.
  await page.reload();
  await settled(page);
  await page.locator('.card', { hasText: FULL }).first().locator('.card-hit').click();
  await page.getByRole('button', { name: new RegExp(`^Change how ${STEWARD.given}`) }).click();
  await editor.getByRole('tab', { name: 'Eyes', exact: true }).click();
  await expect(green).toHaveAttribute('aria-pressed', 'true');
  await editor.getByRole('tab', { name: 'Extras', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Sea', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Nothing was changed this time, so it closes without a question.
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
});
