// node --test src/lib/events.server.test.ts — life events, sources and citations on a private data folder: who may change
// what, what a guest gets, "Protect living people", the cascades when a person or a fact goes, and deleting a cited source.
// Server modules load through Vite (ssrLoadModule), as the app does.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-events-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const family = openSqlite(join(dir, 'family.db'), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', 'family'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO person (id, given, surname, born, born_place, living) VALUES
    ('ada', 'Ada', 'Alder', '1890', 'Lindholm', 0), ('ben', 'Ben', 'Alder', '1920', NULL, 0), ('cleo', 'Cleo', 'Alder', '2010-04-02', 'Brookmere', 1);
  INSERT INTO parent (child, parent) VALUES ('ben', 'ada'), ('cleo', 'ben');
  INSERT INTO partnership (id, a, b, kind, start) VALUES ('u1', 'ada', 'ben', 'other', '1950');
  INSERT INTO place (name, lat, lng) VALUES ('Lindholm', 54.6, 9.0), ('Brookmere', 51.0, 7.0), ('Harbour Town', 53.5, 10.0), ('Northfield', 55.0, 9.5);
  INSERT INTO research_project (id, title, private, created_by, created_at, updated_at) VALUES ('rp', 'Open', 0, 'x', '2026', '2026'), ('rq', 'Hidden', 1, 'x', '2026', '2026');
  INSERT INTO research_document (id, project, key, mime, size, title, created_by, created_at, updated_at) VALUES
    ('doc-open', 'rp', 'research/a.pdf', 'application/pdf', 1, 'Parish book', 'x', '2026', '2026'),
    ('doc-hidden', 'rq', 'research/b.pdf', 'application/pdf', 1, 'Secret letter', 'x', '2026', '2026');
