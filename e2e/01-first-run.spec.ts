// Journey 1: the first visit to an empty server. Set up with a passkey, add yourself, sign out, sign back in.
import { join } from 'node:path';
import { SETUP_CODE } from '../playwright.config.ts';
import { addPasskeyDevice, checkAxe, expect, FAMILY, settled, STEWARD, test } from './fixtures.ts';

test('first-run setup with a passkey, adding yourself', async ({ page, context }) => {
  await addPasskeyDevice(page);

  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await settled(page);
  await checkAxe(page, 'setup');

  await page.getByLabel('Family name').fill(FAMILY);
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByLabel('Your name').fill(`${STEWARD.given} ${STEWARD.surname}`);
  await page.getByRole('button', { name: 'Create your passkey' }).click();

  await expect(page.getByLabel('Given name')).toHaveValue(STEWARD.given);
  await checkAxe(page, 'setup, adding yourself');
  await expect(page.getByLabel('Surname')).toHaveValue(STEWARD.surname);
  await page.getByRole('button', { name: /Add me/ }).click();

  await page.waitForURL(/\/family$/);
  await settled(page);
  await expect(page.getByRole('heading', { name: `${STEWARD.given} ${STEWARD.surname}`, level: 2, exact: true })).toBeVisible();

  // The tour is offered once. Declining is remembered, so it stays out of the way of the other journeys.
  await page.getByRole('dialog', { name: 'Would you like a quick tour?' }).getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog', { name: 'Would you like a quick tour?' })).toBeHidden();
  await checkAxe(page, 'tree, first run');
  await context.storageState({ path: join(process.env.KINDRED_E2E_DATA!, 'steward.json') });
});
