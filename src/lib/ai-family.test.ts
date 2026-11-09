// node --test src/lib/ai-family.test.ts — the assistant's family drafts and what each role may be offered. A batch of new
// people applies in one go and links to each other and to people in the tree; a retry replays instead of writing twice;
// a loop is reported and the rest applied; an approximate date stays approximate; a viewer or contributor is offered no
// more than their role allows and the server refuses the rest; no tool manages access or AI settings.
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

test('a memory told in a session is saved under its teller and names its approver; without one it is the approver’s', async () => {
  const stories = async (given: string) => (await db(TREE).all<{ author: string; context: string | null; body: string }>(
    'SELECT author, context, body FROM story WHERE person = (SELECT id FROM person WHERE given = ?)', given,
  )).map((r) => ({ ...r }));
  const out = await family.applyFamilyBatch({
    tree: TREE, user: 'u-a', author: 'Anna Approver', role: 'editor', locale: 'de',
    batch: {
      people: [
        { key: key('told'), ref: 'n40', given: 'Told', living: false, story: { kind: 'memory', body: 'Sie sang im Chor.', teller: 'ingrid' } },
        { key: key('own'), ref: 'n41', given: 'Own', living: false, story: { kind: 'memory', body: 'Mine.' } },
        { key: key('mine'), ref: 'n42', given: 'Mineself', living: false, story: { kind: 'memory', body: 'Told by the approver.', teller: 'hans' } },
      ],
      links: [],
    },
    me: 'hans',
  });
  assert.ok(out.people.every((p) => p.id), 'all three are added');
  assert.deepEqual(await stories('Told'), [{ author: 'Ingrid Braun', context: 'Aus einer Familiensitzung, bestätigt von Anna Approver', body: 'Sie sang im Chor.' }]);
  assert.deepEqual(await stories('Own'), [{ author: 'Anna Approver', context: null, body: 'Mine.' }]);
  assert.deepEqual(await stories('Mineself'), [{ author: 'Anna Approver', context: null, body: 'Told by the approver.' }], 'telling it yourself is your own memory');

  const before = await countPeople();
  const gone = await family.applyFamilyBatch({
    tree: TREE, user: 'u-a', author: 'Anna Approver', role: 'editor',
    batch: { people: [{ key: key('gone'), ref: 'n43', given: 'Gone', living: false, story: { kind: 'note', body: 'x', teller: 'nobody' } }], links: [] },
  });
  assert.deepEqual(gone.people, [{ ref: 'n43', error: 'ai.famTellerGone' }], 'a teller who is not in the tree is reported');
  assert.equal(await countPeople(), before, 'and the person is not half written');
});

test('the draft names a memory’s teller from the tree: the speaker the model named, else the session’s speaker, never an unknown id', async () => {
  const propose = async (session: boolean, teller?: string) => {
    const out: import('./ai/types.ts').Proposal[] = [];
    await tools.runTool({ tree: TREE, role: 'editor', me: 'ingrid', session, locale: 'en' }, 'propose_family', {
      people: [{ ref: 'n50', given: 'Tilda', living: false, story: { kind: 'memory', body: 'A line.', ...(teller ? { teller } : {}) } }], links: [],
    }, out);
    return out[0];
  };
  const tellerOf = (p: import('./ai/types.ts').Proposal) => (p.args as { people: { story: { teller?: string } }[] }).people[0].story.teller;
  const named = await propose(true, 'hans');
  assert.equal(tellerOf(named), 'hans');
  assert.equal(named.view?.names?.hans, 'Hans Braun', 'the card can say who told it');
  assert.equal(tellerOf(await propose(true)), 'ingrid', 'the session’s speaker, when the model named nobody');
  assert.equal(tellerOf(await propose(true, 'nobody')), 'ingrid', 'an id not in the tree is not kept');
  assert.equal(tellerOf(await propose(false)), undefined, 'outside a session it is the reader’s own');
});

test('the card shows the words it asks you to approve, and who they will be saved under', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { FamilyDraft } = await load<typeof import('../components/assistant/FamilyDraft.tsx')>('/src/components/assistant/FamilyDraft.tsx');
  const proposal = {
    id: 'p1', kind: 'family', summary: 'Add 1', status: 'open', editable: [], diff: [],
    args: { people: [{ ref: 'n1', given: 'Tilda', living: false, story: { kind: 'memory', body: 'Sie sang im Chor.', teller: 'hans' } }, { ref: 'n2', given: 'Ulla', living: false, story: { kind: 'note', body: 'Eine Notiz.' } }], links: [] },
    view: { names: { hans: 'Hans Braun' } },
  } as unknown as import('./ai/types.ts').Proposal;
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FamilyDraft, { tree: TREE, conv: 'c1', itemId: 'i1', proposal , onDecided: () => {} })));
  assert.match(html, /Sie sang im Chor\./, 'the memory itself is on the card');
  assert.match(html, /Told by Hans Braun/);
  assert.match(html, /Will be saved under your name/, 'a memory with no teller says so');
});

