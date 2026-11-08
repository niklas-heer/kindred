// node --test src/lib/ai-migration.test.ts — migration 0010 (several providers per family) on a database holding today's shape:
// migrations 0001 to 0009 applied, with real rows. Each family's keys are sealed the way they were before (v1, bound to the
// family only), so the test also checks that a moved key still opens for its family and for no other. Nothing else is touched:
// the switches, the budget, the web-search switch, the custom prices and the spend keep their values.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-migration-'));
const accountsPath = join(dir, 'accounts.db');
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = accountsPath;
process.env.KINDRED_SECRET = 'migration-test-secret';
// Loaded after the environment is set: the store reads it on import.
const { migrate, migrationFiles } = await import('./store/node.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

// ---------- the keys as they were sealed before 0010 (v1: AES-GCM, HKDF over the secret, the family id as the info) ----------
const enc = new TextEncoder();
const SECRET = process.env.KINDRED_SECRET!;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
async function v1Key(tree: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('kindred-ai-keys/v1'), info: enc.encode(`tree:${tree}`) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function v1Seal(tree: string, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await v1Key(tree), enc.encode(key)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
async function v1Open(tree: string, sealed: string): Promise<string | null> {
  const [v, iv, ct] = sealed.split('.');
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv!) }, await v1Key(tree), unb64(ct!)));
  } catch {
    return null;
  }
}

const ANTHROPIC = 'sk-ant-FAMILY-A-ANTHROPIC-1111';
const OR_A = 'sk-or-v1-FAMILY-A-PORTRAIT-2222';
const OR_B_FAMILY = 'sk-or-v1-FAMILY-B-ASSISTANT-3333';
const OR_B_PORTRAIT = 'sk-or-v1-FAMILY-B-PORTRAIT-4444';
const OPENAI_C = 'sk-openai-FAMILY-C-5555-OPENAI';
const OR_D = 'sk-or-v1-FAMILY-D-PORTRAIT-6666';

