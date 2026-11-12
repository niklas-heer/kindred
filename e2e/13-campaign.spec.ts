// Journey 13: the Campaign. A steward gathers a house from surnames (the game needs a house to rule), turns the game on
// under Games, looks at this week's invented continent, plays a whole reign of the week's challenge (placing the levy,
// choosing a province, a target, the troops, and confirming), reads the reign's chronicle, sees the server's score and
// the reign's title in the family's table and on Today, finds a reign kept under earlier rules let go with a word, and
// tries a practice reign, which counts for nothing, with the board's scenes moving.
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
  // This week's field is an invented continent, shown as a picture before the reign begins: a name, and nothing to press.
  const picture = page.getByRole('img', { name: /^A map of [A-Z][a-z]+, this week’s continent/ });
  await expect(picture).toBeVisible();
  await expect(page.getByText(/^This week’s continent: [A-Z][a-z]+$/)).toBeVisible();
  await expect(page.locator('.cg-week-map [role="button"]')).toHaveCount(0);
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
  await expect(orders.getByText('Spring, year 1')).toBeVisible();
  // Sixteen provinces with invented names, and a legend that names every land and feature the map draws.
  await expect(page.locator('.cm-prov')).toHaveCount(16);
  const names = await page.locator('.cm-prov').evaluateAll((all) => all.map((p) => p.getAttribute('data-province') ?? ''));
  expect(new Set(names).size).toBe(16);
  for (const n of names) expect(n).toMatch(/^[A-Z][a-z]{4,17}$/);
  const legend = page.getByRole('list', { name: 'Reading the map' });
  for (const word of ['Plains', 'Forest', 'Highland', 'Marsh', 'Town', 'Seat', 'River', 'Mountains', 'Sea lane']) await expect(legend.getByText(word, { exact: true })).toBeVisible();
  await page.getByText('What each one does').click();
  await expect(page.getByText(/An attack across it is fought for 2 rounds, not 3\./)).toBeVisible();
  await expect(orders.getByRole('listitem').filter({ hasText: 'Reinforce' })).toHaveAttribute('aria-current', 'step');
  // Where renown comes from opens in a new tab, so the game stays.
  await expect(orders.getByRole('link', { name: /Information needed/ })).toHaveAttribute('target', '_blank');

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
  // The continent is new each week, so the province to order from is found, not assumed: one of the steward's own with
  // a neighbour it can attack (a seat next door is locked, and nobody crosses a ridge).
  let from = mine;
  for (const own of await page.locator('.cm-prov[data-mine]').evaluateAll((all) => all.map((p) => p.getAttribute('data-province')!))) {
    from = page.locator(`.cm-prov[data-province="${own}"]`);
    await from.click();
    if (await page.locator('.cm-prov[data-reach="attack"]').count()) break;
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('.cm-prov.is-dim').first()).toBeVisible();
  const target = page.locator(`.cm-prov[data-province="${await page.locator('.cm-prov[data-reach="attack"]').first().getAttribute('data-province')}"]`);
  await expect(target).toBeVisible();
  await target.click();
  const order = orders.getByRole('region', { name: /^Attack .+ from / });
  await expect(order.getByTestId('chance')).toHaveText(/^\d+% chance\s*\d+ against \d+$/);
  // The chance comes with everything the ground does to it, in words.
  await expect(order.getByTestId('modifiers').getByRole('listitem').first()).toHaveText(/^(Forest|Highland|Marsh|Town|Across the river|By sea|Open ground): /);
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
  await from.click();
  await target.click();
  await order.getByRole('button', { name: /^Attack with \d+ troops?$/ }).click();
  const battle = page.getByRole('dialog', { name: /^The battle of / });
  await expect(battle).toBeVisible();
  await expect(battle.getByText(/^The attacker’s chance: \d+%$/)).toBeVisible();
  await expect(battle.getByText(/^(Taken|Held)$/)).toBeVisible();
  await checkAxe(page, 'campaign, a battle');
  await battle.getByRole('button', { name: 'Carry on' }).click();
  await expect(orders.getByRole('heading', { name: '2 orders left' })).toBeVisible();

  // A reload comes back to the same turn: the tab keeps the reign and plays its moves again.
  await page.reload();
  await settled(page);
  await expect(page.getByRole('heading', { name: /^The reign of /, level: 1 })).toBeVisible();
  await expect(orders.getByRole('heading', { name: '2 orders left' })).toBeVisible();
  const kept = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('kindred:campaign:reign:'))!;
    return { key, week: (JSON.parse(sessionStorage.getItem(key)!) as { run: { week: string } }).run.week };
  });
  // Leaving asks first, since it ends the reign.
  await page.getByRole('button', { name: 'Leave the reign' }).click();
  const leaving = page.getByRole('dialog', { name: 'End this reign?' });
  await expect(leaving).toBeVisible();
  await leaving.getByRole('button', { name: 'Cancel' }).click();
  await expect(leaving).toBeHidden();
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
  await expect(result.getByTestId('result-rank')).toHaveText(/Your best reign yet!\s*You are first of 1 this week/);
  // The chronicle: the reign's title and why, its score in parts, and the provinces held turn by turn.
  await expect(result.locator('.cc-title')).toHaveText(/^\s*An? .+ reign\s/);
  await expect(result.getByRole('img', { name: /^Provinces held turn by turn: \d+ at the opening, \d+ at the end/ })).toBeVisible();
  await expect(result.getByText('Battles won')).toBeVisible();
  await checkAxe(page, 'campaign, the chronicle');
  const score = Number(await result.getByRole('heading', { name: /points$/ }).getAttribute('data-score'));
  await result.getByRole('button', { name: 'Back to the table' }).click();
  await expect(page.getByTestId('week-me')).toHaveText(new RegExp(`^Your best this week: ${score}, after 1 reign\\. You are first of 1\\.$`));
  await expect(page.locator('.cg-table li.is-mine .cg-table-score')).toHaveText(String(score));
  await expect(page.locator('.cg-table li.is-mine')).toHaveText(/1 reign · An? .+ reign/);
  await expect(page.locator('.cg-week-record')).toHaveText(new RegExp(`Your best reign so far: ${score} points\\.$`));

  // A reign this tab kept from before the invented continent (a map with no version, made from places) is let go with
  // a word, and the page goes on.
  await page.evaluate(({ key, week }) => {
    const old = { run: { id: 'old', week, seed: 's', field: { map: { provinces: [{ id: 0, name: 'Old Town', x: 500, y: 300, cell: [[0, 0], [9, 0], [9, 9]], real: true }], borders: [] }, sides: [], start: { turn: 0, holder: [null], troops: [2], pool: {}, seats: {}, orders: 3, won: {}, lost: {}, attacks: 0 } }, side: 'x', renown: 0, grant: 0 }, submit: true, moves: [{ t: 'end' }], opKey: 'old-key' };
    sessionStorage.setItem(key.replace(/[^:]+$/, 'old'), JSON.stringify(old));
  }, kept);
  await page.reload();
  await settled(page);
  await expect(page.getByText('The Campaign has a new map')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin a reign' })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('kindred:campaign:reign:')).length)).toBe(0);

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
  // Levy left after "On to the orders": the Reinforce step goes back to placing.
  await page.getByRole('button', { name: /^Back to placing: \d+ troops? of the levy/ }).click();
  await expect(page.getByRole('heading', { name: /^Place your levy/ })).toBeVisible();
  await page.getByRole('button', { name: 'On to the orders' }).click();
  await page.getByRole('button', { name: 'End the turn' }).click();
  await expect(page.getByRole('heading', { name: 'Turn 2 of 12' })).toBeVisible();
  await checkAxe(page, 'campaign, practice');
  // With motion allowed the board tells what happens: a regent's attack is shown on the map with a way to skip it, or
  // the new turn's banner comes up; either way the turn can be ended again once it has been told.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const end = page.getByRole('button', { name: 'End the turn' });
  await end.click();
  await expect(page.getByRole('heading', { name: 'Turn 3 of 12' })).toBeVisible();
  await expect(page.locator('.cm-caption, .cm-banner').first()).toBeVisible();
  const skip = page.locator('.cm-caption').getByRole('button', { name: 'Skip' });
  if (await skip.isVisible()) await skip.click();
  await expect(end).toBeEnabled();
  await expect(page.locator('.cm-caption')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Back to the week' }).click();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();
  await expect(page.getByTestId('week-me')).toHaveText(new RegExp('after 1 reign\\.'));
});
