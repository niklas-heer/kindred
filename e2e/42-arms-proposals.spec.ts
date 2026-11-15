// Journey 42: coat-of-arms proposals (docs/arms-proposals.md). A contributor (invited, in a browser of their own) proposes
// arms for a house in the designer's propose mode, without the house's name and motto. In choose mode, the family's
// default, the steward sees it beside the house's arms now and puts it to a vote; while the vote runs, the steward's own
// designer cannot change the arms. Both members rank the shields; a guest of a share link sees the shields and their
// names, never who proposed them, and no proposals on the house's page. The steward closes the vote, and the house bears
// the new arms. In steward mode, set on the Houses page, the Houses page counts the waiting proposal and the steward
// accepts it directly, after confirming it.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, test, type Issues } from './fixtures.ts';
import type { Browser, Page } from '@playwright/test';

/** A second member: an invitation (Contributor, the dialog's default role), accepted in a browser of their own. */
async function inviteMember(page: Page, browser: Browser, issues: Issues, baseURL: string | undefined, tree: string, name: string) {
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  const inviting = page.getByRole('dialog');
  await inviting.getByRole('button', { name: 'Make an invitation link' }).click();
  const invitation = await inviting.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await inviting.getByRole('button', { name: 'Done' }).click();
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(context);
  const them = await context.newPage();
  await addPasskeyDevice(them);
  await them.goto(invitation.replace(/^https?:\/\/[^/]+/, ''));
  await them.getByRole('textbox', { name: 'What should the family call you?' }).fill(name);
  await them.getByRole('button', { name: 'Create your passkey' }).click();
  await them.getByRole('button', { name: 'Just browsing' }).click();
  await them.waitForURL((u) => !u.pathname.startsWith('/invite'));
  await them.getByRole('complementary', { name: 'Would you like a quick tour?' }).getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => undefined);
  return { context, them };
}

/**
 * Proposes arms from the house page: one more charge layer than the house has (so the design differs), a name and a note.
 * Returns the shield's label in the designer ("Arms of …: <blazon>"), which the designer shows again once the house bears it.
 */
async function propose(page: Page, house: string, name: string, note: string) {
  await page.goto(house);
  await settled(page);
  await page.getByRole('button', { name: 'Propose arms' }).click();
  const designer = page.getByRole('dialog', { name: 'Propose arms' });
  // Only arms are proposed: the house's name and motto are not there.
  await expect(designer.getByRole('textbox', { name: 'House name' })).toHaveCount(0);
  await expect(designer.getByRole('textbox', { name: 'Motto' })).toHaveCount(0);
  const send = designer.getByRole('button', { name: 'Propose these arms' });
  await designer.getByRole('textbox', { name: 'Name of your design' }).fill(name);
  // The house's own arms cannot be proposed.
  await expect(send).toBeDisabled();
  await designer.getByRole('button', { name: 'Charges', exact: true }).click();
  await designer.getByRole('textbox', { name: 'A note (if you like)' }).fill(note);
  const shield = (await designer.getByRole('region', { name: 'Preview' }).getByRole('img').first().getAttribute('aria-label'))!;
  await send.click();
  await expect(designer).toBeHidden();
  return shield;
}

/** The shield the steward's designer opens with: the house's arms as stored. */
async function armsNow(page: Page, house: string) {
  await page.goto(house);
  await settled(page);
  await page.getByRole('button', { name: 'Edit arms' }).click();
  const designer = page.getByRole('dialog', { name: 'Coat of arms' });
  const label = await designer.getByRole('region', { name: 'Preview' }).getByRole('img').first().getAttribute('aria-label');
  await designer.getByRole('button', { name: 'Cancel' }).click();
  await expect(designer).toBeHidden();
  return label;
}