// ---------- today's shape: 0001 to 0009, with the rows a real family has ----------
function todaysShape(): DatabaseSync {
  const d = new DatabaseSync(accountsPath);
  d.exec('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
  for (const f of migrationFiles('accounts').filter((f) => f < '0010_')) {
    d.exec(readFileSync(join(process.cwd(), 'migrations', 'accounts', f), 'utf8'));
    d.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
  }
  return d;
}

const ASSISTANT_FEATURES = '{"assistant":true,"faces":true,"avatar":false,"arms":true}';
const CUSTOM = '{"my-model":{"inPerM":1,"outPerM":2}}';

test('migration 0010 moves today\'s single-key settings into providers and routes, and keeps everything else', async () => {
  const d = todaysShape();
  d.prepare('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)').run('u1', 'Anna', 'handle-migration', 1);
  const seal = {
    a: await v1Seal('mig-a', ANTHROPIC), aPortrait: await v1Seal('mig-a', OR_A),
    bFamily: await v1Seal('mig-b', OR_B_FAMILY), bPortrait: await v1Seal('mig-b', OR_B_PORTRAIT),
    c: await v1Seal('mig-c', OPENAI_C), dPortrait: await v1Seal('mig-d', OR_D),
  };

  // Family A: an Anthropic family with its own portrait key (OpenRouter), the common case with both.
  d.prepare(`INSERT INTO ai_settings (tree, provider, model, key_sealed, key_tail, features, daily_tokens, updated, updated_by, monthly_micros, web_search, custom_prices)
             VALUES (?, 'anthropic', 'claude-sonnet-5-5', ?, '1111', ?, 300000, 10, 'u1', 7000000, 1, ?)`).run('mig-a', seal.a, ASSISTANT_FEATURES, CUSTOM);
  d.prepare(`INSERT INTO ai_portrait (tree, enabled, model, reuse_family_key, key_sealed, key_tail, updated, updated_by)
             VALUES (?, 1, 'openai/gpt-image-2', 0, ?, '2222', 11, 'u1')`).run('mig-a', seal.aPortrait);
  d.prepare("INSERT INTO ai_background_task (tree, task, enabled, schedule, last_started) VALUES ('mig-a', 'arms', 1, 'weekly', 1234)").run();
  d.prepare("INSERT INTO ai_spend (tree, month, micros) VALUES ('mig-a', '2026-11', 42)").run();

  // Family B: both keys are OpenRouter's, and they differ. The assistant's key becomes the connection; the portrait's stays put.
  d.prepare(`INSERT INTO ai_settings (tree, provider, model, key_sealed, key_tail, features, daily_tokens, updated, updated_by, monthly_micros, web_search, custom_prices)
             VALUES (?, 'openrouter', 'google/gemini-3.8-flash', ?, '3333', ?, 300000, 10, 'u1', 5000000, 0, '{}')`).run('mig-b', seal.bFamily, ASSISTANT_FEATURES);
  d.prepare(`INSERT INTO ai_portrait (tree, enabled, model, reuse_family_key, key_sealed, key_tail, updated, updated_by)
             VALUES (?, 1, 'openai/gpt-image-2', 0, ?, '4444', 11, 'u1')`).run('mig-b', seal.bPortrait);

  // Family C: an OpenAI family whose portrait reuses the family key (so it has no OpenRouter key of its own).
  d.prepare(`INSERT INTO ai_settings (tree, provider, model, key_sealed, key_tail, features, daily_tokens, updated, updated_by, monthly_micros, web_search, custom_prices)
             VALUES (?, 'openai', 'gpt-6.1-sol', ?, '5555', ?, 300000, 10, 'u1', 5000000, 0, '{}')`).run('mig-c', seal.c, ASSISTANT_FEATURES);
  d.prepare(`INSERT INTO ai_portrait (tree, enabled, model, reuse_family_key, key_sealed, key_tail, updated, updated_by)
             VALUES (?, 0, 'openai/gpt-image-2', 1, NULL, NULL, 11, 'u1')`).run('mig-c');

  // Family D: no AI settings row, only a portrait key.
  d.prepare(`INSERT INTO ai_portrait (tree, enabled, model, reuse_family_key, key_sealed, key_tail, updated, updated_by)
             VALUES (?, 0, '', 0, ?, '6666', 11, 'u1')`).run('mig-d', seal.dPortrait);

  // Family E: nothing at all.
  d.prepare("INSERT INTO ai_spend (tree, month, micros) VALUES ('mig-e', '2026-11', 0)").run();

  // The migration, as the store runs it on open: only 0010 is pending.
  migrate(d, 'accounts');
  assert.ok(d.prepare("SELECT 1 FROM d1_migrations WHERE name = '0010_ai_providers.sql'").get(), 'applied');

  const providers = (tree: string) => d.prepare('SELECT provider, key_sealed, key_tail FROM ai_provider WHERE tree = ? ORDER BY provider').all(tree) as { provider: string; key_sealed: string; key_tail: string }[];
  const routes = (tree: string) => d.prepare('SELECT route, provider, model FROM ai_route WHERE tree = ? ORDER BY route').all(tree) as { route: string; provider: string | null; model: string }[];
  const settings = (tree: string) => d.prepare('SELECT features, web_search, monthly_micros, custom_prices, key_sealed, key_tail FROM ai_settings WHERE tree = ?').get(tree) as { features: string; web_search: number; monthly_micros: number; custom_prices: string; key_sealed: string | null; key_tail: string | null };
  const portrait = (tree: string) => d.prepare('SELECT enabled, model, key_sealed FROM ai_portrait WHERE tree = ?').get(tree) as { enabled: number; model: string; key_sealed: string | null };

  // A: the Anthropic key and the portrait's OpenRouter key are two connections; the assistant and the portrait have routes.
  const pa = providers('mig-a');
  assert.deepEqual(pa.map((p) => [p.provider, p.key_tail]), [['anthropic', '1111'], ['openrouter', '2222']]);
  assert.equal(pa.find((p) => p.provider === 'anthropic')!.key_sealed, seal.a, 'the sealed key moved unchanged');
  assert.equal(await v1Open('mig-a', pa.find((p) => p.provider === 'anthropic')!.key_sealed), ANTHROPIC, 'and it still opens for its family');
  assert.equal(await v1Open('mig-a', pa.find((p) => p.provider === 'openrouter')!.key_sealed), OR_A, 'the portrait key is OpenRouter\'s connection, and it still opens');
  assert.equal(await v1Open('mig-b', pa.find((p) => p.provider === 'anthropic')!.key_sealed), null, 'a moved key cannot be opened as another family\'s');
  assert.deepEqual(routes('mig-a').map((r) => [r.route, r.provider, r.model]), [['assistant', 'anthropic', 'claude-sonnet-5-5'], ['portrait', 'openrouter', 'openai/gpt-image-2']]);
  const sa = settings('mig-a');
  assert.equal(sa.features, ASSISTANT_FEATURES, 'the switches are kept');
  assert.equal(sa.web_search, 1);
  assert.equal(sa.monthly_micros, 7_000_000, 'the monthly budget is kept');
  assert.equal(sa.custom_prices, CUSTOM, 'the custom prices are kept');
  assert.equal(sa.key_sealed, null, 'the key sits in one place now');
  assert.equal(sa.key_tail, null);
  assert.equal(portrait('mig-a').key_sealed, null, 'the portrait\'s copy of its key is cleared');
  assert.equal(portrait('mig-a').enabled, 1, 'painting stays on');
  assert.equal(d.prepare("SELECT enabled, last_started FROM ai_background_task WHERE tree = 'mig-a'").get()!.enabled, 1, 'a background task keeps its switch');
  assert.equal((d.prepare("SELECT micros FROM ai_spend WHERE tree = 'mig-a'").get() as { micros: number }).micros, 42, 'spend is kept');

  // B: both keys are OpenRouter's and differ. The assistant's key is the connection; the portrait's key is not dropped: it stays where it was.
  assert.deepEqual(providers('mig-b').map((p) => [p.provider, p.key_tail]), [['openrouter', '3333']]);
  assert.equal(await v1Open('mig-b', providers('mig-b')[0]!.key_sealed), OR_B_FAMILY);
  assert.equal(portrait('mig-b').key_sealed, seal.bPortrait, 'the second OpenRouter key is kept in place, not dropped');
  assert.equal(await v1Open('mig-b', portrait('mig-b').key_sealed!), OR_B_PORTRAIT);
  assert.deepEqual(routes('mig-b').map((r) => [r.route, r.provider, r.model]), [['assistant', 'openrouter', 'google/gemini-3.8-flash'], ['portrait', 'openrouter', 'openai/gpt-image-2']]);
  assert.equal(settings('mig-b').monthly_micros, 5_000_000);

  // C: the portrait reused the family key, so there is no OpenRouter connection; the portrait route keeps its model, and waits for one.
  assert.deepEqual(providers('mig-c').map((p) => p.provider), ['openai']);
  assert.equal(await v1Open('mig-c', providers('mig-c')[0]!.key_sealed), OPENAI_C);
  assert.deepEqual(routes('mig-c').map((r) => [r.route, r.provider, r.model]), [['assistant', 'openai', 'gpt-6.1-sol'], ['portrait', 'openrouter', 'openai/gpt-image-2']]);
  assert.equal(portrait('mig-c').enabled, 0);

  // D: a portrait key alone becomes the OpenRouter connection; there is no assistant route to invent.
  assert.deepEqual(providers('mig-d').map((p) => [p.provider, p.key_tail]), [['openrouter', '6666']]);
  assert.equal(await v1Open('mig-d', providers('mig-d')[0]!.key_sealed), OR_D);
  assert.deepEqual(routes('mig-d').map((r) => r.route), ['portrait']);
  assert.equal(portrait('mig-d').key_sealed, null);

  // E: nothing was created for a family with no AI rows.
  assert.equal(providers('mig-e').length, 0);
  assert.equal(routes('mig-e').length, 0);

  d.close();
});
