// Journey 18: "View as". A steward previews the family as a viewer (no edit controls, a reaction refused with a gentle notice),
// as a member linked to a person (the tree says "you" there), and as a guest of a share link that protects living people (a
// living person's dates are held back), then stops and can change things again. The bar works at 390 px and by keyboard.
import type { Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

const MEMBER = { id: '00000000-0000-4000-8000-00000000e218', name: 'Milo Previewson' };
const MEMORY = 'The winter the lake froze over and everyone skated.';

/** A living relative, a memory, and a member linked to the relative, written straight into the scratch databases. */
function addFamily(tree: string) {
  const data = process.env.KINDRED_E2E_DATA!;
  const d = new DatabaseSync(join(data, `${tree}.db`));
  d.exec('PRAGMA busy_timeout = 5000');
  d.prepare('INSERT OR IGNORE INTO person (id, given, surname, born, born_place, living, sex) VALUES (?, ?, ?, ?, ?, 1, ?)').run('e2e-milo', 'Milo', 'Previewson', '1961-03-14', 'Quietbrook', 'm');
  d.prepare("INSERT OR IGNORE INTO story (id, person, kind, body, author, at) VALUES ('e2e-view-as-story', 'e2e-milo', 'memory', ?, 'Milo', '2026-01-02T10:00:00Z')").run(MEMORY);
  d.close();
  const a = new DatabaseSync(join(data, 'accounts.db'));
  a.exec('PRAGMA busy_timeout = 5000');
  a.prepare('INSERT OR IGNORE INTO user (id, name, handle, created, last_seen) VALUES (?, ?, ?, ?, ?)').run(MEMBER.id, MEMBER.name, 'e2e-view-as-handle', Date.now(), Date.now());
  a.prepare("INSERT OR IGNORE INTO membership (user, tree, role, person, person_confirmed, created) VALUES (?, ?, 'contributor', 'e2e-milo', 1, ?)").run(MEMBER.id, tree, Date.now());
  a.close();
}

// The Register draws only the rows in view, and earlier journeys leave people in the family: search, so the row is there.
const findMilo = (page: Page) => page.getByPlaceholder(/^Search by name/).fill('Previewson');

test('view as: a viewer, a member, a guest of a protecting link, then stop', async ({ page, issues }) => {
  // A refused change answers 403, which the browser logs; that is the point of the step that causes it.
  issues.allow(/status of 403|403 \(Forbidden\)/);
  const tree = await openFamily(page);
  addFamily(tree);

  // A share link that protects living people (the default), so there is a guest to view the family as.
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).first().click();
  const making = page.getByRole('dialog');
  await making.getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  await expect(page.locator('.share-shown input').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // As the steward, the living relative's year is there.
  await page.goto(`/${tree}/people`);
  await settled(page);
  await findMilo(page);
  await expect(page.getByRole('gridcell', { name: '14 Mar 1961' })).toBeVisible();

  // 1. As a viewer, from the Access page.
  await page.goto(`/${tree}/access`);
  await settled(page);
  const see = page.getByRole('region', { name: 'See it as someone else' });
  await see.getByRole('button', { name: 'Viewer', exact: true }).click();
  await page.waitForURL(new RegExp(`/${tree}$`));
  await settled(page);
  const bar = page.getByRole('complementary', { name: 'Preview' });
  await expect(bar.getByText('Viewing as a viewer')).toBeVisible();
  await expect(bar.getByText('Nothing you do here is saved.')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Preview on.' })).toHaveText(/Viewing as a viewer/);
  await checkAxe(page, 'tree, viewing as a viewer');

  await page.goto(`/${tree}/chronicle`);
  await settled(page);
  await expect(page.getByRole('button', { name: 'Add a memory' })).toHaveCount(0);
  const entry = page.locator('.chr-item').filter({ hasText: MEMORY });
  await expect(entry).toBeVisible();
  const remember = entry.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /🙏/ });
  await remember.click();
  const notice = page.locator('.toast').filter({ hasText: 'Not saved: this is a preview' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('You are viewing as a viewer. Stop the preview to change something.');
  await expect(remember).toHaveAttribute('aria-pressed', 'false');

  // 2. Switch to the member, from the bar: the tree says "you" on their person.
  await bar.getByRole('button', { name: 'Switch…' }).click();
  const chooser = page.getByRole('dialog', { name: 'View the family as someone else' });
  await expect(chooser).toBeVisible();
  await checkAxe(page, 'view as chooser');
  await chooser.getByRole('button', { name: new RegExp(`^${MEMBER.name}`) }).click();
  await page.waitForURL(new RegExp(`/${tree}$`));
  await settled(page);
  await expect(bar.getByText(`Viewing as ${MEMBER.name}`)).toBeVisible();
  await expect(bar.getByText('Role: Contributor')).toBeVisible();
  // The tree opens on their person, with "you" on the card and in the panel.
  await expect(page.locator('.card-kin.me')).toHaveText(/you/i);
  await expect(page.getByText('This is you')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Milo Previewson' })).toBeVisible();

  // 3. A guest of the link, which protects living people: the relative's dates are held back.
  await bar.getByRole('button', { name: 'Switch…' }).click();
  await chooser.getByRole('button', { name: /^A guest of the share link/ }).click();
  await page.waitForURL(new RegExp(`/${tree}$`));
  await settled(page);
  await expect(bar.getByText('Viewing as a guest of the share link')).toBeVisible();
  await expect(bar.getByText('Living people protected')).toBeVisible();
  await page.goto(`/${tree}/people`);
  await settled(page);
  await findMilo(page);
  await expect(page.getByRole('link', { name: 'Milo Previewson' })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: '14 Mar 1961' })).toHaveCount(0);
  await checkAxe(page, 'register, viewing as a guest');

  // On a phone the bar fits, and Stop is reached by keyboard.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(bar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  const stop = bar.getByRole('button', { name: 'Stop the preview and see the family as yourself' });
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForLoadState('load');
  await settled(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  // 4. Stopped: the steward again, everything back, and changes work.
  await expect(page.getByRole('complementary', { name: 'Preview' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Preview stopped.' })).toHaveText('Preview stopped. You see the family as yourself again.');
  await findMilo(page);
  await expect(page.getByRole('gridcell', { name: '14 Mar 1961' })).toBeVisible();
  await page.goto(`/${tree}/chronicle`);
  await settled(page);
  await expect(page.getByRole('button', { name: 'Add a memory' }).first()).toBeVisible();
  const again = page.locator('.chr-item').filter({ hasText: MEMORY }).getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /🙏/ });
  await again.click();
  await expect(again).toHaveAttribute('aria-pressed', 'true');
});
