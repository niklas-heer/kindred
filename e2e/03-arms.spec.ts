// Journey 3: design a coat of arms, take a suggestion from the name, and seal it.
import { checkAxe, expect, openFamily, settled, setTheme, test } from './fixtures.ts';

test('arms: design, suggestion, seal', async ({ page }) => {
  const tree = await openFamily(page);
  await page.goto(`/${tree}/houses`);
  await settled(page);
  await checkAxe(page, 'houses, empty');
  await page.getByRole('button', { name: 'New house' }).first().click();
  const made = page.getByRole('dialog', { name: 'A new house' });
  await made.getByRole('textbox', { name: 'Name', exact: true }).fill('Armsby');
  await made.getByRole('button', { name: /Create/ }).click();
  await page.waitForURL(/\/house\//);
  await settled(page);
  await checkAxe(page, 'house');

  await page.getByRole('button', { name: 'Edit arms' }).click();
  const designer = page.getByRole('dialog', { name: 'Coat of arms' });
  for (const theme of ['codex', 'modern', 'night'] as const) {
    await setTheme(page, theme);
    await checkAxe(page, `arms designer (${theme})`);
  }
  await setTheme(page, 'codex');

  await designer.getByRole('radiogroup', { name: 'Field tincture' }).getByRole('radio', { name: 'Gules (red)' }).click();
  await expect(designer.getByRole('region', { name: 'Preview' })).toContainText('Gules');

  await designer.getByRole('tab', { name: 'Suggest from the name' }).click();
  await designer.getByRole('textbox', { name: 'Name to read' }).fill('Armsby');
  await designer.getByRole('tabpanel', { name: 'Suggest from the name' }).getByRole('button', { name: /^Armsby:/ }).first().click();
  const shield = designer.getByRole('region', { name: 'Preview' }).getByRole('img').first();
  await expect(shield).not.toHaveAttribute('aria-label', /: Gules$/);
  const sealed = (await shield.getAttribute('aria-label'))!;

  await designer.getByRole('button', { name: 'Seal the arms' }).click();
  await expect(designer).toBeHidden();
  await expect(page.getByText('Arms sealed')).toBeVisible();

  await page.reload();
  await settled(page);
  await page.getByRole('button', { name: 'Edit arms' }).click();
  await expect(page.getByRole('dialog', { name: 'Coat of arms' }).getByRole('region', { name: 'Preview' }).getByRole('img', { name: sealed, exact: true })).toBeVisible();
});
