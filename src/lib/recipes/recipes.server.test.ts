// node --test src/lib/recipes/recipes.server.test.ts — recipes on a private data folder: who may write and change one;
// what a guest reads when the link protects living people; that the pictures are stored with the media and are not in the
// gallery; that a change deletes what it replaces; removal, Undo and the daily sweep; a recipe from before the form.
// Server modules load through Vite (ssrLoadModule), as the app does. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-recipes-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const family = openSqlite(join(dir, 'family.db'), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', 'family'), ('name', 'The Alders'), ('tagline', ''), ('theme', 'codex'), ('focus', 'hilde');
  INSERT INTO person (id, given, surname, born, living) VALUES ('hilde', 'Hilde', 'Alder', '1921', 0), ('ben', 'Ben', 'Alder', '1960-02-03', 1);
  INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES ('old', 'hilde', 'recipe', 'Plum cake', 'Flour, plums, patience.', 'Jonas', '2021-06-02T10:00:00.000Z', NULL);
`);
family.close();

const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const R = await load<typeof import('./recipes.server.ts')>('/src/lib/recipes/recipes.server.ts');
const S = await load<typeof import('../story.server.ts')>('/src/lib/story.server.ts');
const Photos = await load<typeof import('../photos.server.ts')>('/src/lib/photos.server.ts');
const { AuthError } = await load<typeof import('../auth/errors.ts')>('/src/lib/auth/errors.ts');
const { readTree } = await load<typeof import('../exchange/model.ts')>('/src/lib/exchange/model.ts');
const { markdownArchive } = await load<typeof import('../exchange/markdown.ts')>('/src/lib/exchange/markdown.ts');
const { writeGedcom } = await load<typeof import('../exchange/gedcom.ts')>('/src/lib/exchange/gedcom.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const d = () => db.db('family');
const count = async (table: string, where = '1 = 1') => (await d().get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const stored = async (key: string) => !!(await db.media.get('family', key));
// The smallest PNG there is.
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
const picture = (thumb = false) => ({ bytes: PNG, mime: 'image/png', width: 1200, height: 800, ...(thumb ? { thumb: { bytes: PNG, mime: 'image/png' } } : {}) });

const nora = { id: 'acc-nora', name: 'Nora Alder', role: 'contributor' as const };
const carl = { id: 'acc-carl', name: 'Carl Alder', role: 'contributor' as const };
const eda = { id: 'acc-eda', name: 'Eda Editor', role: 'editor' as const };
const vera = { id: 'acc-vera', name: 'Vera Viewer', role: 'viewer' as const };
const guest = { id: '', name: '', role: 'viewer' as const, guest: true };
const careful = { ...guest, protectLiving: true };

const goulash = (over: Partial<Parameters<typeof R.saveRecipe>[2]> = {}): Parameters<typeof R.saveRecipe>[2] => ({
  person: 'hilde', title: 'Goulash', source: 'Oma Hilde’s', servings: 4, prepMinutes: 20, cookMinutes: 150,
  groups: [{ name: '', items: [{ amount: '800', unit: 'g', item: 'beef', note: 'diced' }, { amount: '3', unit: '', item: 'onions', note: '' }] }],
  steps: [{ text: 'Brown the beef.', image: null }, { text: 'Simmer for two hours.', image: null }],
  notes: 'Better the next day.', tags: ['stew', 'Sunday'], cover: 'keep', ...over,
});

let id = '';

test('a contributor writes a recipe: a story of kind recipe, its row, and a history row that says added', async () => {
  ({ id } = await R.saveRecipe('family', nora, goulash(), { steps: {} }));
  const story = await d().get<{ kind: string; title: string; body: string; author: string; author_account: string; person: string }>('SELECT * FROM story WHERE id = ?', id);
  assert.equal(story!.kind, 'recipe');
  assert.equal(story!.title, 'Goulash');
  assert.equal(story!.author, 'Nora Alder');
  assert.equal(story!.author_account, 'acc-nora');
  // The body is the whole recipe written out, so everything that reads stories reads it.
  assert.match(story!.body, /\*\*Ingredients\*\*/);
  assert.match(story!.body, /- 800 g beef, diced/);
  assert.match(story!.body, /2\. Simmer for two hours\./);
  assert.equal(await count('recipe', `story = '${id}'`), 1);
  const h = await d().get<{ action: string; kind: string; person: string; label: string }>("SELECT action, kind, person, label FROM history WHERE record = ? ORDER BY id DESC", id);
  assert.deepEqual({ ...h }, { action: 'added', kind: 'story', person: 'hilde', label: 'Goulash' });

  const book = await R.cookbook('family', vera);
  const mine = book.find((r) => r.id === id)!;
  assert.equal(mine.structured, true);
  assert.deepEqual(mine.tags, ['stew', 'Sunday']);
  assert.deepEqual(mine.items, ['beef', 'onions']);
  assert.equal(mine.servings, 4);
  assert.equal(mine.cover, null);
  // A recipe from before the form is in the cookbook too, as free text.
  const old = book.find((r) => r.id === 'old')!;
  assert.equal(old.structured, false);
  assert.equal(old.title, 'Plum cake');
});

test('a viewer, a guest and an empty recipe are refused, and nothing is stored for them', async () => {
  const before = await count('story');
  assert.throws(() => R.saveRecipe('family', vera, goulash(), { steps: {} }), AuthError);
  assert.throws(() => R.saveRecipe('family', guest, goulash(), { steps: {} }), AuthError);
  assert.throws(() => R.saveRecipe('family', nora, goulash({ title: '   ' }), { steps: {} }), /recipes\.err\.title/);
  await assert.rejects(R.saveRecipe('family', nora, goulash({ groups: [], steps: [] }), { cover: picture(true), steps: {} }), /recipes\.err\.empty/);
  await assert.rejects(R.saveRecipe('family', nora, goulash({ person: 'nobody' }), { steps: {} }), /Person not found/);
  assert.equal(await count('story'), before);
  // The refused save's picture was given back.
  assert.equal(await count('recipe_image'), 0);
});

test('the pictures are stored with the media and are not in the gallery', async () => {
  await R.saveRecipe('family', nora, goulash({ id, cover: 'new', steps: [{ text: 'Brown the beef.', image: 'new:0' }, { text: 'Simmer for two hours.', image: null }] }), { cover: picture(true), steps: { 0: picture() } });
  const r = (await R.recipe('family', id, nora))!;
  assert.match(r.cover!.key, /^recipe\/[0-9a-f-]+\.png$/);
  assert.equal(r.cover!.width, 1200);
  const step = r.steps[0]!.image!;
  assert.match(step, /^recipe\//);
  assert.ok(r.pictures[step]);
  assert.ok(await stored(r.cover!.key));
  assert.ok(await stored(step));
  // No gallery row, so not in the Gallery, on nobody's photos, and not served by the gallery's route.
  assert.equal(await count('media'), 0);
  assert.equal((await Photos.gallery('family')).media.length, 0);
  assert.equal(await Photos.pictureFor('family', r.cover!.key.replace('recipe/', 'gallery/'), false), undefined);
  // The recipe's own route finds them: the picture, and the cover's small copy.
  assert.deepEqual(await R.recipePicture('family', r.cover!.key, false), { key: r.cover!.key, mime: 'image/png' });
  const small = await R.recipePicture('family', r.cover!.key, true);
  assert.match(small!.key, /^recipe-thumb\//);
  assert.ok(await stored(small!.key));
  assert.equal(await R.recipePicture('family', 'recipe/nothing.png', false), undefined);
  assert.equal(await R.recipePicture('family', 'gallery/x.png', false), undefined);
});

test('a guest reads recipes as they read stories: none of a living person when the link protects the living', async () => {
  const { id: bens } = await R.saveRecipe('family', nora, goulash({ person: 'ben', title: 'Ben’s chilli', cover: 'new' }), { cover: picture(true), steps: {} });
  const cover = (await R.recipe('family', bens, nora))!.cover!.key;
  // A plain guest link (the steward chose not to protect) reads both.
  assert.deepEqual((await R.cookbook('family', guest)).map((r) => r.id).sort(), [bens, id, 'old'].sort());
  assert.ok(await R.recipe('family', bens, guest));
  assert.ok(await R.recipePicture('family', cover, false, false));
  // A protecting link: Ben is living, so his recipe is not there at all, and neither is its picture. Hilde's is.
  assert.deepEqual((await R.cookbook('family', careful)).map((r) => r.id).sort(), [id, 'old'].sort());
  assert.equal(await R.recipe('family', bens, careful), null);
  assert.equal(await R.recipePicture('family', cover, false, true), undefined);
  assert.equal(await R.recipePicture('family', cover, true, true), undefined);
  assert.ok(await R.recipe('family', id, careful));
  // A guest is never offered a change.
  assert.equal((await R.recipe('family', id, guest))!.editable, false);
  assert.equal((await R.recipe('family', id, guest))!.removable, false);
  // Nothing about who wrote it by account reaches a reader.
  assert.equal(JSON.stringify(await R.recipe('family', id, guest)).includes('acc-nora'), false);
});

test('its writer and an editor may change it, another contributor may not; a change deletes what it replaces', async () => {
  const was = (await R.recipe('family', id, nora))!;
  assert.equal(was.editable, true);
  assert.equal((await R.recipe('family', id, carl))!.editable, false);
  assert.equal((await R.recipe('family', id, eda))!.editable, true);
  assert.equal((await R.recipe('family', id, eda))!.removable, true);
  assert.equal(was.removable, false);
  await assert.rejects(R.saveRecipe('family', carl, goulash({ id, title: 'Carl’s goulash' }), { steps: {} }), AuthError);

  const oldCover = was.cover!.key;
  const oldSmall = (await R.recipePicture('family', oldCover, true))!.key;
  const oldStep = was.steps[0]!.image!;
  // The editor gives it a new cover, drops the step's picture, and doubles the onions.
  await R.saveRecipe('family', eda, goulash({
    id, cover: 'new', servings: 6,
    groups: [{ name: '', items: [{ amount: '800', unit: 'g', item: 'beef', note: 'diced' }, { amount: '6', unit: '', item: 'onions', note: '' }] }],
  }), { cover: picture(true), steps: {} });
  const now = (await R.recipe('family', id, nora))!;
  assert.notEqual(now.cover!.key, oldCover);
  assert.equal(now.steps[0]!.image, null);
  assert.equal(now.servings, 6);
  // Still Nora's, written when she wrote it.
  assert.equal(now.author, 'Nora Alder');
  assert.equal(now.at, was.at);
  assert.equal(now.editable, true);
  for (const k of [oldCover, oldSmall, oldStep]) assert.equal(await stored(k), false, k);
  assert.equal(await count('recipe_image', `story = '${id}'`), 1);
  const h = await d().get<{ action: string; fields: string }>("SELECT action, fields FROM history WHERE record = ? ORDER BY id DESC", id);
  assert.equal(h!.action, 'changed');
  const f = JSON.parse(h!.fields) as { f: Record<string, unknown>; o?: string[] };
  assert.deepEqual(f.f.servings, [4, 6]);
  // The pictures are recorded as changed, without their keys.
  assert.ok(f.o?.includes('cover'));
  // A step may only name one of this recipe's own pictures: somebody else's key is dropped.
  const other = (await R.cookbook('family', nora)).find((r) => r.title === 'Ben’s chilli')!.cover!.key;
  await R.saveRecipe('family', nora, goulash({ id, servings: 6, steps: [{ text: 'Brown the beef.', image: other }] }), { steps: {} });
  assert.equal((await R.recipe('family', id, nora))!.steps[0]!.image, null);
  assert.ok(await stored(other));
});

test('the steps’ pictures are counted, kept and new together, before anything is uploaded', async () => {
  const five = Array.from({ length: 5 }, (_, n) => ({ text: `Step ${n + 1}.`, image: `new:${n}` }));
  const { id: soup } = await R.saveRecipe('family', nora, goulash({ title: 'Soup', steps: five }), { steps: Object.fromEntries(five.map((_, n) => [n, picture()])) });
  const kept = (await R.recipe('family', soup, nora))!.steps.map((s) => ({ text: s.text, image: s.image }));
  assert.equal(kept.filter((s) => s.image).length, 5);
  const puts = db.media.put;
  let uploaded = 0;
  db.media.put = (async (...a: Parameters<typeof puts>) => { uploaded += 1; return puts(...a); }) as typeof puts;
  try {
    await assert.rejects(
      R.saveRecipe('family', nora, goulash({ id: soup, title: 'Soup', steps: [...kept, { text: 'Six.', image: 'new:0' }, { text: 'Seven.', image: 'new:1' }] }), { steps: { 0: picture(), 1: picture() } }),
      /recipes\.err\.too_many_pictures/,
    );
  } finally {
    db.media.put = puts;
  }
  assert.equal(uploaded, 0, 'nothing was uploaded');
  assert.equal(await count('recipe_image', `story = '${soup}'`), 5);
  // One more is still allowed.
  await R.saveRecipe('family', nora, goulash({ id: soup, title: 'Soup', steps: [...kept, { text: 'Six.', image: 'new:0' }] }), { steps: { 0: picture() } });
  assert.equal(await count('recipe_image', `story = '${soup}'`), 6);
});

test('two saves that change only the cover do not both win: the second decides again, and no picture is left behind', async () => {
  const { id: pie } = await R.saveRecipe('family', nora, goulash({ title: 'Pie', cover: 'new' }), { cover: picture(), steps: {} });
  const write = d().batch.bind(d());
  let theirs = '';
  d().batch = (async (qs: Parameters<typeof write>[0]) => {
    if (!theirs && qs.some((x) => /INSERT INTO recipe \(/.test(x.sql))) {
      d().batch = write;
      await R.saveRecipe('family', eda, goulash({ id: pie, title: 'Pie', cover: 'new' }), { cover: picture(), steps: {} });
      theirs = (await R.recipe('family', pie, nora))!.cover!.key;
    }
    return write(qs);
  }) as typeof write;
  try {
    await R.saveRecipe('family', nora, goulash({ id: pie, title: 'Pie', cover: 'new' }), { cover: picture(), steps: {} });
  } finally {
    d().batch = write;
  }
  const now = (await R.recipe('family', pie, nora))!;
  assert.ok(theirs && now.cover!.key !== theirs, 'the later save wins');
  assert.equal(await count('recipe_image', `story = '${pie}'`), 1, 'only the cover it names');
  assert.equal(await stored(theirs), false, 'the replaced cover is deleted, not left behind');
});

test('a recipe from before the form becomes a structured one, and stays its writer’s', async () => {
  const before = (await R.recipe('family', 'old', nora))!;
  assert.equal(before.structured, false);
  assert.equal(before.body, 'Flour, plums, patience.');
  // Nobody's account wrote it, so only an editor may give it its form.
  assert.equal(before.editable, false);
  await R.saveRecipe('family', eda, goulash({ id: 'old', title: 'Plum cake', source: '', tags: ['cake'], notes: 'Flour, plums, patience.' }), { steps: {} });
  const after = (await R.recipe('family', 'old', nora))!;
  assert.equal(after.structured, true);
  assert.equal(after.author, 'Jonas');
  assert.equal(after.at, '2021-06-02T10:00:00.000Z');
  assert.deepEqual(after.tags, ['cake']);
});

test('removing a recipe hides its pictures; Undo brings the recipe and its pictures back', async () => {
  const cover = (await R.recipe('family', id, nora))!.cover!.key;
  await S.removeStory('family', id, { key: 'removal-0001', user: 'acc-eda', payload: { id } });
  assert.equal(await R.recipe('family', id, nora), null);
  assert.equal(await count('recipe', `story = '${id}'`), 0);
  // The picture is still stored, but nobody is served it.
  assert.ok(await stored(cover));
  assert.equal(await R.recipePicture('family', cover, false), undefined);
  assert.equal(await count('recipe_image', `story = '${id}' AND gone_at IS NOT NULL`), 1);
  // A sweep the next day leaves it: the removal can still be undone.
  assert.equal(await R.sweepRecipeImages('family', new Date(Date.now() + 86_400_000)), 0);

  await S.restoreStory('family', 'removal-0001', 'acc-eda');
  const back = (await R.recipe('family', id, nora))!;
  assert.equal(back.title, 'Goulash');
  assert.equal(back.cover!.key, cover);
  assert.equal(back.servings, 6);
  assert.deepEqual(await R.recipePicture('family', cover, false), { key: cover, mime: 'image/png' });
});

test('the daily job deletes the pictures of a recipe that stayed removed for 31 days, and only those', async () => {
  const chilli = (await R.cookbook('family', nora)).find((r) => r.title === 'Ben’s chilli')!;
  const small = (await R.recipePicture('family', chilli.cover!.key, true))!.key;
  await S.removeStory('family', chilli.id, undefined);
  assert.equal(await R.sweepRecipeImages('family', new Date(Date.now() + 30 * 86_400_000)), 0);
  assert.equal(await R.sweepRecipeImages('family', new Date(Date.now() + 32 * 86_400_000)), 1);
  assert.equal(await stored(chilli.cover!.key), false);
  assert.equal(await stored(small), false);
  // The goulash, which is there, keeps its cover.
  assert.ok(await stored((await R.recipe('family', id, nora))!.cover!.key));
  // A recipe goes with its person, and its pictures are marked then too.
  const { id: gone } = await R.saveRecipe('family', nora, goulash({ person: 'ben', title: 'Ben’s bread', cover: 'new' }), { cover: picture(), steps: {} });
  await d().run("DELETE FROM person WHERE id = 'ben'");
  assert.equal(await count('recipe_image', `story = '${gone}' AND gone_at IS NOT NULL`), 1);
});

test('the Markdown archive writes a recipe readably; GEDCOM has none of it', async () => {
  const tree = await readTree(d());
  const { files, losses } = markdownArchive(tree);
  const note = files.find((f) => f.path === 'memories/hilde.md')!.data as string;
  assert.match(note, /## Goulash/);
  assert.match(note, /\*Recipe, written by Nora Alder on \d{4}-\d\d-\d\d\*/);
  assert.match(note, /\*Oma Hilde’s · Serves 6 · Preparation 20 min · Cooking 2 h 30 min\*/);
  assert.match(note, /\*\*Ingredients\*\*\n\n- 800 g beef, diced\n- 3 onions/);
  assert.match(note, /\*\*Method\*\*\n\n1\. Brown the beef\./);
  assert.match(note, /\*Tags: stew, Sunday\. With 1 picture, kept in Kindred\.\*/);
  // The recipe from before the form is there as it always was, now with its form.
  assert.match(note, /## Plum cake/);
  assert.ok(losses.some((l) => /recipe picture/.test(l)), losses.join('\n'));
  const ged = writeGedcom(tree).text;
  assert.equal(/Goulash|beef/.test(ged), false);
});
