// Journey 38: optional email (docs/hosting-many-families.md, "Email"). The operator sets up a provider on the console's Email
// tab and sends a test email; the Health tab counts it; the steward confirms their address from the account menu with the link
// the email carries; an invitation goes out by email and its one-click unsubscribe works from a signed-out browser; and
// "Forgot your password?" gives the same answer for an unknown address as for one whose account has no password, and sends
// neither an email. Nothing reaches a provider: KINDRED_MAIL_FAKE=1 (local origin only) keeps every email in
// mail-outbox.jsonl in the data folder, where the journey reads it. Saving the settings and the test email need a fresh proof:
// the journeys' steward has no virtual device holding its passkey, so the journey marks its sessions proved, as a passkey
// would. It puts every setting back, so the journeys after it see email off.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

interface Mail { to: string; subject: string; text: string; html: string; headers: Record<string, string> }
const outbox = (): Mail[] => {
  const file = join(process.env.KINDRED_E2E_DATA!, 'mail-outbox.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Mail) : [];
};
const accountsDb = () => new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, 'accounts.db'));
function run(sql: string, ...params: (string | number)[]) {
  const db = accountsDb();
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}
/** The operator's sessions proved themselves just now, as a passkey on this device would. */
const prove = () => run("UPDATE session SET proved = ?, proved_via = 'passkey' WHERE user IN (SELECT id FROM user WHERE operator = 1)", Date.now());

test('email: the console, a test email, confirming an address, an invitation by email, unsubscribing, and a reset that tells nothing', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);
  const before = outbox().length;
  try {
    // ---------- the console ----------
    prove();
    await page.goto('/operator?tab=email');
    await settled(page);
    const tab = page.getByRole('tabpanel');
    await expect(tab.getByRole('heading', { name: 'Email' })).toBeVisible();
    await expect(tab.getByRole('status').filter({ hasText: 'Off' })).toBeVisible();
    await tab.getByRole('combobox', { name: 'How to send' }).click();
    await page.getByRole('option', { name: 'Resend' }).click();
    await tab.getByRole('textbox', { name: /^Sender address/ }).fill('kindred@family.example.org');
    await tab.getByRole('textbox', { name: /^Sender name/ }).fill('The Testerby tree');
    await tab.getByLabel('API key').fill('re_journey_key_not_real');
    await expect(tab.getByText(/listed as a subprocessor/)).toBeVisible();
    await tab.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tab.getByText('Saved')).toBeVisible();
    await expect(tab.getByRole('status').filter({ hasText: 'Sending' })).toBeVisible();
    await expect(tab.getByLabel('API key')).toHaveValue('');
    await expect(tab.getByLabel('API key')).toHaveAttribute('placeholder', /Stored, sealed/);
    await checkAxe(page, 'operator email tab');

    await tab.getByLabel('To', { exact: true }).fill('olu@example.org');
    await tab.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(tab.getByText('Sent. Look in the inbox of olu@example.org.')).toBeVisible();
    const test = outbox().at(-1)!;
    expect(test.to).toBe('olu@example.org');
    expect(test.subject).toMatch(/^A test email from /);
    expect(test.html).not.toMatch(/<img|<script/i);
    expect(test.headers['List-Unsubscribe']).toBeUndefined();

    await page.getByRole('tab', { name: 'Health' }).click();
    const health = page.getByRole('region', { name: 'Email', exact: true });
    await expect(health.getByText(/Last 24 hours: 1 sent, 0 failed/)).toBeVisible();
    await expect(health.getByText('No failures.')).toBeVisible();

    // ---------- confirming the steward's address ----------
    await page.goto(`/${tree}`);
    await settled(page);
    await page.locator('.acct-trigger').click();
    await page.getByRole('menuitem', { name: 'Your email' }).click();
    const dialog = page.getByRole('dialog', { name: 'Your email' });
    await dialog.getByLabel(/Email address/).fill('ada@family.example.org');
    await dialog.getByRole('button', { name: 'Send a confirmation link' }).click();
    await expect(dialog.getByText(/We sent a link to ada@family\.example\.org/)).toBeVisible();
    await checkAxe(page, 'your email dialog');
    const confirm = outbox().at(-1)!;
    expect(confirm.to).toBe('ada@family.example.org');
    const link = /(http:\/\/[^\s]+\/verify-email\/[A-Za-z0-9_-]{43})/.exec(confirm.text)![1]!;
    await page.goto(link);
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Confirm your email address' })).toBeVisible();
    await checkAxe(page, 'confirm email page');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Address confirmed' })).toBeVisible();
    // Used once.
    await page.goto(link);
    await settled(page);
    await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();

    // ---------- an invitation by email, and its unsubscribe ----------
    await page.goto(`/${tree}/access`);
    await settled(page);
    await page.getByRole('button', { name: 'Invite someone' }).first().click();
    const inviting = page.getByRole('dialog');
    await inviting.getByRole('textbox', { name: 'Their email (optional)' }).fill('pip@example.org');
    await inviting.getByRole('button', { name: 'Make an invitation link' }).click();
    const invitation = await inviting.getByRole('textbox', { name: 'Invitation link' }).inputValue();
    await inviting.getByRole('button', { name: 'Send the invitation by email' }).click();
    await expect(inviting.getByText('Sent to pip@example.org.')).toBeVisible();
    await inviting.getByRole('button', { name: 'Done' }).click();
    const invite = outbox().at(-1)!;
    expect(invite.to).toBe('pip@example.org');
    expect(invite.text).toContain(invitation);
    expect(invite.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const unsubscribe = /(http:\/\/[^\s]+\/unsubscribe\?[^\s]+)/.exec(invite.text)![1]!;

    const stranger = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    issues.watch(stranger);
    const away = await stranger.newPage();
    await away.goto(unsubscribe);
    await settled(away);
    await expect(away.getByText(/Stop these emails to this address: invitations to a family/)).toBeVisible();
    await checkAxe(away, 'unsubscribe page');
    await away.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(away.getByRole('heading', { name: 'Unsubscribed' })).toBeVisible();
    // A link with another category is not valid.
    await away.goto(unsubscribe.replace('c=invitation', 'c=operator'));
    await settled(away);
    await away.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(away.getByText('This unsubscribe link is not valid.')).toBeVisible();

    // ---------- "Forgot your password?" tells nothing ----------
    run("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(['passkey', 'password']), Date.now());
    const sentBefore = outbox().length;
    const answers: string[] = [];
    for (const address of ['nobody@example.org', 'ada@family.example.org']) {
      await away.goto('/signin');
      await settled(away);
      await away.getByRole('button', { name: 'Forgot your password?' }).click();
      await expect(away.getByText('Reset your password by email')).toBeVisible();
      await away.getByLabel('Email address').fill(address);
      await away.getByRole('button', { name: 'Send the link' }).click();
      const answer = away.getByRole('status').filter({ hasText: 'Look in your inbox' });
      await expect(answer).toBeVisible();
      answers.push((await answer.textContent()) ?? '');
    }
    await checkAxe(away, 'reset by email');
    expect(answers[0]).toBe(answers[1]);
    // The steward's account has no password: neither address gets anything.
    await away.waitForTimeout(500);
    expect(outbox().length).toBe(sentBefore);
    await stranger.close();
  } finally {
    run("DELETE FROM instance_setting WHERE key LIKE 'mail\\_%' ESCAPE '\\' OR key = 'auth_methods'");
  }
  expect(outbox().length).toBeGreaterThan(before);
});
