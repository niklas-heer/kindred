// node --test src/lib/field-visibility.test.ts — the three levels of a person's fields (personal, editors, family), per role
// and per guest, on every path a field can leave by: the person reads, Contacts, suggestions, the assistant, the exports, the
// D1 transfer. Also the migration of the old flag, an author who loses their role or their access, and a steward refused a
// personal item. These call the real server functions against scratch databases; only "who is asking" and createServerFn are
// replaced, as in auth/share.test.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';
import type { Role } from './roles.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-visibility-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'visibility-test-secret';

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
      export const getRequest = () => new Request('http://localhost/');
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = () => {};
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null, guest: globalThis.__guest });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } },
  ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const store = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const dbs = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const fns = await load<typeof import('./person.functions.ts')>('/src/lib/person.functions.ts');
const api = await load<typeof import('./api.ts')>('/src/lib/api.ts');
const authFns = await load<typeof import('./auth/functions.ts')>('/src/lib/auth/functions.ts');
const suggest = await load<typeof import('./field-suggest.functions.ts')>('/src/lib/field-suggest.functions.ts');
const toolsModule = () => load<typeof import('./ai/tools.server.ts')>('/src/lib/ai/tools.server.ts');
const lookup = await load<typeof import('./ai/lookup.server.ts')>('/src/lib/ai/lookup.server.ts');
const exchange = await load<typeof import('./exchange/model.ts')>('/src/lib/exchange/model.ts');
const exportServer = await load<typeof import('./exchange/export.server.ts')>('/src/lib/exchange/export.server.ts');
const archive = await load<typeof import('./jobs/archive.ts')>('/src/lib/jobs/archive.ts');
const transfer = await import('../../scripts/lib/d1-transfer.ts');
const graphLib = await load<typeof import('./graph.ts')>('/src/lib/graph.ts');
const gaps = await load<typeof import('./gaps.ts')>('/src/lib/gaps.ts');

const TREE = 'levels';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AUTHOR = id(1), OTHER_EDITOR = id(2), STEWARD = id(3), CONTRIBUTOR = id(4), VIEWER = id(5), DEMOTED = id(6), LEAVER = id(7);
const PERSONAL = 'PERSONALMARKER', EDITORS = 'EDITORSMARKER', FAMILY = 'FAMILYMARKER';

const g = globalThis as unknown as { __signedIn?: { id: string; name: string } | null; __guest?: unknown };
const as = (user: string) => { g.__signedIn = { id: user, name: user }; g.__guest = undefined; };
const asGuest = () => { g.__signedIn = null; g.__guest = { link: 'l', tree: TREE, expires: Date.now() + 3_600_000 }; };

let ops = 0;
const opKey = () => `testop-${++ops}-abcdefgh`;
const setRole = (user: string, role: Role) => store.accounts().run('UPDATE membership SET role = ? WHERE user = ? AND tree = ?', role, user, TREE);
const addRow = (fid: string, person: string, type: string, value: object, visibility: string, owner: string | null = null) =>
  dbs.db(TREE).run('INSERT INTO person_field (id, person, type, label, value, visibility, owner) VALUES (?, ?, ?, ?, ?, ?, ?)', fid, person, type, '', JSON.stringify(value), visibility, owner);
const has = async (fid: string) => !!(await dbs.db(TREE).get('SELECT id FROM person_field WHERE id = ?', fid));
const idsFor = async (person: string) => (await fns.getPersonDetail({ data: { tree: TREE, id: person } })).fields.map((f) => f.id).sort();

