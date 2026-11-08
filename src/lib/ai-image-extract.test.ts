// node --test src/lib/ai-image-extract.test.ts: what a picture yields beyond handles. The model is stubbed with answers a real one gave
// for a certificate, a tree drawing and a profile list; the draft keeps dates as read, marks doubts, starts addresses restricted, and writes
// nothing before approval. Private data folder and fake provider; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-extract-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-extract-test-secret';

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
const { defaultVisibility } = await load<typeof import('../components/fields/model.ts')>('/src/components/fields/model.ts');
const draft = await load<typeof import('../components/assistant/family-draft.ts')>('/src/components/assistant/family-draft.ts');

const TREE = 'extract';
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


const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]).toString('base64');
const send = (answer: unknown) => chat.sendMessage({ tree: TREE, user: 'u1', role: 'editor', me: null, text: `Add everything. FAKE-FAMILY ${JSON.stringify(answer)}`, locale: 'en', images: [{ base64: PNG }] });
type Row = Record<string, any>;
const draftOf = (items: Awaited<ReturnType<typeof send>>['items']) => items[1].proposals![0].args as unknown as { people: Row[]; links: Row[] };
const apply = (d: { people: Row[]; links: Row[] }, role: 'editor' | 'contributor' = 'editor') => family.applyFamilyBatch({
  tree: TREE, user: 'u1', author: 'Anna', role,
  batch: { people: d.people.map((p) => ({ ...draft.cleanPerson(p as any), key: crypto.randomUUID() }) as any), links: d.links.map((l) => ({ ...l, key: crypto.randomUUID() })) as any },
});
const fields = (person: string) => db(TREE).all<{ type: string; label: string; value: string; visibility: string }>('SELECT type, label, value, visibility FROM person_field WHERE person = ? ORDER BY ord', person);
const count = async () => (await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM person'))!.n;

const CERT = {
  people: [
    { ref: 'n1', given: 'Johann', furtherGiven: ['Georg'], surname: 'Weber', sex: 'm', born: '1884-03-02', bornPlace: 'Ulm', living: false, occupation: 'Schreiner',
      unsure: ['born: handwritten, the day could be 2 or 7'],
      story: { kind: 'note', body: 'Taufschein, Ulm. Randnotiz: „Pate war der Onkel“.' } },
    { ref: 'n2', given: 'Anna', surname: 'Keller', born: '~1860', living: false, details: [
      { type: 'names', label: 'birth name', value: { name: 'Anna Maria Keller' } },
      { type: 'email', value: { address: 'not an email' } },
      { type: 'address', value: { street: 'Gartenweg 4', city: 'Ulm' } },
      { type: 'phone', value: { number: '+49 731 5550101' } }] },
  ],
  links: [{ anchor: 'n1', person: 'n2', relation: 'parent' }],
};

test('a certificate keeps real dates, places and notes, marks doubts, and starts each field at its type’s level', async () => {
  const before = await count();
  const { items } = await send(CERT);
  assert.equal(await count(), before, 'drafting writes nothing');
  const d = draftOf(items);
  assert.deepEqual(d.people[0].born, '1884-03-02');
  assert.equal(d.people[1].born, '~1860', 'an approximate year keeps its ~');
  assert.deepEqual(d.people[0].unsure, ['born: handwritten, the day could be 2 or 7']);
  assert.deepEqual(d.people[1].details.map((x: Row) => x.type), ['names', 'address', 'phone'], 'the misread email is not offered');
  assert.ok(d.people[1].unsure.some((u: string) => u.startsWith('email')), 'and it is said');
  const out = await apply(d);
  assert.ok(out.people.every((p) => p.id), JSON.stringify(out));
  const [johann, anna] = out.people.map((p) => p.id!);
  const row = await db(TREE).get<Row>('SELECT * FROM person WHERE id = ?', johann);
  assert.equal(row!.born, '1884-03-02');
  assert.equal(row!.born_place, 'Ulm');
  assert.equal(row!.occupation, 'Schreiner');
  const vis = Object.fromEntries((await fields(anna)).map((f) => [f.type, f.visibility]));
  assert.equal(vis.address, 'editors');
  assert.equal(vis.phone, defaultVisibility('phone'), 'every field starts at its type’s level, as anywhere else');
  assert.equal(vis.names, defaultVisibility('names'));
  const tales = await db(TREE).all<{ body: string }>('SELECT body FROM story WHERE person = ?', johann);
  assert.equal(tales.length, 1);
  assert.ok(tales[0].body.includes('Taufschein') && tales[0].body.includes('Not certain: born: handwritten'), tales[0].body);
  const annaTales = await db(TREE).all<{ body: string }>('SELECT body FROM story WHERE person = ?', anna);
  assert.ok(annaTales[0].body.includes('email'), 'the skipped detail is named, its value is not copied');
  assert.ok(!annaTales[0].body.includes('not an email'));
});

test('a family-tree drawing becomes people and links, and an unclear line is a question, not a link', async () => {
  const { items } = await send({
    people: [
      { ref: 'n1', given: 'Otto', surname: 'Brandt', born: '1901', living: false },
      { ref: 'n2', given: 'Elsa', born: '1905', living: false, unsure: ['surname: not shown on the drawing'] },
      { ref: 'n3', given: 'Klara', born: '~1930', living: true, unsure: ['born: only “aged 22” and a 1952 stamp are visible'] },
    ],
    links: [{ anchor: 'n1', person: 'n2', relation: 'partner' }, { anchor: 'n1', person: 'n3', relation: 'child', coParent: 'n2' }],
    questions: ['Is the line from Klara going to Otto or to Elsa’s sister?'],
  });
  const d = draftOf(items);
  assert.equal(d.people.length, 3);
  assert.equal(d.links.length, 2);
  assert.equal(d.people[2].born, '~1930');
  const before = await count();
  const out = await apply(d);
  assert.equal(await count(), before + 3);
  assert.ok(out.links.every((l) => l.ok), JSON.stringify(out.links));
  assert.equal(out.people.every((p) => p.id), true);
});

test('a profile list still works, and over-long lists are trimmed rather than refused', async () => {
  const many = Array.from({ length: 12 }, (_, i) => `u${i}`);
  const { items } = await send({
    people: [{ ref: 'n1', given: 'Lena', living: true, social: [{ network: 'Instagram', handle: 'lena.k' }], unsure: many.map((x) => `${x} ${'y'.repeat(300)}`),
      details: many.map((x) => ({ type: 'website', value: { url: `https://example.com/${x}` } })) }],
    links: [],
  });
  const p = draftOf(items).people[0];
  assert.deepEqual(p.social, [{ network: 'Instagram', handle: 'lena.k' }]);
  assert.equal(p.unsure.length, 8);
  assert.ok(p.unsure.every((u: string) => u.length <= 200));
  assert.equal(p.details.length, 8);
});

test('a contributor can add the people but not the contact details; the doubts are kept only where stories are allowed', async () => {
  const { items } = await send({ people: [{ ref: 'n1', given: 'Berta', living: true, unsure: ['surname: smudged'], details: [{ type: 'phone', value: { number: '123' } }] }], links: [] });
  const out = await apply(draftOf(items), 'contributor');
  assert.ok(out.people[0].error || out.people[0].id, 'it reports, never throws');
});
