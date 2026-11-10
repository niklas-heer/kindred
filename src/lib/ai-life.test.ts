// node --test src/lib/ai-life.test.ts — the assistant reads life events and sources: a person's events and the sources cited
// for their facts in read_person, the family's events in list_events, and its sources in list_sources and read_source. Every
// member role may read them; a source's link to a private research document reaches only editors and stewards; a call without
// a member account gets no source. Fake provider, private data folder, invented people.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-life-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-life-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const tools = await load<typeof import('./ai/tools.server.ts')>('/src/lib/ai/tools.server.ts');
const { stepLabel } = await load<typeof import('./ai/stream.ts')>('/src/lib/ai/stream.ts');
import type { Role } from './roles.ts';

const TREE = 'life';
const NOW = '2026-11-10T00:00:00Z';
const db = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
db.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ida');
  INSERT INTO person (id, given, surname, born, living, sex) VALUES
    ('ida', 'Ida', 'Fern', '1890-04-02', 0, 'f'), ('olav', 'Olav', 'Fern', '1888-01-09', 0, 'm'), ('tove', 'Tove', 'Fern', '1915-06-01', 1, 'f');
  INSERT INTO parent (child, parent) VALUES ('tove', 'ida'), ('tove', 'olav');
  INSERT INTO partnership (id, a, b, kind, start) VALUES ('u1', 'ida', 'olav', 'marriage', '1912');
  INSERT INTO life_event (id, person, type, label, date, end_date, place, note, created_at, updated_at) VALUES
    ('e-bapt', 'ida', 'baptism', NULL, '1890-05', NULL, 'Moorby', '', '${NOW}', '${NOW}'),
    ('e-school', 'ida', 'education', 'Moorby village school', '1896', '1904', 'Moorby', 'Top of her class', '${NOW}', '${NOW}'),
    ('e-emig', 'olav', 'emigration', NULL, '1920', NULL, 'Port Kestrel', 'With two trunks', '${NOW}', '${NOW}'),
    ('e-emig2', 'ida', 'emigration', NULL, '1921', NULL, 'Port Kestrel', '', '${NOW}', '${NOW}');
  INSERT INTO research_project (id, title, private, created_by, created_at, updated_at) VALUES ('rp', 'Hidden project', 1, 'u1', '${NOW}', '${NOW}');
  INSERT INTO research_document (id, project, key, mime, size, title, private, created_by, created_at, updated_at)
    VALUES ('doc', 'rp', 'research/doc.pdf', 'application/pdf', 10, 'SECRET_DOCUMENT_TITLE', 1, 'u1', '${NOW}', '${NOW}');
  INSERT INTO source (id, title, author, reference, note, document, created_at, updated_at) VALUES
    ('s-reg', 'Moorby parish register', NULL, 'KB 4', 'Baptisms 1880–1900', 'doc', '${NOW}', '${NOW}'),
    ('s-list', 'Passenger list of the Gannet', 'Harbour office', NULL, '', NULL, '${NOW}', '${NOW}');
  INSERT INTO citation (id, source, fact, person, parent, event, partnership, page, quality, transcription, created_at, updated_at) VALUES
    ('c1', 's-reg', 'birth', 'ida', NULL, NULL, NULL, 'p. 7', 'original', 'Ida, daughter of…', '${NOW}', '${NOW}'),
    ('c2', 's-reg', 'event', NULL, NULL, 'e-bapt', NULL, 'p. 7', 'original', '', '${NOW}', '${NOW}'),
    ('c3', 's-list', 'event', NULL, NULL, 'e-emig', NULL, 'row 12', 'derivative', '', '${NOW}', '${NOW}'),
    ('c4', 's-reg', 'parent', 'tove', 'ida', NULL, NULL, NULL, NULL, '', '${NOW}', '${NOW}');
