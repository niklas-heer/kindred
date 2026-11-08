import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Import after choosing a private store; never touch the deployment's accounts.
test('bootstrap modes, discoverable options, exclusions and proxy origin', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kindred-auth-test-'));
  const saved = { ...process.env };
  process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
  // Setup looks for existing families, so the family folder must be private too (never data/).
  process.env.KINDRED_DATA_DIR = dir;
  delete process.env.KINDRED_SETUP_CODE;
  delete process.env.KINDRED_REQUIRE_SETUP_CODE;
  const store = await import('./store.server.ts');
  const setup = await import('./setup.server.ts');
  const passkeys = await import('./passkeys.server.ts');
  const request = new Request('http://localhost:4651');
  try {
    await t.test('first setup is open, without a console code', async () => {
      assert.equal(await setup.needsSetup(), true);
      assert.equal(await setup.checkSetupCode(''), true);
      const { options } = await passkeys.setupOptions(request, '', 'Anna');
      assert.equal(options.authenticatorSelection?.residentKey, 'required');
      assert.equal(options.authenticatorSelection?.userVerification, 'preferred');
      assert.equal(options.authenticatorSelection?.authenticatorAttachment, undefined);
      assert.equal(options.attestation, 'none');
      assert.deepEqual(options.pubKeyCredParams.map((p) => p.alg), [-7, -257]);
      assert.deepEqual(options.excludeCredentials, []);
    });
    await t.test('required code and legacy flag reject missing or wrong codes', async () => {
      process.env.KINDRED_SETUP_CODE = 'required';
      assert.equal(await setup.checkSetupCode(''), false);
      await assert.rejects(passkeys.setupOptions(request, 'wrong', 'Anna'), /code/);
      const log = console.log;
      let output = '';
      console.log = (message) => { output += message; };
      try { await setup.announceSetup(undefined, true); } finally { console.log = log; }
      const code = output.match(/[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}/)?.[0];
      assert.ok(code);
      assert.equal(await setup.checkSetupCode(code.toLowerCase().replaceAll('-', ' ')), true);
      await passkeys.setupOptions(request, code, 'Anna');
      delete process.env.KINDRED_SETUP_CODE;
      process.env.KINDRED_REQUIRE_SETUP_CODE = '1';
      assert.equal(await setup.checkSetupCode('wrong'), false);
      assert.equal(await setup.checkSetupCode(code), true);
      delete process.env.KINDRED_REQUIRE_SETUP_CODE;
      // A code set in the environment is the same in every process (Workers) and is never printed.
      process.env.KINDRED_SETUP_CODE = 'ABCD-EFGH-JKMN-PQRS';
      assert.equal(await setup.checkSetupCode('abcd efgh jkmn pqrs'), true);
      assert.equal(await setup.checkSetupCode(code), false);
      delete process.env.KINDRED_SETUP_CODE;
    });
    await t.test('origin config supplies the RP hostname and exact public origin', async () => {
      process.env.KINDRED_ORIGIN = 'https://family.example.org:8443/';
      assert.deepEqual(passkeys.relyingParty(request), {rpID:'family.example.org', origin:'https://family.example.org:8443'});
      const { options } = await passkeys.signInOptions(request);
      assert.deepEqual(options.allowCredentials, []);
      assert.equal(options.userVerification, 'preferred');
      assert.equal(options.rpId, 'family.example.org');
      delete process.env.KINDRED_ORIGIN;
    });
    await t.test('existing passkeys are excluded and setup closes after the first account', async () => {
      const { user, insert } = store.newUser('Anna', null);
      await store.accounts().batch([
        insert,
        store.insertCredential({id:'YWJj', user:user.id, publicKey:new Uint8Array([1]), counter:0, transports:[], device:'Test', synced:true}),
        store.upsertMembership(user.id, 'modern', 'steward'),
      ]);
      const { options } = await passkeys.addOptions(request, user);
      assert.deepEqual(options.excludeCredentials, [{id:'YWJj', type:'public-key', transports:[]}]);
      assert.equal(await setup.needsSetup(), false);
      assert.equal(await setup.checkSetupCode(''), false);
      await assert.rejects(passkeys.setupOptions(request, '', 'Second'), /already set up/);
    });
    await t.test('only the first verified Access identity can claim stewardship; code mode blocks it', async () => {
      await store.accounts().run('DELETE FROM user');
      const { getSession } = await import('./session.server.ts');
      const families = async () => [{id:'modern'}, {id:'realm'}];
      process.env.KINDRED_SETUP_CODE = 'required';
      assert.equal((await getSession(request, async () => 'first@example.org', families)).user, null);
      delete process.env.KINDRED_SETUP_CODE;
      assert.equal((await getSession(request, async () => undefined, families)).user, null);
      const results = await Promise.all([
        getSession(request, async () => 'first@example.org', families),
        getSession(request, async () => 'second@example.org', families),
      ]);
      assert.equal(results.filter((s) => s.user).length, 1);
      assert.equal(await store.userCount(), 1);
      const winner = results.find((s) => s.user)!.user!;
      assert.deepEqual((await store.membershipsOf(winner.id)).map((m) => m.role), ['steward','steward']);
    });
    await t.test('a membership keeps the higher role; a family keeps a steward', async () => {
      const a = store.accounts();
      const { user, insert } = store.newUser('Bea', null);
      await a.batch([insert, store.upsertMembership(user.id, 'solo', 'editor')]);
      await a.batch([store.upsertMembership(user.id, 'solo', 'viewer')]);
      assert.equal((await store.membership(user.id, 'solo'))!.role, 'editor');
      await a.batch([store.upsertMembership(user.id, 'solo', 'steward')]);
      assert.equal((await store.membership(user.id, 'solo'))!.role, 'steward');
      await assert.rejects(a.batch([store.q('DELETE FROM membership WHERE user = ? AND tree = ?', user.id, 'solo'), store.keepsASteward('solo')]), /kindred:guard/);
      assert.equal((await store.membership(user.id, 'solo'))!.role, 'steward');
    });
    await t.test('setup is open to the public only off this computer and without a code', () => {
      delete process.env.KINDRED_SETUP_CODE;
      for (const h of ['localhost', 'app.localhost', '127.0.0.1', '[::1]']) assert.equal(setup.isLocalHost(h), true, h);
      assert.equal(setup.isLocalHost('family.example.org'), false);
      assert.equal(setup.setupOpenToPublic(new URL('https://family.example.org')), true);
      assert.equal(setup.setupOpenToPublic(new URL('http://localhost:4771')), false);
      process.env.KINDRED_SETUP_CODE = 'required';
      assert.equal(setup.setupOpenToPublic(new URL('https://family.example.org')), false);
      delete process.env.KINDRED_SETUP_CODE;
    });
    await t.test('a public address the request arrives at makes setup public, even when KINDRED_ORIGIN is local', () => {
      delete process.env.KINDRED_SETUP_CODE;
      const local = new URL('http://localhost:4901');
      assert.equal(setup.setupOpenToPublic(local, local), false, 'local origin, local host');
      assert.equal(setup.setupOpenToPublic(local, new URL('https://family.example.org')), true, 'the proxy forwards a public name');
      assert.equal(setup.setupOpenToPublic(new URL('https://family.example.org'), local), true, 'the configured origin is public');
      process.env.KINDRED_SETUP_CODE = 'required';
      assert.equal(setup.setupOpenToPublic(local, new URL('https://family.example.org')), false, 'a code is required: not open');
      delete process.env.KINDRED_SETUP_CODE;
    });
    await t.test('a public host other than KINDRED_ORIGIN’s is logged once; the same host, the scheme, and loopback are not', () => {
      const lines: string[] = [];
      const log = (m: string) => lines.push(m);
      assert.equal(setup.logOriginMismatch(undefined, new URL('https://other.example.net/'), log), false, 'nothing configured');
      assert.equal(setup.logOriginMismatch('https://family.example.org/', new URL('https://family.example.org/x'), log), false, 'the scheme differs behind a proxy: normal');
      assert.equal(setup.logOriginMismatch('http://localhost:4901', new URL('http://localhost:4901/'), log), false, 'the same host');
      assert.equal(setup.logOriginMismatch('https://family.example.org', new URL('http://127.0.0.1:4901/'), log), false, 'the server checking its own address');
      assert.equal(lines.length, 0);
      assert.equal(setup.logOriginMismatch('https://family.example.org', new URL('https://other.example.net/api'), log), true);
      assert.equal(setup.logOriginMismatch('https://family.example.org', new URL('https://other.example.net/api'), log), false, 'once per process');
      assert.equal(lines.length, 1);
      assert.match(lines[0], /other\.example\.net.*family\.example\.org/);
    });
    await t.test('KINDRED_REQUIRE_SETUP_CODE takes 1, true, yes or required in any case; other values leave it off, warn once and are not repeated', () => {
      const saved = console.warn;
      const warnings: string[] = [];
      console.warn = (m: unknown) => { warnings.push(String(m)); };
      try {
        delete process.env.KINDRED_SETUP_CODE;
        for (const v of ['1', 'true', 'TRUE', 'True', ' yes ', 'Yes', 'YES', 'required', 'Required']) {
          process.env.KINDRED_REQUIRE_SETUP_CODE = v;
          assert.equal(setup.setupCodeRequired(), true, JSON.stringify(v));
        }
        assert.equal(warnings.length, 0, 'the accepted values do not warn');
        // A pasted setup code in this variable must not be echoed into the log.
        for (const v of ['0', 'false', 'no', 'on', 'y', '2', 'ABCD-EFGH-JKMN-PQRS']) {
          process.env.KINDRED_REQUIRE_SETUP_CODE = v;
          assert.equal(setup.setupCodeRequired(), false, JSON.stringify(v));
        }
        assert.equal(warnings.length, 1, 'one warning, however many values or calls');
        assert.match(warnings[0], /KINDRED_REQUIRE_SETUP_CODE/);
        assert.equal(warnings[0].includes('ABCD'), false, 'the value is not logged');
        process.env.KINDRED_REQUIRE_SETUP_CODE = '';
        assert.equal(setup.setupCodeRequired(), false, 'empty is simply unset');
      } finally {
        console.warn = saved;
        delete process.env.KINDRED_REQUIRE_SETUP_CODE;
      }
    });
    await t.test('behind a TLS proxy the address a request arrived at uses X-Forwarded-Proto; only http and https count', () => {
      assert.equal(setup.arrivedAt(new Request('http://family.example.org:8080/setup?x=1')).href, 'http://family.example.org:8080/setup?x=1');
      const behind = setup.arrivedAt(new Request('http://family.example.org/setup', { headers: { 'x-forwarded-proto': 'https, http' } }));
      assert.equal(behind.origin, 'https://family.example.org');
      assert.equal(behind.pathname, '/setup');
      assert.equal(setup.arrivedAt(new Request('http://family.example.org/', { headers: { 'x-forwarded-proto': 'ftp' } })).origin, 'http://family.example.org');
    });
  } finally {
    (await import('../store/node.ts')).closeAccounts();
    process.env = saved;
    rmSync(dir, {recursive:true, force:true});
  }
});
