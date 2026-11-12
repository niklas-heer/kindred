// Journey 32: hosting and sign-up (docs/hosting-many-families.md, "Hosting and sign-up"). The operator turns the server into a
// host of families: sign-up is refused until the checklist's items are there, then it opens; a stranger on a phone sees the
// landing page (the operator's paragraph, no family named), switches language, starts a family with a passkey (Turnstile is the
// local stand-in, KINDRED_TURNSTILE_FAKE=1) and adds themselves; the operator sees the sign-up and makes a code. The journey
// puts every setting back, so the journeys after it see the server as before.
import { addPasskeyDevice, checkAxe, expect, FAMILY, settled, setTheme, test } from './fixtures.ts';

test('hosting: the landing page, sign-up with a passkey, and the operator’s Hosting tab', async ({ page, browser, issues, baseURL }) => {
  await page.goto('/operator?tab=hosting');
  await settled(page);
  const hosting = page.getByRole('tabpanel');
  await expect(hosting.getByRole('heading', { name: 'Ready to host?' })).toBeVisible();
  await expect(hosting.getByRole('listitem').filter({ hasText: 'Privacy policy' })).toHaveClass(/missing/);
  await hosting.getByLabel(/Hosting families/).check();
  await hosting.getByRole('textbox', { name: 'Your paragraph' }).fill('Run by Orla for the families of Sample Town.\nWrite to us any time.');
  await hosting.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(hosting.getByText('Saved.')).toBeVisible();
  await checkAxe(page, 'operator hosting tab');

  // Sign-up is refused while the legal texts and a storage cap are missing, and says what is.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel(/Anyone may start a family/).check();
  await expect(page.getByText(/Sign-up needs the hosting mode, Cloudflare Turnstile/)).toBeVisible();
  issues.allow(/status of 400 .*_serverFn/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Sign-up needs a few things first: impressum, privacy, terms, cap/)).toBeVisible();
  await page.getByLabel('Legal notice (Impressum)').fill('Orla Example\nSample Street 1\n12345 Sample Town');
  await page.getByLabel('Privacy policy').fill('We keep what your family writes, for your family.');
  await page.getByLabel('Terms of use').fill('Be kind. We process your family’s data for you, as you instruct us.');
  await page.getByLabel('Storage cap for new families, in MB').fill('500');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // A stranger on a phone: the landing page, in the app's theme, with no family named and nothing counted.
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  issues.watch(visit);
  const stranger = await visit.newPage();
  await addPasskeyDevice(stranger);
  await stranger.goto('/');
  await settled(stranger);
  await expect(stranger).toHaveURL(/\/$/);
  await expect(stranger.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(stranger.getByText('Run by Orla for the families of Sample Town.')).toBeVisible();
  await expect(stranger.getByRole('link', { name: 'Legal notice (Impressum)' })).toBeVisible();
  const body = await stranger.locator('body').innerText();
  expect(body.includes(FAMILY), 'the landing page names no family').toBe(false);
  expect(/\b\d+ (families|accounts|members)\b/i.test(body), 'and counts nothing').toBe(false);
  expect(await stranger.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await checkAxe(stranger, 'landing page');
  await setTheme(stranger, 'night');
  await checkAxe(stranger, 'landing page (night)');
  await setTheme(stranger, 'codex');

  // The language switch.
  await stranger.getByRole('combobox', { name: /: English$/ }).click();
  await stranger.getByRole('option', { name: 'Deutsch' }).click();
  await expect(stranger.getByRole('link', { name: 'Eine Familie anlegen' })).toBeVisible();
  await stranger.getByRole('combobox', { name: /: Deutsch$/ }).click();
  await stranger.getByRole('option', { name: 'English' }).click();

  // Starting a family: a passkey, the terms and the processing agreement, 16 or older, Turnstile's stand-in.
  await stranger.getByRole('link', { name: 'Start a family' }).click();
  await stranger.waitForURL(/\/signup$/);
  await settled(stranger);
  await stranger.getByLabel('Your name').fill('Ines Quillon');
  await stranger.getByLabel('The family’s name').fill('The Quillons');
  await expect(stranger.getByLabel('Its address')).toHaveValue('the-quillons');
  await stranger.getByLabel('Your email').fill('ines@example.org');
  await stranger.getByLabel(/I accept this server’s terms of use/).check();
  await stranger.getByLabel('I am 16 or older.').check();
  const go = stranger.getByRole('button', { name: 'Create your passkey and the family' });
  await expect(go).toBeDisabled();
  await stranger.getByLabel(/stand-in for Turnstile/).check();
  await checkAxe(stranger, 'sign-up form');
  expect(await stranger.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await go.click();
  await expect(stranger.getByLabel('Given name')).toHaveValue('Ines');
  await stranger.getByRole('button', { name: /Add me/ }).click();
  await stranger.waitForURL(/\/the-quillons$/);
  await settled(stranger);
  await expect(stranger.getByRole('heading', { name: 'Ines Quillon', level: 2, exact: true })).toBeVisible();
  await visit.close();

  // The operator sees who signed up and how to reach them, and makes a code.
  await page.goto('/operator?tab=hosting');
  await settled(page);
  await expect(hosting.getByRole('cell', { name: 'ines@example.org · not checked' })).toBeVisible();
  await expect(hosting.getByText(/Sign-up is on\. Today: 1/)).toBeVisible();
  await hosting.getByLabel('Label').fill('For the Ottleys');
  await hosting.getByRole('button', { name: 'Make a code' }).click();
  await expect(hosting.getByLabel(/^Code [A-Z2-9-]{14}, and its link$/)).toHaveValue(/\/signup\?code=[A-Z2-9-]{14}$/);
  await hosting.getByRole('button', { name: 'Withdraw' }).click();
  await expect(hosting.getByText('withdrawn')).toBeVisible();

  // Everything back as it was: stewards make families, no legal texts, one family's server.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel(/Stewards and operators/).check();
  for (const label of ['Legal notice (Impressum)', 'Privacy policy', 'Terms of use', 'Storage cap for new families, in MB']) await page.getByLabel(label).fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Hosting' }).click();
  await hosting.getByLabel(/For one family/).check();
  await hosting.getByRole('textbox', { name: 'Your paragraph' }).fill('');
  await hosting.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(hosting.getByText('Saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.getByRole('cell', { name: 'Made a sign-up code' })).toBeVisible();
});