test('the uncertain lines show on the person they belong to, marked as uncertain, with a way to leave them out', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { FamilyDraft } = await load<typeof import('../components/assistant/FamilyDraft.tsx')>('/src/components/assistant/FamilyDraft.tsx');
  const proposal = {
    id: 'p1', kind: 'family', summary: 'Add 2', status: 'open', editable: [], diff: [],
    args: {
      people: [
        { ref: 'n1', given: 'Tilda', living: false, unsure: ['Birth year is smudged', 'Surname may be Beck'], details: [{ type: 'phone', value: { number: '1' } }] },
        { ref: 'n2', given: 'Ulla', living: false, unsure: ['Age read as 40'] },
        { ref: 'n3', given: 'Vera', living: false },
      ],
      links: [],
    },
  } as unknown as import('./ai/types.ts').Proposal;
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FamilyDraft, { tree: TREE, conv: 'c1', itemId: 'i1', proposal, onDecided: () => {} })));
  const row = (given: string, next: string) => html.slice(html.indexOf(given), next ? html.indexOf(next) : undefined);
  assert.match(row('Tilda', 'Ulla'), /Not certain[\s\S]*Birth year is smudged[\s\S]*Surname may be Beck/);
  assert.match(row('Tilda', 'Ulla'), /aria-label="Leave these and the other details out"/);
  assert.match(row('Ulla', 'Vera'), /Age read as 40/);
  assert.match(row('Ulla', 'Vera'), /aria-label="Leave these out"/, 'with no other details, the button says only what it removes');
  assert.doesNotMatch(row('Vera', ''), /Not certain/, 'a person with nothing uncertain has no such block');
});

test('the card lists each detail as it will be saved, with its label and level', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { FamilyDraft } = await load<typeof import('../components/assistant/FamilyDraft.tsx')>('/src/components/assistant/FamilyDraft.tsx');
  const proposal = {
    id: 'p1', kind: 'family', summary: 'Add 1', status: 'open', editable: [], diff: [],
    args: {
      people: [{
        ref: 'n1', given: 'Tilda', living: false,
        details: [
          { type: 'phone', value: { number: ' +49 555 ', stray: 'NOT_A_PART' } },
          { type: 'address', label: 'holiday', value: { street: 'Mühlweg 3', city: 'Ulm' } },
          { type: 'email', value: { address: 'not-an-address' } },
        ],
      }],
      links: [],
    },
  } as unknown as import('./ai/types.ts').Proposal;
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FamilyDraft, { tree: TREE, conv: 'c1', itemId: 'i1', proposal, onDecided: () => {} })));
  const [phone, address, email] = html.split('class="ai-fam-detail"').slice(1);
  assert.match(phone, /Phone/);
  assert.match(phone, /Mobile/, 'with no label of its own, the label the server will give it');
  assert.match(phone, />\+49 555</, 'one part reads as just its value, trimmed');
  assert.match(phone, /fv-vis-family/);
  assert.doesNotMatch(html, /NOT_A_PART/, 'a part the type does not keep is not shown as if it were saved');
  assert.match(address, /Holiday/);
  assert.match(address, /Street: Mühlweg 3 · [^<:]+: Ulm/);
  assert.match(address, /fv-vis-editors/, 'an address starts at the editors level');
  assert.match(address, /aria-label="Remove Address"/);
  assert.match(email, /Not an email address\./);
  assert.match(email, /will not be saved/, 'a detail the server would skip says so');
});

