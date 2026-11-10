// Journey 19: on a person's page the reader tells the assistant "add that she emigrated in 1952, according to the passenger list".
// The fake provider answers with a card for the new source and a card for the emigration that cites it. Approved, the person's
// timeline shows the emigration with its "sourced" mark, and the family's Sources page lists the passenger list.
import type { Page } from '@playwright/test';
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const FULL = `${STEWARD.given} ${STEWARD.surname}`;

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
  if ((await assistant.getAttribute('aria-checked')) !== 'true') {
    await assistant.click();
    await page.getByRole('combobox', { name: 'Assistant chat: Provider' }).click();
    await page.getByRole('option', { name: 'Anthropic' }).click();
    await page.locator('#ai-budget-usd').fill('5');
    await page.getByRole('group', { name: 'Saving' }).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible();
  }
}

test('the assistant proposes a life event with its source, and approving puts both on the person', async ({ page }) => {
  const slug = await openFamily(page);
  await turnOnAssistant(page, slug);

  await page.goto(`/${slug}/people`);
  await settled(page);
  // The Register draws only the rows in view, and earlier journeys leave people in the family: search, so the row is there.
  await page.getByPlaceholder(/^Search by name/).fill(STEWARD.surname);
  const href = await page.locator('.reg-name a').filter({ hasText: STEWARD.given }).first().getAttribute('href');
  await page.goto(href!);
  await settled(page);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${FULL}`) })).toBeVisible();

  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('#ai-input').fill('add that she emigrated in 1952, according to the passenger list');
  await page.locator('.ai-send').click();

  const source = page.locator('.ai-card').filter({ hasText: 'New source: Passenger list' });
  const event = page.locator('.ai-card').filter({ hasText: `Add a life event for ${FULL}` });
  await expect(source).toBeVisible({ timeout: 20_000 });
  await expect(event).toBeVisible();
  // Each card says what it adds, for whom, and citing what.
  await expect(source).toContainText(`Emigration of ${FULL} (1952)`);
  await expect(event).toContainText('Emigration');
  await expect(event).toContainText('1952');
  await expect(event).toContainText('Passenger list (new, from its own card)');
  await checkAxe(page, 'assistant: event and source cards');

  // The source first, then the event that cites it.
  await source.getByRole('button', { name: 'Approve' }).click();
  await expect(source.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await event.getByRole('button', { name: 'Approve' }).click();
  await expect(event.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(event.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).first().click();

  // The person's page has both: the emigration among the life events, and the passenger list cited for it. A reload shows the same.
  await page.reload();
  await settled(page);
  // Where the timeline is drawn (it needs two moments), it shows the emigration with its "sourced" mark.
  const timeline = page.locator('.pp-timeline li').filter({ hasText: 'Emigration' });
  if (await timeline.count()) await expect(timeline.locator('.life-sourced')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(page.getByRole('region', { name: 'Life events' }).locator('.life-row').filter({ hasText: 'Emigration' })).toContainText('1952');
  const fact = page.getByRole('region', { name: 'Sources of the facts' }).locator('.life-fact').filter({ hasText: 'Emigration' });
  await fact.locator('.life-count').click();
  await expect(fact.locator('.life-cites')).toContainText('Passenger list');

  await page.goto(`/${slug}/research/sources`);
  await settled(page);
  await expect(page.getByText('Passenger list').first()).toBeVisible();
});
