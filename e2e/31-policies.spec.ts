// Journey 31: the operator's policies and announcements (docs/hosting-many-families.md, "Policies", "Announcements"). The
// operator turns the Campaign off for every family: the console shows what that changes before it saves, and the family's
// Games page keeps the switch in view, locked, with one sentence. Then an announcement to stewards: the banner shows on the
// family's pages until it is dismissed. The journey puts every setting back, so the journeys after it see the server as before.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('the operator’s policies: a locked Campaign and an announcement to stewards', async ({ page }) => {
  const tree = await openFamily(page);

  // Policies: the Campaign off for every family, previewed before it is saved.
  await page.goto('/operator?tab=policies');
  await settled(page);
  const campaign = page.getByRole('region', { name: 'The Campaign' });
  await expect(campaign).toBeVisible();
  await campaign.getByLabel('Off for every family').check();
  await expect(campaign.getByRole('button', { name: 'Save' })).toBeDisabled();
  await campaign.getByRole('button', { name: 'Show what changes' }).click();
  await expect(campaign.getByText(/Families affected: \d+ \(\d+ lose it, 0 gain it\)/)).toBeVisible();
  await campaign.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await checkAxe(page, 'operator policies');

  // The family's stewards see the switch, off and locked, with the reason.
  await page.goto(`/${tree}/settings/games`);
  await settled(page);
  const gameSwitch = page.getByRole('switch', { name: 'The Campaign is on for this family' });
  await expect(gameSwitch).toBeDisabled();
  await expect(gameSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Turned off by this server’s operator.')).toBeVisible();
  await checkAxe(page, 'games page, locked');

  // An announcement to stewards: the banner shows on the family's pages until it is dismissed.
  await page.goto('/operator?tab=announcements');
  await settled(page);
  await page.getByLabel('Title').fill('Maintenance on Sunday');
  await page.getByLabel('Text', { exact: true }).fill('The server restarts at 22:00 UTC.');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Maintenance on Sunday' })).toBeVisible();
  await page.goto(`/${tree}`);
  await settled(page);
  const banner = page.getByRole('region', { name: 'Announcement from this server’s operator' });
  await expect(banner.getByText('Maintenance on Sunday')).toBeVisible();
  await checkAxe(page, 'announcement banner');
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toBeHidden();

  // Everything back as it was.
  await page.goto('/operator?tab=announcements');
  await settled(page);
  await page.getByRole('listitem').filter({ hasText: 'Maintenance on Sunday' }).getByRole('button', { name: 'End now' }).click();
  await page.goto('/operator?tab=policies');
  await settled(page);
  const again = page.getByRole('region', { name: 'The Campaign' });
  await again.getByLabel('Every family, as its stewards choose').check();
  await again.getByRole('button', { name: 'Show what changes' }).click();
  await expect(again.getByText(/gain it/)).toBeVisible();
  await again.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});