test('editing or removing one detail changes what is sent, and only that detail', async () => {
  const { cleanPerson, patchDetail, dropDetail, detailPreview, detailKeys } = await load<typeof import('../components/assistant/family-draft.ts')>('/src/components/assistant/family-draft.ts');
  const details: import('../components/assistant/family-draft.ts').DraftDetail[] = [
    { type: 'phone', label: 'home', value: { number: '111' } },
    { type: 'occupation', value: { title: 'Miller', employer: 'The mill' } },
  ];
  const person = { ref: 'n1', given: 'Tilda', living: false, unsure: ['Birth year is smudged'] };

  const edited = patchDetail(patchDetail(details, 0, { key: 'number', value: ' 222 ' }), 0, { label: 'work' });
  assert.deepEqual(cleanPerson({ ...person, details: edited }).details, [
    { type: 'phone', label: 'work', value: { number: '222' } },
    { type: 'occupation', label: undefined, value: { title: 'Miller', employer: 'The mill' } },
  ]);
  assert.equal(details[0].value.number, '111', 'the draft as proposed is not changed in place');

  const removed = cleanPerson({ ...person, details: dropDetail(details, 0) });
  assert.deepEqual(removed.details?.map((d) => d.type), ['occupation']);
  assert.deepEqual(removed.unsure, person.unsure, 'removing one detail leaves the uncertain lines alone');

  assert.equal(detailPreview(details[1]).label, 'job', 'a blank label is the type’s own, as the server stores it');
  assert.deepEqual(detailPreview({ type: 'phone', label: '  ', value: { number: '1' } }).label, 'mobile');
  assert.deepEqual(detailKeys({ type: 'religion', value: {} }), ['name', 'leftOn'], 'the left-this-faith flag is not a text box');
  assert.equal(detailPreview({ type: 'dates', value: { date: 'soon' } }).issue, 'date');
});

test('a failed link keeps the card open and retryable, and a link left out is neither sent nor counted', async () => {
  const { draftProgress, linksToSend, cleanPerson } = await load<typeof import('../components/assistant/family-draft.ts')>('/src/components/assistant/family-draft.ts');
  const rows = [
    { ref: 'n1', given: 'A', living: true, status: 'done' as const, id: 'a1' },
    { ref: 'n2', given: 'B', living: true, status: 'done' as const, id: 'b1' },
  ];
  const failed = { uid: 'l0', anchor: 'n1', person: 'n2', relation: 'partner' as const, status: 'failed' as const, error: 'no' };
  const loop = { uid: 'l1', anchor: 'n1', person: 'otto', relation: 'parent' as const, status: 'todo' as const };
  const leftOut = new Set(['l1']);

  const stuck = draftProgress(rows, [failed, loop], leftOut);
  assert.deepEqual(
    { people: [stuck.peopleDone, stuck.peopleTotal], links: [stuck.linksDone, stuck.linksTotal], unfinished: stuck.unfinished, failed: stuck.failed, settled: stuck.settled },
    { people: [2, 2], links: [0, 1], unfinished: 1, failed: true, settled: false },
    'two people added and one link failed is not finished, so a retry is open',
  );

  const sent = linksToSend(rows, [failed, loop], leftOut, new Set());
  assert.deepEqual(sent.map((l) => l.uid), ['l0'], 'the failed link is sent again and the left-out link never is');
  assert.deepEqual(sent[0].payload, { anchor: 'a1', person: 'b1', relation: 'partner' }, 'by the ids the people got');

  assert.equal(draftProgress(rows, [loop], leftOut).settled, true, 'with the failed link removed, a left-out link does not hold the card open');
  assert.equal(draftProgress(rows.map((r) => ({ ...r, status: 'todo' as const })), [], leftOut).settled, false, 'nothing added yet is not finished');

  const person = { ref: 'n3', given: ' C ', living: true };
  assert.equal(cleanPerson({ ...person, story: { kind: 'memory', body: '   ' } }).story, undefined, 'a memory emptied on the card is not sent');
  assert.deepEqual(cleanPerson({ ...person, story: { kind: 'memory', title: ' ', body: ' Edited. ', teller: '' } }).story, { kind: 'memory', title: undefined, body: 'Edited.', teller: undefined });
});

test('a family session is refused before any spend for a role that could not apply its draft', async () => {
  const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
  const chat = (await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts')).withLatestChat(await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts'));
  const rows = async () => (await accounts().get<{ n: number }>('SELECT count(*) AS n FROM ai_chat'))!.n;
  const before = await rows();
  for (const role of ['viewer', 'contributor'] as Role[]) {
    await assert.rejects(chat.sendMessage({ tree: TREE, user: 'u-v', role, me: null, text: 'x'.repeat(20_000), locale: 'en', session: true }), /ai\.famRefused/, `${role} may not send a session`);
  }
  assert.equal(await rows(), before, 'nothing was recorded, so nothing was spent');
});

test('no tool manages access or invitations, or changes AI settings or keys', async () => {
  const offered = tools.toolsFor('steward', { web: true, faces: true, avatar: true }).tools.map((t) => t.name);
  for (const name of offered) {
    assert.doesNotMatch(name, /invite|access|token|secret|api_?key|ai_?setting|grant/i, `${name} must not manage access or AI settings`);
  }
  assert.ok(!PROPOSAL_KINDS.some((k) => /access|invite|key|setting/.test(k) && !k.includes('house')), 'no proposal kind manages access');
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
  const third = await tools.runTool({ ...ctx, faces: true, images: [], looks: 2 }, 'describe_photo', { key: 'gallery/p1.jpg' }, out);
  assert.match(third, /Only two pictures/, 'the limit is per reply: the list of pictures is emptied after every step, the count is not');
});

