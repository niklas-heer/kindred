// Journey 41: family votes (docs/votes.md). The steward starts a ranked vote with three options and ranks two of them; a
// second member (invited, in a browser of their own, on a phone) is asked to vote before they see a tally, ranks theirs,
// and sees who chose what. The steward closes it, and the page shows the winner and the count's rounds. A secret vote
// shows who has voted and no tally until it closes. A guest of a share link sees only the vote that lets guests in, gives
// a name and votes; the steward sees the guest among the voters.
import { addPasskeyDevice, checkAxe, expect, openFamily, settled, STEWARD, test, type Issues } from './fixtures.ts';
import type { Browser, Page } from '@playwright/test';

const ME = `${STEWARD.given} ${STEWARD.surname}`;
/** A time zone no test machine runs in (UTC+14), for a reader far from the server. */
const FAR_ZONE = 'Pacific/Kiritimati';

/** Starts a vote from the Votes page and waits for its own page. */
async function startVote(page: Page, tree: string, v: { question: string; options: string[]; ranked?: boolean; secret?: boolean; guests?: boolean }) {
  await page.goto(`/${tree}/votes`);
  await settled(page);
  await page.getByRole('button', { name: 'Start a vote' }).first().click();
  const composer = page.getByRole('dialog', { name: 'Start a vote' });
  await composer.getByRole('textbox', { name: 'Question' }).fill(v.question);
  for (const [i, option] of v.options.entries()) {
    if (i >= 2) await composer.getByRole('button', { name: 'Add an option' }).click();
    await composer.getByRole('textbox', { name: `Option ${i + 1}` }).fill(option);
  }
  if (v.ranked) await composer.getByRole('radio', { name: 'Ranked' }).click();
  if (v.secret) {
    await composer.getByRole('switch', { name: 'Secret vote' }).click();
    await expect(composer.getByText("Hidden from the family. Kindred's server stores ballots to count them.")).toBeVisible();
  }
  if (v.guests) await composer.getByRole('switch', { name: 'Guests may vote' }).click();
  await composer.getByRole('button', { name: 'Start the vote' }).click();
  await page.waitForURL(new RegExp(`/${tree}/votes/[0-9a-f-]{36}$`));
  await settled(page);
  await expect(page.getByRole('heading', { name: v.question, level: 1 })).toBeVisible();
}

/** A second member: an invitation, accepted in a browser of their own. */
async function inviteMember(page: Page, browser: Browser, issues: Issues, baseURL: string | undefined, tree: string, name: string) {
  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  const inviting = page.getByRole('dialog');
  await inviting.getByRole('button', { name: 'Make an invitation link' }).click();
  const invitation = await inviting.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await inviting.getByRole('button', { name: 'Done' }).click();
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  issues.watch(context);
  const them = await context.newPage();
  await addPasskeyDevice(them);
  await them.goto(invitation.replace(/^https?:\/\/[^/]+/, ''));
  await them.getByRole('textbox', { name: 'What should the family call you?' }).fill(name);
  await them.getByRole('button', { name: 'Create your passkey' }).click();
  await them.getByRole('button', { name: 'Just browsing' }).click();
  await them.waitForURL((u) => !u.pathname.startsWith('/invite'));
  await them.getByRole('complementary', { name: 'Would you like a quick tour?' }).getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => undefined);
  return { context, them };
}

