// node --test src/lib/operator/languages.test.ts: the instance's languages (docs/hosting-many-families.md, "Languages"). The
// operator's choice is one instance setting; English is always offered, a language that is not complete never is, and a
// setting of English alone is kept as a choice rather than read as "not set". Invented data only.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-languages-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const settings = await import('./settings.server.ts');
const { store } = await import('../store/index.ts');
const { COMPLETE_LOCALES } = await import('../i18n/languages.ts');

const save = async (languages: Awaited<ReturnType<typeof settings.instanceSettings>>['languages']) => {
  const s = await settings.instanceSettings();
  await store.accounts().batch(settings.saveSettings({ ...s, languages }, 'operator-test'));
};

test('no setting offers every complete language; a choice offers those of it that are complete, and English always', async () => {
  assert.equal((await settings.instanceSettings()).languages, null);
  assert.deepEqual(await settings.offeredLanguages(), COMPLETE_LOCALES);
  await save(['en', 'af']);
  assert.deepEqual((await settings.instanceSettings()).languages, ['en', 'af']);
  assert.deepEqual(await settings.offeredLanguages(), ['en', 'af']);
  // English alone is a choice, stored as such, not an empty setting (which would mean every language).
  await save([]);
  assert.deepEqual((await settings.instanceSettings()).languages, ['en']);
  assert.deepEqual(await settings.offeredLanguages(), ['en']);
  // A language still being translated stays off even when chosen.
  await save(['de', 'ja']);
  assert.deepEqual(await settings.offeredLanguages(), ['en', 'de']);
  await save(null);
  assert.deepEqual(await settings.offeredLanguages(), COMPLETE_LOCALES);
});
