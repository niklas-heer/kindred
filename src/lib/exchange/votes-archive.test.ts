// node --test src/lib/exchange/votes-archive.test.ts: the Markdown archive's votes/ files. An open vote that has closed
// lists each ballot by name; a secret one only its totals and who voted; a vote still open gives no result at all.
// A private data folder; invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-votes-archive-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('../votes/votes.server.ts')>('/src/lib/votes/votes.server.ts');
const K = await load<typeof import('../votes/voter-key.server.ts')>('/src/lib/votes/voter-key.server.ts');
const { readTree } = await load<typeof import('./model.ts')>('/src/lib/exchange/model.ts');
const { markdownArchive } = await load<typeof import('./markdown.ts')>('/src/lib/exchange/markdown.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const who = (id: string, name: string, role: 'contributor' | 'steward' = 'contributor') => ({ id, name, role, person: null, personConfirmed: false });
const ada = who('acc-ada', 'Ada Alder');
const bo = who('acc-bo', 'Bo Birch');
const eve = who('acc-eve', 'Eve Elm', 'steward');
const DAY = 86_400_000;
const START = new Date('2026-03-01T10:00:00.000Z');

async function tree(id: string): Promise<string> {
  await db.store.ensureTree(id);
  return id;
}
const optionOf = async (t: string, vote: string, label: string) => (await db.db(t).get<{ id: string }>('SELECT id FROM vote_option WHERE vote = ? AND label = ?', vote, label))!.id;
const start = (t: string, question: string, over: object = {}, from = START) =>
  V.createVote(t, ada, { question, kind: 'single', secret: false, addOptions: false, guests: true, closesAt: new Date(from.getTime() + 7 * DAY).toISOString(), options: ['Beach', 'Lake'], ...over }, undefined, from);
const archiveOf = async (t: string, name: string, withKey = true) => {
  const { files } = markdownArchive(await readTree(db.db(t), withKey ? { voterKey: K.voterKey } : {}), new Set(), new Date('2026-11-15T00:00:00Z'));
  return files.find((f) => f.path === name)?.data as string | undefined;
};
const vote = (t: string, id: string, w: ReturnType<typeof who>, labels: string[], at: Date) =>
  Promise.all(labels.map((l) => optionOf(t, id, l))).then((ids) => V.castBallot(t, { kind: 'member', who: w }, id, ids, at));

test('a closed open vote lists each ballot by name', async () => {
  const t = await tree('archive-open');
  const { id } = await start(t, 'Where do we meet?');
  const at = new Date(START.getTime() + DAY);
  await vote(t, id, ada, ['Beach'], at);
  await vote(t, id, bo, ['Lake'], at);
  await V.castBallot(t, { kind: 'guest', key: 'g:one', name: 'Gus Guest', link: 'l', net: 1 }, id, [await optionOf(t, id, 'Beach')], at);
  await db.db(t).run('UPDATE vote SET closed_at = closes_at');
  const text = (await archiveOf(t, 'votes/2026.md'))!;
  assert.match(text, /Where do we meet\?/);
  assert.match(text, /Beach: 2/);
  assert.match(text, /^- Ada Alder: Beach/m);
  assert.match(text, /^- Bo Birch: Lake/m);
  assert.match(text, /^- Gus Guest \(guest\): Beach/m);
});

test('a secret vote has its totals and who voted, never who chose what', async () => {
  const t = await tree('archive-secret');
  const { id } = await start(t, 'Which cake?', { secret: true, options: ['Plum', 'Apple'] });
  const at = new Date(START.getTime() + DAY);
  await vote(t, id, ada, ['Plum'], at);
  await vote(t, id, bo, ['Plum'], at);
  await vote(t, id, eve, ['Apple'], at);
  await db.db(t).run('UPDATE vote SET closed_at = closes_at');
  const text = (await archiveOf(t, 'votes/2026.md'))!;
  assert.match(text, /Plum: 2/);
  assert.match(text, /Apple: 1/);
  assert.match(text, /Voted: Ada Alder, Bo Birch, Eve Elm/);
  assert.doesNotMatch(text, /^- Ada Alder: /m, 'no ballot by name');
  assert.doesNotMatch(text, /Ada Alder.*Plum|Plum.*Ada Alder/);
});

test('a struck guest does not count in a secret vote, and a vote still open gives no result', async () => {
  const t = await tree('archive-struck');
  const from = new Date();
  const { id } = await start(t, 'Which cake?', { secret: true, options: ['Plum', 'Apple'] }, from);
  const at = new Date(from.getTime() + 1000);
  await vote(t, id, ada, ['Plum'], at);
  await V.castBallot(t, { kind: 'guest', key: 'g:one', name: 'Gus Guest', link: 'l', net: 1 }, id, [await optionOf(t, id, 'Apple')], at);
  const voterRow = (await db.db(t).get<{ id: string }>("SELECT id FROM vote_voter WHERE guest_key = 'g:one'"))!.id;
  await V.strikeVoter(t, eve, id, voterRow, true, undefined, at);
  const open = (await archiveOf(t, `votes/${from.getFullYear()}.md`))!;
  assert.match(open, /Still open/);
  assert.doesNotMatch(open, /Plum: \d|Apple: \d/, 'no live tallies of a secret vote, or of any open one');
  await db.db(t).run('UPDATE vote SET closed_at = ?', new Date(from.getTime() + 2000).toISOString());
  const text = (await archiveOf(t, `votes/${from.getFullYear()}.md`))!;
  assert.match(text, /Plum: 1/);
  assert.match(text, /Apple: 0/);
  assert.match(text, /Gus Guest \(guest, struck\)/);
});

test('a ranked vote shows each round, and a tree without votes writes no votes/ file', async () => {
  const t = await tree('archive-ranked');
  assert.equal(await archiveOf(t, 'votes/2026.md'), undefined);
  const { id } = await start(t, 'Order of speeches', { kind: 'ranked', options: ['Ada', 'Bo', 'Cy'] });
  const at = new Date(START.getTime() + DAY);
  const more = [who('acc-cy', 'Cy Cork'), who('acc-di', 'Di Dale')];
  await vote(t, id, ada, ['Ada'], at);
  await vote(t, id, bo, ['Ada'], at);
  await vote(t, id, eve, ['Bo', 'Cy'], at);
  await vote(t, id, more[0]!, ['Cy'], at);
  await vote(t, id, more[1]!, ['Cy'], at);
  await db.db(t).run('UPDATE vote SET closed_at = closes_at');
  const text = (await archiveOf(t, 'votes/2026.md'))!;
  assert.match(text, /Round 1/);
  assert.match(text, /Round 2/);
  assert.match(text, /Winner: Cy/);
});

test('without the server\'s key a struck guest of a secret vote does not make the read fail, and the archive says so', async () => {
  const t = await tree('archive-nokey');
  const { id } = await start(t, 'Which cake?', { secret: true, options: ['Plum', 'Apple'] });
  const at = new Date(START.getTime() + DAY);
  await vote(t, id, ada, ['Plum'], at);
  await V.castBallot(t, { kind: 'guest', key: 'g:one', name: 'Gus Guest', link: 'l', net: 1 }, id, [await optionOf(t, id, 'Apple')], at);
  await V.strikeVoter(t, eve, id, (await db.db(t).get<{ id: string }>("SELECT id FROM vote_voter WHERE guest_key = 'g:one'"))!.id, true, undefined, at);
  await db.db(t).run('UPDATE vote SET closed_at = closes_at');
  const text = (await archiveOf(t, 'votes/2026.md', false))!;
  assert.match(text, /Apple: 1/, 'nothing is left out that cannot be identified');
  assert.match(text, /could not tell which ballots were theirs/);
});

test('the comments on a vote are under it, open or closed, written as text', async () => {
  const closed = await tree('archive-comments');
  const { id } = await start(closed, 'Which cake?');
  await db.db(closed).run("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('c1', 'vote', ?, 'acc-bo', 'Bo Birch', 'Plum, *please*', '2026-03-02T09:00:00.000Z')", id);
  await db.db(closed).run('UPDATE vote SET closed_at = closes_at');
  assert.match((await archiveOf(closed, 'votes/2026.md'))!, /Nobody voted\.[^]*### Comments\n\n\*\*Bo Birch\*\*, 2026-03-02:\n\n> Plum, \\\*please\\\*\n$/);

  const open = await tree('archive-comments-open');
  const from = new Date();
  const { id: still } = await start(open, 'Which song?', {}, from);
  await db.db(open).run("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('c2', 'vote', ?, 'acc-ada', 'Ada Alder', 'Any song but that one', ?)", still, from.toISOString());
  const text = (await archiveOf(open, `votes/${from.toISOString().slice(0, 4)}.md`))!;
  assert.match(text, /Still open[^]*### Comments\n\n\*\*Ada Alder\*\*, \d{4}-\d{2}-\d{2}:\n\n> Any song but that one\n$/);
});

test('the archive counts suggestions and source files, and says they are not in it', async () => {
  const t = await tree('archive-suggestions');
  const d = db.db(t);
  await d.run("INSERT INTO person (id, given, living) VALUES ('p1', 'Ada', 0)");
  await d.run("INSERT INTO suggestion (id, kind, person, payload, status, author_name, created_at) VALUES ('s1', 'details', 'p1', '{}', 'waiting', 'Bo', '2026-11-01'), ('s2', 'details', 'p1', '{}', 'declined', 'Bo', '2026-11-01'), ('s3', 'details', 'p1', '{}', 'withdrawn', 'Bo', '2026-11-01')");
  await d.run("INSERT INTO source (id, title, created_at, updated_at) VALUES ('src1', 'Register', '2026-11-01', '2026-11-01')");
  await d.run("INSERT INTO source_file (source, media_key, mime, name, ord, added_at) VALUES ('src1', 'source/a.pdf', 'application/pdf', 'a.pdf', 0, '2026-11-01')");
  const read = await readTree(d, {});
  assert.equal(read.extras.suggestions, 2, 'a withdrawn one is not counted');
  assert.equal(read.extras.sourceFiles, 1);
  const { losses } = markdownArchive(read, new Set(), new Date('2026-11-15T00:00:00Z'));
  assert.ok(losses.includes('2 suggestions (waiting or decided) and their files are not in the archive'));
});
