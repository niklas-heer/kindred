// node --test src/lib/ai-abilities.test.ts — what the assistant can change, ask and show: every tool's permissions, forged and
// private ids, removals, the question card's once-only answer, widgets built from the tree, and the prompt's rules. Fake provider,
// private data folder.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-abilities-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-abilities-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const chat = await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts');
const conversations = await load<typeof import('./ai/conversations.server.ts')>('/src/lib/ai/conversations.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const tools = await load<typeof import('./ai/tools.server.ts')>('/src/lib/ai/tools.server.ts');
const blocks = await load<typeof import('./ai/blocks.server.ts')>('/src/lib/ai/blocks.server.ts');
const { systemPrompt } = await load<typeof import('./ai/prompt.ts')>('/src/lib/ai/prompt.ts');
const merge = await load<typeof import('../components/assistant/apply-merge.ts')>('/src/components/assistant/apply-merge.ts');
const { chipsFor } = await load<typeof import('../components/assistant/widgets/chips.ts')>('/src/components/assistant/widgets/chips.ts');
const { pageFrom } = await load<typeof import('../components/assistant/page-context.ts')>('/src/components/assistant/page-context.ts');
const { CHANGED_SINCE_OPENED } = await load<typeof import('./fields/model.ts')>('/src/lib/fields/model.ts');

import type { Role } from './roles.ts';
import type { Proposal } from './ai/types.ts';

const TREE = 'fam';
const db = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
db.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', 'Old line'), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, motto, arms) VALUES ('h1', 'Stone', 'Hold fast', '{"field":"azure","division":"plain","charge":"lion","chargeTincture":"or"}');
  INSERT INTO person (id, given, surname, born, living, house) VALUES
    ('grandma', 'Gerda', 'Stone', '1930-02-02', 0, 'h1'),
    ('ada', 'Ada', 'Stone', '1960-03-15', 1, 'h1'),
    ('bob', 'Bob', 'Stone', '1958-07-01', 1, 'h1'),
    ('cleo', 'Cleo', 'Stone', '1990-11-20', 1, NULL),
    ('dan', 'Dan', 'Marsh', '1959-05-05', 1, NULL);
  UPDATE person SET sex = 'f' WHERE id IN ('grandma', 'ada', 'cleo');
  UPDATE person SET sex = 'm' WHERE id IN ('bob', 'dan');
  INSERT INTO parent (child, parent) VALUES ('ada', 'grandma'), ('bob', 'grandma'), ('cleo', 'bob');
  INSERT INTO partnership (id, a, b, kind, start, place) VALUES ('u1', 'ada', 'dan', 'marriage', '1985-11-20', 'Bonn');
  INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner) VALUES
    ('fav', 'ada', 'favourites', 'colour', '{"text":"blue"}', 0, 'family', NULL),
    ('secret', 'ada', 'medical', 'condition', '{"note":"SECRET_EDITOR"}', 1, 'editors', NULL),
    ('mine', 'ada', 'notes', 'general', '{"text":"SECRET_PERSONAL"}', 2, 'personal', 'u1'),
    ('anni', 'cleo', 'dates', 'anniversary', '{"date":"2010-11-21","note":""}', 0, 'editors', NULL);
  INSERT INTO story (id, person, kind, body, author, at) VALUES ('s1', 'ada', 'note', 'A story.', 'Anna', '2020-01-01T00:00:00Z');
  INSERT INTO album (id, name, at) VALUES ('alb', 'Summer', '2020-01-01');
