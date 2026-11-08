// node --test src/lib/ai-portrait.test.ts — painted portraits, on a private data folder with `fetch` stubbed (nothing is sent).
// The review step replaces nothing until a portrait is accepted; a candidate is discarded or replaced; the budget stops a
// painting before it is sent and settles it to OpenRouter's reported cost; a reply that is not a picture is refused and
// stores nothing; a key goes only to OpenRouter and never reaches a message or a log; the photo must be one the person is
// tagged in; the editor's and steward's rights are the ones the server functions check.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-portrait-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '0';
process.env.KINDRED_SECRET = 'ai-portrait-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const portrait = await load<typeof import('./ai/portrait.server.ts')>('/src/lib/ai/portrait.server.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const providers = await load<typeof import('./ai/providers.server.ts')>('/src/lib/ai/providers.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const rules = await load<typeof import('./ai/portrait-rules.ts')>('/src/lib/ai/portrait-rules.ts');
const roles = await load<typeof import('./roles.ts')>('/src/lib/roles.ts');
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const KEY = 'sk-or-v1-PORTRAIT-SECRET-KEY-9876';
const TREE = 'paint';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const b64 = rules.toBase64;

const LIST = {
  data: [
    { id: 'openai/gpt-image-2', name: 'GPT Image 2', created: 300, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { prompt: '0.000008', image_output: '0.00003' } },
    { id: 'google/gemini-3-pro-image', name: 'Gemini 3 Pro Image', created: 250, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] }, pricing: { prompt: '0.000002', completion: '0.000012', image_output: '0.000012' } },
  ],
};

type Reply = (body: any) => Response;
let imageCalls: { url: string; auth: string; body: any }[] = [];
/** Stubs fetch: the public list, and the image endpoint's reply (the default: a PNG at $0.05). Nothing real is called. */
function stub(reply: Reply = () => new Response(JSON.stringify({ data: [{ b64_json: b64(PNG), media_type: 'image/png' }], usage: { cost: 0.05 } }), { status: 200 })) {
  imageCalls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/models')) return new Response(JSON.stringify(LIST), { status: 200 });
    if (url.startsWith('https://openrouter.ai/api/v1/images')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      imageCalls.push({ url, auth: String((init?.headers as Record<string, string>)?.authorization ?? ''), body });
      return reply(body);
    }
    throw new Error(`an unexpected request to ${url}`);
  }) as typeof fetch;
}

/** A family, a person tagged in one gallery photo taken in 1990, and that photo's picture in media. */
async function seed(tree: string) {
  await dbs.provisionFamily(tree, 'Portrait Test');
  const d = dbs.db(tree);
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ada', 'Ada', 0, '1950')");
  await d.run("INSERT INTO person (id, given, living, born) VALUES ('ben', 'Ben', 0, '1960')");
  const key = 'gallery/ada-1990.png';
  await dbs.media.put(tree, key, PNG, 'image/png');
  await d.run("INSERT INTO media (key, mime, taken, uploaded_by, uploaded_at) VALUES (?, 'image/png', '1990-06-01', 'u1', ?)", key, new Date().toISOString());
  await d.run("INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at) VALUES (?, 'ada', 0.1, 0.1, 0.5, 0.5, 1, 'u1', ?)", key, new Date().toISOString());
  return key;
}

/** Switches painting on for a family with a key, and sets the monthly budget (micro-dollars). */
async function enable(tree: string, monthlyMicros = 5_000_000) {
  stub();
  await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', 'u1', 'Anna', `handle-${tree}`, Date.now());
  await setup.setUpFamilyAi(tree, 'u1', {
    provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-unrelated-key-0000', features: { assistant: false, faces: false, avatar: false, arms: false },
    webSearch: false, monthlyMicros, customPrices: {},
  });
  await providers.saveProviderKey(tree, 'u1', 'openrouter', KEY);
  await providers.saveRoutes(tree, [{ route: 'portrait', provider: 'openrouter', model: 'openai/gpt-image-2' }]);
  await portrait.setPortraitEnabled(tree, 'u1', true);
}

