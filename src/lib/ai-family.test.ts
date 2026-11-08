// node --test src/lib/ai-family.test.ts — the assistant's family drafts and what each role may be offered. A batch of new
// people applies in one go and links to each other and to people in the tree; a retry replays instead of writing twice;
// a loop is reported and the rest applied; an approximate date stays approximate; a viewer or contributor is offered no
// more than their role allows and the server refuses the rest; no tool deletes or manages access or AI settings.
// Runs on a private data folder with the fake provider, never on data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { Role } from './roles.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-family-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-family-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { db, graph } = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const family = await load<typeof import('./ai/family.server.ts')>('/src/lib/ai/family.server.ts');
const tools = await load<typeof import('./ai/tools.server.ts')>('/src/lib/ai/tools.server.ts');
const { PROPOSAL_KINDS } = await load<typeof import('./ai/types.ts')>('/src/lib/ai/types.ts');

const TREE = 'famtest';
const seedTree = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
seedTree.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Braun family'), ('tagline', ''), ('theme', 'codex'), ('focus', '');
  INSERT INTO person (id, given, surname, born, living, sex) VALUES
    ('otto', 'Otto', 'Braun', '1905', 0, 'm'),
    ('elsa', 'Elsa', 'Braun', '1910', 0, 'f'),
    ('ingrid', 'Ingrid', 'Braun', '1936', 1, 'f'),
    ('hans', 'Hans', 'Braun', '1930', 0, 'm');
  INSERT INTO parent (child, parent) VALUES ('ingrid', 'otto'), ('ingrid', 'elsa');