`);
family.close();

const db = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const E = await load<typeof import('./events.server.ts')>('/src/lib/events.server.ts');
const S = await load<typeof import('./sources.server.ts')>('/src/lib/sources.server.ts');
const Rel = await load<typeof import('./relations.server.ts')>('/src/lib/relations.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const editor = { id: 'u-editor', name: 'Eda Editor', role: 'editor' as const };
const contributor = { id: 'u-contrib', name: 'Cal Contributor', role: 'contributor' as const };
const viewer = { id: 'u-viewer', name: 'Vi Viewer', role: 'viewer' as const };
const guest = { id: '', name: '', role: 'viewer' as const, guest: true, protectLiving: false };
const protectedGuest = { ...guest, protectLiving: true };
const forbidden = /permission/;

const event = (person: string, over: Record<string, unknown> = {}) =>
  ({ person, type: 'residence' as const, label: null, date: '1912', endDate: null, place: 'Harbour Town', note: '', ...over });
const source = (over: Record<string, unknown> = {}) =>
  ({ title: 'Parish register of Lindholm', author: null, publication: 'Lindholm parish', reference: 'KB 12', date: '1890', note: '', document: null, media: null, ...over });

test('the migration is plain SQL both drivers run, with the three tables other features read', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/tree/0024_events_sources.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i);
  const d = openSqlite(join(dir, 'family.db'), 'tree');
  const names = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('life_event', 'source', 'citation')").all() as { name: string }[]).map((r) => r.name).sort();
  d.close();
  assert.deepEqual(names, ['citation', 'life_event', 'source']);
});

test('only an editor adds, changes, orders and removes events; a contributor, a viewer and a guest are refused', async () => {
  for (const who of [contributor, viewer, guest]) await assert.rejects(E.saveEvent('family', who, event('ada'), undefined), forbidden);
  const { id } = await E.saveEvent('family', editor, event('ada'), undefined);
  const second = await E.saveEvent('family', editor, event('ada', { type: 'census', date: '1912', place: null }), undefined);
  await assert.rejects(E.removeEvent('family', contributor, id, undefined), forbidden);
  await assert.rejects(E.reorderEvents('family', viewer, 'ada', [second.id, id], undefined), forbidden);
  await E.reorderEvents('family', editor, 'ada', [second.id, id], undefined);
  const list = await E.personEvents('family', 'ada', viewer);
  assert.deepEqual(list.map((e) => e.type), ['census', 'residence'], 'same date: the editor’s order decides');
  await assert.rejects(E.reorderEvents('family', editor, 'ada', [id], undefined), /events\.err\.changed/, 'a list that is not the person’s events is refused');
  await E.saveEvent('family', editor, { ...event('ada'), id, note: 'By the harbour' }, undefined);
  assert.equal((await E.personEvents('family', 'ada', viewer)).find((e) => e.id === id)!.note, 'By the harbour');
  await assert.rejects(E.saveEvent('family', editor, { ...event('ben'), id }, undefined), /events\.err\.gone/, 'an event stays with its person');
  await E.removeEvent('family', editor, second.id, undefined);
  assert.equal((await E.personEvents('family', 'ada', viewer)).length, 1);
});

test('an event keeps its rules: a custom one has a label, a burial is not for the living, and the end is not before the start', async () => {
  await assert.rejects(E.saveEvent('family', editor, event('ada', { type: 'custom', label: '  ' }), undefined), /events\.err\.label_required/);
  await assert.rejects(E.saveEvent('family', editor, event('cleo', { type: 'burial' }), undefined), /events\.err\.living/);
  await assert.rejects(E.saveEvent('family', editor, event('ada', { date: '1920', endDate: '1910' }), undefined), /events\.err\.end_before_start/);
  await assert.rejects(E.saveEvent('family', editor, event('nobody'), undefined), /events\.err\.person_gone/);
  const { id } = await E.saveEvent('family', editor, event('ada', { type: 'custom', label: 'Opened the bakery', date: '1925', place: 'Northfield' }), undefined);
  assert.equal((await E.personEvents('family', 'ada', viewer)).find((e) => e.id === id)!.label, 'Opened the bakery');
});

test('a guest sees events of the dead; with "Protect living people" none of a living person’s, and no place only they name', async () => {
  await E.saveEvent('family', editor, event('cleo', { type: 'education', place: 'Brookmere', date: '2016' }), undefined);
  assert.equal((await E.personEvents('family', 'cleo', guest)).length, 1, 'a link without the setting shows them');
  assert.equal((await E.personEvents('family', 'cleo', protectedGuest)).length, 0);
  assert.ok((await E.personEvents('family', 'ada', protectedGuest)).length > 0, 'the dead are untouched');
  const open = await E.familyEventPlaces('family', viewer);
  assert.ok(open.events.some((e) => e.person === 'cleo'));
  assert.ok(open.places.some((p) => p.name === 'Brookmere'));
  const shielded = await E.familyEventPlaces('family', protectedGuest);
  assert.equal(shielded.events.some((e) => e.person === 'cleo'), false);
  assert.equal(shielded.places.some((p) => p.name === 'Brookmere'), false);
  assert.ok(shielded.places.some((p) => p.name === 'Harbour Town'));
});

test('sources and citations are an editor’s to change and a member’s to read; a guest gets none', async () => {
  await assert.rejects(S.saveSource('family', contributor, source(), undefined), forbidden);
  await assert.rejects(S.listSources('family', guest), /access/i);
  await assert.rejects(S.personCitations('family', 'ada', guest), /access/i);
  const { id } = await S.saveSource('family', editor, source(), undefined);
  await assert.rejects(S.saveCitation('family', viewer, { source: id, target: { fact: 'birth', person: 'ada' }, page: null, quality: null, transcription: '' }, undefined), forbidden);
  await S.saveCitation('family', editor, { source: id, target: { fact: 'birth', person: 'ada' }, page: 'p. 12', quality: 'original', transcription: 'Ada, daughter of…' }, undefined);
  const cites = await S.personCitations('family', 'ada', viewer);
  assert.equal(cites.length, 1);
  assert.deepEqual(cites[0].target, { fact: 'birth', person: 'ada' });
  assert.equal(cites[0].sourceTitle, 'Parish register of Lindholm');
  assert.equal((await S.listSources('family', viewer)).find((s) => s.id === id)!.citations, 1);
  await assert.rejects(S.unsourcedBirths('family', viewer), forbidden, 'the Needed list is for editors');
  const unsourced = await S.unsourcedBirths('family', editor);
  assert.equal(unsourced.includes('ada'), false);
  assert.ok(unsourced.includes('ben') && unsourced.includes('cleo'));
  await assert.rejects(S.saveCitation('family', editor, { source: id, target: { fact: 'parent', child: 'ada', parent: 'ben' }, page: null, quality: null, transcription: '' }, undefined), /sources\.err\.fact_gone/, 'only a link that exists is cited');
});

test('a link to a private research document is kept back from those who may not see it', async () => {
  const hidden = await S.saveSource('family', editor, source({ title: 'A letter', document: 'doc-hidden' }), undefined);
  await assert.rejects(S.saveSource('family', contributor, source({ document: 'doc-hidden' }), undefined), forbidden);
  const forViewer = (await S.listSources('family', viewer)).find((s) => s.id === hidden.id)!;
  assert.equal(forViewer.document, null);
  assert.equal((await S.listSources('family', editor)).find((s) => s.id === hidden.id)!.document?.title, 'Secret letter');
  const open = await S.saveSource('family', editor, source({ title: 'The book', document: 'doc-open' }), undefined);
  assert.equal((await S.listSources('family', viewer)).find((s) => s.id === open.id)!.document?.title, 'Parish book');
});

test('a source still cited is deleted only with the citations the editor confirmed', async () => {
  const { id } = await S.saveSource('family', editor, source({ title: 'Census 1912' }), undefined);
  const { id: ev } = await E.saveEvent('family', editor, event('ben', { type: 'census' }), undefined);
  await S.saveCitation('family', editor, { source: id, target: { fact: 'event', event: ev }, page: null, quality: 'derivative', transcription: '' }, undefined);
  await S.saveCitation('family', editor, { source: id, target: { fact: 'partnership', partnership: 'u1' }, page: null, quality: null, transcription: '' }, undefined);
  await assert.rejects(S.removeSource('family', editor, id, 1, undefined), /sources\.err\.cited_changed/, 'the editor confirmed one, there are two');
  const d = db.db('family');
  await assert.rejects(d.run('DELETE FROM source WHERE id = ?', id), /constraint/i, 'the database itself keeps a cited source');
  await S.removeSource('family', editor, id, 2, undefined);
  assert.equal((await d.get<{ n: number }>('SELECT count(*) AS n FROM citation WHERE source = ?', id))!.n, 0);
  assert.equal(await d.get('SELECT id FROM source WHERE id = ?', id), undefined);
});

test('removing a person takes their events and every citation of their facts with them', async () => {
  const { id } = await S.saveSource('family', editor, source({ title: 'Family bible' }), undefined);
  const { id: ev } = await E.saveEvent('family', editor, event('ben', { type: 'military', date: '1940', endDate: '1945' }), undefined);
  for (const target of [
    { fact: 'birth' as const, person: 'ben' }, { fact: 'name' as const, person: 'ben' }, { fact: 'event' as const, event: ev },
    { fact: 'partnership' as const, partnership: 'u1' }, { fact: 'parent' as const, child: 'ben', parent: 'ada' }, { fact: 'parent' as const, child: 'cleo', parent: 'ben' },
  ]) await S.saveCitation('family', editor, { source: id, target, page: null, quality: null, transcription: '' }, undefined);
  await db.once('family', undefined, 'removePerson', (d) => Rel.removePlan(d, 'family', 'ben'));
  const d = db.db('family');
  assert.equal((await d.get<{ n: number }>("SELECT count(*) AS n FROM life_event WHERE person = 'ben'"))!.n, 0);
  assert.equal((await d.get<{ n: number }>('SELECT count(*) AS n FROM citation WHERE source = ?', id))!.n, 0, 'their birth, name, event, partnership and both parent links');
  assert.ok(await d.get('SELECT id FROM source WHERE id = ?', id), 'the source stays');
});

test('a retried change with the same key writes once', async () => {
  const op = { key: 'retry-key-0001', user: editor.id, payload: { n: 1 } };
  const a = await E.saveEvent('family', editor, event('ada', { type: 'award', label: 'Baker of the year' }), op);
  const b = await E.saveEvent('family', editor, event('ada', { type: 'award', label: 'Baker of the year' }), op);
  assert.equal(a.id, b.id);
  assert.equal((await E.personEvents('family', 'ada', viewer)).filter((e) => e.type === 'award').length, 1);
});
