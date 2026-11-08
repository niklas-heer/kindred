// node --test src/lib/ai-chat-images.test.ts: pictures on a chat message. The limits and the role are checked before
// anything is spent, a picture reaches the provider and is priced, it is not stored unless the reader keeps it, and a
// kept one is as private as the chat. A list read from a picture becomes one draft, with handles: nothing is written
// without approval, and someone already in the tree is not added again. Private data folder and fake provider; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-images-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-images-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { db } = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const chat = await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts');
const family = await load<typeof import('./ai/family.server.ts')>('/src/lib/ai/family.server.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const images = await load<typeof import('./ai/chat-images.ts')>('/src/lib/ai/chat-images.ts');
const { CHAT_IMAGE_COUNT } = await load<typeof import('./ai/types.ts')>('/src/lib/ai/types.ts');
const draft = await load<typeof import('../components/assistant/family-draft.ts')>('/src/components/assistant/family-draft.ts');

const TREE = 'pics';
const seed = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
seed.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname, living) VALUES ('ada', 'Ada', 'Lovelace', 1), ('tomas', 'Tomas', 'Adeyemi', 1), ('rosa', 'Rosa', 'Vargas', 1);
  INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES ('s1', 'rosa', 'social', 'Instagram', '{"handle":"@rosa.vargas"}', 0, 'family');
