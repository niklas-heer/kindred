// Journey 22: live presence. The steward invites a second member, who opens the family in a browser of their own: each sees
// the other in the top bar ("1 here now", and who is on which page); the second member selects the steward's card and the
// steward's tree shows it with a halo and their face; both on the same profile say "… is here"; switching "Show me to others"
// off takes the halo away; on a phone the faces stay without sideways scrolling; and when the second member closes their
// browser, the bar says who was here last.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const COUSIN = 'Bram Presence';
const ME = `${STEWARD.given} ${STEWARD.surname}`;

test('presence: two members see each other, a selected card has a halo, sharing can be switched off', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);

  // ---------- a second member ----------
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  const inviting = page.getByRole('dialog');
  await inviting.getByRole('button', { name: 'Make an invitation link' }).click();
  const invitation = await inviting.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await inviting.getByRole('button', { name: 'Done' }).click();

  const theirs = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(theirs);
  const cousin = await theirs.newPage();
  await addPasskeyDevice(cousin);
  await cousin.goto(invitation.replace(/^https?:\/\/[^/]+/, ''));
  await cousin.getByRole('textbox', { name: 'What should the family call you?' }).fill(COUSIN);
  await cousin.getByRole('button', { name: 'Create your passkey' }).click();
  await cousin.getByRole('button', { name: 'Just browsing' }).click();
  await cousin.waitForURL((u) => !u.pathname.startsWith('/invite'));
  await cousin.getByRole('complementary', { name: 'Would you like a quick tour?' }).getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => undefined);

  // ---------- both in the tree ----------
  await cousin.goto(`/${tree}`);
  await settled(cousin);
  await page.goto(`/${tree}`);
  await settled(page);
  const here = page.getByRole('button', { name: '1 here now' });
  await expect(here).toBeVisible({ timeout: 15_000 });
  await expect(cousin.getByRole('button', { name: '1 here now' })).toBeVisible({ timeout: 15_000 });
  await here.click();
  const list = page.getByRole('dialog', { name: 'Here now' });
  await expect(list.getByText(`${COUSIN}, in the tree`)).toBeVisible();
  await checkAxe(page, 'tree, who is here');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();

  // ---------- the cousin selects the steward: a halo on the steward's tree ----------
  await cousin.locator('.card', { hasText: STEWARD.given }).first().locator('.card-hit').click();
  const watched = page.locator('.card.watched', { hasText: STEWARD.given }).first();
  await expect(watched).toBeVisible({ timeout: 15_000 });
  await expect(watched.locator('.card-watchers')).toHaveAttribute('title', `${COUSIN} has ${ME} selected`);

  // ---------- both on the steward's profile ----------
  await cousin.getByRole('link', { name: 'Full profile' }).first().click();
  await cousin.waitForURL(/\/person\//);
  const profile = new URL(cousin.url()).pathname;
  await page.goto(profile);
  await settled(page);
  await expect(page.getByRole('status').filter({ hasText: `${COUSIN} is here` })).toBeVisible({ timeout: 15_000 });
  await expect(cousin.getByRole('status').filter({ hasText: `${ME} is here` })).toBeVisible({ timeout: 15_000 });

  // ---------- "Show me to others" off: nothing selected is shared any more, either way ----------
  await cousin.locator('.acct-trigger').click();
  const share = cousin.getByRole('menuitemcheckbox', { name: /Show me to others/ });
  await expect(share).toHaveAttribute('aria-checked', 'true');
  await share.click();
  await expect(share).toHaveAttribute('aria-checked', 'false');
  await cousin.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: `${COUSIN} is here` })).toBeHidden({ timeout: 15_000 });
  await expect(cousin.getByRole('status').filter({ hasText: `${ME} is here` })).toBeHidden({ timeout: 15_000 });
  // Still here, though: the page is shared, the person is not.
  await expect(page.getByRole('button', { name: '1 here now' })).toBeVisible();

  // ---------- on a phone ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '1 here now' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---------- the cousin leaves ----------
  await theirs.close();
  await expect(page.getByRole('button', { name: /^Last here: Bram Presence/ })).toBeVisible({ timeout: 15_000 });
});