test('arms proposals: a contributor proposes, the family votes, the steward accepts in steward mode', async ({ page, browser, issues, baseURL }) => {
  test.setTimeout(240_000);
  const tree = await openFamily(page);

  // ---------- a house, and the family's setting on the Houses page ----------
  await page.goto(`/${tree}/houses`);
  await settled(page);
  await page.getByRole('button', { name: 'New house' }).first().click();
  const made = page.getByRole('dialog', { name: 'A new house' });
  await made.getByRole('textbox', { name: 'Name', exact: true }).fill('Starling');
  await made.getByRole('button', { name: /Create/ }).click();
  await page.waitForURL(/\/house\//);
  const house = new URL(page.url()).pathname;
  await page.goto(`/${tree}/houses`);
  await settled(page);
  const setting = page.getByRole('region', { name: 'Arms proposals' });
  await expect(setting.getByRole('radio', { name: 'A steward chooses each time' })).toBeChecked();
  await expect(setting.getByRole('switch', { name: 'Guests may vote on arms' })).toBeChecked();
  await checkAxe(page, 'houses, with the arms setting');

  // ---------- a contributor proposes ----------
  const { context, them } = await inviteMember(page, browser, issues, baseURL, tree, 'Bo Starling');
  const proposed = await propose(them, house, 'The stars of Starling', 'Three stars for three sisters.');
  const theirs = them.getByRole('region', { name: 'Proposed arms' });
  await expect(theirs.getByRole('heading', { name: 'The stars of Starling' })).toBeVisible();
  await expect(theirs.getByText('Waiting')).toBeVisible();
  await expect(theirs.getByText('Three stars for three sisters.')).toBeVisible();
  await expect(theirs.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  // A contributor decides nothing.
  await expect(theirs.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await checkAxe(them, 'house, with a proposal');

  // ---------- choose mode: the steward puts it to a vote ----------
  await page.goto(house);
  await settled(page);
  const list = page.getByRole('region', { name: 'Proposed arms' });
  await expect(list.getByText('Proposed by Bo Starling')).toBeVisible();
  await expect(list.getByRole('img', { name: /^The house's arms now: / })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Decline' })).toBeVisible();
  await list.getByRole('button', { name: 'Put to a vote' }).click();
  await expect(list.getByRole('status')).toContainText("The proposal is in the house's arms vote.");
  await expect(list.getByText('In the vote')).toBeVisible();
  await checkAxe(page, 'house, with a proposal in a vote');

  // While the vote runs, the steward's designer cannot change the arms.
  await page.getByRole('button', { name: 'Edit arms' }).click();
  const designer = page.getByRole('dialog', { name: 'Coat of arms' });
  await designer.getByRole('button', { name: 'Charges', exact: true }).click();
  await designer.getByRole('button', { name: 'Seal the arms' }).click();
  await expect(designer.getByRole('alert')).toContainText("The family is voting on this house's arms.");
  await designer.getByRole('button', { name: 'Reset' }).click();
  await designer.getByRole('button', { name: 'Cancel' }).click();
  await expect(designer).toBeHidden();

  // ---------- two members rank the shields ----------
  await list.getByRole('link', { name: 'Open the vote' }).first().click();
  await page.waitForURL(new RegExp(`/${tree}/votes/[0-9a-f-]{36}$`));
  await settled(page);
  const voteUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: /^Which arms should House .*Starling bear\?$/ })).toBeVisible();
  const ballot = page.getByRole('group', { name: 'Tap the options in the order you prefer them' });
  await expect(ballot.locator('.vt-arms')).toHaveCount(2);
  const stars = ballot.getByRole('button', { name: 'The stars of Starling', exact: true });
  await expect(ballot.getByRole('button', { name: 'Keep our current arms', exact: true })).toBeVisible();
  // The shield is described in words.
  await expect(stars).toHaveAccessibleDescription(/mullet/i);
  await stars.click();
  await page.getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your vote is in.' })).toBeVisible();
  await checkAxe(page, 'an arms vote');

  await them.goto(voteUrl);
  await settled(them);
  await them.getByRole('group', { name: 'Tap the options in the order you prefer them' }).getByRole('button', { name: 'The stars of Starling', exact: true }).click();
  await them.getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(them.getByRole('status').filter({ hasText: 'Your vote is in.' })).toBeVisible();
  // Someone else's arms vote: nothing to close it with.
  await expect(them.getByRole('button', { name: 'Close now' })).toHaveCount(0);

  // ---------- a guest sees the shields, never who proposed them ----------
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();
  issues.allow(/Failed to load resource: the server responded with a status of 40[13]/);
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(visit);
  const guest = await visit.newPage();
  await guest.goto(url);
  await settled(guest);
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await guest.goto(voteUrl);
  await settled(guest);
  const theirBallot = guest.getByRole('group', { name: 'Tap the options in the order you prefer them' });
  await expect(theirBallot.getByRole('button', { name: 'The stars of Starling', exact: true })).toBeVisible();
  await expect(theirBallot.locator('.vt-arms')).toHaveCount(2);
  await expect(guest.getByText('Bo Starling')).toHaveCount(0);
  await expect(guest.getByText('Three stars for three sisters.')).toHaveCount(0);
  await checkAxe(guest, 'an arms vote as guest');
  // On the house's page a guest sees no proposals and cannot propose.
  await guest.goto(house);
  await settled(guest);
  await expect(guest.getByRole('heading', { level: 1, name: /Starling/ })).toBeVisible();
  await expect(guest.getByRole('region', { name: 'Proposed arms' })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Propose arms' })).toHaveCount(0);
  await visit.close();

  // ---------- the steward closes it, and the house bears the new arms ----------
  await page.goto(voteUrl);
  await settled(page);
  await page.getByRole('button', { name: 'Close now' }).click();
  await page.getByRole('dialog', { name: 'Close this vote now?' }).getByRole('button', { name: 'Close now' }).click();
  await expect(page.getByText('Chosen: The stars of Starling')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Results' }).locator('.vt-arms').first()).toBeVisible();
  expect(await armsNow(page, house)).toBe(proposed);
  await them.goto(house);
  await settled(them);
  await expect(them.getByRole('region', { name: 'Proposed arms' }).getByText('Accepted')).toBeVisible();
  await context.close();

  // ---------- steward mode: the Houses page counts it, and the steward accepts it ----------
  await page.goto(`/${tree}/houses`);
  await settled(page);
  await setting.getByRole('radio', { name: 'A steward decides' }).check();
  await expect(setting.getByRole('status')).toHaveText('Saved');
  const lone = await propose(page, house, 'The lone star', 'One star is enough.');
  await page.goto(`/${tree}/houses`);
  await settled(page);
  await expect(page.getByRole('link', { name: /Starling/ }).getByText('1 proposal waits')).toBeVisible();
  await page.goto(house);
  await settled(page);
  await expect(list.getByRole('button', { name: 'Put to a vote' })).toHaveCount(0);
  await list.getByRole('button', { name: 'Accept' }).click();
  // Accept changes the house's arms at once, so the steward confirms it.
  const accepting = page.getByRole('dialog', { name: 'Accept “The lone star”?' });
  await expect(accepting).toContainText(/House .*Starling will bear these arms\./);
  await accepting.getByRole('button', { name: 'Accept' }).click();
  await expect(accepting).toBeHidden();
  await expect(list.getByText('Accepted')).toBeVisible();
  expect(await armsNow(page, house)).toBe(lone);
});
