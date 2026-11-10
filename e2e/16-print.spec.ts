// Journey 16: printing. From a person to the Print page, a chart on one sheet, the print layout (only the paper, at the
// paper's size, light whatever the theme), and a family book whose PDF has as many pages as the preview has sheets.
import { checkAxe, expect, openFamily, setTheme, settled, STEWARD, test } from './fixtures.ts';

const FULL = `${STEWARD.given} ${STEWARD.surname}`;
/** Pages in a PDF, by its page objects. */
const pdfPages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const MM = 96 / 25.4;

test('a chart and a family book, as the printer gets them', async ({ page }) => {
  await openFamily(page);
  await page.getByRole('link', { name: `Print a chart or a book for ${FULL}` }).click();
  await page.waitForURL(/\/print\?/);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Print', level: 1 })).toBeVisible();

  // The ancestor chart is the first thing offered: one landscape sheet, with the person on it.
  const doc = page.locator('.pr-doc');
  const sheets = doc.locator('.pr-sheet');
  await expect(doc).toHaveAttribute('data-ready', 'true');
  await expect(sheets).toHaveCount(1);
  await expect(sheets.first().getByRole('heading', { name: `Ancestors of ${FULL}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print 1 page' })).toBeEnabled();
  await checkAxe(page, 'print, ancestor chart');

  // Choose the descendant chart, upright on Letter paper.
  await page.getByRole('combobox', { name: 'Product' }).click();
  await page.getByRole('option', { name: 'Descendant chart' }).click();
  await expect(sheets.first().getByRole('heading', { name: `Descendants of ${FULL}` })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Paper' }).getByRole('radio', { name: 'Letter' }).click();
  await expect(page).toHaveURL(/paper=letter/);

  // The print layout: the app around the paper is gone, the sheet has the paper's own size and is white in the dark theme too.
  await setTheme(page, 'night');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('banner')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Print/ })).toBeHidden();
  const box = (await sheets.first().boundingBox())!;
  expect(Math.abs(box.width - 215.9 * MM)).toBeLessThan(1.5);
  expect(Math.abs(box.height - 279.4 * MM)).toBeLessThan(1.5);
  expect(box.x).toBeLessThan(1);
  expect(await sheets.first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }))).toBe(1);
  await page.emulateMedia({ media: null });
  await setTheme(page, 'codex');

  // The family book of this one person: a cover, the contents, their pages and the register of names.
  await page.getByRole('combobox', { name: 'Product' }).click();
  await page.getByRole('option', { name: 'Family book' }).click();
  await expect(doc).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('status').filter({ hasText: /1 person on \d+ pages/ })).toBeVisible();
  const count = await sheets.count();
  expect(count).toBeGreaterThan(2);
  await expect(sheets.first()).toContainText('Testerby');
  await expect(sheets.first()).toContainText('Living people are shown by name only.');
  await expect(sheets.last()).toContainText('Register of names');
  // The register sends the reader to the page the person is on.
  await expect(sheets.last().locator('.pr-rel').filter({ hasText: `${STEWARD.surname}, ${STEWARD.given}` }).locator('.pr-pageref')).toHaveText('3');
  await expect(page.getByRole('button', { name: `Print ${count} pages` })).toBeEnabled();
  await checkAxe(page, 'print, family book');

  // Nothing is laid outside its page, and the PDF has one page for each sheet of the preview.
  expect(await page.evaluate(() => [...document.querySelectorAll('.pr-body')].filter((b) => b.scrollHeight - b.clientHeight > 1).length)).toBe(0);
  await page.emulateMedia({ media: 'print' });
  expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }))).toBe(count);
  await page.emulateMedia({ media: null });

  // With the living in full, the colophon says so.
  await page.getByRole('switch', { name: 'Living people in full' }).click();
  await expect(doc).toHaveAttribute('data-ready', 'true');
  await expect(sheets.first()).toContainText('Living people are shown in full.');
});
