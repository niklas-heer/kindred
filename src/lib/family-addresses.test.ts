// node --test src/lib/family-addresses.test.ts — copying a relative's address. What is offered is only what the reader
// could already see on that relative's page. A scratch family under a temporary KINDRED_DATA_DIR (never data/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-family-addresses-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { familyAddresses } = await import('./family-addresses.server.ts');
const EDITOR = { account: 'editor-account', role: 'editor', guest: false } as const;
const VIEWER = { account: 'viewer-account', role: 'viewer', guest: false } as const;
import { withoutPersonal, type Audience } from './visibility.ts';

const MEMBER: Audience = { account: 'acc-member', role: 'viewer', guest: false };
const GUEST: Audience = { account: null, role: 'viewer', guest: true };

const TREE = 'share';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Share'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  for (const [id, living] of [['me', 1], ['wife', 1], ['ex', 1], ['mum', 1], ['kid', 1], ['sis', 1], ['gone', 0], ['cousin', 1]] as const) {
    d.exec(`INSERT INTO person (id, given, born, living) VALUES ('${id}', '${id}', '1950', ${living})`);
  }
  d.exec(`INSERT INTO partnership (id, a, b, kind) VALUES ('u1', 'me', 'wife', 'marriage')`);
  d.exec(`INSERT INTO partnership (id, a, b, kind, end, end_reason) VALUES ('u2', 'ex', 'me', 'marriage', '2001', 'divorce')`);
  d.exec(`INSERT INTO parent (child, parent) VALUES ('me', 'mum'), ('sis', 'mum'), ('gone', 'mum'), ('kid', 'me')`);
  const add = (id: string, who: string, street: string, level = 'family', type = 'address', owner: string | null = null) =>
    d.exec(`INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner, created_by_name, updated_by) VALUES ('${id}', '${who}', '${type}', 'home', '${JSON.stringify(type === 'address' ? { street, postcode: '1000', city: 'Town', country: '' } : { number: street })}', 0, '${level}', ${owner ? `'${owner}'` : 'NULL'}, 'Seed', 'Seed')`);
  add('a1', 'wife', 'Open Lane 1');
  add('a2', 'kid', 'Open Lane 1');
  add('a3', 'mum', 'Secret Road 2', 'editors');
  add('a3b', 'mum', 'Diary Lane 8', 'personal', 'address', 'acc-other');
  add('a4', 'sis', 'Sister Way 3');
  add('a5', 'ex', 'Former Close 4');
  add('a6', 'gone', 'Old Lane 5');
  add('a7', 'cousin', 'Far Street 6');
  add('a8', 'wife', 'not an address', 'family', 'phone');
  add('a9', 'sis', 'Already Mine 7');
  add('a10', 'me', 'Already Mine 7');
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

const streets = (list: { parts: { street: string } }[]) => list.map((a) => a.parts.street).sort();

test('an address the reader may not see is never offered', async () => {
  const offered = await familyAddresses(TREE, 'me', MEMBER);
  assert.deepEqual(streets(offered), ['Open Lane 1', 'Sister Way 3']);
  assert.ok(!JSON.stringify(offered).includes('Secret Road'));
});

test('someone else\'s personal address is never offered, not even to an editor', async () => {
  assert.ok(!streets(await familyAddresses(TREE, 'me', EDITOR)).includes('Diary Lane 8'));
});

test('even its owner is not offered a personal address: the server function strips that level', async () => {
  assert.ok(!streets(await familyAddresses(TREE, 'me', withoutPersonal({ ...MEMBER, account: 'acc-other' }))).includes('Diary Lane 8'));
});

test('a guest is offered nothing', async () => {
  assert.deepEqual(await familyAddresses(TREE, 'me', GUEST), []);
});

test('a reader who may see it is offered it', async () => {
  assert.deepEqual(streets(await familyAddresses(TREE, 'me', EDITOR)), ['Open Lane 1', 'Secret Road 2', 'Sister Way 3']);
});

test('names who has it, once per address, closest first', async () => {
  const shared = (await familyAddresses(TREE, 'me', MEMBER)).find((a) => a.parts.street === 'Open Lane 1');
  assert.deepEqual(shared?.who, ['wife', 'kid']);
});

test('only living, current, close family; never distant relatives, former partners or the address they already have', async () => {
  const all = streets(await familyAddresses(TREE, 'me', EDITOR));
  for (const s of ['Former Close 4', 'Old Lane 5', 'Far Street 6', 'Already Mine 7', 'not an address']) assert.ok(!all.includes(s), s);
});

test('someone with no close family is offered nothing', async () => {
  assert.deepEqual(await familyAddresses(TREE, 'cousin', EDITOR), []);
});
