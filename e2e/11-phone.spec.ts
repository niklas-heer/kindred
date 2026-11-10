// Journey 11: the phone. At 390 x 844 the main screens keep their primary button on the screen and pass axe. The cases
// are the ones that once broke: the upload dialog pushed its button off the bottom, and the memory form ran wider than
// its card.
import { expect, openFamily, settled, STEWARD, test, checkAxe } from './fixtures.ts';
import type { Locator, Page } from '@playwright/test';

// A 1 x 1 PNG: the upload dialog only needs something it can decode.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

/** Whether the element lies wholly inside the screen. */
async function insideScreen(page: Page, el: Locator, what: string) {
  const box = await el.boundingBox();
  const view = page.viewportSize()!;
  expect(box, `${what} is laid out`).not.toBeNull();
  expect(box!.x, `${what}: left edge`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${what}: top edge`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what}: right edge`).toBeLessThanOrEqual(view.width);
  expect(box!.y + box!.height, `${what}: bottom edge`).toBeLessThanOrEqual(view.height);
}

test('on a phone the tree, a person, the memory form and the upload dialog fit the screen', async ({ page }) => {
  const tree = await openFamily(page);
  // The register is a table at desktop width; take the person's address from it, then go to the phone.
  await page.goto(`/${tree}/people`);
  await settled(page);
  const href = await page.locator('.reg-name a').filter({ hasText: STEWARD.given }).first().getAttribute('href');
  await page.setViewportSize({ width: 390, height: 844 });

  // The tree: one main landmark, one h1, the skip link first in the tab order, the tab bar on the screen.
  await page.goto(`/${tree}`);
  await settled(page);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await insideScreen(page, page.locator('.tabbar'), 'tab bar');
  await checkAxe(page, 'tree (phone)');

  // A person.
  await page.goto(href!);
  await settled(page);
  await insideScreen(page, page.getByRole('button', { name: 'Show in tree' }).or(page.getByRole('link', { name: 'Show in tree' })).first(), 'person: main action');
  await checkAxe(page, 'person (phone)');

  // The memory form: its Save button, and nothing wider than the screen.
  await page.getByRole('tab', { name: /Stories/ }).click();
  await page.getByRole('button', { name: /Add a memory/ }).click();
  await page.locator('.story-form textarea').fill('A short memory.');
  const save = page.locator('.story-form button.btn.primary');
  await save.scrollIntoViewIfNeeded();
  await insideScreen(page, save, 'memory form: Save');
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll').toBeLessThanOrEqual(390);
  await checkAxe(page, 'add a memory (phone)');

  // The upload dialog with three photographs: the footer button must still be on the screen.
  await page.goto(`/${tree}/gallery`);
  await settled(page);
  await page.getByRole('button', { name: 'Add photos' }).first().click();
  await page.locator('input[type=file]').setInputFiles(['one.png', 'two.png', 'three.png'].map((name) => ({ name, mimeType: 'image/png', buffer: PNG })));
  await expect(page.locator('.gal-item')).toHaveCount(3);
  await insideScreen(page, page.locator('.gal-upload-foot .btn.primary'), 'upload dialog: submit');
  await checkAxe(page, 'upload dialog (phone)');
});
