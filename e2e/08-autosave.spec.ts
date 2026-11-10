// Journey 8: filling someone in on a phone. Each change saves itself, with no Save button: the status line, Undo, Next on the
// keyboard, adding a field in one tap, a failed save that retries, a draft that survives the page going away (and one whose
// write landed as the page went), someone else's edits (merged when they don't clash, shown when they do), and tapping a
// value on the Everyday tab to edit it where it is.
import type { Page } from '@playwright/test';
import { expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

const FULL = `${STEWARD.given} ${STEWARD.surname}`;

test.use({ viewport: { width: 390, height: 844 } });

const bar = (page: Page) => page.getByRole('group', { name: 'Saving' });
const status = (page: Page) => bar(page).getByRole('status');
const box = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

/** On a phone the person starts as a slim peek: tapping it opens the sheet with its tabs. */
async function openEditTab(page: Page) {
  const more = page.getByRole('button', { name: /^More about / });
  if (await more.isVisible()) await more.click();
  await page.getByRole('tab', { name: 'Edit' }).click();
}

async function openEdit(page: Page) {
  await openFamily(page);
  await page.getByRole('button', { name: new RegExp(`^${FULL}`) }).nth(1).click();
  await openEditTab(page);
  await expect(box(page, 'Called')).toBeVisible();
}

/** Sets a box to `text` and waits until the form says that is saved. */
async function saved(page: Page, name: string, text: string) {
  await box(page, name).fill(text);
  await expect(status(page)).toHaveText('All saved');
}

test('a change saves itself, and Undo takes it back', async ({ page }) => {
  await openEdit(page);
  await expect(status(page)).toHaveText('Changes save on their own');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);

  // The family is read afresh after a save: the form the reader is in has to stay where it is, focus and all.
  const reread = page.waitForResponse(async (r) => r.request().method() === 'GET' && r.url().includes('/_serverFn/') && (await r.text()).includes('"Addy"'));
  await saved(page, 'Called', 'Addy');
  await box(page, 'Called').focus();
  await (await reread).finished();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(box(page, 'Called')).toBeFocused();
  await bar(page).getByRole('button', { name: 'Undo' }).click();
  await expect(box(page, 'Called')).toHaveValue('');
  await expect(status(page)).toHaveText('All saved');
  await expect(bar(page).getByRole('button', { name: 'Undo' })).toHaveCount(0);

  await page.reload();
  await settled(page);
  await openEditTab(page);
  await expect(box(page, 'Called')).toHaveValue('');
});

test('Next goes to the next box, and a new phone number is one tap and a number away', async ({ page }) => {
  await openEdit(page);
  const given = box(page, 'Given name at birth');
  await expect(given).toHaveAttribute('enterkeyhint', 'next');
  await given.focus();
  await given.press('Enter');
  await expect(box(page, 'Surname at birth')).toBeFocused();

  await page.getByRole('group', { name: 'Choose a kind of field' }).getByRole('button', { name: 'Phone', exact: true }).click();
  const number = box(page, 'Number');
  await expect(number).toBeFocused();
  await expect(number).toHaveAttribute('inputmode', 'tel');
  await expect(number).toHaveAttribute('type', 'tel');
  await number.fill('+49 151 1234567');
  await expect(status(page)).toHaveText('All saved');

  // Changing who may see it is a change like any other.
  await page.getByRole('radiogroup', { name: 'Who can see this' }).getByRole('radio', { name: 'Editors' }).click();
  await expect(status(page)).toHaveText('All saved');

  await page.reload();
  await settled(page);
  await openEditTab(page);
  await expect(box(page, 'Number')).toHaveValue('+49 151 1234567');
  await expect(box(page, 'Number')).toHaveCount(1);
  await expect(page.getByRole('radiogroup', { name: 'Who can see this' }).getByRole('radio', { name: 'Editors' })).toHaveAttribute('aria-checked', 'true');
});

test('a half-written email waits for its domain while the rest is saved', async ({ page }) => {
  await openEdit(page);
  await page.getByRole('group', { name: 'Choose a kind of field' }).getByRole('button', { name: 'Email', exact: true }).click();
  await box(page, 'Email address').fill('ada@');
  await expect(status(page)).toHaveText('Check the fields marked in red. They save as soon as they are right.');
  await box(page, 'Email address').fill('ada@example.org');
  await expect(status(page)).toHaveText('All saved');
});

test('a failed save tries again and keeps what was typed', async ({ page, issues }) => {
  issues.allow(/Failed to load resource/);
  await openEdit(page);
  let blocked = 0;
  await page.route('**/*', (route) => {
    const r = route.request();
    if (r.method() === 'POST' && (r.postData() ?? '').includes('the Stubborn') && blocked < 1) {
      blocked += 1;
      return route.abort('failed');
    }
    return route.fallback();
  });
  await box(page, 'Epithet').fill('the Stubborn');
  await expect(status(page)).toHaveText('Not saved yet. Trying again…');
  await expect(box(page, 'Epithet')).toHaveValue('the Stubborn');
  await expect(status(page)).toHaveText('All saved');
  await page.unroute('**/*');

  await page.reload();
  await settled(page);
  await openEditTab(page);
  await expect(box(page, 'Epithet')).toHaveValue('the Stubborn');
});

