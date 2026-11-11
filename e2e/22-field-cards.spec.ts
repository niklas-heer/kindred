// Journey 22: the Edit tab's field cards fold to one line each, and only the one being edited is open. A new card opens by
// itself, a click elsewhere or Escape folds it, a tap or the keyboard opens it again, and one with something wrong in it
// stays open. The palette suggests people and pages as they are typed.
import type { Page } from '@playwright/test';
import { checkAxe, expect, openFamily, STEWARD, test } from './fixtures.ts';

const FULL = `${STEWARD.given} ${STEWARD.surname}`;
const box = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const status = (page: Page) => page.getByRole('group', { name: 'Saving' }).getByRole('status');

async function openEdit(page: Page) {
  await openFamily(page);
  await page.getByRole('button', { name: new RegExp(`^${FULL}`) }).nth(1).click();
  const more = page.getByRole('button', { name: /^More about / });
  if (await more.isVisible()) await more.click();
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(box(page, 'Called')).toBeVisible();
}

for (const [where, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
  test.describe(where, () => {
    test.use({ viewport });

    test(`only the card being edited is open (${where})`, async ({ page }) => {
      await openEdit(page);
      const kinds = page.getByRole('group', { name: 'Choose a kind of field' });

      // A new card opens with its box in focus.
      await kinds.getByRole('button', { name: 'Email', exact: true }).click();
      await expect(box(page, 'Email address')).toBeFocused();
      await box(page, 'Email address').fill(`fold-${where}@example.org`);
      await expect(status(page)).toHaveText('All saved');

      // Adding another folds the first to its line.
      await kinds.getByRole('button', { name: 'Notes', exact: true }).click();
      await expect(box(page, 'Email address')).toHaveCount(0);
      const email = page.getByRole('button', { name: new RegExp(`^Email.*fold-${where}@example\\.org`) });
      await expect(email).toHaveAttribute('aria-expanded', 'false');
      await checkAxe(page, `edit tab, folded cards (${where})`);

      // Escape folds the open card and leaves the focus on its line.
      await page.getByRole('textbox', { name: 'Text', exact: true }).fill(`Folded on ${where}`);
      await page.getByRole('textbox', { name: 'Text', exact: true }).press('Escape');
      const notes = page.getByRole('button', { name: new RegExp(`^Notes.*Folded on ${where}`) });
      await expect(notes).toBeFocused();
      await expect(status(page)).toHaveText('All saved');

      // The keyboard opens a card again, and its first box takes the focus.
      await email.focus();
      await email.press('Enter');
      await expect(box(page, 'Email address')).toBeFocused();
      await expect(page.getByRole('button', { name: 'Close Email' })).toHaveAttribute('aria-expanded', 'true');

      // A click elsewhere in the form folds it.
      await page.locator('.pe .rule').first().click();
      await expect(box(page, 'Email address')).toHaveCount(0);

      // A card with something wrong in it stays open while another is opened.
      await email.click();
      await box(page, 'Email address').fill('half@');
      await notes.click();
      await expect(box(page, 'Email address')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeVisible();
      await box(page, 'Email address').fill(`fold-${where}@example.org`);
      await expect(status(page)).toHaveText('All saved');
    });
  });
}

test('an empty address card offers the finder first and the boxes on request', async ({ page }) => {
  await openEdit(page);
  await page.getByRole('group', { name: 'Choose a kind of field' }).getByRole('button', { name: 'Address', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Find an address' })).toBeFocused();
  await expect(box(page, 'Street')).toHaveCount(0);
  // This server has the online lookup off, so the box says nothing about OpenStreetMap.
  await expect(page.getByText(/looked up on OpenStreetMap/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Type the parts in by hand' }).click();
  await box(page, 'Street').fill('Example Lane 3');
  await box(page, 'Town or city').fill('Sampleton');
  await expect(status(page)).toHaveText('All saved');
  await page.locator('.pe .rule').first().click();
  await expect(page.getByRole('button', { name: /^Address.*Example Lane 3, Sampleton/ })).toBeVisible();
});

test('the palette suggests people and pages as a name is typed', async ({ page }) => {
  await openFamily(page);
  await page.keyboard.press('ControlOrMeta+k');
  const find = page.getByRole('combobox', { name: 'Find anyone' });
  await find.fill(STEWARD.surname.toLowerCase().slice(0, 4));
  await expect(page.getByRole('option', { name: new RegExp(FULL) }).first()).toBeVisible();
  await find.fill('atlas');
  await expect(page.getByRole('option', { name: /Atlas/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
});
