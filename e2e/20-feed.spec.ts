// Journey 20: the family's feed. The new bar leads to the Gallery and Contacts on a wide screen and on a phone, with the
// Almanac and the Atlas under More; the steward writes a message with a picture and a link, about themself; it is on
// Today, on their own page and in the Gallery; a second member (invited, in a browser of their own) reacts and comments;
// the steward changes the message and removes it; a guest of a share link sees none of it, and has a bar that still
// makes sense. The page is checked at 390 px too.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const MESSAGE = 'We have moved to Aldersbrook!\n<b>Not bold</b>, and the photos are at https://example.org/sunday.';
const ME = `${STEWARD.given} ${STEWARD.surname}`;

test('feed: the new bar; a message with a picture; a second member answers; a guest sees none of it', async ({ page, browser, issues, baseURL }) => {
  // A long journey: three browsers, an upload and a share link.
  test.setTimeout(240_000);
  const tree = await openFamily(page);

  // ---------- the bar on a wide screen ----------
  const sections = page.getByRole('navigation', { name: 'Sections' }).first();
  const names = await sections.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('aria-label')));
  expect(names.slice(0, 5), 'the bar starts with Today, the tree, the Chronicle, the Gallery and Contacts').toEqual(['Today', 'Tree', 'Chronicle', 'Gallery', 'Contacts']);
  await sections.getByRole('button', { name: /^More/ }).click();
  const more = sections.getByRole('list', { name: 'More sections' });
  for (const name of ['Almanac', 'Atlas', 'Register', 'Houses', 'Needed', 'Research']) await expect(more.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(more.getByText('Look around')).toBeVisible();
  await page.keyboard.press('Escape');
  await sections.getByRole('link', { name: 'Contacts' }).click();
  await page.waitForURL(new RegExp(`/${tree}/contacts$`));
  await sections.getByRole('link', { name: 'Gallery' }).click();
  await page.waitForURL(new RegExp(`/${tree}/gallery$`));
  await sections.getByRole('link', { name: 'Today' }).click();
  await page.waitForURL(new RegExp(`/${tree}/today$`));
  await settled(page);

  // ---------- a message, with a picture, about someone ----------
  const feed = page.getByRole('region', { name: 'From the family' });
  await expect(feed).toBeVisible();
  // The cards that were Today before the feed are still here, beside it.
  await expect(page.getByRole('region', { name: 'Question of the week' })).toBeVisible();
  await feed.getByRole('button', { name: /^(What is new with you|Tell the family something)/ }).click();
  const composer = page.getByRole('dialog', { name: 'Write to the family' });
  await expect(composer.getByLabel('Your message')).toBeFocused();
  // Nothing to share yet.
  await expect(composer.getByRole('button', { name: 'Share with the family' })).toBeDisabled();
  await composer.getByLabel('Your message').fill(MESSAGE);
  await composer.locator('input[type=file]').setInputFiles({ name: 'house.png', mimeType: 'image/png', buffer: PNG });
  await expect(composer.getByRole('list', { name: 'Pictures' }).getByRole('img', { name: 'Picture 1' })).toBeVisible();
  await composer.getByRole('button', { name: 'Add someone' }).click();
  await composer.getByRole('searchbox', { name: 'Who is it about?' }).fill(STEWARD.given);
  await composer.getByRole('list', { name: 'Who is it about?' }).getByRole('button', { name: new RegExp(`^${ME}`) }).first().click();
  await expect(composer.getByRole('button', { name: new RegExp(`^Remove ${ME}`) })).toBeVisible();
  await checkAxe(page, 'today, the composer');
  // The same window writes a memory for the Chronicle: who it is about comes first, as there.
  await composer.getByRole('radio', { name: 'A memory of someone' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a memory' }).getByRole('searchbox', { name: 'Who is it about?' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Add a memory' }).getByRole('radio', { name: 'A message' }).click();
  // What was typed is still there.
  await expect(composer.getByLabel('Your message')).toHaveValue(MESSAGE);
  await composer.getByRole('button', { name: 'Share with the family' }).click();
  await expect(composer).toBeHidden();

  const post = feed.getByRole('article', { name: `Message from ${ME}` }).filter({ hasText: 'We have moved to Aldersbrook!' });
  await expect(post).toBeVisible();
  // The words are text with their line break; only the address is a link, and a safe one.
  await expect(post.locator('.fd-body')).toHaveText(MESSAGE);
  await expect(post.locator('.fd-body b')).toHaveCount(0);
  const link = post.getByRole('link', { name: 'https://example.org/sunday' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(post.getByRole('img')).toHaveCount(1);
  // The picture's own address (a gallery picture), for what a guest is and is not served further down.
  const postPicture = /\/api\/media\/[a-z0-9-]+\/([a-z0-9-]+\.[a-z]+)/.exec((await post.getByRole('img').getAttribute('src'))!)![1]!;
  await expect(post.locator('.fd-about').getByRole('link', { name: new RegExp(`^${ME}`) })).toBeVisible();
  await checkAxe(page, 'today, with a message');

  // Its picture opens in the gallery's own window.
  await post.locator('.fd-pics button').click();
  const lightbox = page.getByRole('dialog', { name: /photo/i });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByRole('link', { name: 'Shared in a message to the family' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  // On the page of the person it is about, under their stories.
  await post.locator('.fd-about').getByRole('link').click();
  await page.waitForURL(new RegExp(`/${tree}/person/`));
  await settled(page);
  await page.getByRole('tab', { name: /^Stories/ }).click();
  await expect(page.getByRole('region', { name: 'From the family' }).getByText('We have moved to Aldersbrook!')).toBeVisible();

  // And its picture is in the Gallery, under "From messages".
  await page.goto(`/${tree}/gallery`);
  await settled(page);
  const fromMessages = page.getByRole('button', { name: /^From messages/ });
  await fromMessages.click();
  await expect(fromMessages).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gal-tile')).toHaveCount(1);

  // ---------- a second member reacts and comments ----------
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
  await cousin.getByRole('textbox', { name: 'What should the family call you?' }).fill('Cora Cousin');
  await cousin.getByRole('button', { name: 'Create your passkey' }).click();
  // The invitation asks who they are in the family: not in the tree yet.
  await cousin.getByRole('button', { name: 'Just browsing' }).click();
  await cousin.waitForURL((u) => !u.pathname.startsWith('/invite'));
  await cousin.getByRole('complementary', { name: 'Would you like a quick tour?' }).getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => undefined);
  await cousin.goto(`/${tree}/today`);
  await settled(cousin);
  const theirPost = cousin.getByRole('region', { name: 'From the family' }).getByRole('article', { name: `Message from ${ME}` }).filter({ hasText: 'We have moved to Aldersbrook!' });
  await expect(theirPost).toBeVisible();
  // Someone else's message: nothing to change or remove it with.
  await expect(theirPost.getByRole('button', { name: 'Change your message' })).toHaveCount(0);
  await expect(theirPost.getByRole('button', { name: /^Remove the message/ })).toHaveCount(0);
  const heart = theirPost.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /❤️/ });
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await theirPost.getByRole('button', { name: 'Comment' }).click();
  const thread = theirPost.getByRole('region', { name: 'Comments' });
  await thread.getByRole('textbox', { name: 'Your comment' }).fill('We will come and see it.');
  await thread.getByRole('button', { name: 'Send' }).click();
  await expect(thread.locator('.resp-comment').first()).toContainText('We will come and see it.');
  // A contributor writes too: a short message of their own.
  await cousin.getByRole('button', { name: /^(What is new with you|Tell the family something)/ }).click();
  const theirComposer = cousin.getByRole('dialog', { name: 'Write to the family' });
  await theirComposer.getByLabel('Your message').fill('Hello from Cora.');
  await theirComposer.getByRole('button', { name: 'Share with the family' }).click();
  await expect(theirComposer).toBeHidden();
  await expect(cousin.getByRole('article', { name: 'Message from Cora Cousin' })).toBeVisible();
  await theirs.close();

  // The steward reads the answer, and "What's new" says who wrote.
  await page.goto(`/${tree}/today`);
  await settled(page);
  await expect(post.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /❤️/ })).toHaveAccessibleName('❤️ 1 – from 1 person');
  await post.getByRole('button', { name: '1 comment' }).click();
  await expect(post.getByRole('region', { name: 'Comments' }).getByText('We will come and see it.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'What’s new' }).getByText('Cora Cousin wrote to the family')).toBeVisible();
  // An editor may remove anyone's message, and nobody changes another's.
  const coras = feed.getByRole('article', { name: 'Message from Cora Cousin' });
  await expect(coras.getByRole('button', { name: 'Remove the message by Cora Cousin' })).toBeVisible();
  await expect(coras.getByRole('button', { name: 'Change your message' })).toHaveCount(0);

  // ---------- a phone ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${tree}/today`);
  await settled(page);
  const tabs = page.locator('.tabbar');
  expect(await tabs.locator('a, button').evaluateAll((items) => items.map((i) => i.textContent?.trim()))).toEqual(['Today', 'Tree', 'Gallery', 'Contacts', 'More']);
  // The cards are a strip of buttons above the feed, one open at a time; the feed is what the screen is for.
  await expect(page.getByRole('region', { name: 'Question of the week' })).toBeHidden();
  const strip = page.getByRole('group', { name: 'More from today' });
  await strip.getByRole('button', { name: 'Question' }).click();
  await expect(page.getByRole('region', { name: 'Question of the week' })).toBeVisible();
  await strip.getByRole('button', { name: /^Quiz/ }).click();
  await expect(page.getByRole('region', { name: 'Question of the week' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Do you know your family?' })).toBeVisible();
  await strip.getByRole('button', { name: /^Quiz/ }).click();
  await expect(page.getByRole('region', { name: 'Do you know your family?' })).toBeHidden();
  await expect(post).toBeVisible();
  expect(await page.evaluate(() => { const p = document.querySelector('.page')!; return p.scrollWidth <= p.clientWidth && document.documentElement.scrollWidth <= window.innerWidth + 1; }), 'no sideways scrolling at 390 px').toBe(true);
  await checkAxe(page, 'today (phone), with messages');
  await tabs.getByRole('link', { name: 'Contacts' }).click();
  await page.waitForURL(new RegExp(`/${tree}/contacts$`));
  await tabs.getByRole('link', { name: 'Gallery' }).click();
  await page.waitForURL(new RegExp(`/${tree}/gallery$`));
  await tabs.getByRole('button', { name: 'More' }).click();
  const sheet = page.getByRole('dialog', { name: 'More' });
  // The Chronicle is first under More, and the Campaign can be found there whether it is on or resting.
  await expect(sheet.getByRole('link').first()).toHaveText(/^\s*Chronicle/);
  for (const name of ['Almanac', 'Atlas', 'Campaign']) await expect(sheet.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---------- the writer changes the message, and removes it ----------
  await page.goto(`/${tree}/today`);
  await settled(page);
  await post.getByRole('button', { name: 'Change your message' }).click();
  const editing = page.getByRole('dialog', { name: 'Change your message' });
  await editing.getByLabel('Your message').fill('We have moved to Aldersbrook, and the kettle is found.');
  await editing.getByRole('button', { name: 'Save' }).click();
  await expect(editing).toBeHidden();
  const changed = feed.getByRole('article', { name: `Message from ${ME}` }).filter({ hasText: 'the kettle is found' });
  await expect(changed.getByText('· changed')).toBeVisible();

  // ---------- a guest of a share link ----------
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).first().click();
  // The message is about the steward, who is living: even a link that shows the living shows a guest none of the feed.
  const protect = page.getByRole('dialog').getByRole('switch', { name: 'Protect living people' });
  if ((await protect.count()) && (await protect.getAttribute('aria-checked')) === 'true') await protect.click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();

  // The tree a guest lands on opens the steward's panel, whose members-only reads a guest is refused, as in journey 5.
  issues.allow(/Failed to load resource: the server responded with a status of 40[13]/);
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(visit);
  const guest = await visit.newPage();
  await guest.goto(url);
  await settled(guest);
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await settled(guest);
  // A guest's bar: the tree, the Chronicle, the Gallery and the Almanac. No Today, no Contacts, no Campaign.
  const guestBar = guest.getByRole('navigation', { name: 'Sections' }).first();
  expect(await guestBar.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('aria-label')))).toEqual(['Tree', 'Chronicle', 'Gallery', 'Almanac']);
  await guestBar.getByRole('button', { name: /^More/ }).click();
  await expect(guestBar.getByRole('list', { name: 'More sections' }).getByRole('link', { name: /^Campaign/ })).toHaveCount(0);
  await guest.keyboard.press('Escape');
  // Today sends a guest back to the tree, and the server gives them no feed.
  await guest.goto(`/${tree}/today`);
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await settled(guest);
  await expect(guest.getByText('We have moved to Aldersbrook')).toHaveCount(0);
  // The Gallery has no picture that came with a message, and no "From messages".
  await guest.goto(`/${tree}/gallery`);
  await settled(guest);
  await expect(guest.getByRole('button', { name: /^From messages/ })).toHaveCount(0);
  const tiles = await guest.locator('.gal-tile img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
  expect(tiles.some((src) => src.includes(postPicture)), 'a guest’s gallery does not list it').toBe(false);
  expect((await guest.request.get(`/api/media/${tree}/${postPicture}`)).status(), 'and it is not served to a guest').toBe(404);
  expect((await page.request.get(`/api/media/${tree}/${postPicture}`)).status(), 'a member is served it').toBe(200);
  // On the person's page a guest reads no message either.
  await guest.goto(`/${tree}/chronicle`);
  await settled(guest);
  await expect(guest.getByText('the kettle is found')).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Add a memory' })).toHaveCount(0);
  await visit.close();

  // ---------- removing it: the app asks first, and the picture leaves the Gallery too ----------
  await page.goto(`/${tree}/today`);
  await settled(page);
  await changed.getByRole('button', { name: `Remove the message by ${ME}` }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove this message?' });
  await expect(confirm.getByText('Its picture leaves the Gallery too.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove message' }).click();
  await expect(confirm).toBeHidden();
  await expect(feed.getByText('the kettle is found')).toHaveCount(0);
  expect((await page.request.get(`/api/media/${tree}/${postPicture}`)).status(), 'the picture went with its message').toBe(404);
});
