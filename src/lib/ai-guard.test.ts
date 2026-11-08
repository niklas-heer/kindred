// node --test src/lib/ai-guard.test.ts — the lookup guard, against the variants a reader or a model writes: spelling (umlauts,
// ß, missing marks), order and punctuation, zero-width characters, telephone numbers in other forms, web addresses and
// search operators. A living person's given name with their surname is refused; a surname alone is not. A private value is
// refused only for a reader who may see it, and a city or a country is never private. Runs on a private data folder.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-guard-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '0';
process.env.KINDRED_SECRET = 'ai-guard-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const lookup = await load<typeof import('./ai/lookup.server.ts')>('/src/lib/ai/lookup.server.ts');
const { graph } = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const TREE = 'guard';
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
// Hans-Peter Müller and Anna Maria Strauß are living; Anna is Brandt now. Jan Berg is living. Otto Vogt is deceased.
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Guards'), ('tagline', ''), ('theme', 'codex'), ('focus', 'hp');
  INSERT INTO person (id, given, surname, nickname, living, current_given, current_surname) VALUES
    ('hp', 'Hans-Peter', 'Müller', 'Möpsi', 1, NULL, NULL),
    ('an', 'Anna Maria', 'Strauß', 'Annie', 1, 'Annie', 'Brandt'),
    ('jn', 'Jan', 'Berg', NULL, 1, NULL, NULL),
    ('ot', 'Otto', 'Vogt', NULL, 0, NULL, NULL);
  INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES
    ('f1', 'hp', 'phone', '', '{"number":"+27 82 123 4567"}', 0, 'editors'),
    ('f2', 'hp', 'medical', '', '{"text":"Diabetes"}', 1, 'editors'),
    ('f3', 'an', 'address', '', '{"street":"Hauptstraße 5","postcode":"7600","city":"Stellenbosch","country":"South Africa"}', 2, 'editors'),
    ('f4', 'an', 'email', '', '{"address":"anna@example.org"}', 3, 'family'),
    ('f5', 'ot', 'address', '', '{"street":"Ardent Pilgrim Lodge"}', 4, 'editors'),
    ('f6', 'ot', 'notes', '', '{"text":"yes"}', 5, 'editors');
