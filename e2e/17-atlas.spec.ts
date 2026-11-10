// Journey 17: the Atlas opens on where most of the family lived and offers the places beyond that view. "Show all" widens the
// map and offers the way back, with reduced motion too (a button drawn over the map once handed its click to the map's drag).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, openFamily, settled, test } from './fixtures.ts';

/** Births in four towns close together and one far away, written straight into the scratch family's database. */
function addBirthplaces(tree: string) {
  const d = new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, `${tree}.db`));
  d.exec('PRAGMA busy_timeout = 5000');
  const place = d.prepare('INSERT OR IGNORE INTO place (name, lat, lng, country) VALUES (?, ?, ?, ?)');
  const towns: [string, number, number, number][] = [['Uppsala', 59.86, 17.64, 4], ['Stockholm', 59.33, 18.07, 4], ['Västerås', 59.61, 16.55, 3], ['Örebro', 59.27, 15.21, 3], ['Melbourne', -37.81, 144.96, 1]];
  const person = d.prepare('INSERT OR IGNORE INTO person (id, given, surname, born, born_place, living, sex) VALUES (?, ?, ?, ?, ?, 0, ?)');
  for (const [name, lat, lng, n] of towns) {
    place.run(name, lat, lng, name === 'Melbourne' ? 'AU' : 'SE');
    for (let i = 0; i < n; i++) person.run(`e2e-atlas-${name}-${i}`, `Atlas${i}`, 'Mapperton', `19${10 + i}-01-02`, name, i % 2 ? 'm' : 'f');
  }
  d.close();
}

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('atlas: "Show all" widens the map to every place, and the way back returns', async ({ page }) => {
  const tree = await openFamily(page);
  addBirthplaces(tree);
  await page.goto(`/${tree}/atlas`);
  await settled(page);
  const transform = () => page.locator('.atlas-canvas svg g[transform]').first().getAttribute('transform');
  const before = await transform();
  await page.getByRole('button', { name: /1 place beyond this view · Show all/ }).click();
  await expect(page.getByRole('button', { name: 'Back to where most of the family lived' })).toBeVisible();
  expect(await transform()).not.toBe(before);
  await page.getByRole('button', { name: 'Back to where most of the family lived' }).click();
  await expect(page.getByRole('button', { name: /beyond this view · Show all/ })).toBeVisible();
  expect(await transform()).toBe(before);
});
