// node --test src/lib/auth/csrf.test.ts — the Origin check of the CSRF middleware behind a proxy: KINDRED_ORIGIN names the
// site, and without it the request's own address does.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-csrf-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_ORIGIN;
const { originAllowed, siteOrigin } = await import('./origin.ts');
test.after(() => rmSync(dir, { recursive: true, force: true }));

// What the app sees behind Caddy: the request arrives on its internal, plain-http address.
const behindProxy = () => new Request('http://127.0.0.1:4901/api/auth/signin', { method: 'POST' });

test('without KINDRED_ORIGIN, the request’s own origin is the site', () => {
  assert.equal(originAllowed('http://127.0.0.1:4901', behindProxy()), true);
  assert.equal(originAllowed('https://family.example.org', behindProxy()), false);
});

test('with KINDRED_ORIGIN, a change sent from the public address is allowed behind a proxy', () => {
  process.env.KINDRED_ORIGIN = 'https://family.example.org';
  try {
    assert.equal(siteOrigin(behindProxy()).origin, 'https://family.example.org');
    assert.equal(originAllowed('https://family.example.org', behindProxy()), true, 'the public origin passes');
    assert.equal(originAllowed('http://127.0.0.1:4901', behindProxy()), false, 'the internal address is not the site');
    assert.equal(originAllowed('https://evil.example.net', behindProxy()), false, 'another site is refused');
  } finally {
    delete process.env.KINDRED_ORIGIN;
  }
});
