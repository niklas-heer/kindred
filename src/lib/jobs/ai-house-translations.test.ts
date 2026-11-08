// node --test src/lib/jobs/ai-house-translations.test.ts — the background translation of a house's researched meanings and its
// arms check, on private databases (never data/). Checked: only what is missing is picked; nothing to do does not run; the
// budget stops the work with nothing written; only the words go out; each reader gets only what they may read; a new research
// replaces the translation; the originals are untouched.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { AiAdapter, AiReply, AiRequest } from '../ai/adapters.ts';
import type { SaveInput } from '../ai/background.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-house-translations-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'house-translations-test-secret';
delete process.env.KINDRED_AI_FAKE;
globalThis.fetch = (async () => { throw new Error('a test tried to reach the network'); }) as typeof fetch;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('../store/index.ts')>('/src/lib/store/index.ts');
const bg = await load<typeof import('../ai/background.server.ts')>('/src/lib/ai/background.server.ts');
const { pending } = await load<typeof import('../ai/background-tasks.server.ts')>('/src/lib/ai/background-tasks.server.ts');
const { readHouseTranslations } = await load<typeof import('../ai/house-translation.server.ts')>('/src/lib/ai/house-translation.server.ts');
const { setUpFamilyAi } = await load<typeof import('../ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const { AiError } = await load<typeof import('../ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const { checkArms } = await load<typeof import('../ai/arms-fit.server.ts')>('/src/lib/ai/arms-fit.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-11-08T06:00:00Z');
const PRICE = { inPerM: 1, outPerM: 1, searchEach: 0 };
const ARMS = { field: 'gules', division: 'plain', charge: 'none', chargeTincture: 'or' };
const MEANINGS = [
  { id: 'm1', language: 'Dutch and German', root: 'heer', meaning: 'lord, gentleman', attestation: 'well-attested', ideas: [{ kind: 'quality', idea: 'courage' }], sources: [{ url: 'https://example.org/heer-source' }], chosen: true },
  { id: 'm2', language: 'German', root: 'hehr', meaning: 'noble', attestation: 'speculative', ideas: [], chosen: false },
  { id: 'own1', language: '', root: '', meaning: 'FAMILY-OWN-WORDS', attestation: 'family', ideas: [], chosen: true },
];

function makeFamily(id: string, meanings: unknown[] = MEANINGS): void {
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Family ${id}'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
    INSERT INTO house (id, name, arms) VALUES ('h1', 'House Heer', '${JSON.stringify(ARMS)}');
    INSERT INTO person (id, given, house, living) VALUES ('ada', 'PERSON-ADA', 'h1', 1);
    INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES ('pf1', 'ada', 'phone', 'Mobile', '{"value":"SECRET-PHONE"}', 0, 'editors');
  `);
  d.prepare(`INSERT INTO house_meaning (house, name, family_words, meanings, web_searched, note, saved_at, saved_by) VALUES ('h1', 'Heer', 'FAMILY-WORDS', ?, 0, 'Little is known.', ?, 'steward-1')`).run(JSON.stringify(meanings), NOW.getTime());
  d.close();
}

const input = (languages: SaveInput['languages']): SaveInput => {
  const schedule = () => ({ schedule: 'daily' as const });
  return { tasks: { arms: schedule(), occupations: schedule(), chronicle: schedule(), names: schedule() }, capShare: 0.2, languages, locale: 'en' };
};

async function setUp(tree: string, languages: SaveInput['languages'], monthlyMicros = 1_000_000): Promise<void> {
  await setUpFamilyAi(tree, null, { provider: 'anthropic', model: '', apiKey: 'sk-test-key-123', features: { assistant: true, faces: false, avatar: false, arms: true }, webSearch: false, monthlyMicros, customPrices: {} });
  await bg.saveBackground(tree, 'steward-1', input(languages));
  await bg.setTaskEnabled(tree, 'occupations', true);
}

const textOf = (req: AiRequest) => {
  const last = req.messages.at(-1);
  return last?.role === 'user' ? last.text : '{}';
};

function stub(usd?: number) {
  const requests: AiRequest[] = [];
  const adapter: AiAdapter = {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    async complete(req: AiRequest): Promise<AiReply> {
      requests.push(req);
      const source = JSON.parse(textOf(req)) as { note?: string; reason?: string; advice?: string; meanings?: { id: string; language: string; meaning: string; ideas: string[] }[] };
      const json = req.json?.name === 'house_meanings_translation'
        ? { same: false, note: `DE ${source.note}`, meanings: source.meanings?.map((m) => ({ id: m.id, language: `DE ${m.language}`, meaning: `DE ${m.meaning}`, ideas: m.ideas.map((i) => `DE ${i}`) })) }
        : { same: false, reason: `DE ${source.reason}`, advice: source.advice ? `DE ${source.advice}` : '' };
      return { text: '', calls: [], json, tokens: 20, inputTokens: 10, outputTokens: 10, searches: 0, ...(usd !== undefined ? { reportedCostUsd: usd } : {}) };
    },
  };
  return { adapter, requests };
}

const run = (tree: string, adapter: AiAdapter) => bg.runTask(tree, 'occupations', { adapter, price: PRICE, now: NOW });
const rows = (tree: string, sql: string) => {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  const out = d.prepare(sql).all();
  d.close();
  return out;
};
const op = (key: string) => ({ key, user: 'steward-1', payload: { key } });
const fitStub = (): AiAdapter => ({
  provider: 'anthropic', model: 'claude-haiku-5-5',
  complete: async () => ({ text: '', calls: [], json: { verdict: 'partly', reason: 'Only courage.', advice: 'Add a trade.' }, tokens: 20, inputTokens: 10, outputTokens: 10, searches: 0 }),
});

test('only what is missing is picked, and once done the task has nothing to do and does not run', async () => {
  const tree = 'picks';
  makeFamily(tree);
  await setUp(tree, ['de', 'af']);
  const items = await pending(tree, 'occupations', ['de', 'af']);
  assert.deepEqual(items.map((p) => ('kind' in p ? `${p.kind}:${p.locale}` : 'other')), ['meanings:de', 'meanings:af']);

  const { adapter, requests } = stub();
  const first = await run(tree, adapter);
  assert.equal(first.status, 'done');
  assert.equal(first.done, 2);
  assert.equal(requests.length, 2);

  assert.deepEqual(await pending(tree, 'occupations', ['de', 'af']), []);
  const second = await run(tree, adapter);
  assert.equal(second.status, 'idle', 'nothing to do does not run');
  assert.equal(requests.length, 2, 'and asks nothing');
});

test('an already translated language is not picked again when another is added', async () => {
  const tree = 'added';
  makeFamily(tree);
  await setUp(tree, ['de']);
  await run(tree, stub().adapter);
  const items = await pending(tree, 'occupations', ['de', 'af']);
  assert.deepEqual(items.map((p) => ('kind' in p ? p.locale : '')), ['af']);
});

test('only the words go out: no person, no private field, no family words, no surname, no root, no source link', async () => {
  const tree = 'privacy';
  makeFamily(tree);
  await setUp(tree, ['de']);
  const { adapter, requests } = stub();
  await run(tree, adapter);
  assert.equal(requests.length, 1);
  const sent = JSON.stringify(requests[0]);
  for (const secret of ['PERSON-ADA', 'SECRET-PHONE', 'FAMILY-OWN-WORDS', 'FAMILY-WORDS', 'Heer', 'hehr', 'heer-source']) assert.ok(!sent.includes(secret), `${secret} stays out`);
  const message = JSON.parse(textOf(requests[0]));
  assert.deepEqual(Object.keys(message).sort(), ['meanings', 'note']);
  assert.deepEqual(Object.keys(message.meanings[0]).sort(), ['id', 'ideas', 'language', 'meaning']);
  assert.equal(requests[0].webSearch, undefined, 'no web search');
});

test('the budget path: a run at the cap stops, writes nothing and leaves the text waiting', async () => {
  const tree = 'budget';
  makeFamily(tree);
  await setUp(tree, ['de'], 1);
  const { adapter, requests } = stub();
  const out = await run(tree, adapter);
  assert.equal(out.status, 'stopped');
  assert.equal(requests.length, 0, 'nothing was sent');
  assert.equal(rows(tree, 'SELECT * FROM house_translation').length, 0);
  assert.equal((await pending(tree, 'occupations', ['de'])).length, 1, 'and the budget does not count against the text');
});

test('a reply of the wrong shape writes nothing and is tried again', async () => {
  const tree = 'badshape';
  makeFamily(tree);
  await setUp(tree, ['de']);
  const adapter: AiAdapter = { ...stub().adapter, complete: async () => ({ text: '', calls: [], json: { same: false, note: 'x', meanings: [] }, tokens: 1, inputTokens: 1, outputTokens: 0, searches: 0 }) };
  const out = await run(tree, adapter);
  assert.equal(out.failed, 1);
  assert.equal(rows(tree, 'SELECT * FROM house_translation').length, 0);
  assert.equal((await pending(tree, 'occupations', ['de'])).length, 1);
});

test('the originals are never altered, and each reader gets only what they may read', async () => {
  const tree = 'reader';
  makeFamily(tree);
  await setUp(tree, ['de']);
  await checkArms({ tree, house: 'h1', locale: 'en', force: false, by: 'steward-1', op: op('reader-check-0001'), adapter: fitStub() });
  const before = JSON.stringify(rows(tree, 'SELECT * FROM house_meaning'));
  const { adapter } = stub();
  await run(tree, adapter);
  assert.equal(JSON.stringify(rows(tree, 'SELECT * FROM house_meaning')), before);

  const steward = await readHouseTranslations(tree, 'de', true);
  assert.deepEqual(Object.keys(steward.meanings.h1.rows).sort(), ['m1', 'm2']);
  assert.equal(steward.meanings.h1.note, 'DE Little is known.');
  assert.equal(steward.reviews.h1.reason, 'DE Only courage.');

  const viewer = await readHouseTranslations(tree, 'de', false);
  assert.deepEqual(Object.keys(viewer.meanings.h1.rows), ['m1'], 'a meaning that was not selected stays with the steward');
  assert.deepEqual(viewer.reviews, {}, 'the arms check is the steward’s');
});

test('an arms check is not translated into the language it was written in', async () => {
  const tree = 'reviewlocale';
  makeFamily(tree);
  await setUp(tree, ['en', 'de']);
  await checkArms({ tree, house: 'h1', locale: 'de', force: false, by: 'steward-1', op: op('reviewlocale-check'), adapter: fitStub() });
  const items = await pending(tree, 'occupations', ['en', 'de']);
  assert.deepEqual(items.filter((p) => 'kind' in p && p.kind === 'review').map((p) => ('kind' in p ? p.locale : '')), ['en']);
});

test('researching again replaces the translation: the old one is not shown and the new text is translated', async () => {
  const tree = 'replaced';
  makeFamily(tree);
  await setUp(tree, ['de']);
  await run(tree, stub().adapter);
  assert.ok((await readHouseTranslations(tree, 'de', true)).meanings.h1);

  await store.tree(tree).run('UPDATE house_meaning SET meanings = ? WHERE house = ?', JSON.stringify([{ ...MEANINGS[0], meaning: 'an army' }]), 'h1');
  assert.equal((await readHouseTranslations(tree, 'de', true)).meanings.h1, undefined, 'the old translation is not shown');
  assert.equal((await pending(tree, 'occupations', ['de'])).length, 1);

  await run(tree, stub().adapter);
  assert.equal((await readHouseTranslations(tree, 'de', true)).meanings.h1.rows.m1.meaning, 'DE an army');
  assert.equal(rows(tree, 'SELECT * FROM house_translation').length, 1, 'replaced, not added to');
});

test('choosing other meanings does not ask for a new translation', async () => {
  const tree = 'chosen';
  makeFamily(tree);
  await setUp(tree, ['de']);
  await run(tree, stub().adapter);
  await store.tree(tree).run('UPDATE house_meaning SET meanings = ? WHERE house = ?', JSON.stringify(MEANINGS.map((m) => ({ ...m, chosen: !m.chosen }))), 'h1');
  assert.deepEqual(await pending(tree, 'occupations', ['de']), []);
});

test('AiError is the budget error the run stops on', () => assert.equal(new AiError('budget', 'x').code, 'budget'));
