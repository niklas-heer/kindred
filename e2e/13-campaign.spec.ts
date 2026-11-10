// Journey 13: the Campaign. A steward gathers a house from surnames (the game needs a house to fight for), turns the
// game on under Games, gives an order on the map, and tries the practice skirmish, which runs in the browser.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('campaign: a steward turns it on, plays an order, and the practice skirmish opens', async ({ page }) => {
  const tree = await openFamily(page);

  // Off by default: no section in the navigation, and the page says so.
  await expect(page.getByRole('navigation', { name: 'Sections' }).first().getByRole('link', { name: 'The Campaign' })).toHaveCount(0);
  // The first visit explains the game once. While it is off there is no map to go to: the practice is the main action.
  await page.goto(`/${tree}/campaign`);
  await settled(page);
  const how = page.getByRole('dialog', { name: 'How the Campaign works' });
  await expect(how).toBeVisible();
  await expect(how.getByRole('button', { name: 'To the map' })).toHaveCount(0);
  await expect(how.getByRole('button', { name: 'Try a practice skirmish' })).toHaveClass(/primary/);
  await how.getByRole('button', { name: 'Not now' }).click();
  await expect(how).toBeHidden();

  // The steward's own house, so there is a side to play.
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
  await expect(page.getByText('Season 1 is being played.')).toBeVisible();

  // The section appears; "How it works" now goes back to the map.
  await page.getByRole('link', { name: 'Open the Campaign' }).click();
  await page.waitForURL(/\/campaign$/);
  await settled(page);
  await expect(how).toBeHidden();
  await page.getByRole('button', { name: 'How it works' }).click();
  await expect(how).toBeVisible();
  await checkAxe(page, 'campaign, how it works');
  await how.getByRole('button', { name: 'To the map' }).click();
  await expect(how).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Sections' }).first().getByRole('link', { name: 'The Campaign' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();
  await expect(page.getByText(/Season 1 · day 1 of 28/)).toBeVisible();
  await checkAxe(page, 'campaign');

  // An order: choose a province of the house with the keyboard, and muster the levy there.
  const orders = page.getByRole('complementary', { name: 'Your orders' });
  await expect(orders.getByTestId('orders-left')).toHaveText('3');
  const mine = page.locator('.cm-prov[data-mine]').first();
  const name = (await mine.getAttribute('data-province'))!;
  await mine.focus();
  await page.keyboard.press('Enter');
  await expect(orders.getByRole('heading', { name, level: 3 })).toBeVisible();
  await checkAxe(page, 'campaign, a province chosen');
  const levy = Number(await orders.getByTestId('levy-waiting').textContent());
  await orders.getByRole('button', { name: /^Muster \d+ troops? at / }).click();
  await expect(orders.getByTestId('orders-left')).toHaveText('2');
  await expect(orders.getByTestId('levy-waiting')).not.toHaveText(String(levy));
  await expect(page.getByRole('region', { name: 'Chronicle of the campaign' }).getByText(new RegExp(`mustered \\d+ troops? at ${name}`))).toBeVisible();

  // The same provinces as a list, for a screen reader.
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.getByRole('list', { name: 'The provinces' }).getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
  await checkAxe(page, 'campaign, list');

  // A reload keeps what was played: the state is the server's.
  await page.reload();
  await settled(page);
  await expect(page.getByRole('complementary', { name: 'Your orders' }).getByTestId('orders-left')).toHaveText('2');

  // The practice skirmish: unlimited orders, and the regents move when the turn ends.
  await page.getByRole('button', { name: 'Practice skirmish' }).click();
  await expect(page.getByRole('heading', { name: 'Practice skirmish', level: 1 })).toBeVisible();
  await expect(page.getByText(/Turn 1 of 10/)).toBeVisible();
  await page.locator('.cm-prov[data-mine]').first().click();
  await page.getByRole('button', { name: /^Muster \d+ troops? at / }).click();
  await expect(page.getByRole('region', { name: 'Chronicle of the campaign' }).getByText(/mustered/)).toBeVisible();
  await page.getByRole('button', { name: 'End the turn' }).click();
  await expect(page.getByText(/Turn 2 of 10/)).toBeVisible();
  await checkAxe(page, 'campaign, practice');
  await page.getByRole('button', { name: 'Back to the campaign' }).click();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();
  // The practice changed nothing on the server.
  await expect(page.getByRole('complementary', { name: 'Your orders' }).getByTestId('orders-left')).toHaveText('2');
});
