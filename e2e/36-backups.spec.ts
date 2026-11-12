// Journey 36: the operator's automatic backups (docs/hosting-many-families.md, "Backups"). The journeys run with the daily jobs
// off, so the operator backs the family up from the Backups tab and tests a restore (the newest backup restored into a scratch
// database and checked); the console shows each backup's time, size, schema and row counts, never what the family holds. The
// restore dialog offers a new family first, and over the family only with its address typed; the journey cancels it, so the
// journeys after it see the same families (a restore itself is covered by src/lib/backup/backup.test.ts and, in workerd, by
// src/lib/store/durable.test.ts). The Health tab then shows the backups instead of "no automatic backup".
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('the operator backs a family up, tests a restore and restores it into a new family', async ({ page }) => {
  const tree = await openFamily(page);
  const copy = `${tree}-copy`.slice(0, 64);

  await page.goto('/operator?tab=backups');
  await settled(page);
  await expect(page.getByRole('tab', { name: 'Backups', selected: true })).toBeVisible();
  await expect(page.getByText(/The backups are files in the server’s backup folder/)).toBeVisible();
  // Lines that follow an icon are not anchored: a regex sees the raw text, which starts with the space after the icon.
  await expect(page.getByRole('region', { name: 'Where and with which key' }).getByText(/Sealed with /)).toBeVisible();
  await checkAxe(page, 'operator backups');

  const row = page.getByRole('listitem').filter({ has: page.locator('code', { hasText: new RegExp(`^${tree}$`) }) }).first();
  await row.getByRole('button', { name: 'Back up now' }).click();
  await expect(row.getByText('Backed up.')).toBeVisible();
  await expect(row.getByText(/^Last good backup /)).toBeVisible();
  await row.getByRole('button', { name: 'Test a restore' }).click();
  await expect(row.getByText(/it is fine/)).toBeVisible();
  await expect(row.getByText(/Restore test passed /)).toBeVisible();

  await row.getByRole('button', { name: /^Backups \(\d+\)$/ }).click();
  await expect(row.getByText(/ rows, schema \d{4}_/).first()).toBeVisible();
  await row.getByRole('button', { name: 'Restore…' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Into a new family')).toBeChecked();
  await expect(dialog.getByText(/Pictures and documents are not in a backup/)).toBeVisible();
  await dialog.getByLabel('Address of the new family').fill(copy);
  await checkAxe(page, 'restore dialog');
  // Over the family: only with its address typed.
  await dialog.getByLabel('Over the family').check();
  const go = dialog.getByRole('button', { name: 'Restore', exact: true });
  await expect(go).toBeDisabled();
  await dialog.getByLabel(`Type ${tree} to confirm.`).fill(tree);
  await expect(go).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // The Health tab shows the backups.
  await page.goto('/operator?tab=health');
  await settled(page);
  const backup = page.getByRole('region', { name: 'Backup' });
  await expect(backup.getByText(/^Backups: \d+, /)).toBeVisible();
  await expect(backup.getByText('No automatic backup on this install.')).toHaveCount(0);
});
