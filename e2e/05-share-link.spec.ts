// Journey 5: a steward makes a share link, a guest comes in with it, sees only what a viewer may see, and cannot write.
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

test('share link: create, guest signs in, viewer only, writes refused', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);

  // A project only editors and stewards may see, and one everybody may.
  await page.goto(`/${tree}/research`);
  await settled(page);
  for (const [question, hidden] of [['Open question for all', false], ['Private question for editors', true]] as const) {
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('textbox', { name: 'Your question' }).fill(question);
    if (hidden) await dialog.getByRole('switch', { name: 'Keep this project to editors and stewards' }).click();
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/research\/.+/);
    await page.goto(`/${tree}/research`);
    await settled(page);
  }

  await page.goto(`/${tree}/access`);
  await settled(page);
  await checkAxe(page, 'access');
  await page.getByRole('button', { name: 'Make a link' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make a link' }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();

  // The steward's own write, recorded so the guest can try the very same call.
  await page.goto(`/${tree}`);
  await settled(page);
  await page.getByRole('button', { name: new RegExp(`^${STEWARD.given} ${STEWARD.surname}`) }).nth(1).click();
  await page.getByRole('tab', { name: 'Edit' }).click();
  // Filling the box is the whole act: the form saves it after a moment.
  const [write] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && (r.postData() ?? '').includes('the Guarded')),
    page.getByRole('textbox', { name: 'Epithet' }).fill('the Guarded'),
  ]);
  await expect(page.getByRole('complementary').getByRole('heading', { name: `${STEWARD.given} ${STEWARD.surname} the Guarded`, exact: true })).toBeVisible();

  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(visit);
  const guest = await visit.newPage();
  await guest.goto(url);
  await settled(guest);
  await checkAxe(guest, 'share link entry');
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await settled(guest);
  await checkAxe(guest, 'tree as guest');

  await expect(guest.getByText('Guest', { exact: true }).first()).toBeVisible();
  await expect(guest.getByRole('tab', { name: 'Edit' })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: /^Add a (partner|parent|child|sibling) of/ })).toHaveCount(0);

  await guest.goto(`/${tree}/research`);
  await settled(guest);
  await expect(guest.getByText('Open question for all')).toBeVisible();
  await expect(guest.getByText('Private question for editors')).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'New project' })).toHaveCount(0);

  await guest.goto(`/${tree}/access`);
  await settled(guest);
  await expect(guest.getByRole('heading', { name: 'Share with a link' })).toHaveCount(0);

  // The server must refuse it even when the buttons are missing. The refused call logs a failed request by design.
  issues.allow(/Failed to load resource/);
  const headers = { 'content-type': write.headers()['content-type'] ?? 'application/json', accept: write.headers().accept ?? 'application/json', 'x-tsr-serverfn': write.headers()['x-tsr-serverfn'] ?? 'true' };
  const refused = await guest.evaluate(async ({ url, body, headers }) => {
    const r = await fetch(url, { method: 'POST', headers, body });
    return { status: r.status, text: await r.text() };
  }, { url: write.url(), body: write.postData()!.replace('the Guarded', 'written by a guest'), headers });
  expect([401, 403], refused.text.slice(0, 300)).toContain(refused.status);

  await page.reload();
  await settled(page);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(page.getByRole('textbox', { name: 'Epithet' })).toHaveValue('the Guarded');

  await visit.close();
});
