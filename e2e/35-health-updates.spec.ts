// Journey 35: the operator's Health tab and how to update this server (docs/hosting-many-families.md, "Health" and "Updates").
// The journeys run the Node build, so the Updates tab shows the checkout's steps rather than the Update button (that one is for
// a copy made by the Deploy to Cloudflare button, KINDRED_UPDATE_VIA=github-actions; src/lib/operator/self-update.test.ts covers
// it against a fake GitHub). Health reads the accounts database only: the family opened first has reported its schema, and the
// automatic backups say which key seals them (journey 36 makes one). Nothing is changed.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('the operator’s Health tab, and the steps to update a Node server', async ({ page }) => {
  await openFamily(page);

  await page.goto('/operator?tab=health');
  await settled(page);
  await expect(page.getByRole('tab', { name: 'Health', selected: true })).toBeVisible();
  const running = page.getByRole('region', { name: 'Running' });
  await expect(running.getByText('Version')).toBeVisible();
  const jobs = page.getByRole('region', { name: 'Daily jobs' });
  await expect(jobs.getByText(/The daily jobs last started|No daily run is recorded yet/)).toBeVisible();
  const families = page.getByRole('region', { name: 'Families’ databases' });
  await expect(families.getByText(/on the newest schema|Newest schema/).first()).toBeVisible();
  const backup = page.getByRole('region', { name: 'Backup' });
  await expect(backup.getByText(/^Sealed with /)).toBeVisible();
  await expect(backup.getByText('No automatic backup on this install.')).toHaveCount(0);
  await expect(backup.getByRole('link', { name: 'How to back up' })).toHaveAttribute('href', /docs\/self-host\.md#backups$/);
  await expect(page.getByRole('region', { name: 'Update check' })).toBeVisible();
  await checkAxe(page, 'operator health');

  await page.goto('/operator?tab=updates');
  await settled(page);
  const update = page.getByRole('region', { name: 'Updating this server' });
  await expect(update.getByText(/runs on Node from a checkout/)).toBeVisible();
  await expect(update.getByText(/mise run build:node/)).toBeVisible();
  await expect(update.getByRole('button', { name: /Update to/ })).toHaveCount(0);
  await expect(update.getByLabel('Token')).toHaveCount(0);
  await checkAxe(page, 'operator updates, Node steps');
});
