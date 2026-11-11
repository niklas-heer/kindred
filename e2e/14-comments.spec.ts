// Journey 14: reactions and comments. The steward writes a memory, reacts to it in the Chronicle, comments with a line break,
// changes the comment and removes it after the confirmation; shares a photo and reacts to it in the gallery; and a guest of a
// share link sees the memory without any of it. The thread is checked at 390 px too.
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const MEMORY = 'The summer we built the boat behind the barn.';

test('comments: react, comment, change and remove on a memory; react to a photo; nothing for a guest', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);

  // A memory, written from the Chronicle.
  await page.goto(`/${tree}/chronicle`);
  await settled(page);
  await page.getByRole('button', { name: 'Add a memory' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add a memory' });
  await add.getByRole('searchbox', { name: 'Who is it about?' }).fill(STEWARD.given);
  await add.getByRole('list', { name: 'Who is it about?' }).getByRole('button', { name: `${STEWARD.given} ${STEWARD.surname}` }).click();
  await add.getByRole('textbox', { name: 'Story', exact: true }).fill(MEMORY);
  await add.getByRole('button', { name: /^Save/ }).click();
  await expect(add).toBeHidden();

  const entry = page.locator('.chr-item').filter({ hasText: MEMORY });
  await expect(entry).toBeVisible();
  const reactions = entry.getByRole('group', { name: 'Reactions' });

  // A reaction from the quick row: pressed at once, with its count in its name.
  const thanks = reactions.getByRole('button', { name: /🙏/ });
  await expect(thanks).toHaveAccessibleName('React with 🙏');
  await expect(thanks).toHaveAttribute('aria-pressed', 'false');
  await thanks.click();
  await expect(thanks).toHaveAttribute('aria-pressed', 'true');
  await expect(thanks).toHaveAccessibleName('🙏 (1 person)');
  // Any other emoji from the palette: found by name, given, and the palette closes.
  await reactions.getByRole('button', { name: 'More emoji' }).click();
  const palette = entry.getByRole('dialog', { name: 'Choose an emoji' });
  await palette.getByRole('searchbox').fill('sunflower');
  await palette.getByRole('button', { name: 'sunflower' }).click();
  await expect(palette).toBeHidden();
  await expect(reactions.getByRole('button', { name: /🌻/ })).toHaveAttribute('aria-pressed', 'true');

  // A comment with a line break, kept as plain text.
  await entry.getByRole('button', { name: 'Comment' }).click();
  const thread = entry.getByRole('region', { name: 'Comments' });
  await expect(thread.getByText('No comments yet.')).toBeVisible();
  await expect(thread.getByText(`🙏: ${STEWARD.given} ${STEWARD.surname}`)).toBeVisible();
  await thread.getByRole('textbox', { name: 'Your comment' }).fill('I held the hammer.\n<b>Not bold</b>');
  await thread.getByRole('button', { name: 'Send' }).click();
  const comment = thread.locator('.resp-comment').first();
  await expect(comment).toBeVisible();
  await expect(comment.locator('.resp-body')).toHaveText('I held the hammer.\n<b>Not bold</b>');
  await expect(comment.locator('b', { hasText: 'Not bold' })).toHaveCount(0);
  await expect(entry.getByRole('button', { name: '1 comment' })).toHaveAttribute('aria-expanded', 'true');
  await checkAxe(page, 'chronicle, a thread open');

  // Change it.
  await comment.getByRole('button', { name: 'Change your comment' }).click();
  const edit = comment.getByRole('textbox', { name: 'Change your comment' });
  await expect(edit).toBeFocused();
  await edit.fill('I held the nails.');
  await comment.getByRole('button', { name: 'Save' }).click();
  await expect(comment.locator('.resp-body')).toHaveText('I held the nails.');
  await expect(comment.getByText('· changed')).toBeVisible();

  // On a phone the thread fits without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(comment).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 390 px').toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Remove it: the app asks first.
  await thread.getByRole('button', { name: `Remove the comment by ${STEWARD.given} ${STEWARD.surname}` }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove this comment?' });
  await expect(confirm.getByText('I held the nails.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove comment' }).click();
  await expect(confirm).toBeHidden();
  await expect(thread.getByText('No comments yet.')).toBeVisible();
  await expect(entry.getByRole('button', { name: 'Comment' })).toBeVisible();

  // A photo, and a reaction to it in its window; the tile counts it.
  await page.goto(`/${tree}/gallery`);
  await settled(page);
  await page.getByRole('button', { name: 'Add photos' }).first().click();
  const upload = page.getByRole('dialog', { name: 'Add photographs' });
  await upload.locator('input[type=file]').setInputFiles({ name: 'boat.png', mimeType: 'image/png', buffer: PNG });
  await upload.getByRole('button', { name: /^Add 1 / }).click();
  await expect(upload).toBeHidden();
  await page.locator('.gal-tile').first().click();
  const box = page.getByRole('dialog', { name: /photo/i });
  const heart = box.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /❤️/ });
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  // Not axe on the whole lightbox here: its date field's small switch is below the target size already (not this feature's).
  await page.keyboard.press('Escape');
  await expect(page.locator('.gal-tile').first().locator('.resp-tally')).toContainText('1');
  await checkAxe(page, 'gallery with a tally');

  // A guest of a share link reads the memory and gets none of the reactions or comments.
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).first().click();
  // The memory is about the steward, who is living: this link shows the living, so the guest reads it.
  const protect = page.getByRole('dialog').getByRole('switch', { name: 'Protect living people' });
  if ((await protect.count()) && (await protect.getAttribute('aria-checked')) === 'true') await protect.click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  // A replaced link keeps the protection the one before it had (an earlier journey's): switch it off on the card, once
  // the card shows the new link.
  const living = page.getByRole('switch', { name: 'Protect living people' }).first();
  await expect(living).toBeVisible();
  if ((await living.getAttribute('aria-checked')) === 'true') await living.click();
  await expect(living).toHaveAttribute('aria-checked', 'false');
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();

  // The tree a guest lands on opens the steward's panel, whose members-only reads (sources) a guest is refused, as in journey 5.
  issues.allow(/Failed to load resource: the server responded with a status of 401/);
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(visit);
  const guest = await visit.newPage();
  await guest.goto(url);
  await settled(guest);
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await guest.goto(`/${tree}/chronicle`);
  await settled(guest);
  await expect(guest.getByText(MEMORY)).toBeVisible();
  await expect(guest.getByRole('group', { name: 'Reactions' })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: /comment/i })).toHaveCount(0);
  await guest.goto(`/${tree}/gallery`);
  await settled(guest);
  await expect(guest.locator('.resp-tally')).toHaveCount(0);
  await visit.close();
});
