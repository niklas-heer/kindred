// node --test src/lib/ai-history.test.ts — the assistant's saved conversation after a role change, the budget inside
// a chat turn, and the add-field proposal's default privacy and labels. Runs on a private data folder with the fake provider.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { Role } from './roles.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-history-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-history-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const chat = await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const tools = await load<typeof import('./ai/tools.server.ts')>('/src/lib/ai/tools.server.ts');
const { translate } = await load<typeof import('./i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');

const TREE = 'hist';
const MARKER = 'SOL_PRIVATE_MARKER';

const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname) VALUES ('ada', 'Ada', 'Lovelace'), ('bob', 'Bob', 'Hope');
  INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES
    ('f1', 'ada', 'medical', 'condition', '{"note":"${MARKER}"}', 0, 'editors'),
    ('f2', 'ada', 'phone', 'mobile', '{"number":"+44 555"}', 1, 'family');
`);
family.close();

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Anna', 'handle-history', Date.now());
await setup.setUpFamilyAi(TREE, 'u1', {
  provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: 'sk-test-abcdefgh1234',
});

const texts = (items: { text: string }[]) => items.map((i) => i.text).join('\n');

test('a demoted reader gets back no earlier turn that quoted private details', async () => {
  // Anna is an editor and asks about Ada's private note; the reply repeats it (the fake echoes the question).
  await chat.sendMessage({ tree: TREE, user: 'u1', role: 'editor', me: null, text: `Note: ${MARKER} is Ada's medical note`, locale: 'en' });
  // Then she is a viewer, and asks something public in the same conversation.
  await chat.sendMessage({ tree: TREE, user: 'u1', role: 'viewer', me: null, text: 'Who is Bob?', locale: 'en' });

  const asEditor = await chat.loadChat(TREE, 'u1', 'editor');
  assert.ok(texts(asEditor.items).includes(MARKER), 'control: an editor still sees the earlier turn');

  const asViewer = await chat.loadChat(TREE, 'u1', 'viewer');
  assert.ok(!texts(asViewer.items).includes(MARKER), 'the demoted reader gets no private text back');
  assert.ok(texts(asViewer.items).includes('Who is Bob?'), 'their own public turns stay');

  const after = await chat.sendMessage({ tree: TREE, user: 'u1', role: 'viewer', me: null, text: 'And Ada?', locale: 'en' });
  assert.ok(!texts(after.items).includes(MARKER));
  assert.ok(!texts((await chat.loadChat(TREE, 'u1', 'viewer')).items).includes(MARKER));
});

test('an editor turn is marked as needing the editor tier; a viewer turn is not', async () => {
  const tiers = await accounts().all<{ body: string }>('SELECT body FROM ai_chat WHERE tree = ? AND user = ?', TREE, 'u1');
  const parsed = tiers.map((r) => JSON.parse(r.body) as { tier?: string });
  assert.ok(parsed.some((b) => b.tier === 'editor'));
  assert.ok(parsed.some((b) => b.tier === 'member'));
});

test('a turn stored before tiers existed is hidden from a reader below editor', async () => {
  const conv = (await accounts().get<{ conv: string }>('SELECT conv FROM ai_conversation WHERE tree = ? AND user = ?', TREE, 'u1'))!.conv;
  await accounts().run(
    'INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'legacy-1', TREE, 'u1', conv, 'assistant', JSON.stringify({ text: `legacy ${MARKER}` }), Date.now(),
  );
  assert.ok(texts((await chat.loadChat(TREE, 'u1', 'editor')).items).includes(MARKER));
  assert.ok(!texts((await chat.loadChat(TREE, 'u1', 'contributor')).items).includes(MARKER));
});

test('the visibility rule: editor turns need edit-person, member turns are for everyone', () => {
  const editorTurn = { text: 'x', tier: 'editor' as const };
  const memberTurn = { text: 'x', tier: 'member' as const };
  const expect: [Role, boolean, boolean][] = [
    // role, may read an editor turn, may read a member turn
    ['viewer', false, true], ['contributor', false, true], ['editor', true, true], ['steward', true, true],
  ];
  for (const [role, editorOk, memberOk] of expect) {
    assert.equal(chat.mayRead(editorTurn, role), editorOk, `${role} / editor turn`);
    assert.equal(chat.mayRead(memberTurn, role), memberOk, `${role} / member turn`);
  }
});

test('a demoted reader cannot change the status of a card from an editor turn', async () => {
  const proposal = { id: 'p-1', kind: 'add-story', summary: 's', diff: [], args: {}, editable: [], status: 'open' };
  await accounts().run(
    'INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'card-1', TREE, 'u1', (await accounts().get<{ conv: string }>('SELECT conv FROM ai_conversation WHERE tree = ? AND user = ?', TREE, 'u1'))!.conv,
    'assistant', JSON.stringify({ text: 'card', proposals: [proposal], tier: 'editor' }), Date.now(),
  );
  await chat.markProposal(TREE, 'u1', 'viewer', 'card-1', 'p-1', 'dismissed');
  const row = await accounts().get<{ body: string }>('SELECT body FROM ai_chat WHERE id = ?', 'card-1');
  assert.equal((JSON.parse(row!.body) as { proposals: { status: string }[] }).proposals[0].status, 'open');
});

test('a chat turn that the budget cannot cover stores nothing', async () => {
  const before = (await accounts().all('SELECT id FROM ai_chat WHERE tree = ? AND user = ?', TREE, 'u1')).length;
  await setup.setUpFamilyAi(TREE, 'u1', {
    provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 0, customPrices: {}, apiKey: 'sk-test-abcdefgh1234',
  });
  await assert.rejects(
    chat.sendMessage({ tree: TREE, user: 'u1', role: 'editor', me: null, text: 'Anything', locale: 'en' }),
    (e: unknown) => e instanceof AiError && e.code === 'budget',
  );
  assert.equal((await accounts().all('SELECT id FROM ai_chat WHERE tree = ? AND user = ?', TREE, 'u1')).length, before);
});

test('an add-field proposal is private by the type\'s rule, whatever the model asks for', async () => {
  await setup.setUpFamilyAi(TREE, 'u1', {
    provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: 'sk-test-abcdefgh1234',
  });
  const ctx = { tree: TREE, role: 'editor' as Role, me: null, locale: 'en' as const };
  const out: import('./ai/types.ts').Proposal[] = [];
  await tools.runTool(ctx, 'propose_add_field', { person: 'ada', type: 'medical', value: { note: 'Asthma' }, private: false }, out);
  await tools.runTool(ctx, 'propose_add_field', { person: 'ada', type: 'phone', value: { number: '+44 1' } }, out);
  assert.equal(out[0].args.visibility, 'editors', 'medical starts at the editors’ level even when the model says otherwise');
  assert.equal(out[1].args.visibility, 'family', 'a phone number starts at the family’s level');
});

test('an add-field proposal names its type and value keys in the reader\'s language', async () => {
  const ctx = { tree: TREE, role: 'editor' as Role, me: null, locale: 'de' as const };
  const out: import('./ai/types.ts').Proposal[] = [];
  await tools.runTool(ctx, 'propose_add_field', { person: 'ada', type: 'phone', value: { number: '+44 1' } }, out);
  assert.equal(out[0].diff[0].label, translate('de', 'type.phone'));
  assert.equal(out[0].diff[0].to, `${translate('de', 'input.number')}: +44 1`);
  assert.ok(!out[0].summary.includes('phone'), 'the summary has no raw type word');
});