test('votes: a ranked vote, two members vote, the creator closes it and the rounds show', async ({ page, browser, issues, baseURL }) => {
  test.setTimeout(180_000);
  const tree = await openFamily(page);

  // ---------- the steward starts a ranked vote and ranks two options ----------
  await page.goto(`/${tree}/votes`);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Votes', level: 1 })).toBeVisible();
  await checkAxe(page, 'votes');
  await startVote(page, tree, { question: 'Where shall we eat after the reunion?', options: ["Bo's Bistro", "Carl's Canteen", "Dot's Diner"], ranked: true });
  const voteUrl = new URL(page.url()).pathname;
  const ballot = page.getByRole('group', { name: 'Tap the options in the order you prefer them' });
  // Each option is named by its label; its place in the order is its description.
  const bo = ballot.getByRole('button', { name: "Bo's Bistro", exact: true });
  const carl = ballot.getByRole('button', { name: "Carl's Canteen", exact: true });
  await carl.click();
  await bo.click();
  await expect(carl).toHaveAttribute('aria-pressed', 'true');
  await expect(carl).toHaveAccessibleDescription('1');
  await expect(bo).toHaveAccessibleDescription('2');
  // Tapped again, an option comes out, and the next moves up.
  await carl.click();
  await expect(carl).toHaveAttribute('aria-pressed', 'false');
  await expect(bo).toHaveAccessibleDescription('1');
  await carl.click();
  await expect(carl).toHaveAccessibleDescription('2');
  await bo.click();
  await bo.click();
  await expect(carl).toHaveAccessibleDescription('1');
  await expect(bo).toHaveAccessibleDescription('2');
  await page.getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your vote is in.' })).toBeVisible();
  // An open vote: having voted, the steward sees the tally and who chose what.
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByText('Round 1')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Who chose what' }).getByText(new RegExp(ME))).toBeVisible();
  await checkAxe(page, 'a ranked vote, voted');

  // ---------- a second member votes, on a phone ----------
  const { context, them } = await inviteMember(page, browser, issues, baseURL, tree, 'Juno Ballot');
  await them.setViewportSize({ width: 390, height: 844 });
  await them.goto(`/${tree}/votes`);
  await settled(them);
  await them.getByRole('link', { name: /Where shall we eat after the reunion\?/ }).click();
  await them.waitForURL(new RegExp(`${voteUrl}$`));
  await settled(them);
  await expect(them.getByText('Vote to see the results')).toBeVisible();
  await expect(them.getByText('Who chose what')).toHaveCount(0);
  const theirBallot = them.getByRole('group', { name: 'Tap the options in the order you prefer them' });
  await theirBallot.getByRole('button', { name: "Carl's Canteen" }).click();
  await theirBallot.getByRole('button', { name: "Dot's Diner" }).click();
  await expect(theirBallot.getByRole('button', { name: "Dot's Diner", exact: true })).toHaveAccessibleDescription('2');
  const scrolls = await them.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrolls, 'no sideways scrolling at 390 px').toBe(false);
  await them.getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(them.getByRole('status').filter({ hasText: 'Your vote is in.' })).toBeVisible();
  await expect(them.getByRole('region', { name: 'Who chose what' }).getByText('Juno Ballot')).toBeVisible();
  // Someone else's vote: nothing to close or remove it with.
  await expect(them.getByRole('button', { name: 'Close now' })).toHaveCount(0);
  await context.close();

  // ---------- the creator closes it ----------
  await page.goto(voteUrl);
  await settled(page);
  await expect(page.getByText('2 have voted')).toBeVisible();
  await page.getByRole('button', { name: 'Close now' }).click();
  await page.getByRole('dialog', { name: 'Close this vote now?' }).getByRole('button', { name: 'Close now' }).click();
  await expect(page.getByText("Chosen: Carl's Canteen")).toBeVisible();
  await expect(results.getByText('Round 1')).toBeVisible();
  await expect(results.getByText('2 votes')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Tap the options in the order you prefer them' })).toHaveCount(0);
  await checkAxe(page, 'a ranked vote, closed');

  // The list keeps it under Closed, with its winner.
  await page.goto(`/${tree}/votes`);
  await settled(page);
  const closed = page.getByRole('region', { name: 'Closed' });
  await expect(closed.getByRole('link', { name: /Where shall we eat after the reunion\?/ })).toContainText("Carl's Canteen");
});

test('votes: a secret vote shows who has voted, and no tally until it closes', async ({ page }) => {
  const tree = await openFamily(page);
  await startVote(page, tree, { question: 'Which month for the picnic?', options: ['June', 'July'], secret: true });
  await expect(page.getByText("Hidden from the family. Kindred's server stores ballots to count them.")).toBeVisible();
  const ballot = page.getByRole('radiogroup', { name: 'Choose one' });
  await ballot.getByRole('radio', { name: 'July' }).check();
  await page.getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your vote is in.' })).toBeVisible();
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByText('Results when the vote closes')).toBeVisible();
  await expect(results.getByText(/\d+ votes?$/)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Who has voted' }).getByText(new RegExp(ME))).toBeVisible();
  await expect(page.getByText('Who chose what')).toHaveCount(0);

  await page.getByRole('button', { name: 'Close now' }).click();
  await page.getByRole('dialog', { name: 'Close this vote now?' }).getByRole('button', { name: 'Close now' }).click();
  await expect(page.getByText('Chosen: July')).toBeVisible();
  await expect(results.getByText('1 vote', { exact: true })).toBeVisible();
  // Closed, a secret vote still never says who chose what.
  await expect(page.getByText('Who chose what')).toHaveCount(0);
});

