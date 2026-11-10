// node --test src/lib/auth/share-living.test.ts — a share link that protects living people. Every server function and every
// route a guest can reach is called as such a guest, against a family with a living child, and its serialized answer is
// searched for the child's birthday, birthplace and everything else the protection withholds. The dead stay as they were,
// members see everything, and a link with the setting off still shows what it showed before. Only invented names.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-share-living-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'share-living-test-secret';
delete process.env.KINDRED_GUEST_ORIGIN;
delete process.env.KINDRED_ORIGIN;
delete process.env.CF_ACCESS_AUD;
delete process.env.CF_ACCESS_TEAM_DOMAIN;

const STUB_START = '\0stub-start';
const STUB_START_SERVER = '\0stub-start-server';
const STUB_SESSION = '\0stub-session';
const framework: Plugin = {
  name: 'stub-framework',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@tanstack/react-start') return STUB_START;
    if (source === '@tanstack/react-start/server') return STUB_START_SERVER;
    if (source === './session.server' && importer?.endsWith('guard.server.ts')) return STUB_SESSION;
    return undefined;
  },
  load(id) {
    if (id === STUB_START) return `export const createServerFn = () => { const b = { validator: () => b, handler: (fn) => { const f = (o) => fn(o ?? {}); f.isServerFn = true; return f; } }; return b; };`;
    if (id === STUB_START_SERVER) return `
      export const getRequest = () => globalThis.__request ?? new Request('http://localhost/');
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = (name, value) => { (globalThis.__setCookies ??= []).push(value); };
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null, guest: globalThis.__guest });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  plugins: [framework],
  resolve: { alias: { '~': resolve('src') } },
  ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const store = await load<typeof import('./store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const fns = await load<typeof import('./share.functions.ts')>('/src/lib/auth/share.functions.ts');
const session = await load<typeof import('./session.server.ts')>('/src/lib/auth/session.server.ts');
const tasks = await load<typeof import('../ai/background-tasks.server.ts')>('/src/lib/ai/background-tasks.server.ts');

const TREE = 'living-share';
const STEWARD = '00000000-0000-4000-8000-0000000000c1';
const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown; __setCookies?: string[]; __request?: Request };

const asSteward = () => { g.__signedIn = { id: STEWARD, name: 'steward' }; g.__guest = undefined; };
const asGuest = (protectLiving: boolean) => { g.__signedIn = null; g.__guest = { link: 'some-link', tree: TREE, expires: Date.now() + 3_600_000, protectLiving }; };

// Today, so the child's birthday and the parents' wedding day are what the families list and the Almanac would announce.
const now = new Date();
const MD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const KID_BORN = `2015-${MD}`;
const WEDDING = `2010-${MD}`;

/** What a protected guest must never receive, whichever read they call. */
const WITHHELD = [
  KID_BORN, 'Quillbridge', 'Pupil-of-Wrenhall', 'KID-BIO-TEXT', 'kid-trait-xq', 'KID-STORY-TEXT', 'KID-STORY-DE', 'KID-PHONE-0000',
  'KID-PROJECT-TITLE', 'KID-RESEARCH-NOTE', 'KID-DOC-TITLE',
  '1985-02-02', 'Marrowfield', WEDDING, 'Weddingham', 'Isolde-Bio', 'KID-EVENT-SCHOOL', 'Schoolbury',
  // A picture the child is in, tagged or only suggested: its caption, date and place.
  'KID-CAPTION-TEXT', '2016-07-07', 'Picnicford', 'SUGGESTED-CAPTION-TEXT', '2017-08-08', 'Suggestedholm',
];
/** What the same guest still gets: the dead as they were, and the names of the living. */
const KEPT = ['1920-05-05', 'Oldhaven', 'GRAN-STORY-TEXT', 'GRAN-PROJECT-TITLE', 'Wren', 'Fernsby', 'GRAN-CAPTION-TEXT', '1950-06-06', 'Gransby', 'GRAN-EVENT-CHAPEL', 'Graveston'];

const KID_DOC = '00000000-0000-4000-8000-00000000d0c1.pdf';
const GRAN_DOC = '00000000-0000-4000-8000-00000000d0c2.pdf';
const PICTURE = '00000000-0000-4000-8000-0000000000e1.jpg';
const GRAN_PICTURE = '00000000-0000-4000-8000-0000000000e2.jpg';
const SUGGESTED_PICTURE = '00000000-0000-4000-8000-0000000000e3.jpg';
const POST_PICTURE = '00000000-0000-4000-8000-0000000000e4.jpg';
const POST = '00000000-0000-4000-8000-0000000000f1';
/** The family's feed (docs/feed.md): a guest gets none of it, protected link or not, though this post is about the dead. */
const FEED_ONLY = ['POST-TEXT-FOR-MEMBERS', 'POST-CAPTION-TEXT', 'POST-COMMENT-TEXT', POST_PICTURE];

/** The route's own GET handler, as the server calls it. */
async function get(route: string, params: Record<string, string>) {
  const { Route } = await load<{ Route: { options: unknown } }>(`/src/routes/api/${route}.ts`);
  const { GET } = (Route.options as { server: { handlers: { GET: (c: { params: Record<string, string>; request: Request }) => Promise<Response> } } }).server.handlers;
  return GET({ params, request: new Request('http://localhost/') });
}

before(async () => {
  await dbs.provisionFamily(TREE, 'Fernsby Test');
  const d = dbs.db(TREE);
  const person = (id: string, given: string, living: number, born: string | null, bornPlace: string | null, more = '') =>
    d.run(`INSERT INTO person (id, given, surname, living, born, born_place${more ? ', occupation, bio, traits, look, nickname' : ''}) VALUES (?, ?, 'Fernsby', ?, ?, ?${more ? ', ?, ?, ?, ?, ?' : ''})`,
      ...[id, given, living, born, bornPlace, ...(more ? JSON.parse(more) : [])]);
  await person('kid', 'Wren', 1, KID_BORN, 'Quillbridge', JSON.stringify(['Pupil-of-Wrenhall', 'KID-BIO-TEXT', '["kid-trait-xq"]', '{"skin":1,"hair":2,"eyes":3,"age":9}', 'Wrenny']));
  await person('mum', 'Isolde', 1, '1985-02-02', 'Marrowfield');
  await d.run("UPDATE person SET bio = 'Isolde-Bio' WHERE id = 'mum'");
  await person('dad', 'Corwin', 1, null, null);
  await person('gran', 'Ottilie', 0, '1920-05-05', 'Oldhaven');
  await d.run("UPDATE person SET died = '1999-09-09', bio = 'GRAN-BIO-TEXT' WHERE id = 'gran'");
  // Not living, though no death is recorded: the flag decides, so she is shown as she is.
  await person('elder', 'Bramwell', 0, '1890-01-01', 'Oldhaven');
  for (const [child, parent] of [['kid', 'mum'], ['kid', 'dad'], ['mum', 'gran']]) await d.run('INSERT INTO parent (child, parent) VALUES (?, ?)', child, parent);
  await d.run("INSERT INTO partnership (id, a, b, kind, start, place) VALUES ('u1', 'mum', 'dad', 'marriage', ?, 'Weddingham')", WEDDING);
  // Life events (migration 0024): the child's school, in a town only it names, and the grandmother's burial.
  await d.run("INSERT INTO life_event (id, person, type, label, date, place, created_at, updated_at) VALUES ('e-kid', 'kid', 'education', 'KID-EVENT-SCHOOL', '2021', 'Schoolbury', '2026', '2026')");
  await d.run("INSERT INTO life_event (id, person, type, label, date, place, created_at, updated_at) VALUES ('e-gran', 'gran', 'burial', 'GRAN-EVENT-CHAPEL', '1999-09-12', 'Graveston', '2026', '2026')");
  for (const [name, lat] of [['Quillbridge', 10], ['Marrowfield', 11], ['Weddingham', 12], ['Oldhaven', 13], ['Schoolbury', 14], ['Graveston', 15]] as const) await d.run('INSERT INTO place (name, lat, lng) VALUES (?, ?, 0)', name, lat);
  await d.run("INSERT INTO story (id, person, kind, body, author, at) VALUES ('s-kid', 'kid', 'memory', 'KID-STORY-TEXT', 'x', '2026-01-02')");
  await d.run("INSERT INTO story (id, person, kind, body, author, at) VALUES ('s-gran', 'gran', 'memory', 'GRAN-STORY-TEXT', 'x', '2026-01-01')");
  for (const [story, body, translated] of [['s-kid', 'KID-STORY-TEXT', 'KID-STORY-DE'], ['s-gran', 'GRAN-STORY-TEXT', 'GRAN-STORY-DE']]) {
    await d.run("INSERT INTO story_translation (story, locale, source_hash, body, translated_at) VALUES (?, 'de', ?, ?, '2026-01-03')", story, await tasks.sourceHash(null, body), translated);
  }
  await d.run(`INSERT INTO person_field (id, person, type, label, value, visibility) VALUES ('f-kid', 'kid', 'phone', 'Mobile', '{"number":"KID-PHONE-0000"}', 'family')`);
  // A gallery picture of the child with her grandmother, one of the grandmother alone, one where the child is only suggested,
  // each with a caption, a date and a place; and a profile photo.
  for (const [key, caption, taken, place, at] of [
    [PICTURE, 'KID-CAPTION-TEXT', '2016-07-07', 'Picnicford', '2026-01-01'],
    [GRAN_PICTURE, 'GRAN-CAPTION-TEXT', '1950-06-06', 'Gransby', '2026-01-02'],
    [SUGGESTED_PICTURE, 'SUGGESTED-CAPTION-TEXT', '2017-08-08', 'Suggestedholm', '2026-01-03'],
  ]) {
    await d.run("INSERT INTO media (key, mime, caption, taken, place, uploaded_by, uploaded_at) VALUES (?, 'image/jpeg', ?, ?, ?, 'x', ?)", `gallery/${key}`, caption, taken, place, at);
    await dbs.media.put(TREE, `gallery/${key}`, new Uint8Array([255, 216, 255]), 'image/jpeg');
  }
  const tag = (key: string, who: string, confirmed: number) =>
    d.run("INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at) VALUES (?, ?, 0.1, 0.1, 0.2, 0.2, ?, 'x', '2026-01-01')", `gallery/${key}`, who, confirmed);
  for (const who of ['kid', 'gran']) await tag(PICTURE, who, 1);
  await tag(GRAN_PICTURE, 'gran', 1);
  await tag(SUGGESTED_PICTURE, 'gran', 1);
  await tag(SUGGESTED_PICTURE, 'kid', 0);
  await d.run("INSERT INTO photo (person, mime, data, at) VALUES ('kid', 'image/jpeg', ?, '2026-01-01')", new Uint8Array([255, 216, 255]));
  // A post in the family's feed about the grandmother, with a picture of her and a comment under it.
  await d.run("INSERT INTO post (id, account, author_name, body, created_at) VALUES (?, ?, 'steward', 'POST-TEXT-FOR-MEMBERS', '2026-01-04T10:00:00.000Z')", POST, STEWARD);
  await d.run("INSERT INTO post_person (post, person) VALUES (?, 'gran')", POST);
  await d.run("INSERT INTO media (key, mime, caption, uploaded_by, uploaded_at) VALUES (?, 'image/jpeg', 'POST-CAPTION-TEXT', ?, '2026-01-04')", `gallery/${POST_PICTURE}`, STEWARD);
  await dbs.media.put(TREE, `gallery/${POST_PICTURE}`, new Uint8Array([255, 216, 255]), 'image/jpeg');
  await d.run('INSERT INTO post_media (post, media, ord) VALUES (?, ?, 0)', POST, `gallery/${POST_PICTURE}`);
  await tag(POST_PICTURE, 'gran', 1);
  await d.run("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('c-post', 'post', ?, ?, 'steward', 'POST-COMMENT-TEXT', '2026-01-04T11:00:00.000Z')", POST, STEWARD);
  // Research about the child, and research about her grandmother.
  for (const [id, title, who, doc, docTitle] of [['pkid', 'KID-PROJECT-TITLE', 'kid', KID_DOC, 'KID-DOC-TITLE'], ['pgran', 'GRAN-PROJECT-TITLE', 'gran', GRAN_DOC, 'Gran document']]) {
    await d.run("INSERT INTO research_project (id, title, created_by, created_at, updated_at) VALUES (?, ?, 'x', '2026-01-01', '2026-01-01')", id, title);
    await d.run("INSERT INTO research_person (project, person, created_by, created_at) VALUES (?, ?, 'x', '2026-01-01')", id, who);
    await d.run("INSERT INTO research_document (id, project, key, mime, size, title, created_by, created_at, updated_at) VALUES (?, ?, ?, 'application/pdf', 4, ?, 'x', '2026-01-01', '2026-01-01')", `d-${id}`, id, `research/${doc}`, docTitle);
    await dbs.media.put(TREE, `research/${doc}`, new Uint8Array([37, 80, 68, 70]), 'application/pdf');
  }
  await d.run("INSERT INTO research_note (id, project, title, body, created_by, created_at, updated_at) VALUES ('n1', 'pkid', 'Note', 'KID-RESEARCH-NOTE', 'x', '2026-01-01', '2026-01-01')");
  // The grandmother's research holds the picture with the child in it, and one of her alone.
  for (const key of [PICTURE, GRAN_PICTURE]) {
    await d.run("INSERT INTO research_picture (project, media, created_by, created_at) VALUES ('pgran', ?, 'x', '2026-01-01')", `gallery/${key}`);
  }
  await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', STEWARD, 'steward', 'handle-steward-living', Date.now());
  await store.accounts().run("INSERT INTO membership (user, tree, role, created) VALUES (?, ?, 'steward', ?)", STEWARD, TREE, Date.now());
});
after(async () => {
  g.__signedIn = null;
  g.__guest = undefined;
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- every server function a guest can reach ----------

function serverFnFiles(from: string): string[] {
  return readdirSync(from).flatMap((name) => {
    const path = join(from, name);
    if (statSync(path).isDirectory()) return serverFnFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name) || name === 'request.ts') return [];
    return readFileSync(path, 'utf8').includes('createServerFn(') ? [path] : [];
  });
}

async function everyServerFn() {
  const found: { name: string; call: (o: unknown) => Promise<unknown> }[] = [];
  for (const file of serverFnFiles(resolve('src/lib'))) {
    const mod = await load<Record<string, unknown>>(`/${file.slice(resolve('.').length + 1).replace(/\\/g, '/')}`);
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function' && (value as { isServerFn?: boolean }).isServerFn) found.push({ name, call: value as (o: unknown) => Promise<unknown> });
    }
  }
  return found;
}

/**
 * The server functions that answer a guest, and so everything that is checked here. share.test.ts holds the same list
 * (GUEST_READS and the open ones); a function that starts answering a guest fails this test until it is added and checked.
 */
const ANSWERS_A_GUEST = new Set([
  'getGraph', 'getChronicle', 'getContacts', 'getPersonDetail', 'getResearchProjects', 'getResearchProject', 'getPersonResearch',
  'getHouseMeanings', 'getHouseTranslations', 'getHouseSettings', 'storyTranslations', 'getGallery', 'getPersonPhotos', 'aiStatus',
  'getPersonEvents', 'getEventPlaces',
  'fetchSession', 'fetchMyFamilies', 'fetchInvite', 'fetchShareEntry', 'openShareLink', 'leaveGuestVisit', 'fetchRemindersAvailable', 'forgetThisDevice',
  // "Ask to join": a guest's own request and what it would send, never another person's data (join.test.ts).
  'fetchJoinState', 'fetchJoinPreview', 'joinOptions', 'sendJoinRequest',
  // Stopping a "View as" preview: always allowed, and it answers nothing but { ok: true } (view-as.test.ts).
  'stopViewAs',
]);

/** Asks every server function as a guest, once about the child and once about her research, and returns what answered. */
async function askEverything(protectLiving: boolean): Promise<Map<string, string>> {
  const base = { tree: TREE, locale: 'de', key: 'k', house: 'h', mediaKey: `gallery/${PICTURE}`, token: 'x', format: 'gedcom', opKey: 'abcdefgh' };
  const answered = new Map<string, string>();
  for (const { name, call } of await everyServerFn()) {
    for (const data of [{ ...base, id: 'kid', person: 'kid', personId: 'kid' }, { ...base, id: 'pkid', person: 'kid', project: 'pkid' }]) {
      asGuest(protectLiving);
      try {
        const out = await call({ data });
        answered.set(name, (answered.get(name) ?? '') + JSON.stringify(out ?? null));
      } catch {}
    }
  }
  return answered;
}

test('no server function gives a protected guest anything the protection withholds', async () => {
  const answered = await askEverything(true);
  for (const name of answered.keys()) assert.ok(ANSWERS_A_GUEST.has(name), `${name} answers a guest: decide what it may carry and add it here`);
  for (const name of ['getGraph', 'getChronicle', 'getPersonDetail', 'getGallery', 'getPersonPhotos', 'getResearchProjects', 'getResearchProject', 'getPersonResearch', 'storyTranslations', 'fetchMyFamilies', 'fetchSession']) {
    assert.ok(answered.has(name), `${name} was asked`);
  }
  for (const [name, json] of answered) {
    for (const secret of WITHHELD) assert.ok(!json.includes(secret), `${name} gave a protected guest "${secret}"`);
  }
  const all = [...answered.values()].join('');
  for (const kept of KEPT) assert.ok(all.includes(kept), `a protected guest still gets "${kept}"`);
  for (const feed of FEED_ONLY) assert.ok(!all.includes(feed), `a protected guest got "${feed}" from the family's feed`);
});

