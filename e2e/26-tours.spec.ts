// Journey 26: the tours. The Tours dialog starts either one. Welcome waits for the reader to open the search and goes
// on by itself when they do, or does it for them ("Show me"). The grand tour has chapters that can be skipped, paused
// and picked up again, and it ends with a closing card. In a steward's preview the tours are the previewed role's. On a
// phone the card stays on the screen.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';
import type { Locator, Page } from '@playwright/test';

const card = (page: Page) => page.locator('.tour-card');
const title = (page: Page, name: string) => card(page).getByRole('heading', { name, exact: true });

async function openTours(page: Page) {
  await page.locator('.acct-trigger').click();
  await page.getByRole('menuitem', { name: 'Tours' }).click();
  const hub = page.getByRole('dialog', { name: 'Tours' });
  await expect(hub).toBeVisible();
  return hub;
}

test('Welcome waits for the search to be opened, and "Show me" opens it', async ({ page }) => {
  await openFamily(page);
  const hub = await openTours(page);
  await checkAxe(page, 'tours dialog');
  await hub.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(title(page, 'Welcome to Kindred')).toBeVisible();
  await checkAxe(page, 'tour card');
  await page.keyboard.press('ArrowRight');
  await expect(title(page, 'Today')).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
  await card(page).getByRole('button', { name: 'Next' }).click();

  // The step asks for the search. The page is the reader's now: ⌘K opens the palette, and the tour goes on by itself.
  await expect(title(page, 'Find anyone')).toBeVisible();
  await expect(card(page).getByText('Your turn: open the search.')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.locator('.palette-input')).toBeVisible();
  await expect(title(page, 'Tree')).toBeVisible();
  await expect(page.locator('.palette-input')).toBeHidden();

  // Back to the same step: this time the tour does it.
  await page.keyboard.press('ArrowLeft');
  await expect(title(page, 'Find anyone')).toBeVisible();
  await card(page).getByRole('button', { name: 'Show me' }).click();
  await expect(page.locator('.palette-input')).toBeVisible();
  await expect(title(page, 'Tree')).toBeVisible();

  // To the end: the closing card offers the grand tour, and Done goes back to where the tour began.
  for (let i = 0; i < 12 && !(await card(page).getByRole('button', { name: 'Done' }).isVisible()); i++) {
    const skip = card(page).getByRole('button', { name: 'Skip this' });
    await ((await skip.isVisible()) ? skip : card(page).getByRole('button', { name: 'Next' })).click();
    await expect(card(page)).not.toHaveAttribute('aria-busy', 'true');
  }
  await expect(title(page, 'You know your way around')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'The grand tour' })).toBeVisible();
  await card(page).getByRole('button', { name: 'Done' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/[^/]+\/?$/);

  // Escape leaves at any step.
  await (await openTours(page)).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(title(page, 'Welcome to Kindred')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
});

