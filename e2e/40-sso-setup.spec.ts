// Journey 40: the guided setup of a single sign-on provider (docs/self-host.md, "Single sign-on"). The operator walks the
// console's wizard: Google's steps with their deep links and the values to paste, Microsoft's personal-accounts preset (a
// secret's expiry, never "trust verified emails"), the hint when someone types Microsoft's `consumers` address, then a generic
// provider against a fake one running inside this test on a loopback port (its own key, discovery document, an authorize
// endpoint that signs everyone in at once and a token endpoint that checks PKCE), so nothing leaves the machine. It saves the
// provider still off, runs the test sign-in in a new window (which signs nobody in and makes nothing), and only then turns it
// on. The cards and the Health tab show the last sign-in, a secret about to expire and Google's six-month deletion. Saving
// needs a fresh proof: the journeys' steward has no virtual device holding its passkey, so the journey marks its sessions
// proved, as a passkey would. It puts everything back.
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { checkAxe, expect, settled, test } from './fixtures.ts';

const accountsDb = () => new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, 'accounts.db'));
function sql(statement: string, ...args: (string | number | null)[]) {
  const db = accountsDb();
  try {
    db.prepare(statement).run(...args);
  } finally {
    db.close();
  }
}
function count(statement: string): number {
  const db = accountsDb();
  try {
    return Number((db.prepare(statement).get() as { n: number }).n);
  } finally {
    db.close();
  }
}
/** The operator's sessions proved themselves just now, as a passkey on this device would. */
const prove = () => sql("UPDATE session SET proved = ?, proved_via = 'passkey' WHERE user IN (SELECT id FROM user WHERE operator = 1)", Date.now());

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'wizard-key', use: 'sig', alg: 'RS256' };
const CLIENT = 'kindred-wizard';

