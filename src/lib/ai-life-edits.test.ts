// node --test src/lib/ai-life-edits.test.ts — the assistant proposes life events, sources and citations: which roles are offered
// the tools and which are refused on the server, what the cards say, the fake provider's "emigrated … according to …" phrase,
// approving through the same server path as the forms (with the change history), a stale card, and taking a change back.
// Fake provider, private data folder, invented people.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-life-edits-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-life-edits-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const chat = await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts');
const conversations = await load<typeof import('./ai/conversations.server.ts')>('/src/lib/ai/conversations.server.ts');
const tools = await load<typeof import('./ai/tools.server.ts')>('/src/lib/ai/tools.server.ts');
const { systemPrompt } = await load<typeof import('./ai/prompt.ts')>('/src/lib/ai/prompt.ts');
const { proposalArgs } = await load<typeof import('./ai/types.ts')>('/src/lib/ai/types.ts');
const L = await load<typeof import('./ai/life-apply.ts')>('/src/lib/ai/life-apply.ts');
const E = await load<typeof import('./events.server.ts')>('/src/lib/events.server.ts');
const S = await load<typeof import('./sources.server.ts')>('/src/lib/sources.server.ts');
const D = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
import type { Role } from './roles.ts';
import type { Proposal } from './ai/types.ts';

const TREE = 'lifeedit';
const NOW = '2026-11-10T00:00:00Z';
const db = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
db.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'mara');
  INSERT INTO person (id, given, surname, born, living, sex) VALUES
    ('mara', 'Mara', 'Quill', '1930-03-01', 0, 'f'), ('jon', 'Jon', 'Quill', '1960-07-07', 1, 'm');
  INSERT INTO parent (child, parent) VALUES ('jon', 'mara');
  INSERT INTO life_event (id, person, type, label, date, end_date, place, note, created_at, updated_at) VALUES
    ('e-bapt', 'mara', 'baptism', NULL, '1930-04', NULL, 'Eskdale', '', '${NOW}', '${NOW}');
  INSERT INTO source (id, title, author, reference, note, created_at, updated_at) VALUES
    ('s-reg', 'Eskdale parish register', 'Parish clerk', 'KB 9', '', '${NOW}', '${NOW}');
  INSERT INTO citation (id, source, fact, person, page, quality, transcription, created_at, updated_at) VALUES
    ('c-birth', 's-reg', 'birth', 'mara', 'p. 3', 'original', '', '${NOW}', '${NOW}');
