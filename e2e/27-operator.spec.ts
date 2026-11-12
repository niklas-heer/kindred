// Journey 27: hosting many families (docs/hosting-many-families.md). The server's first account is its operator: it opens the
// operator console, makes a family for someone else and hands them the steward link (the operator is not a member), opens the
// waiting list, a stranger asks for a family and sends a data request, the operator approves and moves the data request on,
// the family's steward sees it on Access once it is forwarded, a read-only family shows its bar and a closed one a page of its own,
// and the invited steward joins with a passkey.
// The journey puts every setting back, so the journeys after it see the server as before.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('the operator console: a family for someone else, the waiting list, data requests, suspension', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);

  // The account menu offers the console to the operator.
  await page.locator('[data-tour="account-menu"]').click();
  await page.getByRole('menuitem', { name: 'Operator console' }).click();
  await page.waitForURL(/\/operator$/);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Operator console', level: 1 })).toBeVisible();
  await checkAxe(page, 'operator console');

  // A family for someone else: the operator is not a member, and gets a link for its first steward.
  const make = page.getByRole('region', { name: 'Make a family for someone' });
  await make.getByLabel('Name', { exact: true }).fill('The Quillfords');
  await make.getByLabel('Its first steward').fill('Quinn Quillford');
  await make.getByLabel('Their email (optional)').fill('quinn@example.org');
  await make.getByRole('button', { name: 'Make the family and the link' }).click();
  const link = page.getByLabel('Invitation link for Quinn Quillford');
  await expect(link).toBeVisible();
  const inviteUrl = await link.inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  const quill = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /The Quillfords/ }) });
  await expect(quill.getByText(/Waiting for its first steward, quinn@example\.org/)).toBeVisible();
  await expect(quill.getByText('Members', { exact: true })).toBeVisible();

  // Settings: anyone may ask, and an Impressum.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel(/Anyone may ask/).check();
  // Without Turnstile the console warns (and still lets the operator open the form).
  await expect(page.getByText(/nothing checks for bots/)).toBeVisible();
  await page.getByLabel('Legal notice (Impressum)').fill('Orla Example\nSample Street 1\n12345 Sample Town');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await checkAxe(page, 'operator settings');

  // A stranger: the sign-in page offers the request form and the legal footer.
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  issues.watch(visit);
  const stranger = await visit.newPage();
  await stranger.goto('/signin');
  await settled(stranger);
  await expect(stranger.getByRole('link', { name: 'Legal notice (Impressum)' })).toBeVisible();
  await stranger.getByRole('link', { name: 'Ask for one' }).click();
  await stranger.waitForURL(/\/request$/);
  await settled(stranger);
  await stranger.getByLabel('Your name').fill('Rhea Rowan');
  await stranger.getByLabel('Your email').fill('rhea@example.org');
  await stranger.getByLabel('The family’s name').fill('The Rowans');
  await stranger.getByLabel('Anything else (optional)').fill('We are five cousins.');
  await checkAxe(stranger, 'family request form');
  expect(await stranger.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await stranger.getByRole('button', { name: 'Send' }).click();
  await expect(stranger.getByText('We’ll be in touch at rhea@example.org.')).toBeVisible();

  // The legal page, and a data request naming the family by its address.
  await stranger.goto('/legal');
  await settled(stranger);
  await expect(stranger.getByText('12345 Sample Town')).toBeVisible();
  await stranger.goto('/privacy-request');
  await settled(stranger);
  await stranger.getByLabel('Your name').fill('Dana Dell');
  await stranger.getByLabel('Your email').fill('dana@example.org');
  await stranger.getByLabel('Which family').fill(`${baseURL}/${tree}`);
  await stranger.getByLabel(/Deletion/).check();
  await stranger.getByLabel('Your request').fill('Please remove my birthday from the tree.');
  await checkAxe(stranger, 'data request form');
  await stranger.getByRole('button', { name: 'Send' }).click();
  await expect(stranger.getByText('We’ll be in touch at dana@example.org.')).toBeVisible();
  await visit.close();

  // The operator approves the request: a family and a link for the person who asked.
  await page.reload();
  await settled(page);
  await page.getByRole('tab', { name: /Waiting list/ }).click();
  const request = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'The Rowans' }) });
  await expect(request.getByText('We are five cousins.')).toBeVisible();
  await request.getByRole('button', { name: 'Approve…' }).click();
  const approve = page.getByRole('dialog', { name: 'A family for “The Rowans”' });
  await approve.getByRole('button', { name: 'Make the family and the link' }).click();
  await expect(approve.getByLabel('Invitation link for Rhea Rowan')).toBeVisible();
  await expect(approve.getByRole('link', { name: 'Write to rhea@example.org' })).toBeVisible();
  await approve.getByRole('button', { name: 'Done' }).click();

  // The data request: the stewards see nothing until the operator hands it to them.
  await page.goto(`/${tree}/access`);
  await settled(page);
  await expect(page.getByText('Please remove my birthday from the tree.')).toBeHidden();
  await page.goto('/operator?tab=data');
  await settled(page);
  const data = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Deletion · Dana Dell' }) });
  await expect(data.getByText(/days left to answer/)).toBeVisible();
  await data.getByRole('radio', { name: 'With the stewards' }).click();
  await expect(data.getByRole('radio', { name: 'With the stewards' })).toHaveAttribute('aria-checked', 'true');
  await checkAxe(page, 'operator data requests');

  // The steward (here the same person, also a steward of the family) sees it on Access and answers it.
  await page.goto(`/${tree}/access`);
  await settled(page);
  const onAccess = page.getByRole('region', { name: /Data requests/ });
  await expect(onAccess.getByText('Please remove my birthday from the tree.')).toBeVisible();
  await onAccess.getByRole('button', { name: 'Mark as answered' }).click();
  await expect(onAccess).toBeHidden();

  // Read-only: its members read it under a bar that says how to reach the operator, and can change nothing.
  await page.goto('/operator');
  await settled(page);
  const own = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(`/${tree}`) }) });
  await own.getByRole('radio', { name: 'Read-only' }).click();
  // Suspending asks for a statement of reasons first (EU DSA Art. 17), which the family's members then read.
  const reasons = page.getByRole('dialog', { name: /read-only\?/ });
  await reasons.getByLabel('Statement of reasons').fill('Testing the read-only bar.');
  await reasons.getByRole('button', { name: 'Read-only' }).click();
  await expect(own.getByText('Suspended', { exact: true })).toBeVisible();
  await page.goto(`/${tree}`);
  await settled(page);
  await expect(page.getByText(/This family is suspended by the server’s operator/)).toBeVisible();
  await expect(page.getByText(/to have the family deleted/)).toBeVisible();
  await expect(page.getByText('Testing the read-only bar.')).toBeVisible();
  await checkAxe(page, 'suspended family');
  // Closed: a page of its own instead of the family. Then it is let go again.
  await page.goto('/operator');
  await settled(page);
  await own.getByRole('radio', { name: 'Closed' }).click();
  const closing = page.getByRole('dialog', { name: /^Close / });
  await closing.getByLabel('Statement of reasons').fill('Testing the closed page.');
  await closing.getByRole('button', { name: 'Closed' }).click();
  await expect(own.locator('.operator-chip', { hasText: 'Closed' })).toBeVisible();
  // Like a family one is not a member of, the closed family's page answers 404.
  issues.allow(new RegExp(`status of 404 .*/${tree}\\)`));
  await page.goto(`/${tree}`);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'This family is closed' })).toBeVisible();
  await expect(page.getByText('Testing the closed page.')).toBeVisible();
  await checkAxe(page, 'closed family');
  await page.goto('/operator');
  await settled(page);
  await own.getByRole('radio', { name: 'In use' }).click();
  await expect(own.getByRole('radio', { name: 'In use' })).toHaveAttribute('aria-checked', 'true');
  await expect(own.getByText('Suspended', { exact: true })).toBeHidden();

  // Settings back as they were: stewards make families, no legal texts.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel(/Stewards and operators/).check();
  await page.getByLabel('Legal notice (Impressum)').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.getByRole('cell', { name: 'Made a family' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Suspended a family' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Closed a family' })).toBeVisible();

  // The invited steward joins the operator's family with a passkey of their own.
  const invited = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(invited);
  const quinn = await invited.newPage();
  await addPasskeyDevice(quinn);
  await quinn.goto(inviteUrl);
  await settled(quinn);
  await quinn.getByLabel('What should the family call you?').fill('Quinn Quillford');
  await quinn.getByRole('button', { name: 'Create your passkey' }).click();
  await expect(quinn.getByRole('heading', { name: 'Who are you in this family?' })).toBeVisible();
  await quinn.goto('/the-quillfords');
  await settled(quinn);
  await expect(quinn.getByText('The Quillfords').first()).toBeVisible();
  await invited.close();

  // Now the operator's family has its steward, and the operator is still no member of it.
  await page.goto('/operator');
  await settled(page);
  await expect(quill.getByText('Quinn Quillford')).toBeVisible();
  // The family's page answers the operator 404, as for anyone who is not a member.
  issues.allow(/status of 404 .*\/the-quillfords\)/);
  await page.goto('/the-quillfords');
  await settled(page);
  await expect(page.getByRole('heading', { name: 'You don’t have access to this family' })).toBeVisible();
});