test('the control: with the setting off, the same guest gets what it got before', async () => {
  const answered = await askEverything(false);
  const all = [...answered.values()].join('');
  for (const shown of [KID_BORN, 'Quillbridge', 'KID-STORY-TEXT', 'KID-STORY-DE', 'KID-PROJECT-TITLE', 'KID-RESEARCH-NOTE', WEDDING, 'Weddingham', 'KID-CAPTION-TEXT', 'Picnicford', 'KID-EVENT-SCHOOL', 'Schoolbury']) {
    assert.ok(all.includes(shown), `an unprotected guest still gets "${shown}"`);
  }
  assert.ok(!all.includes('KID-PHONE-0000'), 'and still no fields at all');
  // The family's feed is the members': no post, no comment on one, and not its picture in the Gallery or on a person's page.
  for (const feed of FEED_ONLY) assert.ok(!all.includes(feed), `a guest got "${feed}" from the family's feed`);
  assert.equal((await get('media.$tree.$key', { tree: TREE, key: POST_PICTURE })).status, 404, 'a post’s picture is not served to a guest');
  assert.equal((await get('media.$tree.$key', { tree: TREE, key: GRAN_PICTURE })).status, 200, 'an ordinary gallery picture is');
});

test('a protected guest gets the living child by name, place in the tree and face, and nothing more', async () => {
  const api = await load<typeof import('../api.ts')>('/src/lib/api.ts');
  asGuest(true);
  const graph = await api.getGraph({ data: { tree: TREE } });
  assert.equal(graph.livingProtected, true);
  const kid = graph.people.find((p) => p.id === 'kid')!;
  assert.deepEqual(
    { ...kid, photo: kid.photo ? 'set' : undefined },
    { id: 'kid', given: 'Wren', surname: 'Fernsby', nickname: 'Wrenny', living: true, stories: 0, contacts: 0, photo: 'set', preferAvatar: false, preferPortrait: false, look: { skin: 1, hair: 2, eyes: 3 } },
    'names, the face and the drawing’s look without its age; no date, place, occupation, traits or counts',
  );
  assert.deepEqual(graph.parents.filter((p) => p.child === 'kid').map((p) => p.parent).sort(), ['dad', 'mum'], 'her place in the tree');
  const u = graph.unions.find((x) => x.id === 'u1')!;
  assert.deepEqual(u, { id: 'u1', a: 'mum', b: 'dad', kind: 'marriage' }, 'the marriage, without its day or place');
  const gran = graph.people.find((p) => p.id === 'gran')!;
  assert.equal(gran.born, '1920-05-05', 'the dead are untouched');
  assert.equal(gran.stories, 1);
  const elder = graph.people.find((p) => p.id === 'elder')!;
  assert.equal(elder.born, '1890-01-01', 'someone marked not living is shown, death date or not');
  assert.deepEqual(graph.places.map((p) => p.name), ['Oldhaven'], 'no Atlas place only the living would have');

  const photos = await load<typeof import('../photos.functions.ts')>('/src/lib/photos.functions.ts');
  const gallery = await photos.getGallery({ data: { tree: TREE } });
  const picture = (key: string) => gallery.media.find((m) => m.key === `gallery/${key}`)!;
  assert.equal(gallery.media.length, 3, 'the pictures themselves are still in the gallery');
  assert.deepEqual(picture(PICTURE).tags.map((t) => t.person), ['gran'], 'the child is not tagged on hers');
  const about = (key: string) => ({ caption: picture(key).caption, taken: picture(key).taken, place: picture(key).place });
  assert.deepEqual(about(PICTURE), { caption: null, taken: null, place: null }, 'and it has no caption, date or place');
  assert.deepEqual(about(SUGGESTED_PICTURE), { caption: null, taken: null, place: null }, 'nor does one she is only suggested in');
  assert.deepEqual(about(GRAN_PICTURE), { caption: 'GRAN-CAPTION-TEXT', taken: '1950-06-06', place: 'Gransby' }, 'a picture of the dead alone keeps them');
  assert.deepEqual(await photos.getPersonPhotos({ data: { tree: TREE, id: 'kid' } }), [], 'and has no pictures of her own');
  const grans = await photos.getPersonPhotos({ data: { tree: TREE, id: 'gran' } });
  assert.equal(grans.length, 3);
  assert.equal(grans.find((m) => m.key === `gallery/${PICTURE}`)!.caption, null, 'on her grandmother’s page neither');

  // The grandmother's research shows both pictures, the one with the child without its caption or date.
  const research = await load<typeof import('../research.functions.ts')>('/src/lib/research.functions.ts');
  const project = (await research.getResearchProject({ data: { tree: TREE, id: 'pgran' } }))!;
  assert.deepEqual(
    project.pictures.map((p) => [p.key, p.caption, p.taken]).sort(),
    [[`gallery/${PICTURE}`, null, null], [`gallery/${GRAN_PICTURE}`, 'GRAN-CAPTION-TEXT', '1950-06-06']],
  );

  const auth = await load<typeof import('./functions.ts')>('/src/lib/auth/functions.ts');
  const [family] = await auth.fetchMyFamilies();
  assert.deepEqual(family.birthdays, [], 'no birthday on the families list');
  assert.deepEqual(family.today, [], 'no birthday or wedding anniversary today');
});