before(async () => {
  await dbs.provisionFamily(TREE, 'Levels');
  const d = dbs.db(TREE);
  for (const p of ['ada', 'ben', 'cid', 'dee', 'eli']) await d.run('INSERT INTO person (id, given, living, born) VALUES (?, ?, 1, ?)', p, p, '1950');
  await addRow('pn', 'ada', 'notes', { text: PERSONAL }, 'personal', AUTHOR);
  await addRow('ed', 'ada', 'medical', { note: EDITORS }, 'editors');
  await addRow('fa', 'ada', 'favourites', { text: FAMILY }, 'family');
  await addRow('c-p', 'ada', 'phone', { number: `${PERSONAL}-phone` }, 'personal', AUTHOR);
  await addRow('c-e', 'ada', 'phone', { number: `${EDITORS}-phone` }, 'editors');
  await addRow('c-f', 'ada', 'phone', { number: `${FAMILY}-phone` }, 'family');
  await addRow('w-p', 'ada', 'languages', { language: `${PERSONAL}lang` }, 'personal', AUTHOR);
  await addRow('w-f', 'ada', 'languages', { language: `${FAMILY}lang` }, 'family');
  await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', STEWARD, 'steward', 'h-s', Date.now());
  for (const [u, role] of [[AUTHOR, 'editor'], [OTHER_EDITOR, 'editor'], [STEWARD, 'steward'], [CONTRIBUTOR, 'contributor'], [VIEWER, 'viewer'], [DEMOTED, 'editor'], [LEAVER, 'editor']] as const) {
    if (u !== STEWARD) await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', u, u, `h-${u}`, Date.now());
    await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', u, TREE, role, Date.now());
  }
});
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });

const ROLES: [string, string, string[]][] = [
  ['the author', AUTHOR, ['c-e', 'c-f', 'c-p', 'ed', 'fa', 'pn', 'w-f', 'w-p']],
  ['another editor', OTHER_EDITOR, ['c-e', 'c-f', 'ed', 'fa', 'w-f']],
  ['a steward', STEWARD, ['c-e', 'c-f', 'ed', 'fa', 'w-f']],
  ['a contributor', CONTRIBUTOR, ['c-f', 'fa', 'w-f']],
  ['a viewer', VIEWER, ['c-f', 'fa', 'w-f']],
];

for (const [name, user, expected] of ROLES) {
  test(`${name} receives exactly their levels, on the person read and the Edit read`, async () => {
    as(user);
    assert.deepEqual(await idsFor('ada'), expected);
    const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'ada' } });
    assert.deepEqual(snap.fields.map((f) => f.id).sort(), expected);
    const sent = JSON.stringify(snap);
    assert.equal(sent.includes(PERSONAL), user === AUTHOR);
    assert.equal(sent.includes(AUTHOR), false, 'the owner is never sent, not even to the owner');
  });
}

test('a guest with a share link receives no field at all, and no Contacts', async () => {
  asGuest();
  const seen = await fns.getPersonDetail({ data: { tree: TREE, id: 'ada' } });
  assert.deepEqual(seen.fields, []);
  assert.deepEqual(await api.getContacts({ data: { tree: TREE } }), []);
  await assert.rejects(fns.getEditSnapshot({ data: { tree: TREE, id: 'ada' } }));
  assert.equal(JSON.stringify(await api.getGraph({ data: { tree: TREE } })).includes(FAMILY), false);
});

const CONTACTS_FOR: [string, string, string[], number][] = [
  ['the author', AUTHOR, ['c-e', 'c-f', 'c-p'], 3],
  ['another editor', OTHER_EDITOR, ['c-e', 'c-f'], 2],
  ['a steward', STEWARD, ['c-e', 'c-f'], 2],
  ['a contributor', CONTRIBUTOR, ['c-f'], 1],
  ['a viewer', VIEWER, ['c-f'], 1],
];
for (const [name, user, ids, count] of CONTACTS_FOR) {
  test(`${name} finds every contact they may see in Contacts and in the graph's count, with its level`, async () => {
    as(user);
    const list = await api.getContacts({ data: { tree: TREE } });
    assert.deepEqual(list.map((c) => c.id).sort(), ids);
    for (const c of list) assert.equal(c.visibility, c.id === 'c-p' ? 'personal' : c.id === 'c-e' ? 'editors' : 'family');
    const ada = (await api.getGraph({ data: { tree: TREE } })).people.find((p) => p.id === 'ada')!;
    assert.equal(ada.contacts, count);
  });
}

