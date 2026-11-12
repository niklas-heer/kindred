// Journey 29: the instance's languages (docs/hosting-many-families.md, "Languages"). The operator offers only English and
// German: the picker lists those two, and a reader who chose German keeps it across a reload with no hydration mismatch.
// Then English alone: the reader's saved German is skipped, the page is English and there is no picker; offering every
// finished language again brings their German back. Puts the setting back, so later journeys see the server as before.
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

test('the operator chooses the languages a reader may pick', async ({ page }) => {
  const tree = await openFamily(page);
  const html = page.locator('html');
  const nav = page.getByRole('banner').first();
  /** The console's words, in the language the operator reads it in at that moment. */
  const EN = { settings: 'Settings', languages: 'Languages', every: /Every finished language/, only: /Only these/, save: 'Save', saved: 'Saved.' };
  const DE = { settings: 'Einstellungen', languages: 'Sprachen', every: /Alle fertigen Sprachen/, only: /Nur diese/, save: 'Speichern', saved: 'Gespeichert.' };
  const languages = (only: string[] | null, w = EN) => async () => {
    await page.goto('/operator');
    await settled(page);
    await page.getByRole('tab', { name: w.settings }).click();
    const fieldset = page.getByRole('group', { name: w.languages });
    if (only === null) await fieldset.getByLabel(w.every).check();
    else {
      await fieldset.getByLabel(w.only).check();
      for (const box of await fieldset.getByRole('checkbox').all()) {
        const name = (await box.locator('xpath=..').innerText()).trim();
        if (!(await box.isDisabled())) await box.setChecked(only.includes(name));
      }
    }
    const save = page.getByRole('button', { name: w.save, exact: true });
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByText(w.saved)).toBeVisible();
    }
  };

  await languages(['English', 'Deutsch'])();
  await checkAxe(page, 'operator settings with languages');
  await page.goto(`/${tree}`);
  await settled(page);
  await page.getByRole('combobox', { name: /: English$/ }).click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options).toContainText(['English', 'Deutsch']);
  await page.getByRole('option', { name: 'Deutsch' }).click();
  await expect(html).toHaveAttribute('lang', 'de');
  await page.reload();
  await settled(page);
  await expect(nav.getByRole('link', { name: 'Stammbaum', exact: true })).toBeVisible();

  // English alone: the saved German is skipped and nothing is left to pick.
  await languages([], DE)();
  await page.goto(`/${tree}`);
  await settled(page);
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(nav.getByRole('link', { name: 'Tree', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Language: / })).toHaveCount(0);

  // Every finished language again: the reader's own choice comes back, then they return to English for later journeys.
  await languages(null)();
  await page.goto(`/${tree}`);
  await settled(page);
  await expect(html).toHaveAttribute('lang', 'de');
  await page.getByRole('combobox', { name: /: Deutsch$/ }).click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.getByRole('option', { name: 'English' }).click();
  await expect(html).toHaveAttribute('lang', 'en');
});