test('members see everything, protected link or not', async () => {
  const api = await load<typeof import('../api.ts')>('/src/lib/api.ts');
  asSteward();
  const graph = await api.getGraph({ data: { tree: TREE } });
  assert.equal(graph.livingProtected, undefined);
  assert.equal(graph.people.find((p) => p.id === 'kid')!.born, KID_BORN);
  const auth = await load<typeof import('./functions.ts')>('/src/lib/auth/functions.ts');
  const [family] = await auth.fetchMyFamilies();
  assert.deepEqual(family.birthdays?.map((b) => b.id), ['kid']);
  assert.ok(family.today.some((e) => e.key === 'a:u1'), 'the wedding anniversary');
  // And the family's feed, with the post's picture in the Gallery and served.
  const feed = await load<typeof import('../feed/feed.functions.ts')>('/src/lib/feed/feed.functions.ts');
  const page = await feed.getFeed({ data: { tree: TREE } });
  assert.ok(JSON.stringify(page).includes('POST-TEXT-FOR-MEMBERS'));
  assert.deepEqual((await feed.getPersonPosts({ data: { tree: TREE, id: 'gran' } })).map((p) => p.id), [POST]);
  const photos = await load<typeof import('../photos.functions.ts')>('/src/lib/photos.functions.ts');
  assert.equal((await photos.getGallery({ data: { tree: TREE } })).media.find((m) => m.key === `gallery/${POST_PICTURE}`)?.post, POST);
  assert.equal((await get('media.$tree.$key', { tree: TREE, key: POST_PICTURE })).status, 200);
});

