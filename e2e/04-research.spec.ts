// Journey 4: a research project with an uploaded document and a note, both on its timeline.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

// A one-pixel PNG. The server looks at what is really in an upload, so it has to be a real picture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('research: project, upload, note, timeline', async ({ page }) => {
  const tree = await openFamily(page);
  await page.goto(`/${tree}/research`);
  await settled(page);
  await checkAxe(page, 'research');

  await page.getByRole('button', { name: 'New project' }).first().click();
  const project = page.getByRole('dialog', { name: 'New project' });
  await project.getByRole('textbox', { name: 'Your question' }).fill('Where did this branch come from?');
  await project.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/research\/.+/);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Where did this branch come from?' })).toBeVisible();

  await page.getByRole('button', { name: 'Add document' }).first().click();
  const doc = page.getByRole('dialog', { name: 'Add document' });
  await doc.locator('input[type=file]').setInputFiles({ name: 'parish.png', mimeType: 'image/png', buffer: PNG });
  await doc.getByRole('textbox', { name: 'Title' }).fill('Parish register');
  await doc.getByRole('radiogroup', { name: 'Date' }).getByRole('radio', { name: 'Year only' }).click();
  await doc.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Year' }).fill('1901');
  await doc.getByRole('button', { name: 'Upload' }).click();
  await expect(doc).toBeHidden();
  await expect(page.getByRole('button', { name: /Parish register/ }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Add note' }).first().click();
  const note = page.getByRole('dialog', { name: 'Add note' });
  await note.getByRole('textbox', { name: 'Title' }).fill('Grandmother remembers');
  await note.getByRole('radiogroup', { name: 'Date' }).getByRole('radio', { name: 'Year only' }).click();
  await note.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Year' }).fill('1902');
  await note.getByRole('textbox', { name: 'Note' }).fill('She said the family came over the mountains.');
  await note.getByRole('button', { name: 'Save' }).click();
  await expect(note).toBeHidden();

  await page.reload();
  await settled(page);
  await checkAxe(page, 'research project');
  const timeline = page.locator('section', { has: page.getByRole('heading', { name: 'Timeline', level: 2 }) });
  await expect(timeline.getByText('Parish register')).toBeVisible();
  await expect(timeline.getByText('Grandmother remembers')).toBeVisible();
  await expect(timeline.getByText('1901').first()).toBeVisible();
  await expect(timeline.getByText('1902').first()).toBeVisible();

  await timeline.getByText('Parish register').click();
  await checkAxe(page, 'research document');
});
