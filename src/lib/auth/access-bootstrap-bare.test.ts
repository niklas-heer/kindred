// node --test src/lib/auth/access-bootstrap-bare.test.ts — the first Cloudflare Access sign-in when the server's family
// database exists but has no details yet (a migrated file with no family name: the D1 case in docs/deploy-cloudflare.md).
// That database gets its details, in the reader's language, and the account is its steward. Scratch folders only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

const dir = mkdtempSync(join(tmpdir(), 'kindred-access-bare-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_DEFAULT_TREE = 'house-bare';
process.env.KINDRED_AUTH = 'cloudflare-access';
process.env.CF_ACCESS_TEAM_DOMAIN = 'family.cloudflareaccess.com';
process.env.CF_ACCESS_AUD = 'aud-bare';
for (const k of ['KINDRED_SETUP_CODE', 'KINDRED_REQUIRE_SETUP_CODE', 'KINDRED_ORIGIN']) delete process.env[k];

const { openSqlite, closeAccounts } = await import('../store/node.ts');
const { accessConfig, verifyAccessToken } = await import('./access.server.ts');
const { getSession } = await import('./session.server.ts');
const store = await import('./store.server.ts');
const { families } = await import('./trees.server.ts');

// A migrated family file with no meta rows: the schema is there, the details are not.
openSqlite(join(dir, 'house-bare.db'), 'tree', { create: true }).close();

test.after(() => {
  closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

const config = accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'family.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-bare' })!;
const { publicKey, privateKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
const token = await new SignJWT({ email: 'carl@example.org' })
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setIssuer(config.team).setAudience(config.aud).setExpirationTime('5m').sign(privateKey);

test('the bare family gets its details in the reader’s language, and the first account stewards it', async () => {
  assert.deepEqual(await families(), [], 'no family is listed yet: its details are missing');
  const session = await getSession(
    new Request('https://family.example.org/', { headers: { 'cf-access-jwt-assertion': token, 'accept-language': 'de-DE,de;q=0.9' } }),
    (r) => verifyAccessToken(r.headers.get('cf-access-jwt-assertion'), config, keys),
  );
  assert.equal(session.user?.email, 'carl@example.org');
  assert.deepEqual((await families()).map((f) => [f.id, f.name]), [['house-bare', 'Unsere Familie']]);
  assert.deepEqual((await store.membershipsOf(session.user!.id)).map((m) => [m.tree, m.role]), [['house-bare', 'steward']]);
});