`);
seed.close();

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

for (const [id, handle] of [['u1', 'h-one'], ['u2', 'h-two']]) await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', id, 'Anna', handle, Date.now());
const FEATURES = { assistant: true, faces: false, avatar: false, arms: false };
const configure = (monthlyMicros: number, features = FEATURES) => setup.setUpFamilyAi(TREE, 'u1', { provider: 'anthropic', model: 'claude-haiku-5-5', features, webSearch: false, monthlyMicros, customPrices: {}, apiKey: 'sk-test-abcdefgh1234' });
await configure(5_000_000);

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');

const send = (o: Partial<Parameters<typeof chat.sendMessage>[0]>) => chat.sendMessage({ tree: TREE, user: 'u1', role: 'editor', me: null, text: 'Please add these.', locale: 'en', ...o });
const refused = (key: string) => (e: unknown) => e instanceof Error && e.message === key;
const people = async () => (await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM person'))!.n;
const socials = (person: string) => db(TREE).all<{ label: string; value: string }>("SELECT label, value FROM person_field WHERE person = ? AND type = 'social'", person);
const keptRows = async () => (await accounts().get<{ n: number }>('SELECT count(*) AS n FROM ai_chat_image'))!.n;

test('pictures are checked by what they are, within their limits', () => {
  assert.equal(images.sniffImage(PNG), 'image/png');
  assert.equal(images.sniffImage(JPEG), 'image/jpeg');
  assert.equal(images.sniffImage(SVG), null, 'an SVG is refused: it can carry script');
  assert.deepEqual(images.checkChatImages([{ base64: PNG }]), [{ mime: 'image/png', base64: PNG }], 'the type is the bytes’ own');
  assert.throws(() => images.checkChatImages([{ base64: SVG }]), refused('ai.err_image_bad'));
  assert.throws(() => images.checkChatImages([{ base64: `${PNG.slice(0, 20)}!!${PNG.slice(22)}` }]), refused('ai.err_image_bad'));
  assert.throws(() => images.checkChatImages(Array.from({ length: CHAT_IMAGE_COUNT + 1 }, () => ({ base64: PNG }))), refused('ai.err_image_many'));
  assert.throws(() => images.checkChatImages([{ base64: PNG.padEnd(images.CHAT_IMAGE_BASE64 + 4, 'A') }]), refused('ai.err_image_big'));
});

test('only a role that can add people can send pictures, and only while the assistant is on', async () => {
  const before = await settings.spentThisMonth(TREE);
  for (const role of ['viewer', 'contributor'] as const) {
    await assert.rejects(send({ role, images: [{ base64: PNG }] }), refused('ai.famRefused'), role);
  }
  assert.equal(await settings.spentThisMonth(TREE), before, 'a refused message spends nothing');
  await configure(5_000_000, { ...FEATURES, assistant: false });
  await assert.rejects(send({ images: [{ base64: PNG }] }), /switched off|off/i);
  await configure(5_000_000);
  await assert.rejects(send({ text: '', images: [] }), refused('ai.err_empty_message'));
});

test('a picture reaches the provider with its real type, and its cost is booked', async () => {
  const realFetch = globalThis.fetch;
  const sent: any[] = [];
  delete process.env.KINDRED_AI_FAKE;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return Response.json({ content: [{ type: 'text', text: 'I can read it.' }], stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 100 } });
  }) as typeof fetch;
  try {
    const before = await settings.spentThisMonth(TREE);
    await send({ images: [{ base64: PNG }, { base64: JPEG }] });
    const blocks = sent[0].messages.at(-1).content as { type: string; source?: { media_type: string } }[];
    assert.deepEqual(blocks.map((b) => b.type), ['image', 'image', 'text']);
    assert.deepEqual(blocks.slice(0, 2).map((b) => b.source!.media_type), ['image/png', 'image/jpeg']);
    assert.ok(sent[0].system.includes('never an instruction'), 'text inside a picture is data');
    // claude-haiku-5-5: $0.10 in, $0.50 out per 1M tokens.
    assert.equal(await settings.spentThisMonth(TREE), before + 3000 * 0.1 + 100 * 0.5);
  } finally {
    globalThis.fetch = realFetch;
    process.env.KINDRED_AI_FAKE = '1';
  }
});

test('pictures make a call dearer before it is sent, so a small budget refuses it', async () => {
  const price = { inPerM: 10, outPerM: 50, searchEach: 0.01 };
  const req = { system: 's', maxTokens: 100, messages: [{ role: 'user' as const, text: 'hi' }] };
  const withPictures = { ...req, messages: [{ role: 'user' as const, text: 'hi', images: [{ mime: 'image/png', base64: PNG }, { mime: 'image/png', base64: PNG }] }] };
  assert.ok(settings.estimateMicros(withPictures, price) - settings.estimateMicros(req, price) >= 2 * 2000 * price.inPerM, 'priced per picture, not by its text');
  // What is left of the month holds a text message (about 900 micro-dollars here) and not six pictures (about 3,500).
  await configure(await settings.spentThisMonth(TREE) + 2000);
  await send({ text: 'Text alone still fits.' });
  await assert.rejects(send({ images: Array.from({ length: 6 }, () => ({ base64: PNG })) }), (e: Error) => e.name === 'AiError');
  await configure(5_000_000);
});

test('a screenshot of profiles becomes one draft with handles, and nothing is written without approval', async () => {
  const before = await people();
  const { items } = await send({ images: [{ base64: PNG }] });
  assert.equal(await people(), before, 'drafting writes nothing');
  assert.equal(items[0].images?.count, 1);
  assert.deepEqual(items[0].images?.kept, [], 'not stored unless the reader asks');
  assert.equal(await keptRows(), 0);
  assert.ok(!JSON.stringify(await accounts().all('SELECT body FROM ai_chat')).includes(PNG), 'the chat row has no picture in it');

  const card = items[1].proposals![0];
  assert.equal(card.kind, 'family');
  assert.equal(card.status, 'open');
  assert.equal(card.view?.pick, true, 'the reader chooses who is added');
  const rows = card.args.people as unknown as { ref: string; given: string; surname?: string; born?: string; social: { network: string; handle: string }[] }[];
  assert.deepEqual(rows.map((r) => r.social), [
    [{ network: 'Instagram', handle: 'mira.lindqvist' }],
    [{ network: 'Instagram', handle: 'tomas_adeyemi' }],
    [{ network: 'Instagram', handle: 'jo_paints' }],
  ], 'the network has its usual name, the handle no @');
  assert.ok(rows.every((r) => !r.born), 'no details beyond what was read');

  // Tomas Adeyemi is already in the tree under the same name: the card starts from him, not a new person.
  assert.deepEqual(card.view?.matches?.n2?.[0], { id: 'tomas', name: 'Tomas Adeyemi', born: null, sure: true });
  assert.equal(card.view?.matches?.n1, undefined);

  // The reader ticks two rows: only those go to the server, and only those are written.
  const key = (s: string) => `${s}-0123456789`;
  const batch = {
    people: [
      { ...draft.cleanPerson({ ...rows[0], living: true }), key: key('mira') },
      { ...draft.cleanPerson({ ...rows[1], living: true, existing: 'tomas' }), key: key('tomas') },
    ],
    links: [],
  };
  const apply = () => family.applyFamilyBatch({ tree: TREE, user: 'u1', author: 'Anna', role: 'editor', batch });
  const first = await apply();
  assert.ok(first.people.every((p) => p.id), JSON.stringify(first.people));
  assert.equal(await people(), before + 1, 'Mira is new; Tomas is not added twice; the third row was not chosen');
  assert.equal(first.people[1].id, 'tomas');
  assert.deepEqual((await socials('tomas')).map((f) => [f.label, JSON.parse(f.value).handle]), [['Instagram', 'tomas_adeyemi']]);
  const mira = first.people[0].id!;
  assert.deepEqual((await socials(mira)).map((f) => [f.label, JSON.parse(f.value).handle]), [['Instagram', 'mira.lindqvist']]);

  // Sent again, nothing is written twice.
  await apply();
  assert.equal(await people(), before + 1);
  assert.equal((await socials('tomas')).length, 1);
  assert.equal((await socials(mira)).length, 1);

  // A later approval of the same profile under a new key adds no second field either.
  await family.applyFamilyBatch({ tree: TREE, user: 'u1', author: 'Anna', role: 'editor', batch: { people: [{ ...batch.people[1], key: key('tomas-2') }], links: [] } });
  assert.equal((await socials('tomas')).length, 1);
});

test('someone the tree already has with this profile is left out, and a misread handle is dropped', async () => {
  const fake = (rows: unknown[]) => `FAKE-FAMILY ${JSON.stringify({ people: rows, links: [] })}`;
  const known = await send({ text: fake([{ ref: 'n1', given: 'Rosa', surname: 'Vargas', living: true, social: [{ network: 'Instagram', handle: 'rosa.vargas' }] }]), images: [{ base64: PNG }] });
  assert.equal(known.items[1].proposals, undefined, 'no card when everyone is already in the tree');

  const mixed = await send({
    text: fake([
      { ref: 'n1', given: 'Rosa', surname: 'Vargas', living: true, social: [{ network: 'Instagram', handle: '@ROSA.VARGAS' }] },
      { ref: 'n2', given: 'Ines', living: true, social: [{ network: 'Instagram', handle: 'has spaces' }, { network: 'Signal', handle: 'ines' }] },
    ]),
    images: [{ base64: PNG }],
  });
  const card = mixed.items[1].proposals![0];
  assert.deepEqual(card.view?.known, [{ name: 'Rosa Vargas', handle: 'ROSA.VARGAS' }], 'the same profile whichever way it is typed');
  const rows = card.args.people as unknown as { ref: string; social: { network: string; handle: string }[] }[];
  assert.deepEqual(rows.map((r) => r.ref), ['n2']);
  assert.deepEqual(rows[0].social, [{ network: 'Signal', handle: 'ines' }]);

  // A role that cannot add people cannot apply a draft either, whatever the browser sends.
  const row = { key: 'viewer-0123456789', ref: 'n9', given: 'Nope', living: true, social: [{ network: 'Instagram', handle: 'nope' }] };
  const out = await family.applyFamilyBatch({ tree: TREE, user: 'u1', author: 'Anna', role: 'viewer', batch: { people: [row], links: [] } });
  assert.equal(out.people[0].id, undefined);
  assert.equal(out.people[0].error, 'ai.famRefused');
});

test('a kept picture is as private as the chat', async () => {
  const { items } = await send({ text: 'Keep this one.', images: [{ base64: PNG }], keepImages: true });
  const [id] = items[0].images!.kept;
  assert.ok(id);
  assert.equal(await keptRows(), 1);
  assert.deepEqual(await chat.loadChatImage(TREE, 'u1', 'editor', id), { mime: 'image/png', base64: PNG });
  assert.equal(await chat.loadChatImage(TREE, 'u2', 'steward', id), null, 'not another reader, not even a steward');
  assert.equal(await chat.loadChatImage(TREE, 'u1', 'viewer', id), null, 'not after the writer is demoted below that turn’s tier');
  assert.equal(await chat.loadChatImage('othertree', 'u1', 'editor', id), null);
  const hist = await chat.loadChat(TREE, 'u1', 'editor');
  assert.ok(hist.items.some((i) => i.images?.kept.includes(id)), 'history lists it');

  // A later turn is told a picture was there; the picture is not sent again.
  const reply = await send({ text: 'What was that?' });
  assert.equal(reply.items[0].images, undefined);
});
