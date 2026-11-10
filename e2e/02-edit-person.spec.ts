// Journey 2: add a partner with a date, edit a person's details, and check that it all survives a reload.
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const FULL = `${STEWARD.given} ${STEWARD.surname}`;
const PARTNER = 'Bram Partnerson';

test('editing a person, with a partnership and a date', async ({ page }) => {
  await openFamily(page);

  await page.getByRole('button', { name: `Add a partner of ${FULL}` }).click();
  const add = page.getByRole('dialog', { name: `Add a partner of ${FULL}` });
  await checkAxe(page, 'add a partner');
  await add.getByLabel('Given name').fill('Bram');
  await add.getByLabel('Surname at birth').fill('Partnerson');
  await add.getByRole('radiogroup', { name: 'Start date (optional)' }).getByRole('radio', { name: 'Year only' }).click();
  await add.getByRole('group', { name: 'Start date (optional)' }).getByRole('textbox', { name: 'Year' }).fill('1975');
  await add.getByRole('button', { name: /Create new/ }).last().click();
  await expect(add).toBeHidden();
  await expect(page.getByRole('button', { name: new RegExp(`^${PARTNER}`) }).first()).toBeVisible();

  // Back to the steward, and edit them.
  await page.getByRole('button', { name: new RegExp(`^${FULL}`) }).nth(1).click();
  await expect(page.getByRole('heading', { name: FULL, level: 2, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Edit' }).click();
  await checkAxe(page, 'person panel, editing');
  await page.getByRole('textbox', { name: 'Epithet' }).fill('the Careful');
  const born = page.getByRole('group', { name: 'Born' });
  await born.getByRole('textbox', { name: 'Day' }).fill('12');
  await born.getByRole('combobox', { name: 'Month' }).click();
  await page.getByRole('option', { name: 'March' }).click();
  await born.getByRole('textbox', { name: 'Year' }).fill('1950');
  // It saves on its own: there is no Save button to find, and the status line says when it is done.
  const status = page.getByRole('group', { name: 'Saving' }).getByRole('status');
  await expect(status).toHaveText('All saved');
  const undo = page.getByRole('group', { name: 'Saving' }).getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('complementary').getByText(/12 March 1950/)).toBeVisible();

  await page.reload();
  await settled(page);
  await checkAxe(page, 'tree with person panel');
  await expect(page.getByRole('complementary').getByText(/12 March 1950/)).toBeVisible();
  await page.getByRole('tab', { name: 'Family' }).click();
  await expect(page.getByRole('tabpanel', { name: /^Family/ }).getByRole('button', { name: new RegExp(`^${PARTNER}.*1975`) })).toBeVisible();
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(page.getByRole('textbox', { name: 'Epithet' })).toHaveValue('the Careful');

  // The edits are in the family's history, each row with its time: the page once failed on its first row.
  const tree = new URL(page.url()).pathname.split('/')[1];
  await page.goto(`/${tree}/history`);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
  await expect(page.locator('.hist-fields').getByText('the Careful').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Restore this value: Epithet/ }).first()).toBeVisible();
  await checkAxe(page, 'history');
});