test('the guest routes: the pictures stay, research about the living does not', async () => {
  asGuest(true);
  assert.equal((await get('photo.$tree.$id', { tree: TREE, id: 'kid' })).status, 200, 'her photo is her face, as today');
  assert.equal((await get('media.$tree.$key', { tree: TREE, key: PICTURE })).status, 200, 'the gallery picture still shows');
  assert.equal((await get('portrait.$tree.$id', { tree: TREE, id: 'kid' })).status, 404, 'no painted portrait here, as for anyone');
  assert.equal((await get('research.$tree.$key', { tree: TREE, key: KID_DOC })).status, 404, 'a document of research that names her does not exist');
  assert.equal((await get('research.$tree.$key', { tree: TREE, key: GRAN_DOC })).status, 200, 'research about the dead is there');
  asGuest(false);
  assert.equal((await get('research.$tree.$key', { tree: TREE, key: KID_DOC })).status, 200, 'the control: an unprotected guest gets it');
});

// ---------- the setting itself ----------

/** Makes a link as the steward through the real server function. */
async function makeLink(protectLiving?: boolean) {
  asSteward();
  const made = await fns.makeShareLink({ data: { tree: TREE, password: false, days: 30, ...(protectLiving === undefined ? {} : { protectLiving }) } });
  return { ...made, token: made.url.split('/share/')[1] };
}
async function visit(token: string) {
  g.__signedIn = null;
  g.__guest = undefined;
  g.__setCookies = [];
  const result = await fns.openShareLink({ data: { token } });
  assert.equal(result.status, 'ok');
  const cookie = g.__setCookies.find((c) => c.startsWith('kindred_guest='))!.split(';')[0];
  return () => session.getSession(new Request('http://localhost/', { headers: { cookie } }), async () => undefined, async () => []);
}