test('the roles that paint and review are editors; the settings are stewards', () => {
  assert.equal(roles.can('editor', 'edit-person'), true);
  assert.equal(roles.can('contributor', 'edit-person'), false, 'a contributor may not paint a portrait');
  assert.equal(roles.can('viewer', 'edit-person'), false);
  assert.equal(roles.can('editor', 'manage-access'), false, 'an editor may not change the settings');
  assert.equal(roles.can('steward', 'manage-access'), true);
});

test('a key is sealed, shown only as its last four characters, and needed before the feature is on', async () => {
  const tree = 'settings';
  await dbs.provisionFamily(tree, 'Settings');
  await assert.rejects(() => portrait.setPortraitEnabled(tree, 'u1', true), (e: unknown) => e instanceof AiError && e.message === 'paint.err_no_key');
  stub();
  await providers.saveProviderKey(tree, 'u1', 'openrouter', KEY);
  await providers.saveRoutes(tree, [{ route: 'portrait', provider: 'openrouter', model: 'openai/gpt-image-2' }]);
  await portrait.setPortraitEnabled(tree, 'u1', false);
  const or = (await providers.providerStates(tree)).find((p) => p.provider === 'openrouter');
  assert.equal(or?.keyState, 'saved');
  assert.equal(or?.keyTail, KEY.slice(-4));
  const row = await accounts().get<{ key_sealed: string }>('SELECT key_sealed FROM ai_provider WHERE tree = ? AND provider = ?', tree, 'openrouter');
  assert.ok(row && !row.key_sealed.includes(KEY), 'the stored key is sealed');
});

test('a model that is not a picture model OpenRouter lists is refused', async () => {
  stub();
  await assert.rejects(() => portrait.checkPaintModel('openai/gpt-4o'), (e: unknown) => e instanceof AiError && e.message === 'paint.err_model_unknown');
});

test('painting is routed only to a provider that paints: another provider is refused, and nothing is saved', async () => {
  const tree = 'reuse';
  await dbs.provisionFamily(tree, 'Reuse');
  stub();
  await assert.rejects(() => providers.saveRoutes(tree, [{ route: 'portrait', provider: 'anthropic', model: 'claude-sonnet-5-5' }]), (e: unknown) => e instanceof AiError && e.message === 'paint.err_provider_cannot_paint');
  assert.equal((await providers.resolveRoute(tree, 'portrait')).effective, null, 'no route was saved');
});

test('painting makes a candidate that changes nothing until it is accepted; accepting replaces the old, and the budget and the key are right', async () => {
  const tree = 'review';
  const photo = await seed(tree);
  await enable(tree);
  stub();
  const cand = await portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' });
  // The request: the picture model, the fixed prompt, the photo as a reference, and the key only as the bearer token to OpenRouter.
  assert.equal(imageCalls.length, 1);
  assert.equal(imageCalls[0]!.url, 'https://openrouter.ai/api/v1/images');
  assert.equal(imageCalls[0]!.auth, `Bearer ${KEY}`);
  assert.equal(imageCalls[0]!.body.model, 'openai/gpt-image-2');
  assert.match(imageCalls[0]!.body.prompt, /Keep this exact person/);
  assert.ok(String(imageCalls[0]!.body.input_references[0].image_url.url).startsWith('data:image/png;base64,'));
  // The candidate is kept as a candidate, with the photo's year, and nothing the person shows has changed.
  const row = await portrait.portraitRow(tree, 'ada', cand.key);
  assert.equal(row?.accepted, 0);
  assert.equal(row?.source_year, 1990);
  assert.equal((await dbs.graph(tree)).people.find((p) => p.id === 'ada')?.portrait, undefined, 'the review step does not replace anything');
  // The budget is settled to what OpenRouter reported ($0.05).
  assert.equal(await settings.spentThisMonth(tree), 50_000);

  // Accepting makes it the person's portrait, with the age in its photo; the person now shows it.
  await portrait.acceptPortrait(tree, 'ada', cand.key);
  const g = (await dbs.graph(tree)).people.find((p) => p.id === 'ada')!;
  assert.equal(g.portrait, cand.key);
  assert.equal(g.portraitAge, 40, 'the photo was taken in 1990, when Ada was 40');
  assert.equal(g.preferPortrait, true);
  assert.equal(g.preferAvatar, false, 'only one of the two choices is ever on');

  // A second painting, accepted, replaces the first: its picture is deleted, and only one is accepted.
  const second = await portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' });
  assert.notEqual(second.key, cand.key);
  await portrait.acceptPortrait(tree, 'ada', second.key);
  assert.equal((await portrait.acceptedPortrait(tree, 'ada'))?.key, second.key);
  assert.equal(await dbs.media.get(tree, cand.key), undefined, 'the replaced picture is deleted');
  assert.ok(await dbs.media.get(tree, second.key), 'the accepted picture is kept');
});

