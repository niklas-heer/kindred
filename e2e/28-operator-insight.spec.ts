// Journey 28: the operator's Statistics and Updates tabs, and "New in Kindred" (docs/hosting-many-families.md). The operator
// reads the server's numbers with a table behind each chart, is asked before any update check (and declines, so nothing reaches
// GitHub), opens "New in Kindred" from the account menu with the operator's links, and someone signed out sees only what is for
// everyone. The update check stays declined (off), which behaves as before: nothing is asked of GitHub.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('operator statistics, the update question and New in Kindred', async ({ page, browser, issues, baseURL }) => {
  await openFamily(page);
  await page.goto('/operator?tab=statistics');
  await settled(page);
  await expect(page.getByRole('tab', { name: 'Statistics', selected: true })).toBeVisible();
  await expect(page.getByText('Families', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Monthly active accounts').first()).toBeVisible();
  // Each chart names itself and offers its numbers as a table.
  await expect(page.getByRole('img', { name: /Accounts/ }).first()).toBeVisible();
  await page.getByText('Show as a table').first().click();
  await expect(page.getByRole('columnheader', { name: 'Period' }).first()).toBeVisible();
  await page.getByRole('radio', { name: '30 days' }).click();
  await expect(page.getByRole('heading', { name: 'Families by storage' })).toBeVisible();
  await checkAxe(page, 'operator statistics');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling').toBe(true);

  // Updates: the running version, and a question before anything is asked of GitHub.
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(page.getByText(/Check for new Kindred releases\?/)).toBeVisible();
  await checkAxe(page, 'operator updates');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('The check is off. Nothing is asked until you turn it on.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);

  // New in Kindred, from the account menu: an operator sees the operators' highlights and the technical links.
  await page.locator('[data-tour="account-menu"]').click();
  await page.getByRole('menuitem', { name: 'New in Kindred' }).click();
  await page.waitForURL(/\/whats-new$/);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'New in Kindred', level: 1 })).toBeVisible();
  await expect(page.getByText('The operator console.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Full changelog/ })).toBeVisible();
  await checkAxe(page, 'new in kindred');

  // Someone signed out: only what is meant for everyone.
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  issues.watch(visit);
  const stranger = await visit.newPage();
  await stranger.goto('/whats-new');
  await settled(stranger);
  await expect(stranger.getByText('Recipes and the Cookbook.')).toBeVisible();
  await expect(stranger.getByText('The operator console.')).toHaveCount(0);
  await expect(stranger.getByText('View as.', { exact: true })).toHaveCount(0);
  await expect(stranger.getByRole('link', { name: /Full changelog/ })).toHaveCount(0);
  expect(await stranger.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await visit.close();
});