test('a guest’s graph holds the plain count, so the Needed page stays honest, and never a value', async () => {
  asGuest();
  const g = await api.getGraph({ data: { tree: TREE } });
  assert.equal(g.people.find((p) => p.id === 'ada')!.contacts, 1);
});

test('every permitted reader receives each field with its level, so the mark can be shown', async () => {
  as(AUTHOR);
  const levels = Object.fromEntries((await fns.getPersonDetail({ data: { tree: TREE, id: 'ada' } })).fields.map((f) => [f.id, f.visibility]));
  assert.deepEqual({ pn: levels.pn, ed: levels.ed, fa: levels.fa }, { pn: 'personal', ed: 'editors', fa: 'family' });
});

test('the level mark renders, named for screen readers, on a field and a contact', async () => {
  const { renderToString } = await import('react-dom/server');
  const { createElement } = await import('react');
  const view = await load<typeof import('../components/fields/FieldsView.tsx')>('/src/components/fields/FieldsView.tsx');
  const field = (visibility: 'personal' | 'editors' | 'family') => ({ id: 'x', type: 'notes' as const, label: '', value: { text: 'n' }, ord: 0, visibility, updatedAt: '', updatedBy: '' });
  for (const [level, word] of [['personal', 'Personal'], ['editors', 'Editors'], ['family', 'Family']] as const) {
    const row = renderToString(createElement(view.FieldRow, { f: field(level) }));
    assert.match(row, new RegExp(`role="img" aria-label="${word}"`), `${level} on a field`);
    const contact = renderToString(createElement(view.ContactRow, { f: { ...field(level), type: 'phone', value: { number: '1' } } }));
    assert.match(contact, new RegExp(`aria-label="${word}"`), `${level} on a contact`);
  }
});

test('the Needed page does not call a contact missing when the reader may see one', async () => {
  await dbs.db(TREE).run("INSERT INTO person (id, given, living, born) VALUES ('fay', 'Fay', 1, '1950')");
  await addRow('fay-c', 'fay', 'phone', { number: '+27 3' }, 'editors');
  const missing = async (user: string) => {
    as(user);
    const g = await api.getGraph({ data: { tree: TREE } });
    const f = graphLib.buildFamily(g);
    return gaps.gapsOf(f, f.byId.get('fay')!, new Set(['contact'] as const)).includes('contact');
  };
  assert.equal(await missing(OTHER_EDITOR), false, 'an editor sees the contact');
  assert.equal(await missing(STEWARD), false, 'a steward sees the contact');
  assert.equal(await missing(VIEWER), true, 'a viewer does not');
  await dbs.db(TREE).run("DELETE FROM person WHERE id = 'fay'");
});

test('suggestions offer an editor what they may see, and never a personal value, not even to its author', async () => {
  await addRow('w-e', 'ada', 'languages', { language: `${EDITORS}lang` }, 'editors');
  as(AUTHOR);
  const words = JSON.stringify(await suggest.getFamilyWords({ data: { tree: TREE } }));
  assert.ok(words.includes(`${FAMILY}lang`));
  assert.ok(words.includes(`${EDITORS}lang`), 'an editor is offered the editors’ level');
  assert.ok(!words.includes(`${PERSONAL}lang`));
  await dbs.db(TREE).run("DELETE FROM person_field WHERE id = 'w-e'");
});

test('the assistant never receives a personal field, whoever is asking, and editors’ fields only for editors', async () => {
  const tools = await toolsModule();
  for (const role of ['viewer', 'contributor', 'editor', 'steward'] as const) {
    const out = await tools.runTool({ tree: TREE, role, me: null, locale: 'en' }, 'read_person', { id: 'ada' }, []);
    assert.ok(!out.includes(PERSONAL), `${role}: personal`);
    assert.equal(out.includes(EDITORS), role === 'editor' || role === 'steward', `${role}: editors reach those who may see them, and only them`);
    assert.ok(out.includes(FAMILY), `${role}: family`);
  }
});