`);
db.close();

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Edda', 'handle-life-edits', Date.now());
await setup.setUpFamilyAi(TREE, 'u1', { provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 50_000_000, customPrices: {}, apiKey: 'sk-test-abcdefgh1234' });

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const LIFE_TOOLS = ['propose_life_event', 'propose_source', 'propose_citation', 'propose_remove_life_record'];
const editor = { id: 'u1', name: 'Edda', role: 'editor' as const };

async function propose(role: Role, name: string, input: unknown, out: Proposal[] = []) {
  const text = await tools.runTool({ tree: TREE, role, me: null, user: 'u1', locale: 'en' }, name, input, out);
  return { out, result: JSON.parse(text) as { error?: string; proposed?: boolean } };
}
const card = async (name: string, input: unknown, out: Proposal[] = []) => {
  const r = await propose('editor', name, input, out);
  assert.equal(r.result.error, undefined, r.result.error ?? '');
  return r.out.at(-1)!;
};
const rows = (p: Proposal) => p.diff.map((d) => [d.label, d.from ?? null, d.to, !!d.removed]);
/** What approval sends, after the browser's own check of the card's arguments (components/assistant/apply.ts). */
const argsOf = <K extends 'life-event' | 'source' | 'citation' | 'life-remove'>(p: Proposal, kind: K) => {
  assert.equal(p.kind, kind);
  // The card's own schema has just checked it; the tests read it freely.
  return proposalArgs[kind].parse(p.args) as any;
};
const op = (key: string, payload: unknown) => ({ key, user: editor.id, payload });

test('editors and stewards are offered the tools; viewers and contributors are not, and are refused on the server', async () => {
  for (const role of ['editor', 'steward'] as const) {
    const names = tools.toolsFor(role).tools.map((t) => t.name);
    for (const n of LIFE_TOOLS) assert.ok(names.includes(n), `${role}: ${n}`);
  }
  for (const role of ['viewer', 'contributor'] as const) {
    const names = tools.toolsFor(role).tools.map((t) => t.name);
    for (const n of LIFE_TOOLS) assert.ok(!names.includes(n), `${role}: ${n}`);
    for (const [name, input] of [
      ['propose_life_event', { person: 'mara', type: 'residence', place: 'Eskdale' }],
      ['propose_source', { title: 'A letter' }],
      ['propose_citation', { source: 's-reg', fact: 'death', person: 'mara' }],
      ['propose_remove_life_record', { what: 'event', id: 'e-bapt' }],
    ] as const) {
      const r = await propose(role, name, input);
      assert.match(r.result.error ?? '', /may not/, `${role}: ${name}`);
      assert.equal(r.out.length, 0);
    }
  }
  // Approving anyway goes to the forms' own server path, which refuses a contributor too.
  await assert.rejects(E.saveEvent(TREE, { ...editor, role: 'contributor' }, L.eventInput({ person: 'mara', type: 'residence', date: null, endDate: null, place: 'Eskdale' }), undefined), /permission/);
  await assert.rejects(S.saveSource(TREE, { ...editor, role: 'contributor' }, L.sourceInput({ title: 'A letter', author: null, publication: null, reference: null, date: null, note: '' }), undefined), /permission/);
});

test('the tool schemas stay under the provider cap', () => {
  const optional = (s: { properties?: Record<string, { properties?: object }>; required?: string[] }): number =>
    Object.entries(s.properties ?? {}).reduce((n, [k, v]) => n + (s.required?.includes(k) ? 0 : 1) + optional(v as never), 0);
  for (const t of tools.toolsFor('steward').tools.filter((x) => LIFE_TOOLS.includes(x.name))) assert.ok(optional(t.parameters as never) <= 17, t.name);
});

test('“she emigrated in 1952, according to the passenger list” becomes a source card and an event card that cites it; approving adds both', async () => {
  const conv = await conversations.newThread(TREE, 'u1');
  const sent = await chat.sendMessage({ tree: TREE, user: 'u1', role: 'editor', me: null, conv, locale: 'en', text: 'add that she emigrated in 1952, according to the passenger list', page: { path: `/${TREE}/person/mara`, personId: 'mara' } } as never);
  const reply = sent.items.at(-1) as { proposals?: Proposal[]; text: string };
  const [src, ev] = reply.proposals ?? [];
  assert.deepEqual(reply.proposals?.map((p) => p.kind), ['source', 'life-event']);
  assert.equal(src.summary, 'New source: Passenger list');
  assert.deepEqual(rows(src), [['Title', null, 'Passenger list', false], ['Cited for', null, 'Emigration of Mara Quill (1952)', false]]);
  assert.equal(ev.summary, 'Add a life event for Mara Quill');
  assert.deepEqual(rows(ev), [['Event', null, 'Emigration', false], ['Date', null, '1952', false], ['Source', null, 'Passenger list (new, from its own card)', false]]);
  assert.deepEqual(ev.args.cite, { sourceTitle: 'Passenger list', page: null, quality: null, transcription: '' });

  // The event card first: the source is not there yet, so nothing is written.
  const e = argsOf(ev, 'life-event');
  const yet = await S.listSources(TREE, editor);
  assert.throws(() => L.pickSource(yet, e.cite), /ailife.err.source_first/);
  // The source card, then the event card: the event, its citation, and a history row for each.
  const s = argsOf(src, 'source');
  await S.saveSource(TREE, editor, L.sourceInput(s), op('key-src-0001', s));
  const sourceId = L.pickSource(await S.listSources(TREE, editor), e.cite);
  const { id } = await E.saveEvent(TREE, editor, L.eventInput(e), op('key-event-001', e));
  await S.saveCitation(TREE, editor, L.citationInput(e.cite, sourceId, { fact: 'event', event: id }), op('key-cite-0001', e.cite));
  const events = await E.personEvents(TREE, 'mara', editor);
  assert.deepEqual(events.map((x) => [x.type, x.date]), [['baptism', '1930-04'], ['emigration', '1952']]);
  const cites = await S.personCitations(TREE, 'mara', editor);
  assert.deepEqual(cites.filter((x) => x.target.fact === 'event').map((x) => [x.sourceTitle, x.event?.type]), [['Passenger list', 'emigration']]);
  const history = await D.db(TREE).all<{ kind: string; action: string }>("SELECT kind, action FROM history WHERE kind IN ('event', 'source', 'citation') ORDER BY rowid");
  assert.deepEqual(history.map((h) => `${h.kind}:${h.action}`), ['source:added', 'event:added', 'citation:added']);
  // A lost reply is sent again with the same key: the same event comes back, and nothing is added twice.
  assert.equal((await E.saveEvent(TREE, editor, L.eventInput(e), op('key-event-001', e))).id, id);
  assert.equal((await E.personEvents(TREE, 'mara', editor)).length, 2);
  // Now that it exists, the same request cites it by id rather than proposing it again.
  const again = await card('propose_life_event', { person: 'mara', type: 'residence', place: 'Port Wren', cite: { sourceTitle: 'passenger LIST' } });
  assert.equal((again.args.cite as { source: string }).source, sourceId);
});

test('the cards refuse what the form would, and never cite an invented source', async () => {
  const refuse = async (name: string, input: unknown, pattern: RegExp, out: Proposal[] = []) => {
    const r = await propose('editor', name, input, out);
    assert.match(r.result.error ?? '', pattern, JSON.stringify(input));
    assert.equal(r.out.length, out.length);
  };
  await refuse('propose_life_event', { person: 'jon', type: 'burial', date: '2001' }, /only for someone who has died/);
  await refuse('propose_life_event', { person: 'mara', type: 'custom' }, /needs a label/);
  await refuse('propose_life_event', { person: 'mara', type: 'education', date: '1940', endDate: '1936' }, /end date is before/);
  await refuse('propose_life_event', { person: 'mara', type: 'education', date: '1940-13' }, /not a real date/);
  await refuse('propose_life_event', { person: 'nobody', type: 'education' }, /not a person in this tree/);
  await refuse('propose_life_event', { person: 'mara', type: 'residence', cite: { source: 's-invented' } }, /Never invent a source/);
  await refuse('propose_life_event', { person: 'mara', type: 'residence', cite: { sourceTitle: 'A diary nobody proposed' } }, /propose_source first/);
  await refuse('propose_source', { title: 'Eskdale Parish Register' }, /already has a source with that title/);
  await refuse('propose_citation', { source: 's-reg', fact: 'birth', person: 'mara' }, /already cited for that fact/);
  await refuse('propose_citation', { source: 's-reg', fact: 'parent', person: 'mara', parent: 'jon' }, /parent link is not recorded/);
  await refuse('propose_remove_life_record', { what: 'event', id: 'e-nope' }, /not in this family/);
  await refuse('propose_life_event', { person: 'mara', id: 'e-bapt', place: 'Eskdale' }, /nothing would change/);
});

test('a change shows before and after, keeps its starting point, and a card that has gone stale is refused', async () => {
  const p = await card('propose_life_event', { person: 'mara', id: 'e-bapt', place: 'Eskdale Green', note: '' , label: 'St Bega' });
  assert.equal(p.summary, 'Change a life event of Mara Quill');
  assert.deepEqual(rows(p), [['Details', 'not recorded', 'St Bega', false], ['Place', 'Eskdale', 'Eskdale Green', false]]);
  const a = argsOf(p, 'life-event');
  const now = (await E.personEvents(TREE, 'mara', editor)).find((x) => x.id === 'e-bapt')!;
  assert.ok(L.eventUnchanged(now, a.before));
  await E.saveEvent(TREE, editor, L.eventInput(a), op('key-change-01', a));
  const after = (await E.personEvents(TREE, 'mara', editor)).find((x) => x.id === 'e-bapt')!;
  assert.deepEqual([after.label, after.place, after.date], ['St Bega', 'Eskdale Green', '1930-04']);
  assert.ok(!L.eventUnchanged(after, a.before), 'approving the same card again finds the record moved on');

  // Taking the change back is a card too: the earlier values, from the card's own starting point.
  const back = await card('propose_life_event', { person: 'mara', id: 'e-bapt', place: a.before.place ?? '', label: a.before.label ?? '' });
  assert.deepEqual(rows(back), [['Details', 'St Bega', 'removed', true], ['Place', 'Eskdale Green', 'Eskdale', false]]);
  const b = argsOf(back, 'life-event');
  await E.saveEvent(TREE, editor, L.eventInput(b), op('key-change-02', b));
  const undone = (await E.personEvents(TREE, 'mara', editor)).find((x) => x.id === 'e-bapt')!;
  assert.ok(L.eventUnchanged(undone, a.before), 'the event is as it was before the first card');
});

test('a citation of an existing source, a change to it, and its removal', async () => {
  const p = await card('propose_citation', { source: 's-reg', fact: 'parent', person: 'jon', parent: 'mara', page: 'p. 40', quality: 'derivative' });
  assert.equal(p.summary, 'Cite Eskdale parish register');
  assert.deepEqual(rows(p), [['Fact', null, 'Jon Quill, child of Mara Quill', false], ['Source', null, 'Eskdale parish register', false], ['Page or entry', null, 'p. 40', false], ['Quality', null, 'Copy or index', false]]);
  const a = argsOf(p, 'citation');
  const { id } = await S.saveCitation(TREE, editor, L.citationInput(a, L.pickSource(await S.listSources(TREE, editor), a), a.target), op('key-cite-0002', a));

  const read = JSON.parse(await tools.runTool({ tree: TREE, role: 'editor', me: null, user: 'u1', locale: 'en' }, 'read_person', { id: 'jon' }, []));
  assert.ok(read.sources.some((s: { id: string }) => s.id === id), 'read_person gives the citation id to change or remove it');

  const change = await card('propose_citation', { id, page: 'p. 41', transcription: 'Jon, son of Mara' });
  assert.deepEqual(rows(change), [['Fact', null, 'Jon Quill, child of Mara Quill', false], ['Page or entry', 'p. 40', 'p. 41', false], ['What it says', 'not recorded', 'Jon, son of Mara', false]]);
  const c = argsOf(change, 'citation');
  await S.saveCitation(TREE, editor, L.citationInput(c, L.pickSource(await S.listSources(TREE, editor), c), c.target), op('key-cite-0003', c));
  assert.equal((await S.sourceCitations(TREE, 's-reg', editor)).find((x) => x.id === id)?.page, 'p. 41');

  const remove = await card('propose_remove_life_record', { what: 'citation', id });
  assert.equal(remove.removal, true);
  assert.deepEqual(rows(remove), [['Fact', 'Jon Quill, child of Mara Quill', 'removed', true]]);
  await S.removeCitation(TREE, editor, argsOf(remove, 'life-remove').id, op('key-cite-0004', { id }));
  assert.equal((await S.sourceCitations(TREE, 's-reg', editor)).some((x) => x.id === id), false);
});

test('removing an event or a source says what goes with it; adding and removing again leaves the record as it was', async () => {
  const before = (await E.personEvents(TREE, 'jon', editor)).length;
  const add = await card('propose_life_event', { person: 'jon', type: 'military', label: 'Coastal guard', date: '1980', endDate: '1982' });
  const a = argsOf(add, 'life-event');
  const { id } = await E.saveEvent(TREE, editor, L.eventInput(a), op('key-mil-0001', a));
  await S.saveCitation(TREE, editor, L.citationInput({ page: null, quality: null, transcription: '' }, 's-reg', { fact: 'event', event: id }), op('key-mil-0002', { id }));

  const remove = await card('propose_remove_life_record', { what: 'event', id });
  assert.equal(remove.summary, 'Remove a life event of Jon Quill');
  assert.deepEqual(rows(remove), [['Event', 'Military service (Coastal guard), 1980', 'removed', true], ['Goes with it', null, '1 citation', true]]);
  await E.removeEvent(TREE, editor, argsOf(remove, 'life-remove').id, op('key-mil-0003', { id }));
  assert.equal((await E.personEvents(TREE, 'jon', editor)).length, before, 'the event is gone, and its citation with it');

  const list = await S.listSources(TREE, editor);
  const reg = list.find((s) => s.id === 's-reg')!;
  const drop = await card('propose_remove_life_record', { what: 'source', id: 's-reg' });
  assert.deepEqual(drop.args, { what: 'source', id: 's-reg', citations: reg.citations });
  assert.ok(rows(drop).some((r) => r[0] === 'Goes with it'));
});

test('the prompt tells an editor to cite a named source and never to invent one; a contributor gets no such rule', () => {
  const base = { locale: 'en' as const, family: 'F', tree: TREE, readerName: null, readerId: null, kinToReader: null, canPropose: true };
  const p = systemPrompt({ ...base, role: 'editor' });
  assert.match(p, /according to the passenger list/);
  assert.match(p, /Never invent a source/);
  assert.match(p, /propose_life_event/);
  assert.doesNotMatch(systemPrompt({ ...base, role: 'contributor' }), /propose_life_event/);
});
