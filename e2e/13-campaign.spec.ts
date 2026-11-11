// Journey 13: the Campaign. A steward gathers a house from surnames (the game needs a house to rule), turns the game on
// under Games, plays a whole reign of this week's challenge (placing the levy, choosing a province, a target, the troops,
// and confirming), sees the server's score in the family's table and on Today, and tries a practice reign, which counts
// for nothing.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('campaign: a steward turns it on, plays a reign to the table, and a practice reign is not counted', async ({ page }) => {
  test.setTimeout(180_000);
  // The regents' attacks are replayed one by one; with reduced motion they are listed at once, which keeps this short.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const tree = await openFamily(page);

  // Off by default: no section in the bar, but it can be found under More, where it is "resting"; and the page says so.
  const bar = page.getByRole('navigation', { name: 'Sections' }).first();
  await expect(bar.getByRole('link', { name: 'The Campaign' })).toHaveCount(0);
  await bar.getByRole('button', { name: /^More/ }).click();
  await expect(bar.getByRole('list', { name: 'More sections' }).getByRole('link', { name: /^Campaign.*Resting/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // The first visit explains the game once. While it is off, a practice reign is the main action.
  await page.goto(`/${tree}/campaign`);
  await settled(page);
  const how = page.getByRole('dialog', { name: 'How the Campaign works' });
  await expect(how).toBeVisible();
  await expect(how.getByRole('button', { name: 'Try a practice reign' })).toHaveClass(/primary/);
  await how.getByRole('button', { name: 'Not now' }).click();
  await expect(how).toBeHidden();
  await expect(page.getByRole('button', { name: 'Turn the Campaign on for this family' })).toBeVisible();
  await expect(page.getByText(/This week’s challenge opens at once/)).toBeVisible();

  // The steward's own house, so there is a house to rule.
  await page.goto(`/${tree}/houses`);
  await settled(page);
  const fromSurnames = page.getByRole('button', { name: 'From surnames' }).first();
  if (await fromSurnames.isVisible()) {
    await fromSurnames.click();
    const dialog = page.getByRole('dialog', { name: 'Houses from surnames' });
    await dialog.getByRole('button', { name: 'Select all' }).click();
    await dialog.getByRole('button', { name: /^Create \d+ houses?$/ }).click();
    await expect(dialog).toBeHidden();
  }

  await page.goto(`/${tree}/settings/games`);
  await settled(page);
  await checkAxe(page, 'games settings');
  const toggle = page.getByRole('switch', { name: 'The Campaign is on for this family' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Members can play this week’s challenge now.')).toBeVisible();

  // The section appears, with this week's challenge and an empty table.
  await page.getByRole('link', { name: 'Open the Campaign' }).click();
  await page.waitForURL(/\/campaign$/);
  await settled(page);
  await expect(page.getByRole('navigation', { name: 'Sections' }).first().getByRole('link', { name: 'The Campaign' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();
  await expect(page.getByText(/This week’s challenge · until /)).toBeVisible();
  await expect(page.getByTestId('week-me')).toHaveText('You have not played this week yet.');
  await expect(page.getByText('Nobody has finished a reign this week yet.')).toBeVisible();
  await page.getByRole('button', { name: 'How it works' }).click();
  await expect(how).toBeVisible();
  await checkAxe(page, 'campaign, how it works');
  await how.getByRole('button', { name: 'Got it' }).click();
  await checkAxe(page, 'campaign');

  // A reign begins on the server's field.
  await page.getByRole('button', { name: 'Begin a reign' }).click();
  await expect(page.getByRole('heading', { name: /^The reign of /, level: 1 })).toBeVisible();
  const orders = page.getByRole('complementary', { name: 'Your orders' });
  await expect(orders.getByRole('heading', { name: 'Turn 1 of 12' })).toBeVisible();
  await expect(orders.getByRole('listitem').filter({ hasText: 'Reinforce' })).toHaveAttribute('aria-current', 'step');

  // Step 1: each press on a province of one's own places one troop; Undo takes it back.
  const mine = page.locator('.cm-prov[data-mine]').first();
  const name = (await mine.getAttribute('data-province'))!;
  const waiting = async () => Number((await orders.getByRole('heading', { name: /^Place your levy/ }).textContent())!.match(/\d+/)![0]);
  const levy = await waiting();
  expect(levy).toBeGreaterThanOrEqual(3);
  await mine.focus();
  await page.keyboard.press('Enter');
  expect(await waiting()).toBe(levy - 1);
  await orders.getByRole('button', { name: 'Undo' }).click();
  expect(await waiting()).toBe(levy);
  for (let i = 0; i < levy; i++) await mine.click();
  await checkAxe(page, 'campaign, reinforcing');

  // Step 2: choosing a province rings what it can reach; a ringed enemy opens the order bar with the exact chance.
  await expect(orders.getByRole('heading', { name: '3 orders left' })).toBeVisible();
  await mine.click();
  await expect(page.locator('.cm-prov.is-dim').first()).toBeVisible();
  const target = page.locator('.cm-prov[data-reach="attack"]').first();
  await expect(target).toBeVisible();
  await target.click();
  const order = orders.getByRole('region', { name: /^Attack .+ from / });
  await expect(order.getByTestId('chance')).toHaveText(/^\d+ against \d+ · .+: \d+%$/);
  await checkAxe(page, 'campaign, an order being made');
  // Fewer troops, a lower chance; Back and Escape step back without moving anything.
  const before = await order.getByTestId('chance').textContent();
  await order.getByRole('button', { name: 'One fewer' }).click();
  await expect(order.getByTestId('chance')).not.toHaveText(before!);
  await order.getByRole('button', { name: 'Back' }).click();
  await expect(order).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-prov.is-dim')).toHaveCount(0);
  await expect(orders.getByRole('heading', { name: '3 orders left' })).toBeVisible();
  // Then the attack itself, confirmed with the bar's button: the battle is shown, and an order is spent.
  await mine.click();
  await target.click();
  await order.getByRole('button', { name: /^Attack with \d+ troops?$/ }).click();
  const battle = page.getByRole('dialog', { name: /^The battle of / });
  await expect(battle).toBeVisible();
  await battle.getByRole('button', { name: 'Carry on' }).click();
  await expect(orders.getByRole('heading', { name: '2 orders left' })).toBeVisible();

  // The same provinces as a list, for a screen reader: choosing works the same way there.
  await page.getByRole('radio', { name: 'List' }).click();
  const list = page.getByRole('list', { name: 'The provinces' });
  await expect(list.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
  await checkAxe(page, 'campaign, list');
  await page.getByRole('radio', { name: 'Map' }).click();

  // The rest of the reign: end every turn; the regents' attacks are listed under the orders.
  for (let turn = 1; turn <= 12; turn++) {
    const end = orders.getByRole('button', { name: turn === 12 ? 'End the last turn' : 'End the turn' });
    await end.click();
    if (turn < 12) await expect(orders.getByRole('heading', { name: `Turn ${turn + 1} of 12` })).toBeVisible();
  }
  await expect(orders.getByRole('heading', { name: 'The reign is over' })).toBeVisible();
  // The score is the server's: it replayed the moves.
  const result = page.locator('.cg-result');
  await expect(result.getByRole('heading', { name: /^\d+ points$/ })).toBeVisible();
  await expect(result.getByTestId('result-rank')).toHaveText(/You are first of 1 this week/);
  const score = Number((await result.getByRole('heading', { name: /points$/ }).textContent())!.match(/\d+/)![0]);
  await result.getByRole('button', { name: 'Back to the table' }).click();
  await expect(page.getByTestId('week-me')).toHaveText(new RegExp(`^Your best this week: ${score}, after 1 reign\\. You are first of 1\\.$`));
  await expect(page.locator('.cg-table li.is-mine .cg-table-score')).toHaveText(String(score));

  // Today says where the steward stands.
  await page.goto(`/${tree}/today`);
  await settled(page);
  await expect(page.getByText('You are first of 1 this week')).toBeVisible();

  // The practice reign: any house, a fresh field, counted for nothing.
  await page.goto(`/${tree}/campaign`);
  await settled(page);
  await page.getByRole('button', { name: 'Practice', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Practice reign', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'On to the orders' }).click();
  await page.getByRole('button', { name: 'End the turn' }).click();
  await expect(page.getByRole('heading', { name: 'Turn 2 of 12' })).toBeVisible();
  await checkAxe(page, 'campaign, practice');
  await page.getByRole('button', { name: 'Back to the week' }).click();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();
  await expect(page.getByTestId('week-me')).toHaveText(new RegExp('after 1 reign\\.'));
});