`);
db.close();

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Anna', 'handle-abilities', Date.now());
await setup.setUpFamilyAi(TREE, 'u1', { provider: 'anthropic', model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 50_000_000, customPrices: {}, apiKey: 'sk-test-abcdefgh1234' });

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const ctx = (role: Role, extra: Partial<Parameters<typeof tools.runTool>[0]> = {}) => ({ tree: TREE, role, me: 'cleo', user: 'u1', locale: 'en' as const, ...extra });
async function propose(role: Role, name: string, input: unknown) {
  const out: Proposal[] = [];
  const text = await tools.runTool(ctx(role), name, input, out);
  return { out, result: JSON.parse(text) as { error?: string; proposed?: boolean } };
}
const names = (role: Role) => tools.toolsFor(role).tools.map((t) => t.name);

function optionalCount(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((n: number, item) => n + optionalCount(item), 0);
  const s = node as { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };
  let count = s.properties ? Object.keys(s.properties).filter((k) => !s.required?.includes(k)).length : 0;
  for (const [key, value] of Object.entries(s)) if (!['enum', 'const', 'default', 'examples', 'required'].includes(key)) count += optionalCount(value);
  return count;
}

test('every tool stays under the provider schema cap', () => {
  for (const t of tools.toolsFor('steward', { web: true, faces: true, avatar: true }).tools) {
    assert.ok(optionalCount(t.parameters) <= 17, `${t.name}: ${optionalCount(t.parameters)} optional properties`);
  }
});

test('nothing outside family data can be proposed', () => {
  for (const n of names('steward')) assert.doesNotMatch(n, /access|role|passkey|key|share|budget|invite/, n);
});

test('a viewer can read, ask and show, but is offered no change', () => {
  const v = names('viewer');
  assert.ok(v.includes('search_people') && v.includes('ask_reader') && v.includes('show_person') && v.includes('find_relatives'));
  assert.equal(v.filter((n) => n.startsWith('propose_')).length, 0);
  assert.equal(tools.toolsFor('viewer').proposals, false);
});

test('each role is offered exactly what it may do by hand', () => {
  const c = names('contributor');
  assert.ok(c.includes('propose_add_story') && c.includes('propose_photo_tags') && c.includes('propose_research_note'));
  assert.ok(!c.includes('propose_edit_names') && !c.includes('propose_remove_person') && !c.includes('propose_unlink'));
  const e = names('editor');
  assert.ok(e.includes('propose_edit_names') && e.includes('propose_remove_person') && e.includes('propose_place_pin'));
  assert.ok(!e.includes('propose_house_details') && !e.includes('propose_family_details') && !e.includes('propose_album_delete'));
  const s = names('steward');
  assert.ok(s.includes('propose_house_details') && s.includes('propose_family_details') && s.includes('propose_album_delete'));
});

test('a viewer calling a proposal tool anyway is refused and nothing is shown', async () => {
  for (const [name, input] of [['propose_edit_names', { person: 'ada', nickname: 'X' }], ['propose_remove_person', { person: 'ada' }], ['propose_add_story', { person: 'ada', kind: 'note', body: 'x' }]] as const) {
    const r = await propose('viewer', name, input);
    assert.match(r.result.error ?? '', /may not/, name);
    assert.equal(r.out.length, 0);
  }
});

test('a steward-only change is refused for an editor', async () => {
  for (const [name, input] of [['propose_house_details', { house: 'h1', name: 'New' }], ['propose_family_details', { name: 'New' }], ['propose_album_delete', { album: 'alb' }], ['propose_house_members', { house: 'h1', add: ['cleo'] }]] as const) {
    const r = await propose('editor', name, input);
    assert.match(r.result.error ?? '', /may not/, name);
    assert.equal(r.out.length, 0);
  }
});

test('an editor-only change is refused for a contributor', async () => {
  for (const [name, input] of [['propose_remove_field', { person: 'ada', field: 'fav' }], ['propose_unlink', { person: 'ada', relative: 'grandma', relation: 'parent' }], ['propose_partnership', { partnership: 'u1', start: '1986' }]] as const) {
    assert.match((await propose('contributor', name, input)).result.error ?? '', /may not/, name);
  }
});

test('a forged id from another family is refused', async () => {
  const cases: [string, unknown][] = [
    ['propose_edit_names', { person: 'other-family-person', nickname: 'X' }],
    ['propose_remove_person', { person: 'other-family-person' }],
    ['propose_remove_field', { person: 'ada', field: 'other-family-field' }],
    ['propose_update_field', { person: 'ada', field: 'other-family-field', value: { text: 'x' } }],
    ['propose_remove_story', { person: 'ada', story: 'other-family-story' }],
    ['propose_partnership', { partnership: 'other-family-union', start: '1990' }],
    ['propose_partnership_end', { partnership: 'other-family-union', end: '1990' }],
    ['propose_house_details', { house: 'other-family-house', name: 'X' }],
    ['propose_album_delete', { album: 'other-family-album' }],
    ['propose_remove_photo', { key: 'gallery/other-family.jpg' }],
    ['propose_research_note', { project: 'other-family-project', title: 'T', body: 'B' }],
    ['show_person', { person: 'other-family-person' }],
    ['ask_reader', { question: 'Who is it?', kind: 'person', people: ['other-family-person'] }],
  ];
  for (const [name, input] of cases) {
    const out: Proposal[] = [];
    const c = { ...ctx('steward'), blocks: [] };
    const r = JSON.parse(await tools.runTool(c, name, input, out)) as { error?: string };
    assert.ok(r.error, `${name} must be refused`);
    assert.equal(out.length, 0, name);
    assert.equal(c.blocks.length, 0, name);
  }
});

test('Personal-level fields are neither read nor proposable, even by their owner', async () => {
  const read = await tools.runTool(ctx('steward'), 'read_person', { id: 'ada' }, []);
  assert.doesNotMatch(read, /SECRET_PERSONAL/);
  assert.match(read, /SECRET_EDITOR/, 'an editor-level field is read at this role, with its id');
  assert.match((await propose('steward', 'propose_remove_field', { person: 'ada', field: 'mine' })).result.error ?? '', /not on this person/);
  assert.match((await propose('steward', 'propose_update_field', { person: 'ada', field: 'mine', value: { text: 'x' } })).result.error ?? '', /not on this person/);
  assert.match(await tools.runTool(ctx('viewer'), 'read_person', { id: 'ada' }, []), /favourites/);
  assert.doesNotMatch(await tools.runTool(ctx('viewer'), 'read_person', { id: 'ada' }, []), /SECRET_EDITOR/);
});

test('a detail cannot be moved to Personal through chat', async () => {
  const r = await propose('editor', 'propose_update_field', { person: 'ada', field: 'fav', visibility: 'personal' });
  assert.match(r.result.error ?? '', /did not fit/);
});

test('removals are marked as removals, on the card and in its rows', async () => {
  const cases: [string, unknown][] = [
    ['propose_remove_field', { person: 'ada', field: 'fav' }],
    ['propose_remove_story', { person: 'ada', story: 's1' }],
    ['propose_unlink', { person: 'ada', relative: 'grandma', relation: 'parent' }],
    ['propose_unlink', { person: 'ada', relative: 'dan', relation: 'partner' }],
    ['propose_remove_person', { person: 'dan' }],
    ['propose_album_delete', { album: 'alb' }],
  ];
  for (const [name, input] of cases) {
    const { out } = await propose('steward', name, input);
    assert.equal(out.length, 1, name);
    assert.equal(out[0].removal, true, name);
    assert.ok(out[0].diff.some((d) => d.removed), name);
  }
  const mixed = await propose('editor', 'propose_edit_names', { person: 'ada', nickname: 'Addie', clear: ['surname'] });
  assert.equal(mixed.out[0].removal, undefined, 'a change that also removes is not a whole removal');
  assert.ok(mixed.out[0].diff.some((d) => d.removed));
  assert.equal((await propose('editor', 'propose_edit_facts', { person: 'ada', clear: ['sex'] })).out[0].removal, true);
  assert.deepEqual((await propose('editor', 'propose_edit_facts', { person: 'ada', clear: ['born'] })).out[0].args.clear, ['born']);
});

test('faith, favourites and further names go through the same field and name rules', async () => {
  const faith = await propose('editor', 'propose_add_field', { person: 'cleo', type: 'religion', value: { name: 'Lutheran' } });
  assert.equal(faith.out[0].args.visibility, 'editors', 'faith starts at the editors’ level');
  const colour = await propose('editor', 'propose_update_field', { person: 'ada', field: 'fav', value: { text: 'green' } });
  assert.deepEqual(colour.out[0].args.value, { text: 'green' });
  assert.match((await propose('editor', 'propose_update_field', { person: 'ada', field: 'fav', value: { text: '' } })).result.error ?? '', /does not fit/);
  const names2 = await propose('editor', 'propose_edit_names', { person: 'ada', furtherGiven: ['Maria', 'Luise'] });
  assert.deepEqual(names2.out[0].args.furtherGiven, ['Maria', 'Luise']);
  assert.deepEqual(names2.out[0].args.before, { furtherGiven: [] });
  assert.match((await propose('editor', 'propose_edit_names', { person: 'ada', surname: 'Stone' })).result.error ?? '', /nothing would change/);
});

test('a marriage can be corrected and ended on its id', async () => {
  const p = await propose('editor', 'propose_partnership', { partnership: 'u1', start: '1986-06-01', clear: ['place'] });
  assert.deepEqual({ ...p.out[0].args }, { partnership: 'u1', kind: 'marriage', start: '1986-06-01', place: null });
  const end = await propose('editor', 'propose_partnership_end', { partnership: 'u1', end: '2001', reason: 'divorce' });
  assert.deepEqual({ ...end.out[0].args }, { partnership: 'u1', end: '2001', endReason: 'divorce' });
  assert.match((await propose('editor', 'propose_partnership_end', { partnership: 'u1', end: 'not-a-date' })).result.error ?? '', /not a real date/);
});

test('approving lays a card over the record', () => {
  const snap = { id: 'ada', revision: 4, given: 'Ada', furtherGiven: [], surname: 'Stone', currentGiven: null, currentSurname: null, nickname: null, sex: 'f', born: null, bornPlace: null, died: null, diedPlace: null, living: true, title: null, epithet: null, occupation: null, occupationCode: null, bio: null, fields: [{ id: 'f', type: 'notes', label: '', value: { text: 'a' }, ord: 0, visibility: 'family', updatedAt: '', updatedBy: '' }] } as never;
  assert.equal(merge.mergeEdit(snap, { nickname: 'Addie', before: { nickname: null } })!.nickname, 'Addie');
});

test('a card whose starting point changed is refused, and one already applied counts as done', () => {
  const snap = { given: 'Ada', furtherGiven: [], surname: 'Stone', currentGiven: null, currentSurname: null, nickname: 'Addie', sex: 'f', born: null, bornPlace: null, died: null, diedPlace: null, living: true, title: null, epithet: null, occupation: null, occupationCode: null, bio: null, fields: [{ id: 'f', type: 'notes', label: '', value: { text: 'a' }, ord: 0, visibility: 'family', updatedAt: '', updatedBy: '' }] } as never;
  assert.throws(() => merge.mergeEdit(snap, { nickname: 'New', before: { nickname: 'Old' } }), { message: CHANGED_SINCE_OPENED });
  assert.equal(merge.mergeEdit(snap, { nickname: 'Addie', before: { nickname: null } }), null);
  assert.equal(merge.mergeEdit(snap, { clear: ['title'], before: {} }), null);
  assert.throws(() => merge.mergeField(snap, { field: 'gone', label: '', value: {}, visibility: 'family', before: { label: '', value: {}, visibility: 'family' } }), { message: CHANGED_SINCE_OPENED });
  const next = merge.mergeField(snap, { field: 'f', label: '', value: { text: 'b' }, visibility: 'family', before: { label: '', value: { text: 'a' }, visibility: 'family' } })!;
  assert.deepEqual(next[0].value, { text: 'b' });
  assert.throws(() => merge.mergeField(snap, { field: 'f', label: '', value: { text: 'b' }, visibility: 'family', before: { label: '', value: { text: 'other' }, visibility: 'family' } }), { message: CHANGED_SINCE_OPENED });
});

test('a contributor can only change their own research', async () => {
  const research = await load<typeof import('./research.server.ts')>('/src/lib/research.server.ts');
  const mine = await research.saveProject(TREE, { id: 'u1', name: 'Anna', role: 'contributor' }, { title: 'Mine', summary: '', private: false }, undefined);
  const theirs = await research.saveProject(TREE, { id: 'u2', name: 'Berta', role: 'contributor' }, { title: 'Theirs', summary: '', private: false }, undefined);
  assert.equal((await propose('contributor', 'propose_research_project', { id: mine.id, title: 'Mine 2' })).out.length, 1);
  assert.match((await propose('contributor', 'propose_research_project', { id: theirs.id, title: 'X' })).result.error ?? '', /own research/);
  assert.equal((await propose('editor', 'propose_research_project', { id: theirs.id, title: 'X' })).out.length, 1);
  assert.match((await propose('contributor', 'propose_research_project', { title: 'P', private: true })).result.error ?? '', /editor/);
  assert.equal((await propose('editor', 'propose_remove_research', { what: 'project', project: mine.id })).out[0].removal, true);
});

test('kinship: “my aunt” is found without asking', () => {
  return tools.runTool(ctx('viewer'), 'find_relatives', { relation: 'aunt_uncle' }, []).then((text) => {
    const r = JSON.parse(text) as { people: { id: string; relation: string }[] };
    assert.deepEqual(r.people.map((p) => [p.id, p.relation]), [['ada', 'aunt']]);
  });
});

test('kinship: without a chosen person it says so rather than guessing', async () => {
  const r = JSON.parse(await tools.runTool({ ...ctx('viewer'), me: null }, 'find_relatives', { relation: 'parent' }, [])) as { error?: string };
  assert.match(r.error ?? '', /has not said who they are/);
});

test('widgets are built from the tree, and the model gives only ids', async () => {
  const c = { ...ctx('viewer'), blocks: [] as never[] };
  assert.deepEqual(JSON.parse(await tools.runTool(c, 'show_person', { person: 'ada', name: 'Hacked' }, [])).shown, true);
  assert.deepEqual(c.blocks[0], { ...(c.blocks[0] as object), type: 'widget', spec: { kind: 'person', person: 'ada' } });
  const data = await blocks.buildWidget(TREE, 'viewer', 'cleo', { kind: 'person', person: 'ada' });
  assert.equal(data?.kind === 'person' && data.person.name, 'Ada Stone');
  assert.equal(data?.kind === 'person' && data.kin?.label, 'aunt');
  const path = await blocks.buildWidget(TREE, 'viewer', null, { kind: 'path', from: 'cleo', to: 'ada' });
  assert.deepEqual(path?.kind === 'path' && path.steps.map((s) => s.id), ['cleo', 'bob', 'grandma', 'ada']);
  const family = await blocks.buildWidget(TREE, 'viewer', null, { kind: 'tree', person: 'ada' });
  assert.deepEqual(family?.kind === 'tree' && [family.parents.map((p) => p.id), family.partners.map((p) => p.id), family.siblings.map((p) => p.id)], [['grandma'], ['dan'], ['bob']]);
  const life = await blocks.buildWidget(TREE, 'viewer', null, { kind: 'timeline', person: 'ada' });
  assert.deepEqual(life?.kind === 'timeline' && life.events.map((e) => e.kind), ['born', 'married']);
  assert.equal(await blocks.buildWidget(TREE, 'viewer', null, { kind: 'person', person: 'gone' }), null);
});

test('the date widget follows the reader’s privacy level', async () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const viewer = await blocks.buildWidget(TREE, 'viewer', null, { kind: 'dates', days: 30 }, now);
  const editor = await blocks.buildWidget(TREE, 'editor', null, { kind: 'dates', days: 30 }, now);
  const rows = (d: typeof viewer) => (d?.kind === 'dates' ? d.rows.map((r) => [r.kind, r.who.id, r.on]) : []);
  assert.deepEqual(rows(viewer), [['anniversary', 'ada', '2026-11-20'], ['birthday', 'cleo', '2026-11-20']]);
  assert.deepEqual(rows(editor), [['anniversary', 'ada', '2026-11-20'], ['birthday', 'cleo', '2026-11-20'], ['anniversary', 'cleo', '2026-11-21']], 'an editors-level date appears only for editors');
});

test('the gap checklist lists what is missing', async () => {
  const gaps = await blocks.buildWidget(TREE, 'viewer', null, { kind: 'gaps', person: 'ada' });
  assert.ok(gaps?.kind === 'gaps' && gaps.rows.some((r) => r.who.id === 'ada' && r.gaps.length > 0));
});

const newChat = () => conversations.newThread(TREE, 'u1');
const send = (conv: string, text: string, extra: object = {}, role: Role = 'editor') => chat.sendMessage({ tree: TREE, user: 'u1', role, me: 'cleo', text, locale: 'en', conv, ...extra });
const replyOf = (items: { role: string }[]) => items[items.length - 1] as import('./ai/types.ts').ChatItem;

test('every fake phrase reaches its widget and is stored with the reply', async () => {
  const kinds = { person: 'person', tree: 'tree', timeline: 'timeline', dates: 'dates', gaps: 'gaps', path: 'path' };
  for (const [phrase, kind] of Object.entries(kinds)) {
    const reply = replyOf((await send(await newChat(), `FAKE-WIDGET ${phrase}`)).items);
    const block = reply.blocks?.[0];
    assert.equal(block?.type === 'widget' && block.spec.kind, kind, phrase);
  }
});

test('every fake question kind reaches its card', async () => {
  for (const kind of ['single', 'multiple', 'person', 'date', 'text']) {
    const reply = replyOf((await send(await newChat(), `FAKE-ASK ${kind}`)).items);
    const block = reply.blocks?.[0];
    assert.equal(block?.type === 'question' && block.kind, kind);
  }
});

test('one request becomes one set of proposals', async () => {
  const reply = replyOf((await send(await newChat(), 'FAKE-APPLY')).items);
  assert.deepEqual(reply.proposals?.map((p) => p.kind), ['edit-person', 'add-field', 'add-story']);
});

test('a viewer’s reply carries a widget but no proposal', async () => {
  const reply = replyOf((await send(await newChat(), 'FAKE-WIDGET person', {}, 'viewer')).items);
  assert.equal(reply.blocks?.length, 1);
  assert.equal(reply.proposals, undefined);
});

test('a question is answered once, survives a reload, and is the next message', async () => {
  const conv = await newChat();
  const reply = replyOf((await send(conv, 'FAKE-ASK single')).items);
  const q = reply.blocks![0] as import('./ai/blocks.ts').QuestionBlock;
  const answer = (a: object) => blocks.answerQuestion({ tree: TREE, user: 'u1', role: 'editor', conv, itemId: reply.id, questionId: q.id, answer: a, mayRead: conversations.mayRead as never });
  await assert.rejects(answer({ choices: ['Not an option'] }), { message: 'chat.err.questionBad' });
  assert.deepEqual(await answer({ choices: ['Mother’s side'] }), { text: 'Mother’s side' });
  await assert.rejects(answer({ choices: ['Father’s side'] }), { message: 'chat.err.questionAnswered' });
  const after = (await conversations.loadChat(TREE, 'u1', 'editor', conv)).items;
  const stored = after.at(-1)!.blocks![0] as import('./ai/blocks.ts').QuestionBlock;
  assert.equal(stored.answer?.text, 'Mother’s side');
  // Another reader's turn is out of reach.
  await assert.rejects(blocks.answerQuestion({ tree: TREE, user: 'u2', role: 'editor', conv, itemId: reply.id, questionId: q.id, answer: { text: 'x' }, mayRead: conversations.mayRead as never }), { message: 'chat.err.questionGone' });
});

test('“something else” and a person answer are checked on the server', async () => {
  const conv = await newChat();
  const reply = replyOf((await send(conv, 'FAKE-ASK person')).items);
  const q = reply.blocks![0];
  const answer = (a: object) => blocks.answerQuestion({ tree: TREE, user: 'u1', role: 'editor', conv, itemId: reply.id, questionId: q.id, answer: a, mayRead: conversations.mayRead as never });
  await assert.rejects(answer({ person: 'other-family-person' }), { message: 'chat.err.questionBad' });
  assert.deepEqual(await answer({ person: 'ada' }), { text: 'Ada Stone' });
  const stored = (await conversations.loadChat(TREE, 'u1', 'editor', conv)).items.at(-1)!.blocks!;
  assert.match(blocks.blocksNote(stored), /person id: ada/, 'the model still gets the id');
});

test('a question passed by a later message can no longer be answered', async () => {
  const conv = await newChat();
  const reply = replyOf((await send(conv, 'FAKE-ASK text')).items);
  const q = reply.blocks![0];
  await send(conv, 'Never mind.');
  await assert.rejects(blocks.answerQuestion({ tree: TREE, user: 'u1', role: 'editor', conv, itemId: reply.id, questionId: q.id, answer: { text: 'x' }, mayRead: conversations.mayRead as never }), { message: 'chat.err.questionStale' });
});

test('a widget is read from the stored turn, and a demoted reader loses it with the turn', async () => {
  const conv = await newChat();
  const reply = replyOf((await send(conv, 'FAKE-WIDGET person')).items);
  const get = (role: Role) => blocks.widgetFor({ tree: TREE, user: 'u1', role, me: null, conv, itemId: reply.id, blockId: reply.blocks![0].id, mayRead: conversations.mayRead as never });
  assert.equal((await get('editor'))?.kind, 'person');
  assert.equal(await get('viewer'), null, 'an editor-tier turn is not readable by a viewer');
  assert.equal(await blocks.widgetFor({ tree: TREE, user: 'u2', role: 'editor', me: null, conv, itemId: reply.id, blockId: reply.blocks![0].id, mayRead: conversations.mayRead as never }), null);
});

test('later turns remember what was asked, without repeating a widget', async () => {
  const note = blocks.blocksNote([{ type: 'question', id: 'q', kind: 'text', question: 'Which?', answer: { text: 'That one', at: 1 } }, { type: 'widget', id: 'w', spec: { kind: 'person', person: 'ada' } }]);
  assert.match(note, /Which\?.*That one/);
  assert.match(note, /person widget for ada/);
});

test('the page decides who “this person” is, and a forged person is ignored', async () => {
  const seen = replyOf((await send(await newChat(), 'FAKE-THIS', { page: { path: `/${TREE}/person/ada`, personId: 'ada' } })).items);
  assert.match(seen.text, /read the person on the page/);
  const forged = replyOf((await send(await newChat(), 'FAKE-THIS', { page: { path: `/${TREE}/person/x`, personId: 'other-family-person' } })).items);
  assert.match(forged.text, /no person on this page/);
});

test('“my aunt” through the fake provider uses kinship, not a question', async () => {
  const reply = replyOf((await send(await newChat(), 'FAKE-MY aunt_uncle')).items);
  assert.match(reply.text, /found your relatives/);
  assert.equal(reply.blocks, undefined);
});

test('the prompt holds the intent rules', () => {
  const base = { locale: 'en' as const, family: 'F', tree: 'fam', readerName: 'Cleo Stone', readerId: 'cleo', kinToReader: null, canPropose: true, role: 'editor' };
  const p = systemPrompt({ ...base, page: { path: '/fam/person/ada', personId: 'ada', personName: 'Ada Stone' } });
  assert.match(p, /Looking at: Ada Stone \[id: ada\]/);
  assert.match(p, /find_relatives for “my aunt”/);
  assert.match(p, /Search before you ever ask/);
  assert.match(p, /make a sensible assumption, act on it, and state it/);
  assert.match(p, /Ask only when the answer would change the result/);
  assert.match(p, /one coherent set of proposals/);
  assert.match(p, /only when the reader clearly asked for that removal/);
  assert.match(p, /\[Access\]\(\/fam\/access\)/, 'accounts and keys: says where, with a link');
  assert.match(p, /\[AI settings\]\(\/fam\/settings\/ai\)/);
  assert.doesNotMatch(systemPrompt({ ...base, page: { path: '/fam/atlas' } }), /Looking at:/);
  assert.match(systemPrompt({ ...base, readerName: null, readerId: null }), /has not said who they are/);
  assert.doesNotMatch(systemPrompt({ ...base, canPropose: false }), /coherent set of proposals/);
});

test('the page is read from the URL', () => {
  assert.deepEqual(pageFrom('/fam/person/ada', {}, 'fam'), { path: '/fam/person/ada', personId: 'ada' });
  assert.deepEqual(pageFrom('/fam', { sel: 'bob', focus: 'ada' }, 'fam'), { path: '/fam', personId: 'bob' });
  assert.deepEqual(pageFrom('/fam/atlas', { focus: 'ada' }, 'fam'), { path: '/fam/atlas' });
});

test('quick replies follow what was shown, and wait for an open question', () => {
  const name = (id: string) => (id === 'ada' ? 'Ada Stone' : undefined);
  const item = (extra: object) => ({ id: 'i', role: 'assistant', text: '', at: 1, ...extra }) as never;
  assert.deepEqual(chipsFor(item({ blocks: [{ type: 'widget', id: 'w', spec: { kind: 'tree', person: 'ada' } }] }), undefined, name).map((c) => c.key), ['chat.chip.timeline', 'chat.chip.gaps']);
  assert.deepEqual(chipsFor(item({ blocks: [{ type: 'question', id: 'q', kind: 'text', question: 'x' }] }), undefined, name), []);
  assert.deepEqual(chipsFor(item({}), undefined, name).map((c) => c.key), ['chat.chip.birthdays', 'chat.chip.anyGaps']);
  assert.equal(chipsFor(item({}), { id: 'bob', given: 'Bob' }, name)[0].name, 'Bob');
});
