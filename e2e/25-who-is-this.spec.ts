// Journey 25: "Who is this?". The steward adds a photograph nobody is named in; the Gallery offers the game. A second member
// (invited, in a browser of their own) plays it: taps a face, names the steward, and is told it is a suggestion; their
// own suggestion is not theirs to confirm. The steward finds it waiting on Today, confirms it, and the photograph's window
// says who named them. The page is checked with axe and at 390 px.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

// A 40 × 30 picture, so the tap has room.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR42u3NMQ0AAAgDsIlFE5qQhQw4mvRvputExGKxWCwWi8VisVj8N15zHj3ZVogU+QAAAABJRU5ErkJggg==', 'base64');
const ME = `${STEWARD.given} ${STEWARD.surname}`;
// An earlier journey (08) may have given the steward an epithet, which follows the name: "Ada Testerby the Merged".
const MINE = `${ME}(?: [^,]+?)?`;

test('who is this: a member names someone, the steward confirms, the tag says who named them', async ({ page, browser, issues, baseURL }) => {
  test.setTimeout(180_000);
  const tree = await openFamily(page);

  // ---------- a photograph nobody is named in ----------
  await page.goto(`/${tree}/gallery`);
  await settled(page);
  await page.getByRole('button', { name: 'Add photos' }).first().click();
  const upload = page.getByRole('dialog', { name: 'Add photographs' });
  await upload.locator('input[type=file]').setInputFiles({ name: 'picnic.png', mimeType: 'image/png', buffer: PNG });
  await upload.getByRole('button', { name: /^Add 1 / }).click();
  await expect(upload).toBeHidden();
  await expect(page.getByRole('link', { name: 'Name the people in untagged photographs' })).toBeVisible();

  // ---------- a second member plays ----------
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  const inviting = page.getByRole('dialog');
  await inviting.getByRole('button', { name: 'Make an invitation link' }).click();
  const invitation = await inviting.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await inviting.getByRole('button', { name: 'Done' }).click();

  const theirs = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(theirs);
  const cousin = await theirs.newPage();
  await addPasskeyDevice(cousin);
  await cousin.goto(invitation.replace(/^https?:\/\/[^/]+/, ''));
  await cousin.getByRole('textbox', { name: 'What should the family call you?' }).fill('Wren Cousin');
  await cousin.getByRole('button', { name: 'Create your passkey' }).click();
  await cousin.getByRole('button', { name: 'Just browsing' }).click();
  await cousin.waitForURL((u) => !u.pathname.startsWith('/invite'));
  await cousin.getByRole('complementary', { name: 'Would you like a quick tour?' }).getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => undefined);

  await cousin.goto(`/${tree}/gallery`);
  await settled(cousin);
  await cousin.getByRole('link', { name: 'Name the people in untagged photographs' }).click();
  await cousin.waitForURL(new RegExp(`/${tree}/who-is-this$`));
  await settled(cousin);
  const game = cousin.getByTestId('who-is-this');
  await expect(cousin.getByRole('heading', { name: 'Who is this?', level: 1 })).toBeVisible();
  // The newest upload comes first: the steward's picnic.
  const photo = game.getByRole('button', { name: /^Tap a face/ });
  await photo.click({ position: { x: 40, y: 30 } });
  await expect(game.getByText('Face marked')).toBeVisible();
  await checkAxe(cousin, 'who is this, a photograph with a mark');
  await game.getByRole('searchbox', { name: 'Who is in this photograph?' }).fill(STEWARD.given);
  await game.getByRole('list', { name: 'Who is in this photograph?' }).getByRole('button', { name: new RegExp(`^${ME}`) }).first().click();
  await expect(game.getByRole('status').filter({ hasText: new RegExp(`Thank you! ${MINE} is suggested`) })).toBeVisible();
  await expect(game.getByText('You named 1 person this month.')).toBeVisible();
  // Their own suggestion is not theirs to confirm.
  await expect(game.getByText(new RegExp(`${MINE}, named by Wren Cousin`))).toHaveCount(0);

  // On a phone the photograph fits the screen.
  await cousin.setViewportSize({ width: 390, height: 844 });
  await cousin.reload();
  await settled(cousin);
  const scrolls = await cousin.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrolls, 'no sideways scrolling at 390 px').toBe(false);
  await theirs.close();

  // ---------- the steward confirms ----------
  await page.goto(`/${tree}/today`);
  await settled(page);
  const card = page.getByTestId('who-is-this');
  await expect(card.getByRole('heading', { name: 'Waiting for your confirmation' })).toBeVisible();
  const waiting = card.getByRole('listitem').filter({ hasText: new RegExp(`${MINE}, named by Wren Cousin`) });
  await waiting.getByRole('button', { name: 'Confirm' }).click();
  await expect(waiting.getByRole('status')).toHaveText('Tagged.');

  // The photograph's window says who is in it, and who named them.
  await page.goto(`/${tree}/gallery`);
  await settled(page);
  await page.locator('.gal-tile').first().click();
  const lightbox = page.getByRole('dialog', { name: /photo/i });
  await expect(lightbox.locator('.lb-chip').filter({ hasText: ME })).toBeVisible();
  await expect(lightbox.getByText('Named by Wren Cousin')).toBeVisible();
  await page.keyboard.press('Escape');

  // The tag is in the family's history.
  await page.goto(`/${tree}/history`);
  await settled(page);
  await expect(page.getByText(ME).first()).toBeVisible();
});
