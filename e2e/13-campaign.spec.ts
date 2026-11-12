// Journey 13: the Campaign. A steward gathers a house from surnames (the game needs a house to rule), turns the game on
// under Games, looks at this week's invented continent, plays a whole reign of the week's challenge (placing the levy,
// choosing a province, a target, the troops, and confirming), finds the turn's strip and the names of an order inside
// the view on a phone, leaves the reign (the day's counted one from the moment it began) and goes on with it from what
// the server kept, reads the reign's chronicle, sees the server's score and the reign's title in the family's table
// and on Today, begins a second reign the same day, which is extra, finds a reign kept under earlier rules let go with a
// word, and tries a practice reign, which counts for nothing, with the board's scenes moving.
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
  await expect(page.getByTestId('week-today')).toHaveText(/Today’s reign is still to play\. The first reign you begin today is the one that counts, from the moment it begins/);
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
  // The first reign begun today is the day's counted one, and the board says so.
  await expect(page.getByTestId('reign-counted')).toHaveText(/^Today’s counted reign: it counts from the moment it began\./);
  const orders = page.getByRole('complementary', { name: 'Your orders' });
  await expect(orders.getByRole('heading', { name: 'Turn 1 of 12' })).toBeVisible();
  await expect(orders.getByText('Spring, year 1')).toBeVisible();
  // Sixteen provinces with invented names, and a legend that names every land and feature the map draws.
  await expect(page.locator('.cm-prov')).toHaveCount(16);
  const names = await page.locator('.cm-prov').evaluateAll((all) => all.map((p) => p.getAttribute('data-province') ?? ''));
  expect(new Set(names).size).toBe(16);
  // A province carries what it is after a hyphen: "Drevost-fell".
  for (const n of names) expect(n).toMatch(/^[A-Z][a-z]{4,7}-[a-z]{3,5}$/);
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
  // On a phone the turn's panel is below the map, so a strip at the foot of the screen keeps the turn, what is left of
  // it, Undo and "End the turn" in reach; the legend is one line until it is opened.
  await page.setViewportSize({ width: 390, height: 844 });
  const strip = page.getByRole('group', { name: 'This turn' });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('Turn 1 of 12');
  await expect(strip).toContainText('2 orders left');
  await expect(strip.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'End the turn' })).toBeVisible();
  await expect(orders.getByRole('button', { name: 'End the turn' })).toBeHidden();
  // The turn's three steps come first in the panel there, each on one line: "Orders" with what is left of them.
  await expect(orders.locator('.cg-step-n')).toHaveText('2');
  const steps = await orders.locator('.cg-steps li').evaluateAll((all) => all.map((li) => ({ height: li.getBoundingClientRect().height, top: li.getBoundingClientRect().top })));
  expect(Math.max(...steps.map((b) => b.height))).toBeLessThan(40);
  expect(steps[0].top).toBeLessThan((await orders.getByRole('heading', { name: 'Turn 1 of 12' }).boundingBox())!.y);
  await expect(legend).toBeHidden();
  await expect(page.locator('.cg-terrain-legend summary').getByText('Reading the map')).toBeVisible();
  await expect(page.locator('.cg-terrain-legend summary').getByText('What each one does')).toBeHidden();
  // An order being chosen: the view moves in, and writes only the names of the provinces in play, inside what it shows.
  for (const own of await page.locator('.cm-prov[data-mine]').evaluateAll((all) => all.map((p) => p.getAttribute('data-province')!))) {
    await page.locator(`.cm-prov[data-province="${own}"]`).focus();
    await page.keyboard.press('Enter');
    if (await page.locator('.cm-prov[data-reach]').count()) break;
    await page.keyboard.press('Escape');
  }
  const inPlay = 1 + (await page.locator('.cm-prov[data-reach]').count());
  expect(inPlay).toBeGreaterThan(1);
  await expect(page.locator('.cm-badge')).toHaveCount(inPlay - 1);
  if (await page.locator('.cm-wrap[data-zoom]').count()) {
    await expect(page.locator('.cm-name')).toHaveCount(inPlay);
    const sheet = (await page.locator('.cm-wrap').boundingBox())!;
    for (const mark of await page.locator('.cm-name, .cm-badge').all()) {
      const box = (await mark.boundingBox())!;
      expect(box.x, 'a name or badge begins inside the map').toBeGreaterThanOrEqual(sheet.x - 1);
      expect(box.x + box.width, 'and ends inside it').toBeLessThanOrEqual(sheet.x + sheet.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(sheet.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);
    }
  } else await expect(page.locator('.cm-name')).toHaveCount(0);
  await checkAxe(page, 'campaign, an order on a phone');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-badge')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(strip).toBeHidden();

  // Leaving says what it means first: this is today's counted reign whatever happens, and it is kept to go on with.
  await page.getByRole('button', { name: 'Leave the reign' }).click();
  const leaving = page.getByRole('dialog', { name: 'Leave your reign for now?' });
  await expect(leaving).toBeVisible();
  await expect(leaving).toContainText('This is today’s counted reign; that was fixed when it began.');
  await expect(leaving).toContainText('Left unfinished, it counts for nothing, and no other reign you begin today can count in its place.');
  await leaving.getByRole('button', { name: 'Cancel' }).click();
  await expect(leaving).toBeHidden();
  await expect(orders.getByRole('heading', { name: '2 orders left' })).toBeVisible();
  // Left for now: the week's page offers to go on with it, and no fresh reign that would count. Today says so too.
  await page.getByRole('button', { name: 'Leave the reign' }).click();
  await leaving.getByRole('button', { name: 'Leave for now' }).click();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();
  await expect(page.getByTestId('week-today')).toHaveText(/Today’s counted reign is under way: turn 1 of 12\./);
  await expect(page.getByRole('button', { name: 'Begin a reign' })).toHaveCount(0);
  await checkAxe(page, 'campaign, a reign under way');
  // The tab has let its copy go: what comes back is what the server kept, up to the battle.
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('kindred:campaign:reign:')).length)).toBe(0);
  await page.goto(`/${tree}/today`);
  await settled(page);
  await expect(page.getByText('Today’s reign is under way. Finish it today for it to count.')).toBeVisible();
  await page.getByRole('link', { name: 'Continue the reign' }).click();
  await page.waitForURL(/\/campaign$/);
  await settled(page);
  await expect(page.getByTestId('week-today')).toHaveText(/Today’s counted reign is under way: turn 1 of 12\./);
  await page.getByRole('button', { name: 'Continue your reign' }).click();
  await expect(page.getByRole('heading', { name: /^The reign of /, level: 1 })).toBeVisible();
  await expect(orders.getByRole('heading', { name: 'Turn 1 of 12' })).toBeVisible();
  await expect(orders.getByRole('heading', { name: '2 orders left' })).toBeVisible();
  await expect(page.getByTestId('reign-counted')).toBeVisible();

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
  // A first reign is called that: it has beaten nothing, so it is not "your best", and one member is not "first of 1".
  await expect(result.getByTestId('result-rank')).toHaveText(/^Your first reign\.\s*You are alone on this week’s table so far, with \d+ points\.$/);
  await expect(result.getByTestId('result-extra')).toHaveCount(0);
  // The chronicle: the reign's title and why, its score in parts, and the provinces held turn by turn.
  await expect(result.locator('.cc-title')).toHaveText(/^\s*An? .+ reign\s/);
  await expect(result.getByRole('img', { name: /^Provinces held turn by turn: \d+ at the opening, \d+ at the end/ })).toBeVisible();
  await expect(result.getByText('Battles won')).toBeVisible();
  await checkAxe(page, 'campaign, the chronicle');
  const score = Number(await result.getByRole('heading', { name: /points$/ }).getAttribute('data-score'));
  await result.getByRole('button', { name: 'Back to the table' }).click();
  await expect(page.getByTestId('week-me')).toHaveText(new RegExp(`^Your best this week: ${score}, from 1 counted reign\\.\\s*Nobody else is on the table yet\\.$`));
  await expect(page.locator('.cg-table li.is-mine .cg-table-score')).toHaveText(String(score));
  await expect(page.locator('.cg-table li.is-mine')).toHaveText(/1 counted reign · An? .+ reign/);
  await expect(page.locator('.cg-week-record')).toHaveText(new RegExp(`Your best reign so far: ${score} points\\.$`));
  await expect(page.getByText('One reign a day counts: the first you begin.')).toBeVisible();
  // A house's total is called what it is.
  await page.getByRole('radio', { name: 'Houses' }).click();
  await expect(page.getByRole('heading', { name: 'Participation totals' })).toBeVisible();
  await page.getByRole('radio', { name: 'This week' }).click();
  // One reign a day counts: today's is played, and another begun now is extra and says so.
  await expect(page.getByTestId('week-today')).toHaveText(/Today’s counted reign is played\./);
  await page.getByRole('button', { name: 'Begin a reign' }).click();
  await expect(page.getByRole('heading', { name: /^The reign of /, level: 1 })).toBeVisible();
  await expect(page.getByText(/^An extra reign: you have already begun today’s counted reign, so this one is not ranked\./)).toBeVisible();
  await page.getByRole('button', { name: 'Leave the reign' }).click();
  await expect(page.getByRole('heading', { name: 'The Campaign', level: 1 })).toBeVisible();

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
  await expect(page.getByText('You are on this week’s table, alone so far')).toBeVisible();
  await expect(page.getByText('Today’s reign is played. Tomorrow’s counts again.')).toBeVisible();

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
  await expect(page.getByTestId('week-me')).toHaveText(new RegExp('from 1 counted reign\\.'));
});
