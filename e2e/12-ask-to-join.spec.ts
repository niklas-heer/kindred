// Journey 12: a guest of the share link asks for an account of their own with a passkey, a steward approves, and the passkey
// signs the new member straight into the family.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

const NEWCOMER = 'Cleo Newcomer';

test('ask to join: guest asks with a passkey, steward approves, new member signs in', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);

  await page.goto(`/${tree}/access`);
  await settled(page);
  // A link from an earlier journey may exist: a new one gives this journey its own URL and password.
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();
  await expect(page.getByRole('switch', { name: 'Guests may ask to join' })).toHaveAttribute('aria-checked', 'true');

  // The guest is on a phone: the invitation, the form and the waiting note must work at 390 px.
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  issues.watch(visit);
  const guest = await visit.newPage();
  await addPasskeyDevice(guest);
  await guest.goto(url);
  await settled(guest);
  await expect(guest.getByText(/the stewards see how this browser used the link/)).toBeVisible();
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await settled(guest);

  const invite = guest.getByRole('complementary', { name: 'Join the family with your own account' });
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Ask to join' }).click();
  const form = guest.getByRole('dialog', { name: 'Ask to join' });
  await form.getByLabel('Your name').fill(NEWCOMER);
  await form.getByRole('button', { name: 'I’m not in the tree yet' }).click();
  await form.getByLabel(/A short message/).fill('I am the cousin from Windhoek.');
  const preview = form.getByRole('region', { name: 'What the stewards will receive' });
  await expect(preview.getByText(NEWCOMER)).toBeVisible();
  await expect(preview.getByText('I am the cousin from Windhoek.')).toBeVisible();
  await settled(guest);
  await checkAxe(guest, 'ask to join form');
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await form.getByRole('button', { name: 'Create a passkey and send' }).click();
  await expect(form).toBeHidden();
  await expect(guest.getByRole('complementary', { name: 'Waiting for a steward' })).toBeVisible();

  // The steward sees the request on top of Access, and approves it.
  await page.goto(`/${tree}/access`);
  await settled(page);
  const card = page.getByRole('article', { name: NEWCOMER });
  await expect(card).toBeVisible();
  await expect(card.getByText('Says they aren’t in the tree yet.')).toBeVisible();
  await expect(card.getByText('I am the cousin from Windhoek.')).toBeVisible();
  await checkAxe(page, 'access with a request to join');
  await card.getByRole('button', { name: 'Approve…' }).click();
  const approve = page.getByRole('dialog', { name: `Let ${NEWCOMER} in` });
  await approve.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(approve).toBeHidden();
  await expect(page.getByRole('article', { name: NEWCOMER })).toHaveCount(0);
  await expect(page.locator('.acc-list .name', { hasText: NEWCOMER })).toBeVisible();

  // The guest's page learns the answer, and the passkey signs them in as a member.
  await guest.reload();
  await settled(guest);
  const yes = guest.getByRole('complementary', { name: 'You’re in' });
  await expect(yes).toBeVisible();
  await yes.getByRole('button', { name: 'Sign in with your passkey' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await settled(guest);
  // They said they are not in the tree yet, so as a member they are asked who they are, like anyone new.
  const who = guest.getByRole('dialog', { name: /Who are you/ });
  await expect(who).toBeVisible();
  await who.getByRole('button', { name: 'Just browsing' }).click();
  await expect(who).toBeHidden();
  await expect(guest.getByRole('button', { name: new RegExp(NEWCOMER) }).first()).toBeVisible();
  await expect(guest.getByText('Guest', { exact: true })).toHaveCount(0);

  await visit.close();
});