`);
seedTree.close();

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A key for one step of an approval: unique and long enough for the server's rule. */
let n = 0;
const key = (label: string) => `${label}-${Date.now().toString(36)}-${(n++).toString(36)}`.padEnd(12, 'x');

const personRow = (id: string) => db(TREE).get<{ id: string; given: string; surname: string | null; born: string | null; occupation: string | null }>(
  'SELECT id, given, surname, born, occupation FROM person WHERE id = ?', id,
);
const countPeople = async () => (await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM person'))!.n;
const parentsOf = async (id: string) => (await db(TREE).all<{ parent: string }>('SELECT parent FROM parent WHERE child = ? ORDER BY parent', id)).map((r) => r.parent);

test('a family draft: new people link to each other and to the tree, and a retry replays instead of writing twice', async () => {
  const batch = {
    people: [
      { key: key('kurt'), ref: 'n1', given: 'Kurt', surname: 'Braun', born: '~1938', living: false },
      { key: key('greta'), ref: 'n2', given: 'Greta', surname: 'Vogel', born: '1940', living: false },
      { key: key('lotte'), ref: 'n3', given: 'Lotte', surname: 'Braun', born: '1965', living: true, occupation: 'Baker', story: { kind: 'memory' as const, title: 'Bread', body: 'Baked every Friday.' } },
    ],
    links: [
      { key: key('l-sib'), anchor: 'ingrid', person: 'n1', relation: 'sibling' as const },
      { key: key('l-partner'), anchor: 'n2', person: 'n1', relation: 'partner' as const },
      { key: key('l-child'), anchor: 'n1', person: 'n3', relation: 'child' as const, coParent: 'n2' },
    ],
  };
  const run = () => family.applyFamilyBatch({ tree: TREE, user: 'u-editor', author: 'Anna', role: 'editor', batch: { people: batch.people, links: batch.links } });
  const before = await countPeople();
  const first = await run();
  assert.ok(first.people.every((p) => p.id), 'every new person is created: ' + JSON.stringify(first.people));
  assert.ok(first.links.every((l) => l.ok), 'every link applies: ' + JSON.stringify(first.links));
  assert.equal(await countPeople(), before + 3);

  const id = (ref: string) => first.people.find((p) => p.ref === ref)!.id!;
  const kurt = await personRow(id('n1'));
  assert.equal(kurt!.born, '~1938', 'an approximate date stays approximate');
  assert.deepEqual(await parentsOf(id('n1')), ['elsa', 'otto'], 'a sibling of Ingrid shares her parents');
  assert.deepEqual(await parentsOf(id('n3')), [id('n1'), id('n2')].sort(), 'the child has both new parents');
  const lotte = await personRow(id('n3'));
  assert.equal(lotte!.occupation, 'Baker');
  const story = await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM story WHERE person = ? AND author = ?', id('n3'), 'Anna');
  assert.equal(story!.n, 1, 'the memory is written once, signed by the approver');

  // Retry the same approval: every step replays the stored result, so nothing is written again.
  const again = await run();
  assert.deepEqual(again.people.map((p) => p.id), first.people.map((p) => p.id), 'a retry gives the same ids');
  assert.equal(await countPeople(), before + 3, 'a retry does not add people');
  assert.equal((await db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM story WHERE person = ?', id('n3')))!.n, 1);
  assert.deepEqual(await parentsOf(id('n3')), [id('n1'), id('n2')].sort(), 'a retry does not change the links');
});

test('a cycle in a draft is reported, the rest of the draft still applies, and the draft check finds it before approval', async () => {
  const people = [
    { key: key('ana'), ref: 'n4', given: 'Ana', living: true },
    { key: key('ben'), ref: 'n5', given: 'Ben', living: true },
    { key: key('mia'), ref: 'n6', given: 'Mia', living: true },
  ];
  const links = [
    { key: key('c1'), anchor: 'n4', person: 'n5', relation: 'child' as const },
    { key: key('c2'), anchor: 'n5', person: 'n4', relation: 'child' as const },
    { key: key('c3'), anchor: 'n6', person: 'ingrid', relation: 'partner' as const },
  ];
  // The draft check on the card sees the loop before anything is approved.
  const g = await graph(TREE);
  assert.deepEqual(family.checkFamily(g, people, links).loops, [1], 'the second link would loop');

  const out = await family.applyFamilyBatch({ tree: TREE, user: 'u-editor', author: 'Anna', role: 'editor', batch: { people, links } });
  const ana = out.people.find((p) => p.ref === 'n4')!.id!;
  const ben = out.people.find((p) => p.ref === 'n5')!.id!;
  assert.ok(out.links[0].ok, 'the first link applies');
  assert.equal(out.links[1].ok, false);
  assert.match(out.links[1].error ?? '', /loop in the ancestry/, 'the refused link says why');
  assert.ok(out.links[2].ok, 'the link after the loop still applies');
  // 'child' reads as: the person is the anchor's child. So Ben is Ana's child, and the reverse link would loop.
  assert.deepEqual(await parentsOf(ben), [ana], 'Ben is Ana’s child');
  assert.deepEqual(await parentsOf(ana), [], 'the loop was not applied: Ana has no parent');
  assert.deepEqual(await parentsOf(out.people.find((p) => p.ref === 'n6')!.id!), [], 'the partner link adds no parent');
});

test('a possible duplicate is flagged on the card, with the existing person', async () => {
  const g = await graph(TREE);
  const checks = family.checkFamily(g, [{ ref: 'n7', given: 'Hans', surname: 'Braun', born: '1930', living: false }], []);
  assert.equal(checks.duplicates.length, 1);
  assert.equal(checks.duplicates[0].id, 'hans');
  const other = family.checkFamily(g, [{ ref: 'n8', given: 'Hans', surname: 'Braun', born: '1938', living: false }], []);
  assert.equal(other.duplicates.length, 0, 'a different birth year is not the same person');
});

test('a draft proposed by the assistant carries its warnings and questions, and is applied only when approved', async () => {
  const ctx = { tree: TREE, role: 'editor' as Role, me: null, locale: 'en' as const };
  const out: import('./ai/types.ts').Proposal[] = [];
  const reply = await tools.runTool(ctx, 'propose_family', {
    people: [{ ref: 'n9', given: 'Hans', surname: 'Braun', born: '1930', living: false }, { ref: 'n10', given: 'Ruth', living: true, born: '1975' }],
    links: [{ anchor: 'n10', person: 'hans', relation: 'child' }],
    questions: ['Which Hans is meant?'],
  }, out);
  assert.match(reply, /"proposed":true/);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'family');
  assert.equal(out[0].view?.duplicates?.[0]?.id, 'hans', 'the card names the likely duplicate');
  assert.deepEqual(out[0].view?.questions, ['Which Hans is meant?']);
  assert.equal(out[0].view?.names?.hans, 'Hans Braun');
  // Nothing was written by proposing.
  assert.equal(await personRow('n9'), undefined);
  assert.equal((await db(TREE).get<{ n: number }>("SELECT count(*) AS n FROM person WHERE given = 'Ruth'"))!.n, 0);
});

test('a viewer and a contributor are offered no change beyond their role, and the server refuses it anyway', async () => {
  const everything = { web: true, faces: true, avatar: true };
  const names = (role: Role) => tools.toolsFor(role, everything).tools.map((t) => t.name);
  for (const role of ['viewer', 'contributor'] as Role[]) {
    const offered = names(role);
    for (const forbidden of ['propose_family', 'propose_add_person', 'propose_set_dates', 'propose_add_field', 'propose_avatar', 'propose_set_occupation', 'propose_house_settings']) {
      assert.ok(!offered.includes(forbidden), `${role} is not offered ${forbidden}`);
    }
  }
  assert.ok(names('contributor').includes('propose_photo_details'), 'a contributor may propose photo details');
  assert.ok(!names('viewer').some((x) => x.startsWith('propose_')), 'a viewer is offered no proposal at all');
  assert.ok(names('steward').includes('propose_house_settings'), 'only a steward is offered house settings');
  assert.ok(!names('editor').includes('propose_house_settings'), 'an editor is not offered house settings');

  const out = await family.applyFamilyBatch({
    tree: TREE, user: 'u-contrib', author: 'Carl', role: 'contributor',
    batch: { people: [{ key: key('cc'), ref: 'n11', given: 'Carl', living: true }], links: [] },
  });
  assert.equal(out.people[0].error, 'ai.famRefused', 'the server refuses a person from a contributor');
  assert.equal(await personRow('n11'), undefined);

  const viaTool = await tools.runTool({ tree: TREE, role: 'viewer', me: null, locale: 'en' }, 'propose_family', { people: [], links: [] }, []);
  assert.match(viaTool, /may not make that change/);
});

test('no tool deletes, manages access or invitations, or changes AI settings or keys', async () => {
  const offered = tools.toolsFor('steward', { web: true, faces: true, avatar: true }).tools.map((t) => t.name);
  for (const name of offered) {
    assert.doesNotMatch(name, /delete|remove|invite|access|member|token|secret|api_?key|ai_?setting|grant/i, `${name} must not manage data, access or AI settings`);
  }
  assert.ok(!PROPOSAL_KINDS.some((k) => /delete|remove|access|invite|key|setting/.test(k) && !k.includes('house')), 'no proposal kind deletes or manages access');
});

test('a draft with a date that does not exist is refused before it is shown', async () => {
  const out: import('./ai/types.ts').Proposal[] = [];
  const reply = await tools.runTool({ tree: TREE, role: 'editor', me: null, locale: 'en' }, 'propose_family', {
    people: [{ ref: 'n12', given: 'Odd', living: false, born: '1930-02-30' }], links: [],
  }, out);
  assert.match(reply, /not a real date/);
  assert.equal(out.length, 0);
});

test('photos: a details card changes only what it says, an album card keeps each photo’s details, and the lists are capped and filtered', async () => {
  await db(TREE).run("INSERT INTO album (id, name, at) VALUES ('lake', 'Lake 1960', '2026-01-01T00:00:00Z')");
  await db(TREE).run(
    "INSERT INTO media (key, mime, width, height, taken, place, caption, album, uploaded_by, uploaded_at) VALUES " +
    "('gallery/p1.jpg', 'image/jpeg', 800, 600, '1960', NULL, NULL, 'lake', 'u1', '2026-01-01T00:00:00Z'), " +
    "('gallery/p2.jpg', 'image/jpeg', 800, 600, NULL, 'Hamburg', NULL, NULL, 'u1', '2026-01-02T00:00:00Z')",
  );
  const ctx = { tree: TREE, role: 'contributor' as Role, me: null, locale: 'en' as const };
  const listed = JSON.parse(await tools.runTool(ctx, 'list_photos', { missing: ['date'] }, []));
  assert.deepEqual(listed.photos.map((p: { key: string }) => p.key), ['gallery/p2.jpg'], 'only the photo with no date is listed');
  assert.ok(listed.albums.some((a: { id: string }) => a.id === 'lake'), 'the albums come with their ids');

  const out: import('./ai/types.ts').Proposal[] = [];
  await tools.runTool(ctx, 'propose_photo_details', { items: [{ key: 'gallery/p2.jpg', taken: '1961-05' }] }, out);
  const details = out[0].args.items as { key: string; taken: string; place: string; album: string | null }[];
  assert.equal(details[0].taken, '1961-05');
  assert.equal(details[0].place, 'Hamburg', 'the place the gallery has is kept, not cleared');
  assert.equal(details[0].album, null, 'no album to move');
  assert.equal(out[0].view?.before?.['gallery/p2.jpg']?.taken, null, 'the card shows what it changes from');

  await tools.runTool(ctx, 'propose_photo_album', { name: 'Hamburg trip', keys: ['gallery/p2.jpg'] }, out);
  assert.equal(out[1].kind, 'photo-album');
  assert.equal(out[1].args.name, 'Hamburg trip');
  assert.equal((out[1].args.items as { key: string }[])[0].key, 'gallery/p2.jpg');
  await tools.runTool(ctx, 'propose_photo_album', { albumId: 'lake', keys: ['gallery/p2.jpg'] }, out);
  assert.equal(out[2].args.albumId, 'lake', 'an existing album is used as it is');

  const refused = await tools.runTool(ctx, 'propose_photo_details', { items: [{ key: 'gallery/nope.jpg', caption: 'x' }] }, out);
  assert.match(refused, /not a photo in this family/);
  assert.equal(out.length, 3, 'a refused card is not shown');

  const missing = JSON.parse(await tools.runTool(ctx, 'missing_info', { person: 'ingrid' }, []));
  assert.ok(missing.people.some((p: { id: string }) => p.id === 'otto'), 'a person’s parents are included');
  const all = JSON.parse(await tools.runTool(ctx, 'missing_info', {}, []));
  assert.ok(all.count >= 1 && all.people.length <= 12, 'the list is capped');
  assert.ok(all.people.every((p: { missing: unknown[] }) => p.missing.length > 0), 'only people with gaps are listed');

  const noLook = await tools.runTool(ctx, 'describe_photo', { key: 'gallery/p1.jpg' }, out);
  assert.match(noLook, /Looking at pictures is off/, 'without the faces feature the assistant works from the details only');
});
