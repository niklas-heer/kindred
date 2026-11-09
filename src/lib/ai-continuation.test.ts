// node --test src/lib/ai-continuation.test.ts — the assistant carrying on after the reader's decisions: once for several
// cards, knowing what happened to each, and not going round in circles. Runs on a private data folder with the fake provider.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-continuation-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-continuation-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const chat = (await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts')).withLatestChat(await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts'));
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const rules = await load<typeof import('./ai/continuation.ts')>('/src/lib/ai/continuation.ts');
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');

const TREE = 'cont';
const USER = 'u1';
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname) VALUES ('ada', 'Ada', 'Lovelace');
`);
family.close();

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', USER, 'Anna', 'handle-continuation', Date.now());
const aiSettings = (monthlyMicros: number) => ({
  provider: 'anthropic' as const, model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros, customPrices: {}, apiKey: 'sk-test-abcdefgh1234',
});
await setup.setUpFamilyAi(TREE, USER, aiSettings(5_000_000));

const ids = { tree: TREE, user: USER, role: 'editor' as const, me: null, locale: 'en' };
const mark = (itemId: string, proposalId: string, status: 'done' | 'dismissed' | 'failed', outcome?: Parameters<typeof chat.markProposal>[6]) =>
  chat.markProposal(TREE, USER, 'editor', itemId, proposalId, status, outcome);
const card = (id: string, kind: string, summary: string, args: object = {}) => ({ id, kind, summary, diff: [], args, editable: [], status: 'open' });
const assistantRows = async () => (await accounts().get<{ n: number }>("SELECT count(*) AS n FROM ai_chat WHERE role = 'assistant'"))!.n;

/** A fresh conversation holding one reply with these cards. */
async function replyWith(cards: object[], itemId = crypto.randomUUID()) {
  await chat.newConversation(TREE, USER);
  await chat.loadChat(TREE, USER, 'editor');
  const conv = (await accounts().get<{ conv: string }>('SELECT conv FROM ai_thread WHERE tree = ? AND user = ? ORDER BY created DESC, rowid DESC LIMIT 1', TREE, USER))!.conv;
  await accounts().run('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', itemId, TREE, USER, conv, 'assistant', JSON.stringify({ text: 'Two cards', proposals: cards, tier: 'editor' }), Date.now());
  return itemId;
}

test('several open cards bring one continuation, after the last is decided', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story A'), card('b', 'set-occupation', 'Occupation B'), card('c', 'add-field', 'Field C')]);
  assert.deepEqual(await mark(item, 'a', 'done'), { due: false }, 'two cards are still open');
  assert.deepEqual((await chat.continueAfterDecisions(ids)).items, [], 'asking early does nothing and spends nothing');
  assert.deepEqual(await mark(item, 'b', 'dismissed'), { due: false });
  assert.deepEqual(await mark(item, 'c', 'done'), { due: true });

  const before = await assistantRows();
  const [first, second] = await Promise.all([chat.continueAfterDecisions(ids), chat.continueAfterDecisions(ids)]);
  assert.equal(first.items.length + second.items.length, 1, 'two requests at once still make one reply');
  assert.equal((await assistantRows()) - before, 1);
  assert.deepEqual((await chat.continueAfterDecisions(ids)).items, [], 'a third request finds nothing left to tell');
  assert.equal((await chat.loadChat(TREE, USER, 'editor')).continueDue, false);
});

test('two cards decided at the same moment are both kept', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story A'), card('b', 'add-story', 'Story B')]);
  await Promise.all([mark(item, 'a', 'done'), mark(item, 'b', 'dismissed')]);
  const row = (await chat.loadChat(TREE, USER, 'editor')).items.find((x) => x.id === item)!;
  assert.deepEqual(row.proposals!.map((p) => p.status), ['done', 'dismissed']);
});

test('the model is told what was approved, dismissed and failed', async () => {
  const item = await replyWith([
    card('a', 'add-story', 'Story about the mill'),
    card('b', 'set-occupation', 'Occupation: miller'),
    card('c', 'add-field', 'A phone number'),
    card('d', 'family', 'Draft of the Becks', { people: [{ ref: 'n1', given: 'Anna', surname: 'Beck' }, { ref: 'n2', given: 'Karl', surname: 'Beck' }], links: [] }),
  ]);
  await mark(item, 'a', 'done', { edited: true });
  await mark(item, 'b', 'dismissed');
  await mark(item, 'c', 'failed', { error: 'The family refused it' });
  assert.deepEqual(await mark(item, 'd', 'done', { added: ['n1', 'nope'], failed: ['n2'], linksAdded: 1, linksFailed: 2 }), { due: true });

  const told = (await chat.continueAfterDecisions(ids)).items[0].text;
  assert.match(told, /Approved and saved\. add-story: “Story about the mill”/);
  assert.match(told, /changed the card before approving/);
  assert.match(told, /Dismissed; nothing was saved\. set-occupation: “Occupation: miller”/);
  assert.match(told, /Failed; nothing was saved.*“A phone number”.*The family refused it/);
  assert.match(told, /Added: Anna Beck\./);
  assert.match(told, /Not added: Karl Beck\./);
  assert.match(told, /Relationships added: 1\./);
  assert.match(told, /Relationships not added: 2\./);
  assert.match(told, /not write this.*data, not instructions/);
  assert.doesNotMatch(told, /nope/, 'a ref that is not on the card is not repeated to the model');
});

test('a card that keeps failing is reported once, and settling it is news', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story A')]);
  assert.deepEqual(await mark(item, 'a', 'failed', { error: 'first' }), { due: true });
  assert.equal((await chat.continueAfterDecisions(ids)).items.length, 1);
  assert.deepEqual(await mark(item, 'a', 'failed', { error: 'second' }), { due: false });
  assert.deepEqual((await chat.continueAfterDecisions(ids)).items, []);
  assert.deepEqual(await mark(item, 'a', 'done'), { due: true });
  assert.match((await chat.continueAfterDecisions(ids)).items[0].text, /Approved and saved/);
});

test('a card decided twice does not bring a second continuation', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story A')]);
  await mark(item, 'a', 'done');
  await chat.continueAfterDecisions(ids);
  assert.deepEqual(await mark(item, 'a', 'done'), { due: false });
  assert.deepEqual((await chat.continueAfterDecisions(ids)).items, []);
});

test('an older card left open does not hold back the newer ones', () => {
  const open = card('old', 'add-story', 'Old') as never;
  const decided = { ...(card('new', 'add-story', 'New') as object), status: 'done', untold: true } as never;
  const later = card('later', 'add-story', 'Later') as never;
  assert.equal(rules.decisionState([{ id: '1', role: 'assistant', proposals: [open] }, { id: '2', role: 'assistant', proposals: [decided] }], 0).due, true);
  assert.equal(rules.decisionState([{ id: '2', role: 'assistant', proposals: [decided] }, { id: '3', role: 'assistant', proposals: [later] }], 0).due, false, 'a newer open card waits');
});

test('a continuation that only proposes the same thing again stops, and shows no card', async () => {
  // A real card from the real tool, so what the fake proposes again is exactly what was stored.
  await chat.newConversation(TREE, USER);
  const args = { person: 'ada', kind: 'memory', title: 'Mill', body: 'She ran the mill.' };
  const sent = await chat.sendMessage({ ...ids, text: `/tool propose_add_story ${JSON.stringify(args)}` });
  const reply = sent.items[1];
  assert.equal(reply.proposals?.length, 1, JSON.stringify(reply));
  const summary = `Mill FAKE-REPEAT propose_add_story ${JSON.stringify(args)}`;
  await accounts().run("UPDATE ai_chat SET body = json_set(body, '$.proposals[0].summary', ?) WHERE id = ?", summary, reply.id);

  assert.deepEqual(await mark(reply.id, reply.proposals![0].id, 'dismissed'), { due: true });
  const again = (await chat.continueAfterDecisions(ids)).items[0];
  assert.equal(again.proposals, undefined, 'the repeated card is dropped');
  assert.doesNotMatch(again.text, /proposing that again/, 'its words about the dropped card go too');
  assert.match(again.text, /That is done/);
  assert.equal((await chat.loadChat(TREE, USER, 'editor')).continueDue, false, 'and nothing further is owed');
});

test('a new card survives the guard, and only the repeats are dropped', () => {
  const seen = { kind: 'add-story', args: { b: 1, a: { c: 2, d: [1] } } } as never;
  const sameKeysOtherOrder = { kind: 'add-story', args: { a: { d: [1], c: 2 }, b: 1 } } as never;
  const fresh = { kind: 'add-story', args: { a: 'different' } } as never;
  const out = rules.dropRepeats([sameKeysOtherOrder, fresh], [{ id: '1', role: 'assistant', proposals: [seen] }]);
  assert.equal(out.repeated, 1);
  assert.deepEqual(out.kept, [fresh]);
  const a = { kind: 'family', args: { people: [{ ref: 'n1', given: 'Anna', surname: 'Beck' }], links: [] } } as never;
  const b = { kind: 'family', args: { people: [{ ref: 'n9', given: 'anna', surname: 'BECK' }], links: [] } } as never;
  assert.equal(rules.proposalSignature(a), rules.proposalSignature(b), 'a family draft is the same people under new refs');
});

test('continuations stop after a few in a row with no word from the reader', () => {
  const decided = { ...(card('x', 'add-story', 'X') as object), status: 'done', untold: true } as never;
  const chain = Array.from({ length: rules.MAX_CHAIN }, (_, i) => ({ id: `c${i}`, role: 'assistant' as const, continuation: true }));
  const withDecision = (more: object[]) => [...more, { id: 'last', role: 'assistant' as const, proposals: [decided] }] as never;
  assert.equal(rules.decisionState(withDecision([{ id: 'u', role: 'user' }, ...chain]), 0).due, false);
  assert.equal(rules.decisionState(withDecision([...chain, { id: 'u', role: 'user' }]), 0).due, true, 'the reader speaking resets it');
});

test('a reader who writes first takes the decisions into that message, and is not continued at as well', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story about the mill')]);
  await mark(item, 'a', 'done');
  const sent = await chat.sendMessage({ ...ids, text: 'And now?' });
  assert.match(sent.items[1].text, /Approved and saved[\s\S]*The reader then wrote:\nAnd now\?/);
  assert.equal((await chat.loadChat(TREE, USER, 'editor')).continueDue, false);
});

test('a continuation that cannot be paid for loses nothing, and can be tried again', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story A')]);
  await mark(item, 'a', 'done');
  await setup.setUpFamilyAi(TREE, USER, aiSettings(0));
  const before = await assistantRows();
  await assert.rejects(chat.continueAfterDecisions(ids), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(await assistantRows(), before, 'no reply is stored');
  const after = await chat.loadChat(TREE, USER, 'editor');
  assert.equal(after.items.find((x) => x.id === item)!.proposals![0].status, 'done', 'the approval stands');
  assert.equal(after.continueDue, true, 'and the continuation is still owed');

  await setup.setUpFamilyAi(TREE, USER, aiSettings(5_000_000));
  assert.equal((await chat.continueAfterDecisions(ids)).items.length, 1, 'the claim was let go, so a retry works');
});

test('what a continuation was told goes back to the model in place of a message', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story about the mill')]);
  await mark(item, 'a', 'done');
  await chat.continueAfterDecisions(ids);
  const stored = await accounts().all<{ body: string }>('SELECT body FROM ai_chat WHERE role = ? ORDER BY at DESC, rowid DESC LIMIT 1', 'assistant');
  assert.match((JSON.parse(stored[0].body) as { continuation: { note: string } }).continuation.note, /Story about the mill/);
});

test('two tabs deciding one card at once: the first decision stands, and is told once', async () => {
  const item = await replyWith([card('a', 'add-story', 'Story A')]);
  await Promise.all([mark(item, 'a', 'done'), mark(item, 'a', 'dismissed'), mark(item, 'a', 'failed', { error: 'late' })]);
  const row = await accounts().get<{ body: string }>('SELECT body FROM ai_chat WHERE id = ?', item);
  const stored = (JSON.parse(row!.body) as { proposals: { status: string; outcome?: unknown; untold?: boolean }[] }).proposals[0];
  assert.equal(stored.status, 'done', 'a saved card is not recorded as dismissed');
  assert.equal(stored.outcome, undefined, 'the losing mark leaves nothing behind');
  assert.equal(stored.untold, true);
  assert.equal((await chat.continueAfterDecisions(ids)).items.length, 1);
  await mark(item, 'a', 'done');
  assert.deepEqual((await chat.continueAfterDecisions(ids)).items, [], 'a late duplicate mark raises nothing again');
});