test('a new link protects living people unless the steward unticks it, and the steward can switch it later', async () => {
  const made = await makeLink();
  assert.equal(made.protectLiving, true, 'on by default');
  asSteward();
  assert.equal((await fns.fetchShareState({ data: { tree: TREE } })).link?.protectLiving, true);
  const sessionNow = await visit(made.token);
  assert.equal((await sessionNow()).guest?.protectLiving, true, 'the visit carries the link’s setting');

  asSteward();
  await fns.setShareProtectLiving({ data: { tree: TREE, protectLiving: false } });
  assert.equal((await fns.fetchShareState({ data: { tree: TREE } })).link?.protectLiving, false);
  assert.equal((await sessionNow()).guest?.protectLiving, false, 'a guest already looking around sees the change with the next read');
  assert.ok((await sessionNow()).guest, 'switching it keeps the link and the visit');

  const unticked = await makeLink(false);
  assert.equal(unticked.protectLiving, false, 'the steward may untick it');
  asSteward();
  assert.equal((await fns.fetchShareState({ data: { tree: TREE } })).link?.protectLiving, false);
});

test('only a steward switches it', async () => {
  await makeLink();
  asGuest(true);
  await assert.rejects(fns.setShareProtectLiving({ data: { tree: TREE, protectLiving: false } }), (e: Error & { status?: number }) => e.status === 401);
  const editor = '00000000-0000-4000-8000-0000000000c2';
  await store.accounts().run('INSERT OR IGNORE INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', editor, 'e', 'handle-e-living', Date.now());
  await store.accounts().run("INSERT OR IGNORE INTO membership (user, tree, role, created) VALUES (?, ?, 'editor', ?)", editor, TREE, Date.now());
  g.__signedIn = { id: editor, name: 'e' };
  g.__guest = undefined;
  await assert.rejects(fns.setShareProtectLiving({ data: { tree: TREE, protectLiving: false } }), (e: Error & { status?: number }) => e.status === 403);
  asSteward();
  assert.equal((await fns.fetchShareState({ data: { tree: TREE } })).link?.protectLiving, true, 'unchanged');
});