/** A provider that signs in someone new for every authorization request, as a public client (no secret). */
function fakeProvider(): Promise<{ server: Server; issuer: string }> {
  const codes = new Map<string, { nonce: string; challenge: string; redirect: string }>();
  let issuer = '';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['none'] });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/authorize') {
      const code = b64u(Buffer.from(crypto.getRandomValues(new Uint8Array(16))));
      codes.set(code, { nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!, redirect: url.searchParams.get('redirect_uri')! });
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state')!);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const issued = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        if (!issued || form.get('client_id') !== CLIENT || issued.redirect !== form.get('redirect_uri') || b64u(createHash('sha256').update(verifier).digest()) !== issued.challenge) return json({ error: 'invalid_grant' }, 400);
        const now = Math.floor(Date.now() / 1000);
        const head = b64u(JSON.stringify({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' }));
        const claims = b64u(JSON.stringify({ iss: issuer, aud: CLIENT, sub: `tester-${now}`, iat: now, exp: now + 300, auth_time: now, nonce: issued.nonce, email: 'tester@example.org', email_verified: true, name: 'Tess Tester' }));
        json({ access_token: 'unused', token_type: 'Bearer', id_token: `${head}.${claims}.${b64u(rsaSign('sha256', Buffer.from(`${head}.${claims}`), privateKey))}` });
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    issuer = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    resolve({ server, issuer });
  }));
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test('single sign-on setup: the wizard’s steps, a test sign-in that makes nothing, turning it on, and the health warnings', async ({ page, issues, baseURL }) => {
  const { server, issuer } = await fakeProvider();
  const users = count('SELECT count(*) AS n FROM user');
  try {
    prove();
    await page.goto('/operator?tab=signin');
    await settled(page);
    await page.getByRole('button', { name: 'Add a provider' }).click();
    const wizard = page.getByRole('form', { name: 'Add a provider' });

    // Google: numbered steps with links to the right pages of Google Cloud, and the values to paste.
    await expect(wizard.getByRole('combobox', { name: 'Provider' })).toHaveText(/Google/);
    await expect(wizard.getByRole('link', { name: 'Open “Branding”' })).toHaveAttribute('href', 'https://console.cloud.google.com/auth/branding');
    await expect(wizard.getByRole('link', { name: 'Open “Clients”' })).toHaveAttribute('href', 'https://console.cloud.google.com/auth/clients/create');
    await expect(wizard.getByLabel('Authorized JavaScript origin')).toHaveValue(baseURL!);
    await expect(wizard.getByLabel('Redirect URI to register at the provider')).toHaveValue(`${baseURL}/api/auth/oidc/google/callback`);
    await expect(wizard.getByText('Google shows the secret only this one time', { exact: false })).toBeVisible();
    await expect(wizard.getByText('Google deletes sign-in clients that nobody used for six months', { exact: false })).toBeVisible();
    await expect(wizard.getByRole('button', { name: 'Test sign-in' })).toBeDisabled();
    await expect(wizard.getByRole('button', { name: 'Turn it on' })).toBeDisabled();
    await checkAxe(page, 'single sign-on wizard: Google');

    // Microsoft's personal accounts: the fixed issuer, the secret's expiry, and never "trust verified emails".
    await wizard.getByRole('combobox', { name: 'Provider' }).click();
    await page.getByRole('option', { name: 'Microsoft (personal accounts: outlook.com, hotmail, live)' }).click();
    await expect(wizard.getByText('Personal Microsoft accounts only', { exact: false })).toBeVisible();
    await expect(wizard.getByLabel('The secret expires on')).toBeVisible();
    await expect(wizard.getByLabel('Issuer')).toHaveCount(0);
    await wizard.getByText('More settings').click();
    await expect(wizard.getByText('Trust this provider’s verified emails')).toHaveCount(0);

    // Someone types Microsoft's shared address for personal accounts: refused, with the way to the preset.
    await wizard.getByRole('combobox', { name: 'Provider' }).click();
    await page.getByRole('option', { name: 'Another OpenID Connect provider' }).click();
    await wizard.getByLabel('Issuer').fill('https://login.microsoftonline.com/consumers/v2.0');
    await expect(wizard.getByText('Choose the provider “Microsoft (personal accounts: outlook.com, hotmail, live)” instead', { exact: false })).toBeVisible();

    // A provider of its own, against the fake one: saved still off.
    await wizard.getByLabel('Short name').fill('wizard');
    await wizard.getByLabel('Button name').fill('Example Wizard ID');
    await wizard.getByLabel('Issuer').fill(issuer);
    await wizard.getByLabel('Client ID').fill(CLIENT);
    await wizard.getByRole('button', { name: 'Save, still off' }).click();
    await expect(wizard.getByText('Saved and still off.', { exact: false })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Example Wizard ID' }).getByText('Off', { exact: true })).toBeVisible();

    // The test sign-in: the real flow in a new window, which signs nobody in and makes no account.
    const [popup] = await Promise.all([page.waitForEvent('popup'), wizard.getByRole('button', { name: 'Test sign-in' }).click()]);
    await popup.waitForURL((u) => u.pathname === '/operator/sso-test' && u.searchParams.get('oidc_test') === 'ok' && u.searchParams.get('popup') === 'yes');
    await settled(popup);
    await expect(popup.getByText('It worked', { exact: false })).toBeVisible();
    await checkAxe(popup, 'single sign-on test sign-in');
    // The window closes itself, or, where the browser does not let it, goes back to the console.
    await popup.getByRole('button', { name: 'Close this window' }).click();
    await expect.poll(() => popup.isClosed() || new URL(popup.url()).pathname === '/operator').toBe(true);
    if (!popup.isClosed()) await popup.close();
    await expect(wizard.getByText('The test sign-in worked', { exact: false })).toBeVisible();
    expect(count('SELECT count(*) AS n FROM user')).toBe(users);
    expect(count('SELECT count(*) AS n FROM oidc_identity')).toBe(0);
    expect(count("SELECT count(*) AS n FROM session WHERE method = 'oidc'")).toBe(0);

    // Only now: turn it on.
    prove();
    await wizard.getByRole('button', { name: 'Turn it on' }).click();
    await expect(wizard).toHaveCount(0);
    const card = page.getByRole('article', { name: 'Example Wizard ID' });
    await expect(card.getByText('Enabled', { exact: true })).toBeVisible();
    await expect(card.getByText(/^Last sign-in /)).toBeVisible();

    // Health: a Microsoft secret about to expire, and a Google client nobody used for five months.
    sql("UPDATE auth_provider SET secret_expires = ? WHERE id = 'wizard'", day(10));
    const old = Date.now() - 160 * 86_400_000;
    sql(`INSERT INTO auth_provider (id, kind, label, issuer, client_id, secret_sealed, scopes, trust_email, enabled, created, updated)
         VALUES ('google', 'google', 'Google', 'https://accounts.google.com', 'unused.apps.googleusercontent.com', NULL, 'openid email profile', 0, 1, ?, ?)`, old, old);
    await page.reload();
    await settled(page);
    await expect(card.getByText('Its client secret expires in 10 days', { exact: false })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Google' }).getByText('Google deletes unused sign-in apps after six months: sign in once with it.', { exact: false })).toBeVisible();
    await page.getByRole('tab', { name: 'Health' }).click();
    const health = page.getByRole('region', { name: 'Single sign-on providers' });
    await expect(health.getByText('Google deletes unused sign-in apps after six months', { exact: false })).toBeVisible();
    await expect(health.getByText('Its client secret expires in 10 days', { exact: false })).toBeVisible();
    await checkAxe(page, 'health with single sign-on warnings');
    await issues.settle();
  } finally {
    sql("DELETE FROM session WHERE method = 'oidc'");
    sql('DELETE FROM oidc_identity');
    sql('DELETE FROM oidc_flow');
    sql("DELETE FROM auth_provider WHERE id IN ('wizard', 'google')");
    server.close();
  }
});