`);
family.close();

const ZW = '​';
const DECOMPOSED_UMLAUT = 'Müller';

test('the guard refuses a living person’s given name with their surname, in the spellings and orders people write', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  const refused = [
    'Hans Peter Müller', 'hans peter muller', 'Hans Peter Mueller', 'Hans-Peter Muller', 'Hans-Peter Mueller',
    'Müller, Hans-Peter', 'Müller Hans-Peter', 'Muller, Hans Peter', 'Mueller, Hans-Peter', 'Peter Müller', 'Hans Müller',
    'Anna Maria Strauss', 'Anna Strauß', 'Anna Strauss', 'Strauss, Anna Maria', 'Anna Maria Strauß',
    'Annie Brandt', 'Brandt, Annie', 'Anna Brandt', 'Jan Berg', 'Berg, Jan', 'Jan, Berg',
    `Hans${ZW} Peter Müller`, `Hans-Peter Mü${ZW}ller`, `Hans-Peter Müller${ZW}`,
    `Hans-Peter ${DECOMPOSED_UMLAUT}`,
    'Hans-Peter “Möpsi” Müller', 'Hans-Peter von Müller',
    'HANS-PETER MÜLLER',
  ];
  for (const q of refused) assert.equal(lookup.refusal(guard, q), 'living-name', JSON.stringify(q));
});

test('a living person’s nickname is refused as a whole word, however it is spelt', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  assert.equal(lookup.refusal(guard, 'Möpsi'), 'nickname');
  assert.equal(lookup.refusal(guard, 'moepsi'), 'nickname', 'ö as oe');
  assert.equal(lookup.refusal(guard, 'Annie'), 'nickname');
  assert.equal(lookup.refusal(guard, 'anniversary customs'), null, 'a nickname is a whole word');
});

test('a surname alone is allowed, and a deceased person’s name is not guarded', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  for (const q of ['Müller', 'muller', 'Mueller', 'Strauss', 'Strauß', 'Brandt', 'Berg', 'Vogt', 'Otto Vogt']) {
    assert.equal(lookup.refusal(guard, q), null, JSON.stringify(q));
  }
});

test('zero-width characters and joined words do not hide a name', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  assert.equal(lookup.refusal(guard, `${ZW}Hans${ZW}Peter${ZW} Müller`), 'living-name');
  assert.equal(lookup.refusal(guard, `Hans‍Peter⁠Müller`), 'living-name');
  assert.equal(lookup.refusal(guard, 'Hanspeter Müller'), 'living-name', 'given names written as one word');
});

test('a telephone number is refused in any spacing or punctuation; a short number is not', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  for (const q of ['0821234567', '+27 82 123 4567', '+27821234567', '+27 (82) 123-4567', '2 7 8 2 1 2 3 4 5 6 7', '082 123 4567']) {
    assert.equal(lookup.refusal(guard, q), 'long-number', JSON.stringify(q));
  }
  assert.equal(lookup.refusal(guard, 'the year 1850'), null);
});

test('a web address and a search operator are refused', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  for (const q of ['site:evil.example', 'site:evil.example phone', 'https://evil.example/p?d=1', 'www.evil.example', 'evil.example history', 'inurl:family tree']) {
    assert.equal(lookup.refusal(guard, q), 'web-address', JSON.stringify(q));
  }
  assert.equal(lookup.refusal(guard, 'a website of the guild'), null, 'the word website is not an operator');
});

test('a private value is refused for a reader who may see it: every word of it, in any order', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  assert.equal(lookup.refusal(guard, 'what is diabetes'), 'private');
  assert.equal(lookup.refusal(guard, 'Hauptstraße 5'), 'private', 'street');
  assert.equal(lookup.refusal(guard, 'Hauptstrasse 5 history'), 'private', 'ß as ss');
  assert.equal(lookup.refusal(guard, '7600'), 'private', 'postcode');
  assert.equal(lookup.refusal(guard, 'Ardent, Pilgrim Lodge'), 'private');
  assert.equal(lookup.refusal(guard, 'Pilgrim Lodge, Ardent'), 'private');
  assert.equal(lookup.refusal(guard, 'yes please'), null, 'a value under four letters is not guarded');
});

test('a city and a country are not private: history of Stellenbosch is allowed', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  assert.equal(lookup.refusal(guard, 'history of Stellenbosch'), null);
  assert.equal(lookup.refusal(guard, 'South Africa boer war'), null);
});

test('a reader who may not see private fields gets no private values: a refusal never reveals one', async () => {
  const g = await graph(TREE);
  const viewer = await lookup.privacyGuard(TREE, g.people, false);
  assert.deepEqual(viewer.privates, []);
  assert.equal(lookup.refusal(viewer, 'what is diabetes'), null, 'a general question is allowed');
  assert.equal(lookup.refusal(viewer, 'Hauptstraße 5'), null);
  // Living names and numbers are still guarded for everyone.
  assert.equal(lookup.refusal(viewer, 'Hans Peter Müller'), 'living-name');
  assert.equal(lookup.refusal(viewer, '+27 82 123 4567'), 'long-number');
});

test('a general question with no name, number or address goes to the web', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  for (const q of ['history of the bakers guild', 'what does Heer mean', 'Stellenbosch history', 'the anniversary of the Hansa']) {
    assert.equal(lookup.refusal(guard, q), null, q);
  }
});

test('the refusal reasons name the kind of detail and never a value', async () => {
  for (const reason of Object.values(lookup.REFUSAL_REASON)) {
    for (const secret of ['Hans', 'Müller', 'Möpsi', 'Diabetes', 'Hauptstraße', 'Pilgrim', '4567', 'Annie']) {
      assert.ok(!reason.includes(secret), `${secret} in ${reason}`);
    }
  }
});

test('a surname particle is not a surname: "Jan van Riebeeck" is allowed beside a living "Jan van der Merwe", and that name is still refused', async () => {
  const PT = 'particles';
  const f = openSqlite(join(dir, `${PT}.db`), 'tree', { create: true });
  f.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${PT}'), ('name', 'Particles'), ('tagline', ''), ('theme', 'codex'), ('focus', 'jm');
    INSERT INTO person (id, given, surname, nickname, living, current_given, current_surname) VALUES
      ('jm', 'Jan', 'van der Merwe', NULL, 1, NULL, NULL),
      ('lv', 'Lisa', 'Van', NULL, 1, NULL, NULL),
      ('ad', 'Anna', 'De La', NULL, 1, NULL, NULL);
  `);
  f.close();
  const guard = await lookup.privacyGuard(PT, (await graph(PT)).people, true);
  for (const q of ['Jan van Riebeeck', 'Jan van der Berg', 'Jan de Wet', 'Jan Riebeeck', 'Jan van der']) {
    assert.equal(lookup.refusal(guard, q), null, JSON.stringify(q));
  }
  for (const q of ['Jan van der Merwe', 'Jan Merwe', 'Merwe, Jan', 'Jan vandermerwe', 'Jan van Merwe', 'Jan Van der Merwe']) {
    assert.equal(lookup.refusal(guard, q), 'living-name', JSON.stringify(q));
  }
  assert.equal(lookup.refusal(guard, 'Lisa Van'), 'living-name', 'a surname that is only a particle still counts');
  assert.equal(lookup.refusal(guard, 'Anna De La'), 'living-name', 'so does one made of several particles');
});

