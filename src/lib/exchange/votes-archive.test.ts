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