`);
db.close();

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const ROLES: Role[] = ['viewer', 'contributor', 'editor', 'steward'];
const run = async (role: Role, name: string, input: unknown, user: string | null = 'u1') =>
  JSON.parse(await tools.runTool({ tree: TREE, role, me: 'tove', user: user ?? undefined, locale: 'en' }, name, input, []));

test('every member role is offered the event and source reads', () => {
  for (const role of ROLES) {
    const names = tools.toolsFor(role).tools.map((t) => t.name);
    for (const n of ['list_events', 'list_sources', 'read_source']) assert.ok(names.includes(n), `${role}: ${n}`);
  }
  assert.equal(stepLabel('read_source'), 'ai.stepFamily');
});

test('read_person carries the person’s life events in order and the sources cited for their facts', async () => {
  for (const role of ROLES) {
    const ida = await run(role, 'read_person', { id: 'ida' });
    assert.deepEqual(ida.events.map((e: { id: string }) => e.id), ['e-bapt', 'e-school', 'e-emig2'], role);
    assert.deepEqual(ida.events[1], { id: 'e-school', type: 'education', label: 'Moorby village school', date: '1896', endDate: '1904', place: 'Moorby', note: 'Top of her class' });
    const facts = ida.sources.map((s: { fact: string; sourceTitle: string; page: string | null }) => [s.fact, s.sourceTitle, s.page]);
    assert.deepEqual(facts.sort(), [['birth', 'Moorby parish register', 'p. 7'], ['event', 'Moorby parish register', 'p. 7']]);
  }
  const tove = await run('viewer', 'read_person', { id: 'tove' });
  assert.deepEqual(tove.sources.map((s: { fact: string; child: string; parent: string }) => [s.fact, s.child, s.parent]), [['parent', 'Tove Fern', 'Ida Fern']]);
});

test('list_events finds events across the family by type or by words, oldest first', async () => {
  const all = await run('viewer', 'list_events', {});
  assert.equal(all.count, 4);
  const emigrations = await run('viewer', 'list_events', { type: 'emigration' });
  assert.deepEqual(emigrations.events.map((e: { name: string; date: string }) => [e.name, e.date]), [['Olav Fern', '1920'], ['Ida Fern', '1921']]);
  const school = await run('contributor', 'list_events', { text: 'village SCHOOL' });
  assert.deepEqual(school.events.map((e: { id: string }) => e.id), ['e-school']);
  const bad = await run('viewer', 'list_events', { type: 'coronation' });
  assert.match(bad.error, /did not fit/);
});

test('list_sources and read_source answer for members; a private research document stays with editors and stewards', async () => {
  for (const role of ROLES) {
    const list = await run(role, 'list_sources', {});
    assert.deepEqual(list.sources.map((s: { id: string; citedFor: number }) => [s.id, s.citedFor]), [['s-reg', 3], ['s-list', 1]], role);
    const one = await run(role, 'read_source', { source: 's-list' });
    assert.equal(one.source.author, 'Harbour office');
    assert.deepEqual(one.citedFor.map((c: { fact: string; event: string; about: string[]; eventType: string }) => [c.fact, c.event, c.eventType, c.about]), [['event', 'e-emig', 'emigration', ['Olav Fern']]]);
    const sees = role === 'editor' || role === 'steward';
    const text = JSON.stringify(await run(role, 'read_source', { source: 's-reg' })) + JSON.stringify(list);
    assert.equal(text.includes('SECRET_DOCUMENT_TITLE'), sees, `${role}: the private document's title`);
  }
  assert.match((await run('viewer', 'read_source', { source: 'nope' })).error, /no such source/);
});

test('without a member account, no source is read', async () => {
  assert.match((await run('viewer', 'list_sources', {}, null)).error, /members/);
  assert.match((await run('viewer', 'read_source', { source: 's-reg' }, null)).error, /members/);
  const ida = await run('viewer', 'read_person', { id: 'ida' }, null);
  assert.deepEqual(ida.sources, []);
  assert.equal(ida.events.length, 3, 'life events are every reader’s');
});
