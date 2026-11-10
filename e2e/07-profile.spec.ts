// Journey 7: a name leads to the person's own page, a drawn portrait opens the character editor for a steward, the tree is
// one click away, and a guest sees what a viewer may, the picture large included.
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

test('profile: from the Register, the character editor, back to the tree, and as a guest with a large picture', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);

  await page.goto(`/${tree}/people`);
  await settled(page);
  const link = page.locator('.reg-name a').filter({ hasText: STEWARD.given }).first();
  const href = await link.getAttribute('href');
  expect(href).toMatch(new RegExp(`^/${tree}/person/[^/]+$`));
  await link.click();
  await page.waitForURL(`**${href}`);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${STEWARD.given} ${STEWARD.surname}`) })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await checkAxe(page, 'profile');

  // The address is a real one: it works on its own. For a steward a drawn portrait opens the character editor (journey 21
  // goes through it); closed with Escape, nothing was changed and the page is where it was.
  await page.goto(href!);
  await settled(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('.pp-head').getByRole('button', { name: new RegExp(`^Change how ${STEWARD.given}`) }).first().click();
  const editor = page.getByRole('dialog', { name: new RegExp(`^Appearance of ${STEWARD.given}`) });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${href}$`));

  await page.getByRole('button', { name: 'Show in tree' }).click();
  await page.waitForURL(new RegExp(`/${tree}\\?focus=`));
  // The tree keeps its side panel, with a way back into the profile.
  await expect(page.getByRole('complementary').getByRole('link', { name: 'Full profile' })).toHaveAttribute('href', href!);

  await page.goto(`/${tree}/person/nobody-here`);
  await settled(page);
  await expect(page.getByText('Page not found')).toBeVisible();

  // A guest may open it as a viewer may: no tools to change anything.
  await page.goto(`/${tree}/access`);
  await settled(page);
  // Journey 5 may have made one already; then this replaces it.
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();

  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(visit);
  const guest = await visit.newPage();
  await guest.goto(url);
  await settled(guest);
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await settled(guest);
  await guest.goto(href!);
  await settled(guest);
  await expect(guest.getByRole('heading', { level: 1, name: new RegExp(`^${STEWARD.given} ${STEWARD.surname}`) })).toBeVisible();
  await expect(guest.getByRole('tab', { name: 'Edit' })).toHaveCount(0);
  await expect(guest.locator('button.pp-photo')).toHaveCount(0);
  await checkAxe(guest, 'profile as guest');
  // A guest has no editor: a click on the picture opens it large, and Escape closes it.
  await expect(guest.getByRole('button', { name: /^Change how|^Try a new look/ })).toHaveCount(0);
  await guest.getByRole('button', { name: /Show the picture of .* large/ }).first().click();
  const large = guest.locator('.lb-picture');
  await expect(large.locator('img')).toBeVisible();
  await checkAxe(guest, 'profile picture');
  await guest.keyboard.press('Escape');
  await expect(large).toHaveCount(0);
  await expect(guest).toHaveURL(new RegExp(`${href}$`));
  await visit.close();
});
