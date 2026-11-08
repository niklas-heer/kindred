// node --test src/lib/houses-members.test.ts — a steward makes houses, makes them from surnames, changes their members, and
// renames the family; a viewer or an editor is refused each time and nothing is written. The server functions run inside a
// request context with a real session cookie, on a private accounts database and a private family file (as houses.test.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-houses-members-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const TREE = 'family';
const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const { startSession } = await load<typeof import('./auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const { newUser, upsertMembership } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const houses = await load<typeof import('./houses.functions.ts')>('/src/lib/houses.functions.ts');
const family = await load<typeof import('./family-details.functions.ts')>('/src/lib/family-details.functions.ts');
const { cleanFamilyDetails } = await load<typeof import('./family-details.server.ts')>('/src/lib/family-details.server.ts');

// TanStack Start keeps each request in two AsyncLocalStorage stores; a real request sets them, and so does this helper.
type Store<T> = AsyncLocalStorage<T>;
const registry = globalThis as unknown as Record<symbol, Store<unknown> | undefined>;
await load<unknown>('@tanstack/react-start/server');
const events = registry[Symbol.for('tanstack-start:event-storage')] as Store<{ request: Request; requestUrl: URL }>;
const contexts = registry[Symbol.for('tanstack-start:start-storage-context')] as Store<{ startOptions: object }>;

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

// A family with a house "House Test" (Ada and Eve), an empty house "Dane", and people with no house: two Smiths and a Dane.
const fam = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
fam.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, arms) VALUES ('h1', 'House Test', '{"field":"gules","division":"plain","charge":"none","chargeTincture":"or"}');
  INSERT INTO house (id, name, arms) VALUES ('h2', 'Dane', '{"field":"azure","division":"plain","charge":"none","chargeTincture":"or"}');
  INSERT INTO person (id, given, surname, house) VALUES ('ada', 'Ada', 'Test', 'h1'), ('eve', 'Eve', 'Test', 'h1');
  INSERT INTO person (id, given, surname) VALUES ('bob', 'Bob', 'Smith'), ('carl', 'Carl', 'Smith'), ('dora', 'Dora', 'Dane');
  INSERT INTO house_succession (house, law, head) VALUES ('h1', 'absolute-primogeniture', 'ada');