test('the web lookup guard knows editors’ values, and never holds a personal one', async () => {
  const people = (await dbs.graph(TREE)).people;
  const editor = await lookup.privacyGuard(TREE, people, true);
  assert.equal(lookup.refusal(editor, EDITORS.toLowerCase()), 'private');
  assert.equal(lookup.refusal(editor, PERSONAL.toLowerCase()), null, 'a refusal would tell an editor that it exists');
});

test('a proposed detail takes the family’s default level, whatever the model asked for', async () => {
  const tools = await toolsModule();
  const ctx = { tree: TREE, role: 'editor' as const, me: null, locale: 'en' as const };
  const out: import('./ai/types.ts').Proposal[] = [];
  await tools.runTool(ctx, 'propose_add_field', { person: 'ada', type: 'medical', value: { note: 'x' }, visibility: 'family' }, out);
  await tools.runTool(ctx, 'propose_add_field', { person: 'ada', type: 'phone', value: { number: '+27 1' }, visibility: 'personal' }, out);
  assert.deepEqual(out.map((p) => p.args.visibility), ['editors', 'family']);
});

test('the exports and the nightly archive hold no personal item, not even in their counts', async () => {
  const tree = await exchange.readTree(dbs.db(TREE));
  const total = (await dbs.db(TREE).get<{ n: number }>('SELECT count(*) AS n FROM person_field'))!.n;
  const personal = (await dbs.db(TREE).get<{ n: number }>("SELECT count(*) AS n FROM person_field WHERE visibility = 'personal'"))!.n;
  assert.equal(tree.extras.fields, total - personal);
  const files = archive.renderFamily(TREE, await exportServer.familySnapshot(TREE), '2026-11-09');
  const text = JSON.stringify(files.map((f) => (typeof f.data === 'string' ? f.data : '')));
  assert.ok(text.length > 10);
  assert.ok(!text.includes(PERSONAL));
});

test('the D1 transfer leaves personal items behind: their accounts do not exist on the target', async () => {
  const rows = await dbs.db(TREE).all<{ id: string; visibility: string }>(`SELECT id, visibility FROM person_field WHERE ${transfer.COPY_ONLY.person_field}`);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.visibility !== 'personal'));
  assert.ok(rows.some((r) => r.id === 'ed'), 'editors’ fields are copied');
});

const details = (s: Awaited<ReturnType<typeof fns.getEditSnapshot>>) => ({
  given: s.given, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname, sex: s.sex,
  born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title, epithet: s.epithet,
  occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});
const inputs = (s: Awaited<ReturnType<typeof fns.getEditSnapshot>>) => s.fields.map((f) => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility }));

test('a steward is refused a personal item: it cannot be read, named in a save, removed, or lost in a save', async () => {
  await addRow('ben-p', 'ben', 'notes', { text: 'gift idea' }, 'personal', AUTHOR);
  await addRow('ben-c', 'ben', 'phone', { number: '+27 2' }, 'personal', AUTHOR);
  await addRow('ben-f', 'ben', 'notes', { text: 'shared' }, 'family');
  as(STEWARD);
  assert.deepEqual(await idsFor('ben'), ['ben-f']);
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'ben' } });
  await assert.rejects(
    fns.savePersonEdit({ data: { tree: TREE, id: 'ben', details: details(snap), fields: [...inputs(snap), { id: 'ben-p', type: 'notes', label: '', value: { text: 'overwritten' }, visibility: 'family' }], revision: snap.revision, opKey: opKey() } }),
    /not on this person/,
  );
  await fns.deletePersonField({ data: { tree: TREE, id: 'ben-p', opKey: opKey() } });
  await api.deleteContact({ data: { tree: TREE, id: 'ben-c' } });
  assert.ok(await has('ben-p'), 'the remove did nothing');
  assert.ok(await has('ben-c'), 'the contact remove did nothing');
  // A whole-list save holds only what the steward sees: a personal item is not "missing from the list".
  await fns.savePersonEdit({ data: { tree: TREE, id: 'ben', details: { ...details(snap), nickname: 'Benny' }, fields: inputs(snap), revision: snap.revision, opKey: opKey() } });
  assert.ok(await has('ben-p'), 'the personal note survived the save');
  as(AUTHOR);
  assert.deepEqual(await idsFor('ben'), ['ben-c', 'ben-f', 'ben-p'], 'and the author still finds them');
});

