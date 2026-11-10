// Journey 15: Today. The page is first in the navigation; the steward answers the question of the week (the answer is
// a memory in the Chronicle), asks a question of their own and takes the curated one back; the quiz has nothing to ask
// in a family of one, then asks once relatives are there, takes one answer and keeps it; a steward can switch it off.
// The sections keep readable names at tablet width, and the phone's tab bar starts with Today.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { checkAxe, expect, openFamily, settled, STEWARD, test } from './fixtures.ts';

/**
 * Relatives for the quiz, written straight into the scratch family's database: three houses, grandparents, parents and
 * cousins with birthplaces. The app's own forms are covered by the other journeys; this one needs the records.
 */
function addRelatives(tree: string) {
  const d = new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, `${tree}.db`));
  d.exec('PRAGMA busy_timeout = 5000');
  const arms = (field: string, charge: string) => JSON.stringify({ field, division: 'plain', charge, chargeTincture: 'or' });
  const house = d.prepare('INSERT OR IGNORE INTO house (id, name, arms) VALUES (?, ?, ?)');
  house.run('e2e-ash', 'House Ashdown', arms('azure', 'lion'));
  house.run('e2e-birch', 'House Birchall', arms('gules', 'eagle'));
  house.run('e2e-cedar', 'House Cedarholm', arms('vert', 'tower'));
  const person = d.prepare('INSERT OR IGNORE INTO person (id, given, surname, house, born, born_place, living, sex) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const parent = d.prepare('INSERT OR IGNORE INTO parent (child, parent) VALUES (?, ?)');
  const people: [string, string, string, string, string, string, number, string][] = [
    ['e2e-gran', 'Greta', 'Ashdown', 'e2e-ash', '1931-02-03', 'Oldbridge', 0, 'f'],
    ['e2e-gramps', 'Gustav', 'Ashdown', 'e2e-ash', '1929-05-06', 'Millford', 0, 'm'],
    ['e2e-mum', 'Marta', 'Birchall', 'e2e-birch', '1956-03-04', 'Northwick', 1, 'f'],
    ['e2e-dad', 'Dag', 'Birchall', 'e2e-birch', '1954-07-08', 'Southmere', 1, 'm'],
    ['e2e-aunt', 'Alva', 'Cedarholm', 'e2e-cedar', '1959-09-10', 'Eastfield', 1, 'f'],
    ['e2e-uncle', 'Ulf', 'Cedarholm', 'e2e-cedar', '1958-11-12', 'Westhaven', 1, 'm'],
    ['e2e-bo', 'Bo', 'Birchall', 'e2e-birch', '1984-04-05', 'Highmoor', 1, 'm'],
    ['e2e-cy', 'Cyrus', 'Cedarholm', 'e2e-cedar', '1986-06-07', 'Lowfen', 1, 'm'],
    ['e2e-di', 'Dina', 'Cedarholm', 'e2e-cedar', '1989-08-09', 'Farcombe', 1, 'f'],
  ];
  for (const p of people) person.run(...p);
  for (const [child, a, b] of [['e2e-mum', 'e2e-gran', 'e2e-gramps'], ['e2e-aunt', 'e2e-gran', 'e2e-gramps'], ['e2e-bo', 'e2e-mum', 'e2e-dad'], ['e2e-cy', 'e2e-aunt', 'e2e-uncle'], ['e2e-di', 'e2e-aunt', 'e2e-uncle']]) {
    parent.run(child!, a!);
    parent.run(child!, b!);
  }
  d.close();
}