test('the migration leaves links that already exist as they were, on a fresh database too', () => {
  const d = new DatabaseSync(':memory:');
  d.exec(readFileSync('migrations/accounts/0015_share_link.sql', 'utf8'));
  d.prepare("INSERT INTO share_link (id, tree, token_hash, created) VALUES ('old', 't', 'x', 1)").run();
  d.exec(readFileSync('migrations/accounts/0023_share_protect_living.sql', 'utf8'));
  assert.equal((d.prepare("SELECT protect_living FROM share_link WHERE id = 'old'").get() as { protect_living: number }).protect_living, 0, 'an existing link is not protected');
  assert.throws(() => d.prepare("UPDATE share_link SET protect_living = 2 WHERE id = 'old'").run(), /CHECK/);
  d.close();
});

test('the Needed page does not count what is withheld as a gap', async () => {
  const api = await load<typeof import('../api.ts')>('/src/lib/api.ts');
  const graphLib = await load<typeof import('../graph.ts')>('/src/lib/graph.ts');
  const gaps = await load<typeof import('../gaps.ts')>('/src/lib/gaps.ts');
  asGuest(true);
  const f = graphLib.buildFamily(await api.getGraph({ data: { tree: TREE } }));
  assert.deepEqual(gaps.gapsOf(f, f.byId.get('dad')!, new Set(gaps.ALL_GAPS)), ['parents', 'sex', 'photo'], 'only what the guest could know is missing');
  assert.deepEqual(gaps.gapsOf(f, f.byId.get('elder')!, new Set(['died'] as const)), ['died'], 'the dead keep their gaps');
});
