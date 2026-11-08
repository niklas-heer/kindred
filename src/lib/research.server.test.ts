// node --test src/lib/research.server.test.ts — the Research page's server layer on a private data folder: who may change
// what, what a viewer never receives, the file route's rule, cascades, and the archive. Server modules load through Vite
// (ssrLoadModule), as the app does.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-research-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const family = openSqlite(join(dir, 'family.db'), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', 'family'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, arms) VALUES ('h1', 'Alder', '{"field":"gules","division":"plain","charge":"none","chargeTincture":"or"}');
  INSERT INTO person (id, given, surname, house, born) VALUES ('ada', 'Ada', 'Alder', 'h1', '1890'), ('ben', 'Ben', 'Alder', 'h1', '1920');
  INSERT INTO place (name, lat, lng) VALUES ('Lindholm', 54.6, 9.0);
  INSERT INTO media (key, mime, uploaded_by, uploaded_at) VALUES ('gallery/g1.jpg', 'image/jpeg', 'x', '2026-01-01T00:00:00Z');
`);
family.close();

const db = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const R = await load<typeof import('./research.server.ts')>('/src/lib/research.server.ts');
const A = await load<typeof import('./exchange/research-archive.ts')>('/src/lib/exchange/research-archive.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const steward = { id: 'u-steward', name: 'Sam Steward', role: 'steward' as const };
const editor = { id: 'u-editor', name: 'Eda Editor', role: 'editor' as const };
const contributor = { id: 'u-contrib', name: 'Cal Contributor', role: 'contributor' as const };
const otherContributor = { id: 'u-other', name: 'Ora Other', role: 'contributor' as const };
const viewer = { id: 'u-viewer', name: 'Vi Viewer', role: 'viewer' as const };

const forbidden = /permission/;
const details = (over: Partial<Parameters<typeof R.addDocument>[6]> = {}) => ({ title: 'A record', date: '1890-04', source: 'Parish', notes: '', private: false, ...over });
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\nendobj\nstartxref\n9\n%%EOF\n');
const stored = (key: string) => db.media.get('family', key);

const newProject = (who: Parameters<typeof R.saveProject>[1], over: Partial<Parameters<typeof R.saveProject>[2]> = {}) =>
  R.saveProject('family', who, { title: 'Where did we come from?', summary: '', private: false, ...over }, undefined);

test('the migration is plain SQL both drivers run, and every table is there', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/tree/0017_research.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i, 'D1 runs a migration as one statement list');
  const d = openSqlite(join(dir, 'family.db'), 'tree');
  const names = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'research_%'").all() as { name: string }[]).map((r) => r.name).sort();
  d.close();
  assert.deepEqual(names, ['research_document', 'research_note', 'research_person', 'research_picture', 'research_place', 'research_project']);
});

test('a viewer cannot add anything; a contributor can, as themselves', async () => {
  await assert.rejects(newProject(viewer), forbidden);
  const { id } = await newProject(contributor);
  await assert.rejects(R.saveNote('family', viewer, { project: id, title: 'x', body: 'y', date: null, private: false }, undefined), forbidden);
  await assert.rejects(R.addLink('family', viewer, id, 'person', 'ada', false, undefined), forbidden);
  await assert.rejects(R.addDocument('family', viewer, id, pdf, 'application/pdf', { width: 0, height: 0 }, details(), undefined), forbidden);

  await R.saveNote('family', contributor, { project: id, title: 'First lead', body: 'A hunch', date: '1912', private: false }, undefined);
  const v = (await R.projectView('family', id, contributor))!;
  assert.equal(v.mine, true);
  assert.equal(v.notes[0].by, 'Cal Contributor');
  assert.equal(v.notes[0].mine, true);
});

test('a contributor changes only their own work; an editor changes anyone’s', async () => {
  const { id: project } = await newProject(contributor);
  const { id: mine } = await R.saveNote('family', contributor, { project, title: 'Mine', body: '1', date: null, private: false }, undefined);
  await assert.rejects(R.saveNote('family', otherContributor, { id: mine, project, title: 'Not mine', body: '2', date: null, private: false }, undefined), forbidden);
  await assert.rejects(R.removeNote('family', otherContributor, project, mine, undefined), forbidden);
  await R.saveNote('family', contributor, { id: mine, project, title: 'Still mine', body: '3', date: null, private: false }, undefined);
  await R.saveNote('family', editor, { id: mine, project, title: 'Edited', body: '4', date: null, private: false }, undefined);
  await R.removeNote('family', editor, project, mine, undefined);
});

test('only an editor can make anything private, and a contributor cannot read it afterwards', async () => {
  const { id: project } = await newProject(editor);
  await assert.rejects(newProject(contributor, { private: true }), forbidden);
  await assert.rejects(R.saveNote('family', contributor, { project, title: 'x', body: 'y', date: null, private: true }, undefined), forbidden);
  await assert.rejects(R.addLink('family', contributor, project, 'person', 'ada', true, undefined), forbidden);
  await R.saveNote('family', editor, { project, title: 'Between editors', body: 'y', date: null, private: true }, undefined);
  assert.equal((await R.projectView('family', project, viewer))!.notes.length, 0);
  assert.equal((await R.projectView('family', project, contributor))!.notes.length, 0);
  assert.equal((await R.projectView('family', project, editor))!.notes.length, 1);
});

test('private work is hidden whole from a viewer: projects, documents, notes, people, the file, and the panel', async () => {
  const { id: project } = await newProject(editor);
  const { id: hidden } = await newProject(editor, { private: true, title: 'A private question' });
  await R.addDocument('family', editor, hidden, pdf, 'application/pdf', { width: 0, height: 0 }, details({ title: 'In a private project' }), undefined);
  const secretDoc = await R.addDocument('family', editor, project, pdf, 'application/pdf', { width: 0, height: 0 }, details({ private: true, title: 'Private doc' }), undefined);
  const openDoc = await R.addDocument('family', editor, project, pdf, 'application/pdf', { width: 0, height: 0 }, details({ title: 'Open doc' }), undefined);
  await R.addLink('family', editor, project, 'person', 'ben', true, undefined);

  // The project list: the hidden project does not show, and the count does not reveal the private document.
  const listed = await R.listProjects('family', viewer);
  assert.equal(listed.some((p) => p.id === hidden), false);
  const open = listed.find((p) => p.id === project)!;
  assert.equal(open.counts.documents, 1);
  assert.equal((await R.listProjects('family', editor)).some((p) => p.id === hidden), true);

  // The project view: gone for a viewer, and private items absent.
  assert.equal(await R.projectView('family', hidden, viewer), undefined);
  const v = (await R.projectView('family', project, viewer))!;
  assert.deepEqual(v.documents.map((d) => d.title), ['Open doc']);
  assert.deepEqual(v.people, []);

  // The file route's rule: a private document or anything in a private project is not served to a viewer.
  assert.equal(await R.documentFile('family', secretDoc.key, 'viewer'), undefined);
  assert.equal(await R.documentFile('family', secretDoc.key, 'contributor'), undefined);
  assert.ok(await R.documentFile('family', secretDoc.key, 'editor'));
  assert.equal((await R.documentFile('family', openDoc.key, 'viewer'))?.private, false);
  assert.equal((await R.documentFile('family', secretDoc.key, 'editor'))?.private, true, 'private is reported so the route will not cache it');

  // The person panel: a private link is not there for a viewer.
  assert.deepEqual(await R.personResearch('family', 'ben', viewer), []);
  assert.deepEqual((await R.personResearch('family', 'ben', editor)).map((r) => r.id), [project]);

  // A private project cannot be written to by someone who cannot see it.
  await assert.rejects(R.saveNote('family', contributor, { project: hidden, title: 'x', body: 'y', date: null, private: false }, undefined), /research\.err\.project_gone/);
});

test('linking is idempotent and a link goes away with what it points at', async () => {
  const { id: project } = await newProject(editor);
  await R.addLink('family', editor, project, 'picture', 'gallery/g1.jpg', false, undefined);
  await R.addLink('family', editor, project, 'picture', 'gallery/g1.jpg', false, undefined);
  await R.addLink('family', editor, project, 'place', 'Lindholm', false, undefined);
  await R.addLink('family', editor, project, 'person', 'ada', false, undefined);
  const v = (await R.projectView('family', project, viewer))!;
  assert.equal(v.pictures.length, 1, 'a second link changes nothing');
  assert.deepEqual([v.places.map((p) => p.place), v.people.map((p) => p.person)], [['Lindholm'], ['ada']]);
  await assert.rejects(R.addLink('family', editor, project, 'person', 'nobody', false, undefined), /research\.err\.person_gone/);

  const d = db.db('family');
  await d.run('DELETE FROM media WHERE key = ?', 'gallery/g1.jpg');
  await d.run('DELETE FROM person WHERE id = ?', 'ada');
  const after = (await R.projectView('family', project, viewer))!;
  assert.equal(after.pictures.length, 0);
  assert.equal(after.people.length, 0);
  assert.equal(after.places.length, 1, 'a place link stays until the place goes');
});

test('a document’s file is stored with its row and deleted with it, and a project takes its files along', async () => {
  const { id: project } = await newProject(editor);
  const doc = await R.addDocument('family', editor, project, pdf, 'application/pdf', { width: 0, height: 0 }, details(), undefined);
  const key = doc.key;
  assert.match(key, /^research\/[0-9a-f-]+\.pdf$/);
  assert.ok(await stored(key), 'the file is in media storage');
  await R.removeDocument('family', editor, doc.id, undefined);
  assert.equal(await stored(key), undefined, 'the file went with the row');

  const second = await R.addDocument('family', editor, project, pdf, 'application/pdf', { width: 0, height: 0 }, details(), undefined);
  await R.removeProject('family', editor, project, undefined);
  assert.equal(await stored(second.key), undefined, 'deleting the project deletes its files');
  assert.equal(await R.projectView('family', project, editor), undefined);
});

test('a contributor can delete a project they started, unless it holds someone else’s work', async () => {
  const { id: ownEmpty } = await newProject(contributor);
  await R.removeProject('family', contributor, ownEmpty, undefined);

  const { id: shared } = await newProject(contributor);
  await R.saveNote('family', otherContributor, { project: shared, title: 'A note', body: 'b', date: null, private: false }, undefined);
  await assert.rejects(R.removeProject('family', contributor, shared, undefined), /research\.err\.others_work/);
  await R.removeProject('family', editor, shared, undefined);
});

test('a retry with the same key writes once', async () => {
  const { id: project } = await newProject(editor);
  const op = { key: 'retry-key-12345', user: editor.id, payload: { project } };
  const first = await R.saveNote('family', editor, { project, title: 'Once', body: 'b', date: null, private: false }, op);
  const again = await R.saveNote('family', editor, { project, title: 'Once', body: 'b', date: null, private: false }, op);
  assert.equal(again.id, first.id);
  assert.equal((await R.projectView('family', project, editor))!.notes.length, 1);
});

test('the archive carries what every member can see and says what it left out', async () => {
  const { id: project } = await newProject(editor, { title: 'The Lindholm line', summary: 'A question.' });
  await R.addDocument('family', editor, project, pdf, 'application/pdf', { width: 0, height: 0 }, details({ title: 'Open record' }), undefined);
  await R.addDocument('family', editor, project, pdf, 'application/pdf', { width: 0, height: 0 }, details({ title: 'Secret record', private: true }), undefined);
  await R.saveNote('family', editor, { project, title: 'Lead', body: 'Body', date: null, private: false }, undefined);
  await newProject(editor, { title: 'Hidden question', private: true });

  const { files, losses } = await A.researchArchive('family');
  const note = files.find((f) => f.path === 'research/the-lindholm-line.md')!;
  assert.ok(note, 'the project has a Markdown file');
  assert.match(String(note.data), /Open record/);
  assert.doesNotMatch(String(note.data), /Secret record/);
  assert.equal(files.filter((f) => f.path.startsWith('research/files/')).some((f) => f.path.endsWith('.pdf')), true);
  assert.equal(files.some((f) => String(f.data).includes?.('Hidden question')), false);
  assert.match(losses.join(' '), /private research items? (is|are) not in the archive/);
  assert.match((await A.researchGedcomLosses('family')).join(' '), /research/);
});