test('a viewer gets the same refusal for someone’s personal item as for any other', async () => {
  as(VIEWER);
  await assert.rejects(fns.deletePersonField({ data: { tree: TREE, id: 'ben-p', opKey: opKey() } }), /permission|forbidden|role|allowed/i);
  await assert.rejects(fns.deletePersonField({ data: { tree: TREE, id: 'no-such-field', opKey: opKey() } }), /permission|forbidden|role|allowed/i);
  assert.ok(await has('ben-p'));
});

test('the author changes the level and the row follows: the owner is theirs while personal, and gone when shared', async () => {
  as(AUTHOR);
  const fid = await fns.addPersonField({ data: { tree: TREE, person: 'eli', field: { type: 'gifts', label: '', value: { text: 'a telescope' }, visibility: 'personal' }, opKey: opKey() } });
  assert.deepEqual({ ...(await dbs.db(TREE).get('SELECT visibility, owner FROM person_field WHERE id = ?', fid)) }, { visibility: 'personal', owner: AUTHOR });
  as(OTHER_EDITOR);
  assert.deepEqual(await idsFor('eli'), []);
  as(AUTHOR);
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'eli' } });
  await fns.savePersonEdit({ data: { tree: TREE, id: 'eli', details: details(snap), fields: inputs(snap).map((f) => ({ ...f, visibility: 'family' as const })), revision: snap.revision, opKey: opKey() } });
  assert.deepEqual({ ...(await dbs.db(TREE).get('SELECT visibility, owner FROM person_field WHERE id = ?', fid)) }, { visibility: 'family', owner: null });
  as(VIEWER);
  assert.deepEqual(await idsFor('eli'), [fid], 'shared with the family now');
});

test('an author who loses their role still finds their personal items and may remove them, but edits nothing else', async () => {
  as(DEMOTED);
  const fid = await fns.addPersonField({ data: { tree: TREE, person: 'dee', field: { type: 'notes', label: '', value: { text: 'mine' }, visibility: 'personal' }, opKey: opKey() } });
  await setRole(DEMOTED, 'viewer');
  assert.deepEqual(await idsFor('dee'), [fid], 'still there at viewer');
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'dee' } });
  await assert.rejects(fns.savePersonEdit({ data: { tree: TREE, id: 'dee', details: details(snap), fields: inputs(snap), revision: snap.revision, opKey: opKey() } }), /permission|forbidden|role|allowed/i);
  await assert.rejects(fns.addPersonField({ data: { tree: TREE, person: 'dee', field: { type: 'notes', label: '', value: { text: 'more' }, visibility: 'personal' }, opKey: opKey() } }), /permission|forbidden|role|allowed/i);
  await fns.deletePersonField({ data: { tree: TREE, id: fid, opKey: opKey() } });
  assert.equal(await has(fid), false);
});

test('removing a member deletes their personal items and nothing else', async () => {
  await addRow('cid-gone', 'cid', 'notes', { text: 'theirs' }, 'personal', LEAVER);
  await addRow('cid-kept', 'cid', 'notes', { text: 'someone else’s' }, 'personal', AUTHOR);
  await addRow('cid-fam', 'cid', 'notes', { text: 'they shared this' }, 'family');
  as(STEWARD);
  await authFns.removeMember({ data: { tree: TREE, user: LEAVER } });
  assert.equal(await has('cid-gone'), false);
  assert.ok(await has('cid-kept'));
  assert.ok(await has('cid-fam'));
});