test('a candidate is discarded with its picture; the accepted portrait cannot be discarded, and remove clears it', async () => {
  const tree = 'discard';
  const photo = await seed(tree);
  await enable(tree);
  stub();
  const cand = await portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' });
  await portrait.discardPortrait(tree, 'ada', cand.key);
  assert.equal(await portrait.portraitRow(tree, 'ada', cand.key), undefined);
  assert.equal(await dbs.media.get(tree, cand.key), undefined, 'the discarded picture is deleted');

  const kept = await portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' });
  await portrait.acceptPortrait(tree, 'ada', kept.key);
  await assert.rejects(() => portrait.discardPortrait(tree, 'ada', kept.key), /paint.err_is_current/);
  await portrait.removePortrait(tree, 'ada');
  assert.equal(await portrait.acceptedPortrait(tree, 'ada'), undefined);
  assert.equal(await dbs.media.get(tree, kept.key), undefined, 'removing deletes the picture');
  const g = (await dbs.graph(tree)).people.find((p) => p.id === 'ada')!;
  assert.equal(g.portrait, undefined);
  assert.equal(g.preferPortrait, false, 'the person goes back to the photo or the drawing');
});

test('the budget stops a painting before it is sent: over the estimate, nothing is sent', async () => {
  const tree = 'budget';
  const photo = await seed(tree);
  // $0.10 a month: the model\'s reservation (about $0.22) is refused, so no request is made.
  await enable(tree, 100_000);
  stub();
  await assert.rejects(() => portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' }), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(imageCalls.length, 0, 'the picture model was never sent the photo');
  assert.equal(await settings.spentThisMonth(tree), 0, 'a refused call spends nothing');
});

test('a reply that is not a picture is refused and stores nothing; a key refused by OpenRouter is named without the key', async () => {
  const tree = 'refused';
  const photo = await seed(tree);
  await enable(tree);
  const logged: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => logged.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => logged.push(a.map(String).join(' '));
  try {
    stub(() => new Response(JSON.stringify({ choices: [{ message: { content: 'I cannot paint this person.' } }] }), { status: 200 }));
    await assert.rejects(() => portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' }), (e: unknown) => e instanceof AiError && e.code === 'bad-output' && e.message === 'paint.err_no_image');
    assert.equal((await dbs.db(tree).all('SELECT key FROM portrait')).length, 0, 'no candidate is kept');

    stub(() => new Response('{"error":"nope"}', { status: 401 }));
    await assert.rejects(() => portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' }), (e: unknown) => e instanceof AiError && e.code === 'auth');
  } finally {
    console.log = log;
    console.error = err;
  }
  const all = logged.join('\n');
  assert.ok(!all.includes(KEY), 'the key is in no log');
  assert.ok(!all.includes('PORTRAIT-SECRET'), 'nor a fragment of it');
});

test('a photo the person is not tagged in cannot be painted', async () => {
  const tree = 'untagged';
  await seed(tree);
  await enable(tree);
  await dbs.media.put(tree, 'gallery/other.png', PNG, 'image/png');
  await dbs.db(tree).run("INSERT INTO media (key, mime, uploaded_by, uploaded_at) VALUES ('gallery/other.png', 'image/png', 'u1', ?)", new Date().toISOString());
  stub();
  await assert.rejects(
    () => portrait.createPortrait(tree, { by: 'u1', personId: 'ben', mediaKey: 'gallery/other.png', locale: 'en' }),
    (e: unknown) => e instanceof AiError && e.message === 'paint.err_photo_not_person',
  );
  assert.equal(imageCalls.length, 0);
});


test('the profile photo is offered first, once, even when the gallery lists it too', async () => {
  const { paintSources } = await load<typeof import('./paint-sources.ts')>('/src/lib/paint-sources.ts');
  const g = [{ key: 'gallery/a.png', caption: 'A' }, { key: 'photo/p.png', caption: null }, { key: 'gallery/a.png', caption: 'A' }, { key: 'gallery/b.png', caption: null }];
  assert.deepEqual(paintSources('photo/p.png', g).map((m) => m.key), ['photo/p.png', 'gallery/a.png', 'gallery/b.png']);
  assert.deepEqual(paintSources(null, g.slice(0, 1)).map((m) => m.key), ['gallery/a.png']);
  assert.deepEqual(paintSources(undefined, []), []);

  const tree = 'profilekey';
  await seed(tree);
  assert.equal(await portrait.profilePhotoKey(tree, 'ada'), null);
  await dbs.media.put(tree, 'photo/ada.png', PNG, 'image/png');
  await dbs.db(tree).run("INSERT INTO photo (person, mime, key, at) VALUES ('ada', 'image/png', 'photo/ada.png', ?)", new Date().toISOString());
  assert.equal(await portrait.profilePhotoKey(tree, 'ada'), 'photo/ada.png');
  await enable(tree);
  stub();
  const c = await portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: 'photo/ada.png', locale: 'en' });
  assert.equal(c.sourceYear, null);
});

test('an old unused draft is swept when a new paint starts; fresh drafts, other people and the accepted portrait stay', async () => {
  const tree = 'sweep';
  const photo = await seed(tree);
  await enable(tree);
  const d = dbs.db(tree);
  const old = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
  const row = async (key: string, person: string, accepted: number, at: string) => {
    await dbs.media.put(tree, key, PNG, 'image/png');
    await d.run("INSERT INTO portrait (key, person, mime, source, model, created_by, created_at, accepted) VALUES (?, ?, 'image/png', ?, 'm', 'u1', ?, ?)", key, person, photo, at, accepted);
  };
  await row('portrait/old-draft.png', 'ada', 0, old);
  await row('portrait/old-accepted.png', 'ada', 1, old);
  await row('portrait/old-ben.png', 'ben', 0, old);
  await row('portrait/fresh.png', 'ada', 0, new Date().toISOString());
  stub();
  const c = await portrait.createPortrait(tree, { by: 'u1', personId: 'ada', mediaKey: photo, locale: 'en' });
  const keys = (await d.all<{ key: string }>('SELECT key FROM portrait ORDER BY key')).map((r) => r.key);
  assert.deepEqual(keys, ['portrait/fresh.png', 'portrait/old-accepted.png', 'portrait/old-ben.png', c.key].sort());
  assert.equal(await dbs.media.get(tree, 'portrait/old-draft.png'), undefined, 'its picture is gone');
  for (const k of ['portrait/old-accepted.png', 'portrait/old-ben.png', 'portrait/fresh.png', c.key]) assert.ok(await dbs.media.get(tree, k), `${k} keeps its picture`);
  assert.equal(await portrait.sweepDrafts(tree, 'ada', 0, Date.now() + 1000), 2, 'with no grace, the unused drafts go');
  assert.ok((await d.get('SELECT key FROM portrait WHERE key = ? AND accepted = 1', 'portrait/old-accepted.png')), 'but never the accepted one');
});
