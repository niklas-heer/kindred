// Journey 9: text reaching the assistant's composer from outside the app, as a dictation app such as Wispr Flow sends it: a real
// paste, execCommand('insertText'), and a value set by script followed by an input event. Each must land, grow the box, and stay
// while a reply streams in, with the box still editable during the reply. Wispr Flow itself cannot run here.
import type { Page } from '@playwright/test';
import { expect, openFamily, settled, test } from './fixtures.ts';

async function turnOnAssistant(page: Page, slug: string) {
  await page.goto(`/${slug}/settings/ai`);
  await settled(page);
  const key = page.getByLabel('API key').first();
  if (await key.isVisible()) {
    await key.fill('sk-test-e2e-abcdefgh');
    await page.getByRole('button', { name: 'Save key' }).first().click();
    await expect(page.getByText('Connected').first()).toBeVisible();
  }
  const assistant = page.getByRole('switch', { name: 'Assistant chat' });
  if ((await assistant.getAttribute('aria-checked')) !== 'true') await assistant.click();
  await page.getByRole('combobox', { name: 'Assistant chat: Provider' }).click();
  await page.getByRole('option', { name: 'Anthropic' }).click();
  await page.locator('#ai-budget-usd').fill('5');
  await page.getByRole('group', { name: 'Saving' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible();
}

test('dictated text lands in the composer by paste, execCommand and a scripted value, and stays while a reply streams', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const slug = await openFamily(page);
  await turnOnAssistant(page, slug);
  await page.goto(`/${slug}`);
  await settled(page);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const box = page.locator('#ai-input');
  await expect(box).toBeFocused();

  // A real paste, then execCommand, then a value set by script: each adds to what is there and the box follows.
  const before = await box.evaluate((el) => (el as HTMLElement).offsetHeight);
  await page.evaluate(() => navigator.clipboard.writeText('Pasted by dictation. '));
  await page.keyboard.press('ControlOrMeta+v');
  await expect(box).toHaveValue('Pasted by dictation. ');
  await box.evaluate(() => { document.execCommand('insertText', false, 'From execCommand. '); });
  await expect(box).toHaveValue('Pasted by dictation. From execCommand. ');
  await box.evaluate((el: HTMLTextAreaElement) => {
    el.value += 'From a value set by script.\nAnd a second line, so the box has to grow.';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(box).toHaveValue(/From a value set by script/);
  await expect.poll(() => box.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThan(before);
  await expect(page.locator('.ai-send')).toBeEnabled();

  // Send, and go on dictating while the reply is written.
  await box.fill('Send this. FAKE-SLOW 2000');
  await page.locator('.ai-send').click();
  await expect(box).toBeFocused();
  await expect(box).toBeEnabled();
  await expect(page.locator('.ai-send')).toBeDisabled();
  await box.evaluate(() => { document.execCommand('insertText', false, 'While the reply is written.'); });
  await box.evaluate((el: HTMLTextAreaElement) => { el.value += ' And more.'; el.dispatchEvent(new Event('input', { bubbles: true })); });

  await expect(page.locator('.ai-log')).toContainText('Fake reply', { timeout: 20_000 });
  await expect(page.locator('.ai-send')).toBeEnabled();
  await expect(box).toHaveValue('While the reply is written. And more.');
  await expect(box).toBeFocused();

  // A draft stays with its chat across a reload.
  await page.reload();
  await settled(page);
  await expect(page.locator('#ai-input')).toHaveValue('While the reply is written. And more.');
});