test('votes: a guest votes where guests may, under a name, and sees no other vote', async ({ page, browser, issues, baseURL }) => {
  test.setTimeout(120_000);
  const tree = await openFamily(page);
  await startVote(page, tree, { question: 'Which colour for the reunion shirts?', options: ['Green', 'Blue'], guests: true });
  const voteUrl = new URL(page.url()).pathname;
  await startVote(page, tree, { question: 'Who brings the cake?', options: ['Ada', 'Bo'] });
  const cakeUrl = new URL(page.url()).pathname;

  await page.goto(`/${tree}/access`);
  await settled(page);
  await page.getByRole('button', { name: /^(Make a link|New link and password)$/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Make a link|Replace it)$/ }).click();
  const shown = page.locator('.share-shown input');
  await expect(shown.first()).toBeVisible();
  const url = await shown.first().inputValue();
  const password = await shown.nth(1).inputValue();

  // The tree a guest lands on asks for what only members read, and is refused, as in journey 5.
  issues.allow(/Failed to load resource: the server responded with a status of 40[13]/);
  // The guest is in a time zone far from the server's: dates must be written in theirs.
  const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, timezoneId: FAR_ZONE });
  issues.watch(visit);
  const guest = await visit.newPage();
  await guest.goto(url);
  await settled(guest);
  await guest.getByLabel('Password').fill(password);
  await guest.getByRole('button', { name: 'Open the family tree' }).click();
  await guest.waitForURL(new RegExp(`/${tree}$`));
  await settled(guest);

  // The guest's bar offers Votes, as there is one they may vote in.
  const bar = guest.getByRole('navigation', { name: 'Sections' }).first();
  await bar.getByRole('button', { name: /^More/ }).click();
  await bar.getByRole('list', { name: 'More sections' }).getByRole('link', { name: /^Votes/ }).click();
  await guest.waitForURL(new RegExp(`/${tree}/votes$`));
  await settled(guest);
  await expect(guest.getByRole('link', { name: /Which colour for the reunion shirts\?/ })).toBeVisible();
  await expect(guest.getByText('Who brings the cake?')).toHaveCount(0);
  await expect(guest.getByText('Where shall we eat after the reunion?')).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Start a vote' })).toHaveCount(0);
  await checkAxe(guest, 'votes as guest');

  await guest.getByRole('link', { name: /Which colour for the reunion shirts\?/ }).click();
  await guest.waitForURL(new RegExp(`${voteUrl}$`));
  await settled(guest);
  // A guest reads no member's name.
  await expect(guest.getByText(new RegExp(ME))).toHaveCount(0);
  await guest.getByRole('radiogroup', { name: 'Choose one' }).getByRole('radio', { name: 'Green' }).check();
  await expect(guest.getByText("Your name is shown to the family's members with your vote.")).toBeVisible();
  await guest.getByRole('textbox', { name: 'Your name' }).fill('Pip Visitor');
  await checkAxe(guest, 'a vote as guest, before voting');
  await guest.getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(guest.getByRole('status').filter({ hasText: 'Your vote is in.' })).toBeVisible();
  await expect(guest.getByRole('region', { name: 'Results' }).getByText('1 vote', { exact: true })).toBeVisible();

  // A vote without guests is not theirs, even by its address.
  await guest.goto(cakeUrl);
  await settled(guest);
  await expect(guest.getByRole('heading', { name: 'This vote is not here' })).toBeVisible();
  await expect(guest.getByText('Who brings the cake?')).toHaveCount(0);
  // Opened directly, the list arrives with the page from the server; its closing time is still in the guest's own zone.
  await guest.goto(`/${tree}/votes`);
  await settled(guest);
  const closing = guest.getByRole('link', { name: /Which colour for the reunion shirts\?/ }).locator('time');
  await expect(closing).toContainText(/^Closes /);
  const [at, written] = [await closing.getAttribute('datetime'), await closing.textContent()];
  const hour = (zone: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(new Date(at!));
  expect(hour(FAR_ZONE), 'the far zone differs from the server’s').not.toBe(hour(Intl.DateTimeFormat().resolvedOptions().timeZone));
  expect(written, 'the closing time in the guest’s zone').toContain(hour(FAR_ZONE));
  await visit.close();

  // The steward sees the guest among those who voted, marked as a guest.
  await page.goto(voteUrl);
  await settled(page);
  await expect(page.getByRole('region', { name: 'Who has voted' }).getByText('Pip Visitor')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Who has voted' }).getByText('guest')).toBeVisible();
});