test('removing a member deletes their assistant chats and kept pictures in that family, and nobody else’s', async () => {
  const gone = id(8);
  const accounts = store.accounts();
  await accounts.run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', gone, gone, 'h-gone', Date.now());
  await accounts.run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', gone, TREE, 'editor', Date.now());
  for (const [chat, user] of [['chat-gone', gone], ['chat-kept', AUTHOR]] as const) {
    await accounts.run('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', chat, TREE, user, 'c', 'user', '{}', 1);
    await accounts.run('INSERT INTO ai_chat_image (id, item, tree, user, mime, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)', `img-${chat}`, chat, TREE, user, 'image/png', 'AA', 1);
    await accounts.run('INSERT INTO ai_thread (tree, user, conv, created, updated) VALUES (?, ?, ?, ?, ?)', TREE, user, 'c', 1, 1);
  }
  as(STEWARD);
  await authFns.removeMember({ data: { tree: TREE, user: gone } });
  for (const table of ['ai_chat', 'ai_chat_image', 'ai_thread']) {
    const left = await accounts.all<{ user: string }>(`SELECT user FROM ${table} WHERE tree = ?`, TREE);
    assert.deepEqual(left.map((r) => r.user), [AUTHOR], table);
  }
});

test('a field with no recorded author cannot be made personal by anyone: the save is refused and the field stays where it was', async () => {
  await addRow('sh-fam', 'dee', 'notes', { text: 'her number' }, 'family');
  await addRow('sh-ed', 'dee', 'medical', { note: 'allergy' }, 'editors');
  as(OTHER_EDITOR);
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'dee' } });
  for (const target of ['sh-fam', 'sh-ed']) {
    await assert.rejects(
      fns.savePersonEdit({ data: { tree: TREE, id: 'dee', details: details(snap), fields: inputs(snap).map((f) => (f.id === target ? { ...f, visibility: 'personal' as const } : f)), revision: snap.revision, opKey: opKey() } }),
      /Only the person who added/,
    );
  }
  const row = (fid: string) => dbs.db(TREE).get<{ visibility: string; owner: string | null }>('SELECT visibility, owner FROM person_field WHERE id = ?', fid);
  assert.deepEqual({ ...(await row('sh-fam')) }, { visibility: 'family', owner: null });
  assert.deepEqual({ ...(await row('sh-ed')) }, { visibility: 'editors', owner: null });
});

test('a new field may start personal, and its author can go on editing it at that level', async () => {
  as(OTHER_EDITOR);
  let snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'dee' } });
  const saved = await fns.savePersonEdit({ data: { tree: TREE, id: 'dee', details: details(snap), fields: [...inputs(snap), { type: 'notes', label: '', value: { text: 'mine' }, visibility: 'personal' as const }], revision: snap.revision, opKey: opKey() } });
  const fid = saved.fieldIds.at(-1)!;
  snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'dee' } });
  await fns.savePersonEdit({ data: { tree: TREE, id: 'dee', details: details(snap), fields: inputs(snap).map((f) => (f.id === fid ? { ...f, value: { text: 'mine, longer' } } : f)), revision: snap.revision, opKey: opKey() } });
  assert.deepEqual({ ...(await dbs.db(TREE).get('SELECT visibility, owner, value FROM person_field WHERE id = ?', fid)) }, { visibility: 'personal', owner: OTHER_EDITOR, value: '{"text":"mine, longer"}' });
  await fns.deletePersonField({ data: { tree: TREE, id: fid, opKey: opKey() } });
});

const levelOf = (fid: string) => dbs.db(TREE).get<{ visibility: string; owner: string | null; created_by: string | null }>('SELECT visibility, owner, created_by FROM person_field WHERE id = ?', fid);
const saveLevel = async (person: string, fid: string, visibility: 'personal' | 'editors' | 'family', text?: string) => {
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: person } });
  return fns.savePersonEdit({ data: { tree: TREE, id: person, details: details(snap), fields: inputs(snap).map((f) => (f.id === fid ? { ...f, visibility, value: text ? { text } : f.value } : f)), revision: snap.revision, opKey: opKey() } });
};
const addShared = async (person: string, text: string) => {
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: person } });
  const saved = await fns.savePersonEdit({ data: { tree: TREE, id: person, details: details(snap), fields: [...inputs(snap), { type: 'notes' as const, label: '', value: { text }, visibility: 'family' as const }], revision: snap.revision, opKey: opKey() } });
  return saved.fieldIds.at(-1)!;
};
const ONLY_AUTHOR = /Only the person who added/;

