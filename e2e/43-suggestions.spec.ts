// Journey 43: suggestions from the family (docs/suggestions.md). A viewer (invited, in a browser of their own) suggests a
// corrected birth year on a person's page; the steward finds it under Suggestions, adjusts the year and approves it; the
// person shows the adjusted year, their history says who suggested it, and the viewer sees "Approved with changes". A
// guest of a share link (protecting living people) suggests a missing parent with a photo, giving their name; on a living
// person they have no way to suggest. The steward sees the parent may be someone already in the tree, approves them as
// someone new, and the photo is a file of the source made for it. A suggestion the steward declines loses its file, and
// the viewer sees the reason.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, STEWARD, test, type Issues } from './fixtures.ts';
import type { Browser, Page } from '@playwright/test';

const FULL = `${STEWARD.given} ${STEWARD.surname}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** A member invited with `role`, accepted in a browser of their own. */
async function inviteMember(page: Page, browser: Browser, issues: Issues, baseURL: string | undefined, tree: string, name: string, role: string) {
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  const inviting = page.getByRole('dialog');
  await inviting.getByRole('combobox', { name: 'Their role' }).click();
  await page.getByRole('option', { name: new RegExp(`^${role}`) }).click();
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

/** Adds a child of the steward who is no longer living, born in `year`, and returns their page's path. */
async function addChild(page: Page, tree: string, given: string, surname: string, year: string) {
  await page.goto(`/${tree}`);
  await settled(page);
  await page.getByRole('button', { name: `Add a child of ${FULL}` }).click();
  const add = page.getByRole('dialog', { name: `Add a child of ${FULL}` });
  await add.getByLabel('Given name').fill(given);
  await add.getByLabel('Surname at birth').fill(surname);
  await add.getByRole('radiogroup', { name: 'Born' }).getByRole('radio', { name: 'Year only' }).click();
  await add.getByRole('group', { name: 'Born' }).getByRole('textbox', { name: 'Year' }).fill(year);
  const living = add.getByRole('switch', { name: 'Still living' });
  if ((await living.getAttribute('aria-checked')) === 'true') await living.click();
  await add.getByRole('button', { name: /Create new/ }).last().click();
  await expect(add).toBeHidden();
  await page.locator('.card', { hasText: `${given} ${surname}` }).first().locator('.card-hit').click();
  const link = page.getByRole('complementary').getByRole('link', { name: `${given} ${surname}`, exact: true });
  return (await link.getAttribute('href'))!;
}

/** Opens the steward's own page, and returns its path. */
async function stewardPage(page: Page, tree: string) {
  await page.goto(`/${tree}`);
  await settled(page);
  await page.locator('.card', { hasText: FULL }).first().locator('.card-hit').click();
  return (await page.getByRole('complementary').getByRole('link', { name: new RegExp(`^${FULL}`) }).first().getAttribute('href'))!;
}

test('suggestions: a viewer and a guest suggest, the steward adjusts, approves and declines', async ({ page, browser, issues, baseURL }) => {
  test.setTimeout(300_000);
  const tree = await openFamily(page);
  const edda = await addChild(page, tree, 'Edda', 'Suggs', '1990');
  // Someone already in the tree that a suggested parent may be.
  await addChild(page, tree, 'Carl', 'Suggs', '1960');
  const ada = await stewardPage(page, tree);

  // ---------- the family's switches for guests, on the Access page ----------
  await page.goto(`/${tree}/access`);
  await settled(page);
  const switches = page.getByRole('region', { name: 'Suggestions from guests' });
  await expect(switches.getByRole('switch', { name: 'Guests may suggest' })).toBeChecked();
  await expect(switches.getByRole('switch', { name: 'Guests may attach files' })).toBeChecked();

  // ---------- a viewer suggests a corrected birth year ----------
  const { context, them } = await inviteMember(page, browser, issues, baseURL, tree, 'Bo Viewer', 'Viewer');
  await them.goto(edda);
  await settled(them);
  await expect(them.getByRole('tab', { name: 'Edit' })).toHaveCount(0);
  await them.getByRole('button', { name: 'Suggest a change' }).click();
  const dialog = them.getByRole('dialog', { name: 'Suggest a change' });
  await expect(dialog.getByRole('radio', { name: /^Their details/ })).toBeChecked();
  const born = dialog.getByRole('group', { name: 'Born' });
  await expect(born.getByRole('textbox', { name: 'Year' })).toHaveValue('1990');
  await born.getByRole('textbox', { name: 'Year' }).fill('1991');
  await dialog.getByRole('textbox', { name: 'How do you know? (if you like)' }).fill('Her baptism record says so.');
  await checkAxe(them, 'suggest a change');
  await dialog.getByRole('button', { name: 'Send the suggestion' }).click();
  await expect(dialog).toBeHidden();
  const theirs = them.getByRole('region', { name: 'Your suggestions' });
  await expect(theirs.getByText('Waiting')).toBeVisible();
  await expect(theirs.getByRole('button', { name: 'Withdraw' })).toBeVisible();

  // ---------- the steward adjusts it and approves ----------
  await page.goto(`/${tree}`);
  await settled(page);
  const sections = page.getByRole('navigation', { name: 'Sections' }).first();
  await sections.getByRole('button', { name: /^More/ }).click();
  await expect(sections.getByRole('list', { name: 'More sections' }).getByRole('link', { name: /^Suggestions/ })).toContainText('1');
  await sections.getByRole('list', { name: 'More sections' }).getByRole('link', { name: /^Suggestions/ }).click();
  await page.waitForURL(new RegExp(`/${tree}/suggestions$`));
  await settled(page);
  const card = page.getByRole('article', { name: /Edda Suggs/ });
  await expect(card.getByText('Suggested by Bo Viewer')).toBeVisible();
  await expect(card.getByText('Her baptism record says so.')).toBeVisible();
  const row = card.getByRole('row', { name: /^Born/ });
  await expect(row).toContainText('1990');
  await expect(row).toContainText('1991');
  await checkAxe(page, 'suggestions');
  await card.getByRole('button', { name: 'Adjust' }).click();
  await card.getByRole('group', { name: 'Born' }).getByRole('textbox', { name: 'Year' }).fill('1992');
  await card.getByRole('button', { name: 'Approve' }).click();
  const approving = page.getByRole('dialog', { name: 'Approve this suggestion?' });
  await approving.getByRole('button', { name: 'Approve' }).click();
  await expect(approving).toBeHidden();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Nothing is waiting')).toBeVisible();

  // The person shows it, and their history says who suggested it.
  await page.goto(edda);
  await settled(page);
  await expect(page.locator('.pp-keyfacts')).toContainText('1992');
  await page.goto(`/${tree}/history?person=${edda.split('/').pop()}`);
  await settled(page);
  await expect(page.getByText(/\(suggested by Bo Viewer\)/).first()).toBeVisible();
  await them.reload();
  await settled(them);
  await expect(theirs.getByText('Approved with changes')).toBeVisible();

  // ---------- a guest suggests a missing parent with a photo ----------
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).first().click();
  await expect(page.getByRole('dialog').getByRole('switch', { name: 'Protect living people' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('dialog').getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();
  issues.allow(/Failed to load resource: the server responded with a status of 40[134]/);
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(visit);
  const guest = await visit.newPage();
  await guest.goto(url);
  await settled(guest);
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  // The steward is living, and the link protects the living: no way to suggest anything about her.
  await guest.goto(ada);
  await settled(guest);
  await expect(guest.getByRole('heading', { level: 1, name: new RegExp(`^${FULL}`) })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Suggest a change' })).toHaveCount(0);
  await guest.goto(edda);
  await settled(guest);
  await guest.getByRole('button', { name: 'Suggest a change' }).click();
  const asking = guest.getByRole('dialog', { name: 'Suggest a change' });
  await asking.getByRole('radio', { name: /^A missing relative/ }).click();
  await asking.getByRole('combobox', { name: /^How are they related/ }).click();
  await guest.getByRole('option', { name: 'Parent', exact: true }).click();
  await asking.getByRole('textbox', { name: 'Given name' }).fill('Carl');
  await asking.getByRole('textbox', { name: 'Surname at birth' }).fill('Suggs');
  await asking.getByRole('radiogroup', { name: 'Born' }).getByRole('radio', { name: 'Year only' }).click();
  await asking.getByRole('group', { name: 'Born' }).getByRole('textbox', { name: 'Year' }).fill('1960');
  // Such a guest suggests only relatives who are no longer living.
  await expect(asking.getByRole('switch', { name: 'Still living' })).toHaveCount(0);
  await asking.locator('input[type=file]').setInputFiles({ name: 'carl.png', mimeType: 'image/png', buffer: PNG });
  await expect(asking.getByText('carl.png')).toBeVisible();
  // Their first suggestion asks for their name, and says who sees it.
  await asking.getByRole('textbox', { name: 'Your name' }).fill('Cee Guest');
  await expect(asking.getByText(/Editors see your name with your suggestion/)).toBeVisible();
  await checkAxe(guest, 'suggest a missing relative as guest');
  await asking.getByRole('button', { name: 'Send the suggestion' }).click();
  await expect(asking).toBeHidden();
  await expect(guest.getByRole('region', { name: 'Your suggestions' }).getByText('Waiting')).toBeVisible();

  // ---------- the steward sees a possible match, and approves them as someone new ----------
  await page.goto(`/${tree}/suggestions`);
  await settled(page);
  const parent = page.getByRole('article', { name: /parent of Edda Suggs/ });
  await expect(parent.getByText('Suggested by Cee Guest')).toBeVisible();
  await expect(parent.getByText('Guest', { exact: true })).toBeVisible();
  await expect(parent.getByRole('link', { name: 'carl.png' })).toHaveAttribute('href', new RegExp(`^/api/suggestion-file/${tree}/[0-9a-f-]{36}$`));
  const matches = parent.getByRole('radiogroup', { name: 'Is this someone already in the tree?' });
  await expect(matches.getByRole('radio', { name: /^This is Carl Suggs/ })).toBeVisible();
  await expect(matches.getByRole('radio', { name: 'No, add them as someone new' })).toBeChecked();
  await checkAxe(page, 'suggestions, a missing relative');
  await parent.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog', { name: 'Approve this suggestion?' }).getByRole('button', { name: 'Approve' }).click();
  await expect(parent).toHaveCount(0);
  // The photo is a file of the source made for it.
  await page.goto(`/${tree}/research/sources`);
  await settled(page);
  const source = page.locator('.source-card', { hasText: 'Supplied with a suggestion by Cee Guest' });
  const file = source.getByRole('link', { name: 'carl.png' });
  await expect(file).toHaveAttribute('href', new RegExp(`^/api/source-file/${tree}/`));
  expect((await page.request.get((await file.getAttribute('href'))!)).status()).toBe(200);
  await visit.close();

  // ---------- a declined suggestion loses its file, and the viewer sees why ----------
  await them.goto(edda);
  await settled(them);
  await them.getByRole('button', { name: 'Suggest a change' }).click();
  await dialog.getByRole('radio', { name: /^A source/ }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Parish register of Suggsby');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'register.png', mimeType: 'image/png', buffer: PNG });
  await dialog.getByRole('button', { name: 'Send the suggestion' }).click();
  await expect(dialog).toBeHidden();
  await page.goto(`/${tree}/suggestions`);
  await settled(page);
  const register = page.getByRole('article', { name: /Parish register of Suggsby/ });
  const pending = (await register.getByRole('link', { name: 'register.png' }).getAttribute('href'))!;
  expect((await page.request.get(pending)).status()).toBe(200);
  await register.getByRole('button', { name: 'Decline' }).click();
  const declining = page.getByRole('dialog', { name: 'Decline this suggestion?' });
  await declining.getByRole('textbox', { name: 'Why (if you like)' }).fill('We have the original already.');
  await declining.getByRole('button', { name: 'Decline' }).click();
  await expect(declining).toBeHidden();
  await expect(register).toHaveCount(0);
  expect((await page.request.get(pending)).status()).toBe(404);
  await them.reload();
  await settled(them);
  await expect(theirs.getByText('Declined')).toBeVisible();
  await expect(theirs.getByText('Reason: We have the original already.')).toBeVisible();
  await context.close();
});
