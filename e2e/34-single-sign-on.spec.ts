// Journey 34: single sign-on with OpenID Connect (docs/self-host.md, "Single sign-on"). A fake provider runs inside this test on
// a free loopback port (its own signing key, discovery document, an authorize endpoint that signs everyone in at once, and a
// token endpoint that checks PKCE), so nothing leaves the machine. The provider is written into the accounts database as the
// console would save it (saving there needs a fresh passkey proof, and the journeys' steward has no virtual device holding its
// passkey), as a public client, so no secret needs sealing. The operator's Sign-in tab shows it with its redirect URI; someone
// takes an invitation with it, finds it in the account menu, signs out, and signs in again with it. The journey puts everything back.
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { checkAxe, expect, openFamily, settled, test } from './fixtures.ts';

const accountsDb = () => new DatabaseSync(join(process.env.KINDRED_E2E_DATA!, 'accounts.db'));
function sql(statement: string, ...args: (string | number | null)[]) {
  const db = accountsDb();
  try {
    db.prepare(statement).run(...args);
  } finally {
    db.close();
  }
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'journey-key', use: 'sig', alg: 'RS256' };
const CLIENT = 'kindred-journey';

/** A provider that signs in `sub` for every authorization request. */
function fakeProvider(sub: string): Promise<{ server: Server; issuer: string }> {
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
        const claims = b64u(JSON.stringify({ iss: issuer, aud: CLIENT, sub, iat: now, exp: now + 300, auth_time: now, nonce: issued.nonce, email: 'quill@example.org', email_verified: true, name: 'Quill Inkwell' }));
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

test('single sign-on: the console, an invitation, the account menu and signing in again', async ({ page, browser, issues, baseURL }) => {
  const { server, issuer } = await fakeProvider('quill-0001');
  const now = Date.now();
  sql(`INSERT INTO auth_provider (id, kind, label, issuer, client_id, secret_sealed, scopes, trust_email, enabled, created, updated)
       VALUES ('journey', 'generic', 'Example ID', ?, ?, NULL, 'openid email profile', 0, 1, ?, ?)`, issuer, CLIENT, now, now);
  sql("INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(['passkey', 'oidc']), now);
  try {
    await openFamily(page);
    await page.goto('/operator');
    await settled(page);
    await page.getByRole('tab', { name: 'Sign-in' }).click();
    const sso = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Single sign-on' }) });
    await expect(sso.getByText('Enabled', { exact: true })).toBeVisible();
    const card = page.getByRole('article', { name: 'Example ID' });
    await expect(card.getByText(`${baseURL}/api/auth/oidc/journey/callback`)).toBeVisible();
    await card.getByRole('button', { name: 'Change' }).click();
    await expect(page.getByLabel('Redirect URI to register at the provider')).toHaveValue(`${baseURL}/api/auth/oidc/journey/callback`);
    await checkAxe(page, 'single sign-on provider form');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // A family for someone else, whose first steward joins with single sign-on.
    await page.getByRole('tab', { name: 'Families' }).click();
    const make = page.getByRole('region', { name: 'Make a family for someone' });
    await make.getByLabel('Name', { exact: true }).fill('The Inkwells');
    await make.getByLabel('Its first steward').fill('Quill Inkwell');
    await make.getByRole('button', { name: 'Make the family and the link' }).click();
    const inviteUrl = await page.getByLabel('Invitation link for Quill Inkwell').inputValue();

    const visit = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    issues.watch(visit);
    const quill = await visit.newPage();
    await quill.goto(inviteUrl);
    await settled(quill);
    const join = quill.getByRole('button', { name: 'Join with Example ID' });
    await expect(join).toBeDisabled();
    await quill.getByLabel('What should the family call you?').fill('Quill Inkwell');
    const terms = quill.getByRole('checkbox', { name: /accept/i });
    if (await terms.count()) await terms.check();
    await checkAxe(quill, 'invitation with single sign-on');
    await join.click();
    await quill.waitForURL((u) => u.origin === baseURL && !u.pathname.startsWith('/invite') && !u.pathname.startsWith('/api'));
    await settled(quill);

    // The account menu lists the provider as in use.
    await quill.locator('[data-tour="account-menu"]').click();
    await quill.getByRole('menuitem', { name: 'Your name & passkeys' }).click();
    const dialog = quill.getByRole('dialog', { name: 'Your name & passkeys' });
    await expect(dialog.getByRole('heading', { name: 'Single sign-on' })).toBeVisible();
    await expect(dialog.getByText('In use as quill@example.org')).toBeVisible();
    await quill.keyboard.press('Escape');

    // Signed out, the sign-in page offers the provider, and it signs in again.
    await quill.locator('[data-tour="account-menu"]').click();
    await quill.getByRole('menuitem', { name: 'Sign out' }).click();
    await quill.goto('/signin');
    await settled(quill);
    await checkAxe(quill, 'sign-in with single sign-on');
    await quill.getByRole('button', { name: 'Continue with Example ID' }).click();
    await quill.waitForURL((u) => u.origin === baseURL && !u.pathname.startsWith('/signin') && !u.pathname.startsWith('/api'));
    await settled(quill);
    await expect(quill.getByText('That didn’t work')).toHaveCount(0);
    await visit.close();
  } finally {
    sql("DELETE FROM instance_setting WHERE key = 'auth_methods'");
    sql("DELETE FROM session WHERE method = 'oidc'");
    sql('DELETE FROM oidc_identity');
    sql('DELETE FROM oidc_flow');
    sql("DELETE FROM auth_provider WHERE id = 'journey'");
    server.close();
  }
});
