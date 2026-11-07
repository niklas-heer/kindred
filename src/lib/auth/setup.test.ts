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
  delete process.env.KINDRED_SETUP_CODE;
  delete process.env.KINDRED_REQUIRE_SETUP_CODE;
  const store = await import('./store.server.ts');
  const setup = await import('./setup.server.ts');
  const passkeys = await import('./passkeys.server.ts');
  const request = new Request('http://localhost:4651');
  try {
    await t.test('first setup is open, without a console code', async () => {
      assert.equal(setup.needsSetup(), true);
      assert.equal(setup.checkSetupCode(''), true);
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
      assert.equal(setup.checkSetupCode(''), false);
      await assert.rejects(passkeys.setupOptions(request, 'wrong', 'Anna'), /code/);
      const log = console.log;
      let output = '';
      console.log = (message) => { output += message; };
      try { setup.announceSetup(undefined, true); } finally { console.log = log; }
      const code = output.match(/[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}/)?.[0];
      assert.ok(code);
      assert.equal(setup.checkSetupCode(code.toLowerCase().replaceAll('-', ' ')), true);
      await passkeys.setupOptions(request, code, 'Anna');
      delete process.env.KINDRED_SETUP_CODE;
      process.env.KINDRED_REQUIRE_SETUP_CODE = '1';
      assert.equal(setup.checkSetupCode('wrong'), false);
      assert.equal(setup.checkSetupCode(code), true);
      delete process.env.KINDRED_REQUIRE_SETUP_CODE;
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
      const user = store.tx((d) => {
        const user = store.createUser(d, 'Anna', null);
        store.addCredential(d, {id:'YWJj', user:user.id, publicKey:new Uint8Array([1]), counter:0, transports:[], device:'Test', synced:true});
        store.addMembership(d, user.id, 'modern', 'steward');
        return user;
      });
      const { options } = await passkeys.addOptions(request, user);
      assert.deepEqual(options.excludeCredentials, [{id:'YWJj', type:'public-key', transports:[]}]);
      assert.equal(setup.needsSetup(), false);
      assert.equal(setup.checkSetupCode(''), false);
      await assert.rejects(passkeys.setupOptions(request, '', 'Second'), /already set up/);
    });
    await t.test('only the first verified Access identity can claim stewardship; code mode blocks it', async () => {
      store.accounts().exec('DELETE FROM user');
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
      assert.equal(store.userCount(), 1);
      const winner = results.find((s) => s.user)!.user!;
      assert.deepEqual(store.membershipsOf(winner.id).map((m) => m.role), ['steward','steward']);
    });
  } finally {
    store.accounts().close();
    (globalThis as any).__kindredAccounts = undefined;
    process.env = saved;
    rmSync(dir, {recursive:true, force:true});
  }
});