test('a new field auto-saved at the default level can still be made personal by its author, and the read says so without naming them', async () => {
  as(AUTHOR);
  g.__signedIn = { id: AUTHOR, name: 'Anna Author' };
  const fid = await addShared('eli', 'typed before the lock');
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'eli' } });
  assert.equal(snap.fields.find((f) => f.id === fid)?.authored, true);
  assert.equal(JSON.stringify(snap.fields.find((f) => f.id === fid)).includes(AUTHOR), false, 'the account itself is never sent');
  await saveLevel('eli', fid, 'personal');
  assert.deepEqual({ ...(await levelOf(fid)) }, { visibility: 'personal', owner: AUTHOR, created_by: AUTHOR });
  await fns.deletePersonField({ data: { tree: TREE, id: fid, opKey: opKey() } });
});

test('its author can share a personal field and lock it again, and the author is never rewritten', async () => {
  as(AUTHOR);
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'eli' } });
  const saved = await fns.savePersonEdit({ data: { tree: TREE, id: 'eli', details: details(snap), fields: [...inputs(snap), { type: 'notes' as const, label: '', value: { text: 'mine' }, visibility: 'personal' as const }], revision: snap.revision, opKey: opKey() } });
  const fid = saved.fieldIds.at(-1)!;
  await saveLevel('eli', fid, 'family');
  assert.deepEqual({ ...(await levelOf(fid)) }, { visibility: 'family', owner: null, created_by: AUTHOR });
  await saveLevel('eli', fid, 'personal');
  assert.deepEqual({ ...(await levelOf(fid)) }, { visibility: 'personal', owner: AUTHOR, created_by: AUTHOR });
  await fns.deletePersonField({ data: { tree: TREE, id: fid, opKey: opKey() } });
});

test('re-saving someone else’s field grants nothing: that editor is refused Personal and the author stays', async () => {
  as(AUTHOR);
  const fid = await addShared('eli', 'theirs');
  as(OTHER_EDITOR);
  await saveLevel('eli', fid, 'family', 'theirs, corrected');
  const snap = await fns.getEditSnapshot({ data: { tree: TREE, id: 'eli' } });
  assert.equal(snap.fields.find((f) => f.id === fid)?.authored, false);
  await assert.rejects(saveLevel('eli', fid, 'personal'), ONLY_AUTHOR);
  assert.deepEqual({ ...(await levelOf(fid)) }, { visibility: 'family', owner: null, created_by: AUTHOR });
  as(STEWARD);
  await assert.rejects(saveLevel('eli', fid, 'personal'), ONLY_AUTHOR, 'a steward does not take it over either');
  as(AUTHOR);
  await fns.deletePersonField({ data: { tree: TREE, id: fid, opKey: opKey() } });
});

test('an older personal field with no recorded author stays its owner’s, and once shared it cannot be locked again', async () => {
  await addRow('old-own', 'eli', 'notes', { text: 'older' }, 'personal', OTHER_EDITOR);
  as(OTHER_EDITOR);
  await saveLevel('eli', 'old-own', 'personal', 'older, edited');
  await saveLevel('eli', 'old-own', 'family');
  assert.deepEqual({ ...(await levelOf('old-own')) }, { visibility: 'family', owner: null, created_by: null });
  await assert.rejects(saveLevel('eli', 'old-own', 'personal'), ONLY_AUTHOR);
  await fns.deletePersonField({ data: { tree: TREE, id: 'old-own', opKey: opKey() } });
});

