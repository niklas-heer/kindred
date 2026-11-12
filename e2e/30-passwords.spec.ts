// Journey 30: username and password beside passkeys (docs/self-host.md, "Ways in"). The operator's Sign-in tab shows each way
// in; passwords are turned on (written as the console's saved setting: saving there needs a fresh passkey proof, and the
// journeys' steward has no virtual device holding its passkey); someone takes an invitation with a username and password,
// turns on two-step codes from the account menu and gets recovery codes, signs out, is refused a wrong password, and signs in
// with the password and a code. The journey puts the setting back, so the journeys after it see passkeys only.
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

const accountsDb = () => new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, 'accounts.db'));
function setMethods(list: string[] | null) {
  const db = accountsDb();
  try {
    if (list) db.prepare("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(list), Date.now());
    else db.prepare("DELETE FROM instance_setting WHERE key = 'auth_methods'").run();
  } finally {
    db.close();
  }
}

/** The six-digit code an authenticator app shows for a base32 secret, `ahead` steps from now. */
function totp(secret: string, ahead = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/\s+/g, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + ahead));
  const mac = createHmac('sha1', key).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

test('passwords beside passkeys: the console, an invitation, two-step codes and signing in', async ({ page, browser, issues, baseURL }) => {
  await openFamily(page);
  await page.goto('/operator');
  await settled(page);
  await page.getByRole('tab', { name: 'Sign-in' }).click();
  const passkeys = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Passkeys' }) });
  const passwords = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Username and password' }) });
  await expect(passkeys.getByText('Enabled', { exact: true })).toBeVisible();
  await expect(passwords.getByText('Configured', { exact: true })).toBeVisible();
  await checkAxe(page, 'operator sign-in tab');

  // Switching passwords on in the form warns of nobody losing a way in.
  await passwords.getByRole('switch', { name: 'Offer it' }).click();
  await expect(page.getByText(/would have no way in/)).toHaveCount(0);
  setMethods(['passkey', 'password']);
  try {
    await page.reload();
    await settled(page);
    await page.getByRole('tab', { name: 'Sign-in' }).click();
    await expect(passwords.getByText('Enabled', { exact: true })).toBeVisible();

    // A family for someone else, whose first steward will use a password.
    await page.getByRole('tab', { name: 'Families' }).click();
    const make = page.getByRole('region', { name: 'Make a family for someone' });
    await make.getByLabel('Name', { exact: true }).fill('The Pennywhistles');
    await make.getByLabel('Its first steward').fill('Pip Pennywhistle');
    await make.getByRole('button', { name: 'Make the family and the link' }).click();
    const inviteUrl = await page.getByLabel('Invitation link for Pip Pennywhistle').inputValue();

    const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    issues.watch(visit);
    const pip = await visit.newPage();
    await pip.goto(inviteUrl);
    await settled(pip);
    await pip.getByLabel('What should the family call you?').fill('Pip Pennywhistle');
    await pip.getByRole('radio', { name: 'Username and password' }).click();
    await pip.getByLabel('Username').fill('pip.pennywhistle');
    await pip.getByLabel('New password').fill('password1234');
    await expect(pip.getByText('That password is too common.', { exact: false })).toBeVisible();
    await expect(pip.getByRole('button', { name: 'Create your account' })).toBeDisabled();
    await pip.getByLabel('New password').fill('a kettle sings at seven');
    await checkAxe(pip, 'invitation with a password');
    await pip.getByRole('button', { name: 'Create your account' }).click();
    await expect(pip.getByRole('heading', { name: 'Who are you in this family?' })).toBeVisible();

    // Two-step codes from the account menu: the sign-up a moment ago counts as the fresh proof.
    await pip.goto('/the-pennywhistles');
    await settled(pip);
    await pip.locator('[data-tour="account-menu"]').click();
    await pip.getByRole('menuitem', { name: 'Your name & passkeys' }).click();
    const dialog = pip.getByRole('dialog', { name: 'Your name & passkeys' });
    await expect(dialog.getByText(/You sign in as pip\.pennywhistle/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Turn on two-step codes' }).click();
    // A QR code for the app to scan (src/lib/qr/qrcode.ts), and the key to type for an app that cannot.
    await expect(dialog.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    const secret = (await dialog.locator('.pw-secret').innerText()).trim();
    await dialog.getByLabel('Code from your authenticator app').fill(totp(secret));
    await dialog.getByRole('button', { name: 'Turn on', exact: true }).click();
    const codes = pip.getByRole('dialog', { name: 'Your recovery codes' });
    await expect(codes.getByRole('listitem')).toHaveCount(10);
    await checkAxe(pip, 'recovery codes');
    await codes.getByRole('button', { name: 'I’ve saved them' }).click();
    await expect(dialog.getByText('10 recovery codes left.')).toBeVisible();
    await pip.keyboard.press('Escape');

    // Signed out, a wrong password gets the one answer; the right one asks for the code, and the next code signs in.
    await pip.locator('[data-tour="account-menu"]').click();
    await pip.getByRole('menuitem', { name: 'Sign out' }).click();
    await pip.goto('/signin');
    await settled(pip);
    await expect(pip.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
    await pip.getByLabel('Username').fill('pip.pennywhistle');
    // The refusal is the server's 400, which the browser reports as a failed load.
    issues.allow(/status of 400 .*\/api\/auth\/password-signin\)/);
    await pip.getByLabel('Password', { exact: true }).fill('a kettle sings at eight');
    await pip.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(pip.getByText('That username and password don’t match.')).toBeVisible();
    await pip.getByLabel('Password', { exact: true }).fill('a kettle sings at seven');
    await pip.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(pip.getByText(/six-digit code/)).toBeVisible();
    await checkAxe(pip, 'two-step code');
    // The code used to turn them on is spent; the next step's is accepted (one step of clock difference is allowed).
    await pip.getByLabel('Code from your authenticator app').fill(totp(secret, 1));
    await pip.getByRole('button', { name: 'Sign in', exact: true }).click();
    await pip.waitForURL((u) => !u.pathname.startsWith('/signin'));
    await settled(pip);
    await visit.close();
  } finally {
    setMethods(null);
  }

  await page.goto('/operator');
  await settled(page);
  await page.getByRole('tab', { name: 'Sign-in' }).click();
  await expect(passwords.getByText('Configured', { exact: true })).toBeVisible();
  await expect(passwords.getByText(/2 accounts can use it|1 account can use it/)).toBeVisible();
});