test('the grand tour skips, pauses and continues by chapter, and ticks off what was walked', async ({ page }) => {
  await openFamily(page);
  let hub = await openTours(page);
  await expect(hub.getByText(/^0 of \d+ chapters$/)).toBeVisible();
  await hub.getByRole('button', { name: 'Start the grand tour' }).click();
  await expect(title(page, 'The grand tour')).toBeVisible();
  await expect(card(page).getByText(/Chapter 1 of \d+ · Today/)).toBeVisible();

  // Skipping a chapter does not tick it; pausing keeps the place.
  await card(page).getByRole('button', { name: 'Skip chapter' }).click();
  await expect(card(page).getByText(/Chapter 2 of \d+ · Tree/)).toBeVisible();
  await card(page).getByRole('button', { name: 'Pause' }).click();
  await expect(card(page)).toHaveCount(0);
  hub = await openTours(page);
  await expect(hub.getByText(/^0 of \d+ chapters$/)).toBeVisible();
  await expect(hub.getByRole('button', { name: /^Continue the grand tour, chapter 2: Tree$/ })).toBeVisible();

  // A chapter can be opened from the list. "A person" asks for two tabs: one the reader opens, one the tour opens.
  await hub.getByRole('button', { name: /A person/ }).click();
  await expect(title(page, 'A person’s page')).toBeVisible();
  await expect(page).toHaveURL(/\/person\//);
  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(title(page, 'Everyday details')).toBeVisible();
  await page.locator('[data-tour="person-tab-everyday"]').click();
  await expect(title(page, 'Editing')).toBeVisible();
  await card(page).getByRole('button', { name: 'Show me' }).click();
  await expect(title(page, 'Fields that fold away')).toBeVisible();
  await expect(page.locator('[data-tour="person-edit"]')).toBeVisible();
  // The address step needs no address: with no address box open it shows the Edit tab.
  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(title(page, 'Addresses that complete themselves')).toBeVisible();

  // On through the rest of the chapter: leaving it by its last step ticks it.
  for (let i = 0; i < 6 && !(await card(page).getByText(/· Chronicle and Cookbook/).isVisible()); i++) {
    await card(page).getByRole('button', { name: 'Next' }).click();
    await expect(card(page)).not.toHaveAttribute('aria-busy', 'true');
  }
  await expect(card(page).getByText(/· Chronicle and Cookbook/)).toBeVisible();

  // Skip to the end: the closing card says how much was walked.
  for (let i = 0; i < 12 && (await card(page).getByRole('button', { name: 'Skip chapter' }).isVisible()); i++) {
    await card(page).getByRole('button', { name: 'Skip chapter' }).click();
    await expect(card(page)).not.toHaveAttribute('aria-busy', 'true');
  }
  await expect(title(page, 'That was the grand tour')).toBeVisible();
  await expect(card(page).getByText(/^1 of \d+ chapters walked\./)).toBeVisible();
  await card(page).getByRole('button', { name: 'Done' }).click();

  hub = await openTours(page);
  await expect(hub.getByText(/^1 of \d+ chapters$/)).toBeVisible();
  await expect(hub.locator('.tours-chapters [data-done]')).toHaveCount(1);
  await checkAxe(page, 'tours dialog, in progress');
  // Restart forgets the ticks.
  await hub.getByRole('button', { name: 'Restart' }).click();
  await expect(title(page, 'The grand tour')).toBeVisible();
  await page.keyboard.press('Escape');
  hub = await openTours(page);
  await expect(hub.locator('.tours-chapters [data-done]')).toHaveCount(0);
});

test('in a "View as" preview the tours work, and are the previewed role\'s', async ({ page }) => {
  const tree = await openFamily(page);
  // The steward has the stewards' chapter.
  let hub = await openTours(page);
  await expect(hub.locator('.tours-chapters li')).toHaveCount(10);
  await expect(hub.getByRole('button', { name: /For stewards/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('region', { name: 'See it as someone else' }).getByRole('button', { name: 'Viewer', exact: true }).click();
  await page.waitForURL(new RegExp(`/${tree}$`));
  await settled(page);
  const bar = page.getByRole('complementary', { name: 'Preview' });
  await expect(bar.getByText('Viewing as a viewer')).toBeVisible();

  // A viewer's tours: no stewards' chapter, and in "A person" nothing about editing.
  hub = await openTours(page);
  await expect(hub.locator('.tours-chapters li')).toHaveCount(9);
  await expect(hub.getByRole('button', { name: /For stewards/ })).toHaveCount(0);
  await hub.getByRole('button', { name: /A person/ }).click();
  await expect(title(page, 'A person’s page')).toBeVisible();
  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(title(page, 'Everyday details')).toBeVisible();
  await card(page).getByRole('button', { name: 'Show me' }).click();
  await expect(card(page).getByText(/· Chronicle and Cookbook/)).toBeVisible();
  await card(page).getByRole('button', { name: 'Pause' }).click();

  await bar.getByRole('button', { name: 'Stop the preview and see the family as yourself' }).click();
  await page.waitForLoadState('load');
  await settled(page);
  await expect(page.getByRole('complementary', { name: 'Preview' })).toHaveCount(0);
});

test('on a phone the tour card and the Tours dialog stay on the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFamily(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: /^Tours/ }).click();
  const hub = page.getByRole('dialog', { name: 'Tours' });
  await expect(hub).toBeVisible();
  // The card glides to its place, so its edges are asked for until they have settled inside the screen.
  const inside = (what: string, el: Locator) => expect.poll(async () => {
    const box = await el.boundingBox();
    return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844;
  }, { message: `${what} is inside the screen` }).toBe(true);
  await inside('the grand tour button', hub.getByRole('button', { name: 'Start the grand tour' }));
  await hub.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(title(page, 'Welcome to Kindred')).toBeVisible();
  for (const name of ['Today', 'Find anyone']) {
    await card(page).getByRole('button', { name: 'Next' }).click();
    await expect(title(page, name)).toBeVisible();
    await inside(`the card at "${name}"`, card(page));
  }
  await inside('"Show me"', card(page).getByRole('button', { name: 'Show me' }));
  await checkAxe(page, 'tour card, a task on a phone');
  await page.keyboard.press('Escape');
});