test('a draft the server never got is there again after the page goes away', async ({ page, issues }) => {
  issues.allow(/Failed to load resource/);
  await openEdit(page);
  await page.route('**/*', (route) => {
    const r = route.request();
    return r.method() === 'POST' && (r.postData() ?? '').includes('the Unsaved') ? route.abort('failed') : route.fallback();
  });
  await box(page, 'Epithet').fill('the Unsaved');
  await expect(status(page)).toHaveText('Not saved yet. Trying again…');

  // The page going away writes once more; that write fails too, so the server never has it.
  await page.reload();
  await settled(page);
  await page.unroute('**/*');
  await openEditTab(page);
  await expect(box(page, 'Epithet')).toHaveValue('the Unsaved');
  await expect(status(page)).toHaveText('All saved');
});

test('a draft the server took as the page went away, its answer lost, is confirmed when the page is back', async ({ page, issues }) => {
  issues.allow(/Failed to load resource/);
  await openEdit(page);
  // The first write reaches the server, but the page never hears back; every later one fails before it gets there.
  let through = false;
  await page.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST' || !(r.postData() ?? '').includes('the Landed')) return route.fallback();
    if (!through) { through = true; await route.fetch(); }
    return route.abort('failed');
  });
  await box(page, 'Epithet').fill('the Landed');
  await expect(status(page)).toHaveText('Not saved yet. Trying again…');

  await page.reload();
  await settled(page);
  await page.unroute('**/*');
  await openEditTab(page);
  await expect(box(page, 'Epithet')).toHaveValue('the Landed');
  // Nothing is owed, but the reader typed this and never saw it saved: the line says it is, rather than starting afresh.
  await expect(status(page)).toHaveText('All saved');
});

test('leaving the tab straight after typing still saves', async ({ page }) => {
  await openEdit(page);
  await box(page, 'Epithet').fill('the Hasty');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('complementary').getByRole('heading', { name: `${FULL} the Hasty`, exact: true })).toBeVisible();
});

test('two people editing: separate changes are merged, the same change is shown and not overwritten', async ({ page, context }) => {
  await openEdit(page);
  const other = await context.newPage();
  await openEdit(other);

  // Different boxes: both stand.
  await saved(other, 'Title', 'Dr');
  await saved(page, 'Epithet', 'the Merged');
  await expect(box(page, 'Title')).toHaveValue('Dr');

  // The same box: the save stops, both versions are on screen, and the first person's stays until someone chooses.
  await other.reload();
  await settled(other);
  await openEditTab(other);
  await saved(other, 'Called', 'Theirs');
  await box(page, 'Called').fill('Mine');
  await expect(status(page)).toHaveText('Choose for each conflict first');
  await expect(page.getByText('Yours: Mine')).toBeVisible();
  await expect(page.getByText('Someone else’s: Theirs')).toBeVisible();
  await other.close();

  // Not chosen yet, and the page goes away: it comes back as the same question, and nothing has been written over theirs.
  await page.reload();
  await settled(page);
  await openEditTab(page);
  await expect(status(page)).toHaveText('Choose for each conflict first');
  await expect(page.getByText('Someone else’s: Theirs')).toBeVisible();

  await page.getByRole('button', { name: 'Use theirs' }).first().click();
  await expect(box(page, 'Called')).toHaveValue('Theirs');
  await expect(status(page)).toHaveText('All saved');
  await page.reload();
  await settled(page);
  await openEditTab(page);
  await expect(box(page, 'Called')).toHaveValue('Theirs');
});

test('on the Everyday tab a contact is added in a row and a value is edited where it is', async ({ page }) => {
  await openEdit(page);
  await page.getByRole('tab', { name: 'Everyday' }).click();

  const add = page.getByRole('textbox', { name: 'Contact details' });
  await page.getByRole('radiogroup', { name: 'Kind of contact' }).getByRole('radio', { name: 'Website' }).click();
  await expect(add).toHaveAttribute('inputmode', 'url');
  await add.fill('example.org');
  // Leaving the box adds it: there is nothing else to tap.
  await add.blur();
  await expect(page.getByRole('tabpanel', { name: /^Everyday/ }).getByRole('link', { name: 'example.org' })).toBeVisible();
  await expect(add).toHaveValue('');

  await page.getByRole('button', { name: 'Edit Website: example.org' }).click();
  const url = box(page, 'Web address');
  await expect(url).toBeFocused();
  await url.fill('example.com');
  await expect(status(page)).toHaveText('All saved');
  await bar(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('link', { name: 'example.com' })).toBeVisible();
});