`);
fam.close();

// One signed-in member per role, so a retry comes from the same person (a retry key is bound to its sender).
const members = new Map<string, Promise<string>>();
/** A signed-in member of the family with `role`; returns the session cookie they would send. */
function memberWith(role: 'viewer' | 'editor' | 'steward'): Promise<string> {
  if (!members.has(role)) {
    members.set(role, (async () => {
      const { user, insert } = newUser(role, null);
      await store.accounts().batch([insert, upsertMembership(user.id, TREE, role)]);
      const set = await startSession(new Request('http://localhost:4792/'), user.id);
      return set.split(';')[0];
    })());
  }
  return members.get(role)!;
}

/** Runs `call` as the request carrying `cookie` (none for a stranger). */
function asRequest<T>(cookie: string | undefined, call: () => Promise<T>): Promise<T> {
  const request = new Request('http://localhost:4792/', { headers: cookie ? { cookie } : {} });
  return events.run({ request, requestUrl: new URL(request.url) }, () => contexts.run({ startOptions: {} }, call));
}

const forbidden = (e: { code?: string; status?: number }) => e.code === 'forbidden' && e.status === 403;
/** The rows of a query as plain objects (the driver's rows have no prototype, which deepEqual would compare). */
const rows = async (sql: string, ...params: string[]) => (await store.tree(TREE).all<Record<string, unknown>>(sql, ...params)).map((r) => ({ ...r }));

test('a viewer and an editor cannot make a house, and nothing is written', async () => {
  for (const role of ['viewer', 'editor'] as const) {
    const cookie = await memberWith(role);
    await assert.rejects(
      asRequest(cookie, () => houses.createHouseFn({ data: { tree: TREE, opKey: `make-house-${role}`, name: 'House Nope', motto: null, country: null } })),
      forbidden,
    );
  }
  assert.equal((await rows("SELECT id FROM house WHERE name = 'House Nope'")).length, 0);
});

test('a stranger without a session is signed out, not let through', async () => {
  await assert.rejects(
    asRequest(undefined, () => houses.createHouseFn({ data: { tree: TREE, opKey: 'make-house-stranger', name: 'House Nope', motto: null, country: null } })),
    (e: { code?: string; status?: number }) => e.code === 'signed-out' && e.status === 401,
  );
});

test('a steward makes a house with a motto and a country, and the name must be new', async () => {
  const steward = await memberWith('steward');
  const made = await asRequest(steward, () =>
    houses.createHouseFn({ data: { tree: TREE, opKey: 'make-house-grey', name: 'House Grey', motto: 'Ever', country: 'DE' } }),
  );
  assert.equal(made.name, 'House Grey');
  const [house] = await rows('SELECT name, motto, arms FROM house WHERE id = ?', made.id);
  assert.equal(house.name, 'House Grey');
  assert.equal(house.motto, 'Ever');
  assert.equal(JSON.parse(house.arms as string).field, 'azure');
  assert.deepEqual(await rows('SELECT country FROM house_succession WHERE house = ?', made.id), [{ country: 'DE' }]);
  // The same name, in any case, is refused.
  await assert.rejects(
    asRequest(steward, () => houses.createHouseFn({ data: { tree: TREE, opKey: 'make-house-grey-2', name: 'house grey', motto: null, country: null } })),
    (e: Error) => e.message === 'houses.err.name_taken',
  );
});

test('the surnames that could make a house are listed, and one already named a house is marked taken', async () => {
  const steward = await memberWith('steward');
  const { groups, unhoused } = await asRequest(steward, () => houses.getSurnameGroups({ data: { tree: TREE } }));
  assert.equal(unhoused, 3);
  assert.deepEqual(groups, [
    { surname: 'Smith', people: 2, taken: false },
    { surname: 'Dane', people: 1, taken: true },
  ]);
});

test('a surname already naming a house is refused, and nothing is written', async () => {
  const steward = await memberWith('steward');
  await assert.rejects(
    asRequest(steward, () => houses.createHousesFromSurnamesFn({ data: { tree: TREE, opKey: 'surname-houses-taken', surnames: ['Smith', 'Dane'] } })),
    (e: Error) => e.message === 'houses.err.name_taken',
  );
  assert.equal((await rows("SELECT id FROM house WHERE name = 'Smith'")).length, 0);
  assert.equal((await rows('SELECT house FROM person WHERE id = ?', 'bob'))[0].house, null);
});

test('a steward makes a house for each chosen surname, and its people join it', async () => {
  const steward = await memberWith('steward');
  const made = await asRequest(steward, () => houses.createHousesFromSurnamesFn({ data: { tree: TREE, opKey: 'surname-houses-smith', surnames: ['Smith'] } }));
  assert.deepEqual(made.map((m) => [m.name, m.people]), [['Smith', 2]]);
  const members = await rows('SELECT id FROM person WHERE house = ? ORDER BY id', made[0].id);
  assert.deepEqual(members, [{ id: 'bob' }, { id: 'carl' }]);
  // Dora has no house and her surname was not chosen: she is still unhoused.
  assert.equal((await rows('SELECT house FROM person WHERE id = ?', 'dora'))[0].house, null);
});

test('a steward moves people in and out of a house; a leaver cannot keep the head or the heir', async () => {
  const steward = await memberWith('steward');
  const change = { tree: TREE, id: 'h1', opKey: 'members-h1-dora', add: ['dora'], remove: ['ada'] };
  const result = await asRequest(steward, () => houses.setHouseMembersFn({ data: change }));
  assert.deepEqual(result, { added: 1, removed: 1 });
  assert.deepEqual(await rows('SELECT id FROM person WHERE house = ? ORDER BY id', 'h1'), [{ id: 'dora' }, { id: 'eve' }]);
  assert.deepEqual(await rows('SELECT head FROM house_succession WHERE house = ?', 'h1'), [{ head: null }]);
});

test('a retry of the same member change writes nothing twice and gets the same answer', async () => {
  const steward = await memberWith('steward');
  const again = { tree: TREE, id: 'h1', opKey: 'members-h1-dora', add: ['dora'], remove: ['ada'] };
  assert.deepEqual(await asRequest(steward, () => houses.setHouseMembersFn({ data: again })), { added: 1, removed: 1 });
  assert.equal((await rows('SELECT count(*) AS n FROM person WHERE house = ?', 'h1'))[0].n, 2);
});

test('a viewer cannot change members', async () => {
  const viewer = await memberWith('viewer');
  await assert.rejects(
    asRequest(viewer, () => houses.setHouseMembersFn({ data: { tree: TREE, id: 'h1', opKey: 'members-viewer-1', add: [], remove: ['eve'] } })),
    forbidden,
  );
  assert.equal((await rows('SELECT house FROM person WHERE id = ?', 'eve'))[0].house, 'h1');
});

test('the family name and tagline are checked, and a steward renames the family', async () => {
  assert.throws(() => cleanFamilyDetails({ name: '   ', tagline: '' }), /acc\.family_name_required/);
  assert.throws(() => cleanFamilyDetails({ name: 'x'.repeat(81), tagline: '' }), /acc\.family_name_long/);
  assert.throws(() => cleanFamilyDetails({ name: 'Ok', tagline: 'y'.repeat(141) }), /acc\.family_tagline_long/);
  assert.deepEqual(cleanFamilyDetails({ name: '  The   Hofmanns ', tagline: ' Since 1820 ' }), { name: 'The Hofmanns', tagline: 'Since 1820' });

  const viewer = await memberWith('viewer');
  await assert.rejects(asRequest(viewer, () => family.updateFamilyDetails({ data: { tree: TREE, opKey: 'rename-viewer', name: 'Nope', tagline: '' } })), forbidden);
  assert.deepEqual(await rows("SELECT value FROM meta WHERE key = 'name'"), [{ value: 'Family' }]);

  const steward = await memberWith('steward');
  const saved = await asRequest(steward, () => family.updateFamilyDetails({ data: { tree: TREE, opKey: 'rename-steward', name: 'Die Familie Test', tagline: 'Seit 1820' } }));
  assert.deepEqual(saved, { name: 'Die Familie Test', tagline: 'Seit 1820' });
  assert.deepEqual(await rows("SELECT value FROM meta WHERE key = 'name' OR key = 'tagline' ORDER BY key"), [{ value: 'Die Familie Test' }, { value: 'Seit 1820' }]);
  // The family id (the link's slug) is untouched, and the name reaches the invitation text.
  assert.deepEqual(await rows("SELECT value FROM meta WHERE key = 'id'"), [{ value: TREE }]);
  const { translate } = await load<typeof import('./i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');
  for (const locale of ['en', 'de', 'af'] as const) assert.ok(translate(locale, 'share.messageOpen', { family: 'Die Familie Test', url: 'https://x.test/s/1' }).includes('Die Familie Test'));
  assert.ok(translate('en', 'acc.familySlug', { slug: TREE }).includes('/family'));
});
