// Journey 39: "Email me a sign-in code" (src/lib/auth/email-code.server.ts; docs/self-host.md, "Ways in"). The operator sets
// email up (as journey 38 does) and turns the *Code by email* card on in the Sign-in tab; a member who lost every device asks
// for a code on the sign-in page, which answers the same for an address no account has; the code does nothing on another
// device that opens the email's link, and signs the member in on the device that asked; the account menu then offers a passkey;
// the member's confirmed address gets the security notice; turning the card off again ends that session. Nothing reaches a
// provider: KINDRED_MAIL_FAKE=1 (local origin only) keeps every email in mail-outbox.jsonl in the data folder. Saving in the
// console needs a fresh proof: the journey marks the operator's sessions proved, as a passkey would. It puts every setting back.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

interface Mail { to: string; subject: string; text: string; html: string; headers: Record<string, string> }
const outbox = (): Mail[] => {
  const file = join(process.env.KINDRED_E2E_DATA!, 'mail-outbox.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Mail) : [];
};
function run(sql: string, ...params: (string | number)[]) {
  const db = new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, 'accounts.db'));
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}
/** The operator's sessions proved themselves just now, as a passkey on this device would. */
const prove = () => run("UPDATE session SET proved = ?, proved_via = 'passkey' WHERE user IN (SELECT id FROM user WHERE operator = 1)", Date.now());
const PIP = { id: 'e2e-pip-0039', name: 'Pip Testerby', email: 'pip@example.org' };

test('a sign-in code by email: the console card, one answer for every address, bound to the device that asked', async ({ page, browser, issues, baseURL }) => {
  const tree = await openFamily(page);
  try {
    // ---------- email, then the card ----------
    prove();
    await page.goto('/operator?tab=email');
    await settled(page);
    const tab = page.getByRole('tabpanel');
    await tab.getByRole('combobox', { name: 'How to send' }).click();
    await page.getByRole('option', { name: 'Resend' }).click();
    await tab.getByRole('textbox', { name: /^Sender address/ }).fill('kindred@family.example.org');
    await tab.getByLabel('API key').fill('re_journey_key_not_real');
    await tab.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tab.getByText('Saved')).toBeVisible();

    // A member with a confirmed address and no way in left (every device lost).
    const now = Date.now();
    run('INSERT INTO user (id, name, email, handle, created, last_seen, email_verified, operator) VALUES (?, ?, ?, ?, ?, ?, 1, 0)', PIP.id, PIP.name, PIP.email, PIP.id, now, now);
    run("INSERT INTO membership (user, tree, role, person, created) VALUES (?, ?, 'viewer', '-', ?)", PIP.id, tree, now);

    prove();
    await page.getByRole('tab', { name: 'Sign-in' }).click();
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Code by email' }) });
    await expect(card.getByText('Configured', { exact: true })).toBeVisible();
    await card.getByRole('switch', { name: 'Offer it' }).click();
    await page.getByRole('button', { name: 'Save the ways in' }).click();
    await expect(card.getByText('Enabled', { exact: true })).toBeVisible();
    // Pip at least, and whoever else earlier journeys left with a confirmed address and nothing else.
    await expect(card.getByText(/can use it; for [1-9]\d* it is the only way in/)).toBeVisible();
    await checkAxe(page, 'sign-in tab with a code by email');

    // ---------- the same answer for every address ----------
    const sentBefore = outbox().length;
    const asked = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    issues.watch(asked);
    const pip = await asked.newPage();
    const answers: string[] = [];
    for (const address of ['nobody@example.org', PIP.email]) {
      await pip.goto('/signin');
      await settled(pip);
      await pip.getByRole('button', { name: 'Email me a sign-in code' }).click();
      await pip.getByLabel('Email address').fill(address);
      await checkAxe(pip, 'sign-in code form');
      await pip.getByRole('button', { name: 'Send me a code' }).click();
      const answer = pip.getByRole('status').filter({ hasText: 'Look in your inbox' });
      await expect(answer).toBeVisible();
      answers.push(((await pip.locator('form.auth-form').textContent()) ?? '').replace(address, '<address>'));
    }
    expect(answers[0]).toBe(answers[1]);
    await expect.poll(() => outbox().length).toBe(sentBefore + 1);
    const mail = outbox().at(-1)!;
    expect(mail.to).toBe(PIP.email);
    expect(mail.subject).toMatch(/^Your sign-in code for /);
    expect(mail.headers['List-Unsubscribe']).toBeUndefined();
    const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
    const link = /(http:\/\/[^\s]+\/signin\?code=1)/.exec(mail.text)![1]!;
    expect(mail.text).not.toContain(code + '\n' + link);

    // ---------- another device: the link opens the code's field, but the code does nothing there ----------
    // The refusal is the point: its 400 is expected.
    issues.allow(/status of 400 .*\/api\/auth\/email-code\)$/);
    const other = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    issues.watch(other);
    const elsewhere = await other.newPage();
    await elsewhere.goto(link);
    await settled(elsewhere);
    await elsewhere.getByLabel('Code from the email').fill(code);
    await elsewhere.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(elsewhere.getByText('That code is wrong or has run out. Ask for a new one.')).toBeVisible();
    await other.close();

    // ---------- the device that asked signs in ----------
    await pip.getByLabel('Code from the email').fill(code);
    await pip.getByRole('button', { name: 'Sign in', exact: true }).click();
    await pip.waitForURL((u) => u.origin === baseURL && !u.pathname.startsWith('/signin'));
    await settled(pip);
    await pip.locator('[data-tour="account-menu"]').click();
    await pip.getByRole('menuitem', { name: 'Your name & passkeys' }).click();
    const dialog = pip.getByRole('dialog', { name: 'Your name & passkeys' });
    await expect(dialog.getByText('You signed in with a code from your email. Add a passkey on this device, so next time it takes one tap.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add a passkey on this device' })).toBeVisible();
    await checkAxe(pip, 'account menu after a code sign-in');
    await pip.keyboard.press('Escape');
    await expect.poll(() => outbox().filter((m) => m.to === PIP.email && /with a code we emailed to this address/.test(m.text)).length).toBe(1);

    // ---------- turning the card off ends the session it started ----------
    prove();
    await page.reload();
    await settled(page);
    await card.getByRole('switch', { name: 'Offer it' }).click();
    await expect(page.getByText(/[1-9]\d* accounts? would have no way in/)).toBeVisible();
    await page.getByRole('button', { name: 'Save the ways in' }).click();
    await expect(card.getByText('Configured', { exact: true })).toBeVisible();
    await pip.goto(`/${tree}`);
    await pip.waitForURL((u) => u.pathname.startsWith('/signin'));
    await settled(pip);
    await expect(pip.getByRole('button', { name: 'Email me a sign-in code' })).toHaveCount(0);
    await asked.close();
  } finally {
    run('DELETE FROM user WHERE id = ?', PIP.id);
    run("DELETE FROM instance_setting WHERE key LIKE 'mail\\_%' ESCAPE '\\' OR key = 'auth_methods'");
  }
});
