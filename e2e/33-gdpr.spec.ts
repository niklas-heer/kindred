// Journey 33: data protection (docs/gdpr.md). The operator makes a family for someone and records a breach that affects it; the
// invited steward signs up with a passkey, adds herself and a living relative, sees the breach notice, answers a request about
// the relative (finds her, downloads a copy, restricts and lifts, erases her with a passkey confirmation), downloads her own
// data and is told she cannot delete her account while she is the family's last steward. The operator downloads the record of
// processing activities, checks retention without deleting anything, sees the subprocessors on /legal and closes the breach.
// Leaves the server as it found it, but for the new family (as journey 27 leaves its own).
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

async function downloaded(page: Page, click: () => Promise<unknown>): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: file.suggestedFilename(), text: readFileSync((await file.path())!, 'utf8') };
}

test('data protection: a request about a relative, your own data, the breach register and the record', async ({ page, browser, issues, baseURL }) => {
  await openFamily(page);

  // The operator: a family for Elin, and the Privacy tab.
  await page.goto('/operator');
  await settled(page);
  const make = page.getByRole('region', { name: 'Make a family for someone' });
  await make.getByLabel('Name', { exact: true }).fill('The Erasmuses');
  await make.getByLabel('Its first steward').fill('Elin Erasmus');
  await make.getByRole('button', { name: 'Make the family and the link' }).click();
  const inviteUrl = await page.getByLabel('Invitation link for Elin Erasmus').inputValue();

  await page.getByRole('tab', { name: 'Privacy' }).click();
  await checkAxe(page, 'operator privacy');
  const md = await downloaded(page, () => page.getByRole('button', { name: 'Markdown' }).click());
  expect(md.name).toMatch(/^processing-record-\d{4}-\d{2}-\d{2}\.md$/);
  expect(md.text).toContain('# Record of processing activities (GDPR Art. 30)');
  const json = await downloaded(page, () => page.getByRole('button', { name: 'JSON' }).click());
  expect(JSON.parse(json.text).format).toBe('kindred-art30-record');
  // Retention: a check counts and deletes nothing; the job stays on reports.
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText('Now it would delete:')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Reports only' })).toHaveAttribute('aria-checked', 'true');
  // A breach that affects only the new family, with a notice for its stewards.
  await page.getByRole('button', { name: 'Record a breach' }).click();
  const form = page.locator('form.gdpr-breach-form');
  await form.getByLabel('Title').fill('Shared link sent to the wrong address');
  await form.getByLabel('Notice for the stewards of the families affected').fill('A share link of your family reached a stranger. Renew it.');
  await form.getByLabel('The Erasmuses').check();
  await form.getByLabel('Risk').selectOption('risk');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  const entry = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /Shared link sent to the wrong address/ }) });
  await expect(entry.getByText(/Tell the authority by/)).toBeVisible();
  await checkAxe(page, 'breach register');

  // Elin joins with a passkey of her own and starts her tree.
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(ctx);
  const elin = await ctx.newPage();
  await addPasskeyDevice(elin);
  await elin.goto(inviteUrl);
  await settled(elin);
  await elin.getByLabel('What should the family call you?').fill('Elin Erasmus');
  await elin.getByRole('button', { name: 'Create your passkey' }).click();
  await expect(elin.getByRole('heading', { name: 'Who are you in this family?' })).toBeVisible();
  await elin.goto('/the-erasmuses');
  await settled(elin);
  await elin.getByLabel('Given name').fill('Elin');
  await elin.getByLabel('Surname').fill('Erasmus');
  await elin.getByRole('button', { name: /Add me/ }).click();
  await expect(elin.getByRole('heading', { name: 'Elin Erasmus', level: 2, exact: true })).toBeVisible();
  // The tour is offered once the family has someone in it, that is now (FirstRun.tsx): its card sits over the tree's corner.
  await elin.getByRole('complementary', { name: 'Would you like a quick tour?' }).getByRole('button', { name: 'Not now' }).click();
  await elin.getByRole('button', { name: 'Add a partner of Elin Erasmus' }).click();
  const add = elin.getByRole('dialog', { name: 'Add a partner of Elin Erasmus' });
  await add.getByLabel('Given name').fill('Cleo');
  await add.getByLabel('Surname at birth').fill('Vandermeer');
  await add.getByRole('button', { name: /Create new/ }).last().click();
  await expect(add).toBeHidden();

  // The breach notice, for her as the family's steward.
  const notice = elin.getByRole('region', { name: 'A notice from the server’s operator' });
  await expect(notice.getByText('A share link of your family reached a stranger. Renew it.')).toBeVisible();
  await checkAxe(elin, 'breach notice');
  await notice.getByRole('button', { name: 'Hide this notice' }).click();
  await expect(notice).toBeHidden();

  // A request about Cleo: find her on Access, see where she appears, give her a copy, restrict, lift, erase.
  await elin.goto('/the-erasmuses/access');
  await settled(elin);
  const req = elin.getByRole('region', { name: 'A request about someone' });
  await req.getByLabel('Name', { exact: true }).fill('Cleo Vandermeer');
  await req.getByRole('button', { name: 'Find' }).click();
  await req.getByRole('button', { name: /^Cleo Vandermeer/ }).click();
  await expect(req.getByText(/They appear in \d+ place/)).toBeVisible();
  await checkAxe(elin, 'a request about someone');
  const copy = await downloaded(elin, () => req.getByRole('button', { name: 'Download a copy for them' }).click());
  expect(JSON.parse(copy.text)).toMatchObject({ format: 'kindred-subject-copy', person: { given: 'Cleo', surname: 'Vandermeer' } });
  await req.getByRole('button', { name: 'Restrict' }).click();
  await expect(req.getByText(/Restricted since/)).toBeVisible();
  await req.getByRole('button', { name: 'Lift the restriction' }).click();
  await expect(req.getByText(/Restricted since/)).toBeHidden();
  await req.getByRole('button', { name: 'Erase…' }).click();
  const erase = elin.getByRole('dialog', { name: 'Erase Cleo Vandermeer?' });
  await checkAxe(elin, 'erase dialog');
  await erase.getByLabel(/To confirm, type their name/).fill('Cleo Vandermeer');
  // Erasing asks for a fresh proof: the server's first answer is the 403 that has the browser confirm with the passkey.
  issues.allow(/status of 403 .*\/_serverFn\//);
  await erase.getByRole('button', { name: 'Erase for good' }).click();
  await expect(req.getByText(/^Erased: \d+ rows? removed or rewritten\.$/)).toBeVisible();
  await req.getByLabel('Name', { exact: true }).fill('Cleo');
  await req.getByRole('button', { name: 'Find' }).click();
  await expect(req.getByText('Nobody of that name is in the tree.')).toBeVisible();

  // Her own data: a download, and no deletion while she is the family's last steward.
  await elin.locator('[data-tour="account-menu"]').click();
  await elin.getByRole('menuitem', { name: 'Your data' }).click();
  const yours = elin.getByRole('dialog', { name: 'Your data' });
  const mine = await downloaded(elin, () => yours.getByRole('button', { name: 'Download (JSON)' }).click());
  const parsed = JSON.parse(mine.text);
  expect(parsed.format).toBe('kindred-account-export');
  expect(parsed.account.name).toBe('Elin Erasmus');
  expect(mine.text).not.toContain('Vandermeer');
  await expect(yours.getByText(/You are the last steward of The Erasmuses/)).toBeVisible();
  await checkAxe(elin, 'your data');
  await ctx.close();

  // The legal page lists the subprocessors (none on a local Node server with no AI key, address lookup off and no push).
  await page.goto('/legal');
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Subprocessors' })).toBeVisible();

  // The breach is closed again, so no notice is left behind.
  await page.goto('/operator?tab=privacy');
  await settled(page);
  await entry.getByRole('button', { name: 'Update' }).click();
  await page.locator('form.gdpr-breach-form').getByLabel('Closed: dealt with').check();
  await page.locator('form.gdpr-breach-form').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(entry.getByText('closed')).toBeVisible();
});
