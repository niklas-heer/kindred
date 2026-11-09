// node --test src/lib/ai-threads.test.ts: a reader's chats. Every path checks the chat is this reader's, the list only names
// what the reader may read, deleting takes the kept pictures with it, a chat's model is a steward's choice, and asking again on
// another model keeps both answers without a second question in the model's history. Private data folder and fake provider.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-threads-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-threads-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const chat = await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts');
const threads = await load<typeof import('./ai/conversations.server.ts')>('/src/lib/ai/conversations.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');

const TREE = 'threads';
const OTHER_TREE = 'elsewhere';
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname) VALUES ('ada', 'Ada', 'Lovelace');`);
family.close();

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

for (const [id, handle] of [['anna', 'h-anna'], ['bert', 'h-bert']]) await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, id, handle, Date.now());
await setup.setUpFamilyAi(TREE, 'anna', { provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: 'sk-test-abcdefgh1234' });

const ask = (conv: string, text: string, role: 'steward' | 'editor' | 'viewer' = 'steward', extra: object = {}) =>
  chat.sendMessage({ tree: TREE, user: 'anna', role, me: null, text, locale: 'en', conv, ...extra });
const list = (role: 'steward' | 'editor' | 'viewer' = 'steward', user = 'anna') => threads.listThreads(TREE, user, role);
const rows = (conv: string) => accounts().all<{ id: string; role: string; body: string }>('SELECT id, role, body FROM ai_chat WHERE conv = ? ORDER BY at, rowid', conv);

test('the migration gives every chat that already has messages a row, dated from them, and loses none', async () => {
  const d = openSqlite(join(dir, 'backfill.db'), 'accounts', { create: true });
  d.exec(`INSERT INTO user (id, name, handle, created) VALUES ('u', 'U', 'h-u', 1), ('v', 'V', 'h-v', 1);
    DELETE FROM ai_thread;
    INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES
      ('a', 't', 'u', 'c1', 'user', '{"text":"hi"}', 100), ('b', 't', 'u', 'c1', 'assistant', '{"text":"yo"}', 200),
      ('c', 't', 'u', 'c2', 'user', '{"text":"hi"}', 300), ('d', 't', 'v', 'c1', 'user', '{"text":"same id, other reader"}', 400);`);
  const sql = readFileSync('migrations/accounts/0020_ai_threads.sql', 'utf8');
  d.exec(sql.slice(sql.indexOf('INSERT OR IGNORE')));
  const got = d.prepare('SELECT user, conv, created, updated FROM ai_thread ORDER BY user, conv').all().map((r) => ({ ...r }));
  d.close();
  assert.deepEqual(got, [
    { user: 'u', conv: 'c1', created: 100, updated: 200 },
    { user: 'u', conv: 'c2', created: 300, updated: 300 },
    { user: 'v', conv: 'c1', created: 400, updated: 400 },
  ]);
});

test('a chat is named from its first message, listed newest first, and an empty one is not listed', async () => {
  const empty = await threads.newThread(TREE, 'anna');
  const first = await threads.newThread(TREE, 'anna');
  await ask(first, 'Who was the first of the family to settle near the river, and why did they come?');
  await new Promise((r) => setTimeout(r, 5));
  const second = await threads.newThread(TREE, 'anna');
  await ask(second, 'Short one');
  const got = await list();
  assert.deepEqual(got.slice(0, 2).map((t) => t.conv), [second, first]);
  assert.equal(got[0].title, 'Short one');
  assert.ok(got[1].title.endsWith('…') && got[1].title.length <= 49 && !got[1].title.includes('why'), got[1].title);
  assert.ok(!got.some((t) => t.conv === empty));
});

test('every path refuses another reader’s chat and another family’s, exactly like one that does not exist', async () => {
  const mine = await threads.newThread(TREE, 'anna');
  await ask(mine, 'mine');
  const before = await rows(mine);
  const card = before[1];
  const refused = /ai\.err_no_chat/;
  await assert.rejects(chat.loadChat(TREE, 'bert', 'steward', mine), refused);
  await assert.rejects(chat.loadChat(OTHER_TREE, 'anna', 'steward', mine), refused);
  await assert.rejects(chat.sendMessage({ tree: TREE, user: 'bert', role: 'steward', me: null, text: 'x', locale: 'en', conv: mine }), refused);
  await assert.rejects(chat.continueAfterDecisions({ tree: TREE, user: 'bert', role: 'steward', me: null, locale: 'en', conv: mine }), refused);
  await assert.rejects(chat.markProposal(TREE, 'bert', 'steward', mine, card.id, 'p', 'done'), refused);
  await assert.rejects(chat.retryWithModel({ tree: TREE, user: 'bert', role: 'steward', me: null, locale: 'en', conv: mine, itemId: card.id, modelOverride: { provider: 'anthropic', model: 'fake-model-strong' } }), refused);
  await assert.rejects(threads.renameThread(TREE, 'bert', 'steward', mine, 'stolen'), refused);
  await assert.rejects(threads.deleteThread(TREE, 'bert', mine), refused);
  await assert.rejects(threads.setThreadModel(TREE, 'bert', 'steward', mine, null), refused);
  await assert.rejects(chat.loadChat(TREE, 'anna', 'steward', crypto.randomUUID()), refused);
  assert.equal((await rows(mine)).length, before.length, 'nothing was added or removed');
  assert.ok(!(await list('steward', 'bert')).some((t) => t.conv === mine));
});

test('a chat whose turns the reader may no longer read is not listed, named or found', async () => {
  const mixed = await threads.newThread(TREE, 'anna');
  await ask(mixed, 'SECRETWORD about a private note', 'editor');
  await ask(mixed, 'A public question', 'viewer');
  const hidden = await threads.newThread(TREE, 'anna');
  await ask(hidden, 'OTHERSECRET only', 'editor');

  const asViewer = await list('viewer');
  assert.equal(asViewer.find((t) => t.conv === mixed)?.title, 'A public question', 'named from the first turn they may read');
  assert.ok(!asViewer.some((t) => t.conv === hidden), 'nothing readable, not listed');
  assert.deepEqual(await threads.searchThreads(TREE, 'anna', 'viewer', 'secretword'), []);
  assert.deepEqual(await threads.searchThreads(TREE, 'anna', 'viewer', 'othersecret'), []);
  assert.equal((await threads.searchThreads(TREE, 'anna', 'editor', 'secretword'))[0]?.conv, mixed);

  // A name given while the reader could see private fields does not outlive that right either.
  await threads.renameThread(TREE, 'anna', 'editor', mixed, 'SECRETWORD chat');
  assert.equal((await list('viewer')).find((t) => t.conv === mixed)?.title, 'A public question');
  assert.equal((await list('editor')).find((t) => t.conv === mixed)?.title, 'SECRETWORD chat');
});

test('search looks through titles and text, ignoring case and accents, and quotes where it found it', async () => {
  const conv = await threads.newThread(TREE, 'anna');
  await ask(conv, 'First question');
  await ask(conv, 'What about Grossmutter Müller and her letters?');
  const hit = (await threads.searchThreads(TREE, 'anna', 'steward', 'muller')).find((t) => t.conv === conv);
  assert.ok(hit?.snippet?.includes('Müller'), String(hit?.snippet));
  assert.ok((await threads.searchThreads(TREE, 'anna', 'steward', 'FIRST QUESTION')).some((t) => t.conv === conv));
});

test('renaming shows the new name, and clearing it goes back to the first message', async () => {
  const conv = await threads.newThread(TREE, 'anna');
  await ask(conv, 'Original words');
  await threads.renameThread(TREE, 'anna', 'steward', conv, '  The   river  ');
  assert.deepEqual((await list()).filter((t) => t.conv === conv).map((t) => [t.title, t.renamed]), [['The river', true]]);
  await threads.renameThread(TREE, 'anna', 'steward', conv, '');
  assert.deepEqual((await list()).filter((t) => t.conv === conv).map((t) => [t.title, t.renamed]), [['Original words', false]]);
});

test('deleting a chat takes its messages and kept pictures, and no other chat’s', async () => {
  const gone = await threads.newThread(TREE, 'anna');
  const kept = await threads.newThread(TREE, 'anna');
  await ask(gone, 'bye');
  await ask(kept, 'stay');
  const item = (await rows(gone))[0].id;
  const stay = (await rows(kept))[0].id;
  await accounts().run('INSERT INTO ai_chat_image (id, item, tree, user, mime, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'img-gone', item, TREE, 'anna', 'image/png', 'x', 1);
  await accounts().run('INSERT INTO ai_chat_image (id, item, tree, user, mime, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'img-stay', stay, TREE, 'anna', 'image/png', 'x', 1);
  await threads.deleteThread(TREE, 'anna', gone);
  assert.equal((await rows(gone)).length, 0);
  assert.equal((await rows(kept)).length, 2);
  assert.deepEqual((await accounts().all<{ id: string }>('SELECT id FROM ai_chat_image WHERE id LIKE ?', 'img-%')).map((r) => r.id), ['img-stay']);
  await assert.rejects(chat.loadChat(TREE, 'anna', 'steward', gone), /ai\.err_no_chat/);
});

test('a reply to a chat deleted while it was on the way stores nothing', async () => {
  const conv = await threads.newThread(TREE, 'anna');
  await ask(conv, 'first');
  const statement = threads.threadExists(TREE, 'anna', conv);
  await threads.deleteThread(TREE, 'anna', conv);
  await assert.rejects(accounts().batch([statement, { sql: 'DELETE FROM ai_chat', params: [] }]));
  assert.ok((await accounts().get<{ n: number }>('SELECT count(*) AS n FROM ai_chat'))!.n > 0, 'the guard stopped the batch');
});

test('only a steward may choose a model, only for a connected provider, and the server records which model wrote', async () => {
  const conv = await threads.newThread(TREE, 'anna');
  const strong = { provider: 'anthropic' as const, model: 'fake-model-strong' };
  await assert.rejects(threads.setThreadModel(TREE, 'anna', 'editor', conv, strong), /ai\.err_model_steward/);
  await assert.rejects(ask(conv, 'x', 'editor', { modelOverride: strong }), /ai\.err_model_steward/);
  await assert.rejects(threads.modelChoices(TREE, 'editor'), /ai\.err_model_steward/);
  await assert.rejects(threads.setThreadModel(TREE, 'anna', 'steward', conv, { provider: 'openai', model: 'gpt-6.1-sol' }), /ai\.err_provider_not_connected/);

  await threads.setThreadModel(TREE, 'anna', 'steward', conv, strong);
  await ask(conv, 'Hello');
  const asSteward = await chat.loadChat(TREE, 'anna', 'steward', conv);
  assert.deepEqual(asSteward.override, strong);
  assert.equal(asSteward.items[1].model?.model, 'fake-model-strong');
  assert.ok(asSteward.items[1].text.includes('fake-model-strong'), 'the model actually answered');

  const asEditor = await chat.loadChat(TREE, 'anna', 'editor', conv);
  assert.equal(asEditor.override, null);
  assert.equal(asEditor.items[1].model, undefined, 'the label stays on the server for anyone else');

  // A stored choice is not used by a turn from a reader who is no longer a steward.
  await ask(conv, 'Now an editor', 'editor');
  assert.ok(!JSON.parse((await rows(conv)).at(-1)!.body).text.includes('fake-model-strong'));

  const choices = await threads.modelChoices(TREE, 'steward');
  assert.ok(choices.models.some((m) => m.id === 'fake-model-strong' && m.cost === '$$$'));
});

test('asking again on a stronger model keeps both answers, and the question goes into the model’s history once', async () => {
  const conv = await threads.newThread(TREE, 'anna');
  await ask(conv, 'Who is Ada?');
  const answer = (await rows(conv))[1].id;
  const strong = { provider: 'anthropic' as const, model: 'fake-model-strong' };
  await assert.rejects(chat.retryWithModel({ tree: TREE, user: 'anna', role: 'editor', me: null, locale: 'en', conv, itemId: answer, modelOverride: strong }), /ai\.err_model_steward/);

  await chat.retryWithModel({ tree: TREE, user: 'anna', role: 'steward', me: null, locale: 'en', conv, itemId: answer, modelOverride: strong });
  const items = (await chat.loadChat(TREE, 'anna', 'steward', conv)).items;
  assert.equal(items.filter((i) => i.role === 'user').length, 1, 'no second question is stored');
  assert.deepEqual(items.map((i) => i.alternateOf ?? null), [null, null, answer]);
  assert.equal(items[2].model?.model, 'fake-model-strong');

  // A follow-up sees one answer per question: the newest, in the first answer's place.
  await ask(conv, 'And then?');
  const after = (await chat.loadChat(TREE, 'anna', 'steward', conv)).items;
  assert.deepEqual(after.map((i) => i.role), ['user', 'assistant', 'assistant', 'user', 'assistant']);
});

test('asking again does not repeat a card the chat has already shown, so one change cannot be approved twice', async () => {
  const conv = await threads.newThread(TREE, 'anna');
  await ask(conv, '/tool propose_add_field {"person":"ada","type":"phone","value":{"number":"+44 1"}}');
  const first = await rows(conv);
  assert.equal(JSON.parse(first[1].body).proposals?.length, 1, 'the first answer has its card');
  await chat.retryWithModel({ tree: TREE, user: 'anna', role: 'steward', me: null, locale: 'en', conv, itemId: first[1].id, modelOverride: { provider: 'anthropic', model: 'fake-model-strong' } });
  const second = JSON.parse((await rows(conv)).at(-1)!.body);
  assert.equal(second.proposals, undefined);
  assert.ok(second.text);
});

test('a continuation, a family session or pictures cannot be asked again', async () => {
  const conv = await threads.newThread(TREE, 'anna');
  await accounts().run('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'q1', TREE, 'anna', conv, 'user', JSON.stringify({ text: 'pic', tier: 'editor', images: { count: 1, kept: [] } }), 1);
  await accounts().run('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'a1', TREE, 'anna', conv, 'assistant', JSON.stringify({ text: 'read it', tier: 'editor' }), 2);
  await assert.rejects(chat.retryWithModel({ tree: TREE, user: 'anna', role: 'steward', me: null, locale: 'en', conv, itemId: 'a1', modelOverride: { provider: 'anthropic', model: 'fake-model-strong' } }), /ai\.err_retry_turn/);
});