test('removing a member deletes only what they created: a personal row naming someone else as its author stays', async () => {
  const gone = id(9);
  await store.accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', gone, gone, 'h-gone9', Date.now());
  await store.accounts().run('INSERT INTO membership (user, tree, role, created) VALUES (?, ?, ?, ?)', gone, TREE, 'editor', Date.now());
  as(gone);
  const shared = await addShared('cid', 'they shared this');
  await dbs.db(TREE).run("INSERT INTO person_field (id, person, type, label, value, visibility, owner, created_by) VALUES ('not-theirs', 'cid', 'notes', '', '{}', 'personal', ?, ?)", gone, AUTHOR);
  await dbs.db(TREE).run("INSERT INTO person_field (id, person, type, label, value, visibility, owner, created_by) VALUES ('theirs', 'cid', 'notes', '', '{}', 'personal', ?, ?)", gone, gone);
  as(STEWARD);
  await authFns.removeMember({ data: { tree: TREE, user: gone } });
  assert.equal(await has('theirs'), false);
  assert.ok(await has('not-theirs'), 'someone else created it');
  assert.ok(await has(shared), 'a shared field outlives its author');
  await dbs.db(TREE).run("DELETE FROM person_field WHERE id = 'not-theirs'");
});

test('the level picker offers Personal only where the server takes it, and says why', async () => {
  const { renderToString } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { VisibilityPicker } = await load<typeof import('../components/fields/VisibilityMark.tsx')>('/src/components/fields/VisibilityMark.tsx');
  const onChange = () => {};
  const radios = (html: string) => html.split('role="radio"').length - 1;
  const saved = renderToString(createElement(VisibilityPicker, { value: 'family', onChange, personal: false }));
  assert.equal(radios(saved), 2);
  assert.match(saved, /Only the person who added/);
  const fresh = renderToString(createElement(VisibilityPicker, { value: 'family', onChange }));
  assert.equal(radios(fresh), 3);
  assert.doesNotMatch(fresh, /Only the person who added/);
});

test('the command palette does not offer a guest Contacts', async () => {
  const { commandsForReader } = await load<typeof import('../components/Palette.tsx')>('/src/components/Palette.tsx');
  const cmds = [{ key: 'atlas' }, { key: 'contacts' }];
  assert.deepEqual(commandsForReader(cmds, true), [{ key: 'atlas' }]);
  assert.deepEqual(commandsForReader(cmds, false), cmds);
});

test('the database refuses a personal row without an owner', async () => {
  await assert.rejects(addRow('bad', 'ada', 'notes', { text: 'x' }, 'personal', null));
  await assert.rejects(addRow('bad2', 'ada', 'notes', { text: 'x' }, 'family', AUTHOR));
  await assert.rejects(addRow('bad3', 'ada', 'notes', { text: 'x' }, 'friends', null));
});

test('the migration maps the old flag exactly and removes it', () => {
  const d = new DatabaseSync(join(dir, 'migration.db'));
  const files = readdirSync('migrations/tree').filter((f) => f.endsWith('.sql')).sort();
  const before20 = files.filter((f) => f < '0020');
  assert.ok(files.some((f) => f.startsWith('0020')));
  for (const f of before20) d.exec(readFileSync(join('migrations/tree', f), 'utf8'));
  d.exec(`INSERT INTO person (id, given) VALUES ('p', 'P');
    INSERT INTO person_field (id, person, type, value, private) VALUES ('open', 'p', 'phone', '{"number":"1"}', 0), ('closed', 'p', 'medical', '{"note":"x"}', 1);`);
  const revisionOf = () => (d.prepare("SELECT revision FROM person WHERE id = 'p'").get() as { revision: number }).revision;
  const before = revisionOf();
  d.exec(readFileSync(join('migrations/tree', files.find((f) => f.startsWith('0020'))!), 'utf8'));
  const rows = d.prepare('SELECT id, visibility, owner FROM person_field ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ id: 'closed', visibility: 'editors', owner: null }, { id: 'open', visibility: 'family', owner: null }]);
  assert.equal(revisionOf(), before + 1, 'only the private row was rewritten');
  assert.ok(!(d.prepare('PRAGMA table_info(person_field)').all() as { name: string }[]).some((c) => c.name === 'private'));
  d.close();
});
