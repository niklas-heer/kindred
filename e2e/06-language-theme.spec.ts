// Journey 6: switching language and theme, each of which has to survive a reload without a hydration mismatch.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('switching language and theme', async ({ page }) => {
  await openFamily(page);
  const html = page.locator('html');
  const nav = page.getByRole('banner').first();

  const language = async (from: string, to: string, tree: string, lang: string) => {
    await page.getByRole('combobox', { name: new RegExp(`: ${from}$`) }).click();
    await page.getByRole('option', { name: to }).click();
    await expect(nav.getByRole('link', { name: tree, exact: true })).toBeVisible();
    await expect(html).toHaveAttribute('lang', lang);
    await page.reload();
    await settled(page);
    await expect(nav.getByRole('link', { name: tree, exact: true })).toBeVisible();
    await expect(html).toHaveAttribute('lang', lang);
  };
  await language('English', 'Deutsch', 'Stammbaum', 'de');
  await checkAxe(page, 'tree (de)');
  await language('Deutsch', 'Afrikaans', 'Stamboom', 'af');
  await checkAxe(page, 'tree (af)');
  await language('Afrikaans', 'English', 'Tree', 'en');

  await expect(html).toHaveAttribute('data-theme', 'codex');
  await checkAxe(page, 'tree with person panel (codex)');
  // At this width the top bar has no room for the theme button: the choice is in the account menu.
  for (const [to, theme] of [['Paper', 'modern'], ['Night', 'night'], ['Codex', 'codex']] as const) {
    await page.locator('.acct-trigger').click();
    await page.getByRole('menuitemradio', { name: to }).click();
    await page.keyboard.press('Escape');
    await expect(html).toHaveAttribute('data-theme', theme);
    await page.reload();
    await settled(page);
    await expect(html).toHaveAttribute('data-theme', theme);
    if (theme !== 'codex') await checkAxe(page, `tree with person panel (${theme})`);
  }
});