test('today: the question of the week, the daily quiz, and sections that keep their names', async ({ page, issues }) => {
  const tree = await openFamily(page);

  // First in the navigation, and in the palette.
  const sections = page.getByRole('navigation', { name: 'Sections' }).first();
  await expect(sections.getByRole('link').first()).toHaveAccessibleName('Today');
  await sections.getByRole('link', { name: 'Today' }).click();
  await page.waitForURL(new RegExp(`/${tree}/today$`));
  await settled(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`^Good (morning|afternoon|evening), ${STEWARD.given}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await checkAxe(page, 'today');

  // ---------- the question of the week ----------
  const week = page.getByRole('region', { name: 'Question of the week' });
  const question = (await week.locator('.td-week-q').textContent())!;
  expect(question.length).toBeGreaterThan(10);
  await expect(week.getByRole('heading', { name: 'No answers yet' })).toBeVisible();

  await week.getByRole('button', { name: 'Tell your story' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your answer' });
  await expect(dialog.getByText(question)).toBeVisible();
  // The steward said who they are in journey 1, so the answer starts out as about them.
  // An earlier journey may have given them an epithet, which follows the name.
  await expect(dialog.getByText(new RegExp(`${STEWARD.given} ${STEWARD.surname}.*\\(you\\)`))).toBeVisible();
  await checkAxe(page, 'today, answering');
  await dialog.getByLabel('What do you remember?').fill('My grandmother ran beside me down the lane, and let go without telling me.');
  await dialog.getByRole('button', { name: 'Share with the family' }).click();
  await expect(dialog).toBeHidden();
  await expect(week.getByRole('heading', { name: '1 answer this week' })).toBeVisible();
  await expect(week.getByText('My grandmother ran beside me down the lane')).toBeVisible();

  // The answer is an ordinary memory: the Chronicle has it, under the question.
  await page.goto(`/${tree}/chronicle`);
  await settled(page);
  await expect(page.getByRole('heading', { name: question, level: 3 })).toBeVisible();
  await expect(page.getByText('My grandmother ran beside me down the lane')).toBeVisible();

  // A steward asks their own question, skips the week, and takes the suggested one back. The answer stays.
  await page.goto(`/${tree}/today`);
  await settled(page);
  await week.getByRole('button', { name: 'Change the question' }).click();
  const change = page.getByRole('dialog', { name: 'This week’s question' });
  await checkAxe(page, 'today, changing the question');
  await change.getByLabel('Your own question').fill('What did the old kitchen smell like on a Sunday?');
  await change.getByRole('button', { name: 'Ask this question' }).click();
  await expect(change).toBeHidden();
  await expect(week.locator('.td-week-q')).toHaveText('What did the old kitchen smell like on a Sunday?');
  await expect(week.getByRole('heading', { name: '1 answer this week' })).toBeVisible();

  await week.getByRole('button', { name: 'Change the question' }).click();
  await change.getByRole('button', { name: 'No question this week' }).click();
  await expect(change).toBeHidden();
  await expect(week.getByText('There is no question this week.')).toBeVisible();
  await expect(week.getByRole('button', { name: 'Tell your story' })).toHaveCount(0);

  await week.getByRole('button', { name: 'Change the question' }).click();
  await change.getByRole('button', { name: 'Back to the suggested question' }).click();
  await expect(change).toBeHidden();
  await expect(week.locator('.td-week-q')).toHaveText(question);

  // Earlier questions stay open.
  const earlier = page.getByRole('region', { name: 'Earlier questions' });
  await expect(earlier.getByRole('listitem')).toHaveCount(3);
  await earlier.getByRole('button', { name: /^Show \d more$/ }).click();
  await expect(earlier.getByRole('listitem')).toHaveCount(8);

  // ---------- the daily quiz ----------
  const quiz = page.getByRole('region', { name: 'Do you know your family?' });
  if (!(await page.locator('.td-quiz-form').count())) {
    // A family of one has nothing to ask about yet, and the card says so instead of failing.
    await expect(quiz.getByText(/needs a little more to go on/)).toBeVisible();
    addRelatives(tree);
    await page.reload();
    await settled(page);
  }
  const form = page.locator('.td-quiz-form');
  await expect(form).toBeVisible();
  await checkAxe(page, 'today, the quiz');
  const submit = quiz.getByRole('button', { name: 'That is my answer' });
  if (await form.getByRole('radio').count()) {
    // Nothing is sent until a choice is made; the keyboard makes it.
    await expect(submit).toBeDisabled();
    await form.getByRole('radio').first().focus();
    await page.keyboard.press('Space');
    await expect(form.getByRole('radio').first()).toBeChecked();
  } else {
    // Birth order: a row moves with its button.
    const first = (await form.locator('.td-quiz-order li').first().textContent())!;
    await form.getByRole('button', { name: /^Move .+ down$/ }).first().click();
    await expect(form.locator('.td-quiz-order li').nth(1)).toHaveText(first);
  }
  await submit.click();
  const verdict = quiz.getByRole('status');
  await expect(verdict).toHaveText(/Yes, that’s right!|Not quite\. Now you know\./);
  const said = (await verdict.textContent())!;
  await expect(quiz.getByText('You are the first to answer today.')).toBeVisible();
  await expect(quiz.getByText('1 day in a row')).toBeVisible();
  await expect(submit).toHaveCount(0);
  await checkAxe(page, 'today, the quiz answered');

  // The answer stands: after a reload it is the same, and there is nothing to send again.
  await page.reload();
  await settled(page);
  await expect(quiz.getByRole('status')).toHaveText(said);
  await expect(quiz.getByRole('button', { name: 'That is my answer' })).toHaveCount(0);

  // ---------- the steward's switch ----------
  await page.goto(`/${tree}/settings/games`);
  await settled(page);
  const toggle = page.getByRole('switch', { name: 'The daily quiz is on for this family' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await checkAxe(page, 'games settings, with the quiz');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.goto(`/${tree}/today`);
  await settled(page);
  await expect(quiz.getByText('The daily quiz is switched off for this family.')).toBeVisible();
  await expect(page.locator('.td-quiz-form, .td-quiz-result')).toHaveCount(0);
  await quiz.getByRole('link', { name: 'Open Games' }).click();
  await page.waitForURL(/\/settings\/games$/);
  await settled(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // ---------- the sections ----------
  // A tablet: every section in the bar shows its name, and the rest are under More.
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(`/${tree}/today`);
  await settled(page);
  for (const name of ['Today', 'Tree', 'Almanac', 'Chronicle', 'Atlas']) {
    await expect(sections.getByRole('link', { name, exact: true }).locator('.nav-label'), `${name} keeps its name at 820px`).toBeVisible();
  }
  const more = sections.getByRole('button', { name: 'More' });
  await expect(more.locator('.nav-label')).toBeVisible();
  await more.focus();
  await page.keyboard.press('Enter');
  const list = sections.getByRole('list', { name: 'More sections' });
  for (const name of ['Register', 'Houses', 'Contacts', 'Needed', 'Gallery', 'Research']) await expect(list.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  await checkAxe(page, 'today (tablet), More open');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await list.getByRole('link', { name: /^Houses/ }).click();
  await page.waitForURL(/\/houses$/);
  await settled(page);
  // Inside one of them, the button says which.
  await expect(sections.getByRole('button', { name: 'More: Houses' })).toBeVisible();
  expect(await page.evaluate(() => { const p = document.querySelector('.page')!; return p.scrollWidth <= p.clientWidth && document.documentElement.scrollWidth <= window.innerWidth; }), 'no sideways scroll at 820px').toBe(true);

  // A phone: Today is the first tab, and the page fits the screen's width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${tree}/today`);
  await settled(page);
  const tabs = page.locator('.tabbar');
  await expect(tabs.getByRole('link').first()).toHaveText('Today');
  await expect(tabs.getByRole('link', { name: 'Today' })).toHaveAttribute('data-status', 'active');
  expect(await page.evaluate(() => { const p = document.querySelector('.page')!; return p.scrollWidth <= p.clientWidth; }), 'no sideways scroll at 390px').toBe(true);
  await checkAxe(page, 'today (phone)');
  await tabs.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: /^Atlas/ })).toBeVisible();

  void issues;
});