test('one draft approved from two sessions, even in two languages, writes once', async () => {
  const { approvalKeys } = await load<typeof import('../components/assistant/approval-keys.ts')>('/src/components/assistant/approval-keys.ts');
  const { once } = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
  const proposalId = crypto.randomUUID();
  const row = { ref: 'n1', given: 'Mina', surname: 'Twice', born: '1950', living: true, story: { kind: 'memory' as const, title: 'Pier', body: 'She fished.' }, unsure: ['maybe a Vogel'] };
  const link = { anchor: 'ingrid', person: 'n1', relation: 'sibling' as const };
  // Each session has its own freshly mounted card: nothing is shared between them except the stored proposal.
  const session = () => {
    const keys = approvalKeys(proposalId);
    return { people: [{ ...row, key: keys.for('person:n1', row) }], links: [{ ...link, key: keys.for('link:l0', link) }] };
  };
  const run = (locale: string) => family.applyFamilyBatch({ tree: TREE, user: 'u-twice', author: 'Anna', role: 'editor', locale, batch: session() });
  const people = await countPeople();
  const count = async (sql: string) => (await db(TREE).get<{ n: number }>(sql))!.n;
  const stories = () => count("SELECT count(*) AS n FROM story WHERE body LIKE 'She fished.%'");
  const first = await run('en');
  const second = await run('de');
  assert.ok(first.people[0].id, JSON.stringify(first));
  assert.equal(second.people[0].error, undefined, 'the second session replays rather than being refused');
  assert.equal(second.people[0].id, first.people[0].id);
  assert.ok(second.links[0].ok, JSON.stringify(second.links));
  assert.equal(await countPeople(), people + 1, 'one person');
  assert.equal(await stories(), 1, 'one memory');

  // A card that is not a family draft: the same args from two sessions are one change.
  const args = { person: 'hans', kind: 'memory', body: 'One card, two tabs.' };
  let wrote = 0;
  const approve = () => once(TREE, { key: approvalKeys(proposalId).for('add-story', args), user: 'u-twice', payload: args }, 'addStory', () => {
    wrote++;
    return { writes: [], result: 'stored' };
  });
  assert.equal(await approve(), 'stored');
  assert.equal(await approve(), 'stored');
  assert.equal(wrote, 1, 'the second session replays the first');
});

test('a field the assistant adds from a family draft records the editor who approved it as its author', async () => {
  const out = await family.applyFamilyBatch({
    tree: TREE, user: 'u-approver', author: 'Anna', role: 'editor',
    batch: { people: [{ key: key('field-author'), ref: 'n1', given: 'Berta', surname: 'Braun', living: true, social: [{ network: 'Mastodon', handle: 'berta_b' }] }], links: [] },
  });
  const row = await db(TREE).get<{ created_by: string | null; created_by_name: string }>('SELECT created_by, created_by_name FROM person_field WHERE person = ?', out.people[0].id!);
  assert.deepEqual({ ...row }, { created_by: 'u-approver', created_by_name: 'Anna' });
});

test('a link is the same link whether or not this tab has already added its row', async () => {
  const { linkIdentity, linksToSend } = await load<typeof import('../components/assistant/family-draft.ts')>('/src/components/assistant/family-draft.ts');
  const row = (ref: string, extra: object = {}) => ({ ref, given: ref, living: true, status: 'todo' as const, ...extra });
  const link = { uid: 'l0', anchor: 'n1', person: 'n2', relation: 'partner' as const, status: 'todo' as const };
  const addedHere = [row('n1', { status: 'done', id: 'real-id' }), row('n2')];
  const notAddedHere = [row('n1'), row('n2')];
  const sent = (rows: typeof addedHere, sending: string[]) => linksToSend(rows as never, [link] as never, new Set(), new Set(sending))[0].payload;
  assert.notDeepEqual(sent(addedHere, ['n2']), sent(notAddedHere, ['n1', 'n2']), 'what is sent differs between the two tabs');
  assert.deepEqual(linkIdentity(addedHere as never, link as never), linkIdentity(notAddedHere as never, link as never), 'the identity behind the key does not');
  assert.notDeepEqual(linkIdentity([row('n1', { existing: 'ada' }), row('n2')] as never, link as never), linkIdentity(notAddedHere as never, link as never), 'pointing a row at someone in the tree is another link');
});
