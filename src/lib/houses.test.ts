// node --test src/lib/houses.test.ts — the house settings write is refused on the server for a viewer and an
// editor, and a steward's save goes through. The real server function runs inside a request context, with a
// real session cookie, on a private accounts database and a private family file. The modules load through
// Vite (ssrLoadModule), as the app does: the server functions use Vite-resolved imports.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-houses-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const TREE = 'family';
const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
/** A module from the app, loaded the way Vite serves it, typed as the module itself. */
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const { startSession } = await load<typeof import('./auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const { newUser, upsertMembership } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { updateHouseSettings } = await load<typeof import('./houses.functions.ts')>('/src/lib/houses.functions.ts');

// TanStack Start keeps each request in two AsyncLocalStorage stores (its server-function context and its
// request event), both shared through the global registry. A real request sets them; here they are set the
// same way, so the server function and its guards read this request's session.
type Store<T> = AsyncLocalStorage<T>;
const registry = globalThis as unknown as Record<symbol, Store<unknown> | undefined>;
await load<unknown>('@tanstack/react-start/server'); // creates the request event store
const events = registry[Symbol.for('tanstack-start:event-storage')] as Store<{ request: Request; requestUrl: URL }>;
const contexts = registry[Symbol.for('tanstack-start:start-storage-context')] as Store<{ startOptions: object }>;

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

// A family with one house, and nothing else that the save needs.
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, arms) VALUES ('h1', 'House Test', '{"field":"gules","division":"plain","charge":"none","chargeTincture":"or"}');
  INSERT INTO person (id, given, house) VALUES ('ada', 'Ada', 'h1');
`);
family.close();

/** A signed-in member of the family with `role`; returns the session cookie they would send. */
async function memberWith(role: 'viewer' | 'editor' | 'steward') {
  const { user, insert } = newUser(role, null);
  await store.accounts().batch([insert, upsertMembership(user.id, TREE, role)]);
  const set = await startSession(new Request('http://localhost:4791/'), user.id);
  return set.split(';')[0];
}

/** Calls the server function as the request carrying `cookie` (none for a stranger). */
function saveAs(cookie: string | undefined, opKey: string) {
  const request = new Request('http://localhost:4791/', { headers: cookie ? { cookie } : {} });
  return events.run({ request, requestUrl: new URL(request.url) }, () =>
    contexts.run({ startOptions: {} }, () =>
      updateHouseSettings({ data: { tree: TREE, id: 'h1', opKey, law: 'seniority', head: null, heir: null, country: 'DE' } }),
    ),
  );
}

const settingsRows = async () => (await store.tree(TREE).all<{ law: string }>('SELECT law FROM house_succession WHERE house = ?', 'h1')).map((r) => ({ law: r.law }));

test('a viewer and an editor are refused, and nothing is written', async () => {
  const viewer = await memberWith('viewer');
  const editor = await memberWith('editor');
  await assert.rejects(saveAs(viewer, 'house-key-viewer'), (e: { code?: string; status?: number }) => e.code === 'forbidden' && e.status === 403);
  await assert.rejects(saveAs(editor, 'house-key-editor'), (e: { code?: string; status?: number }) => e.code === 'forbidden' && e.status === 403);
  assert.deepEqual(await settingsRows(), []);
});

test('a stranger without a session is signed out, not let through', async () => {
  await assert.rejects(saveAs(undefined, 'house-key-stranger'), (e: { code?: string; status?: number }) => e.code === 'signed-out' && e.status === 401);
  assert.deepEqual(await settingsRows(), []);
});

test('a steward saves the house settings', async () => {
  const steward = await memberWith('steward');
  const saved = await saveAs(steward, 'house-key-steward');
  assert.equal(saved.law, 'seniority');
  assert.deepEqual(await settingsRows(), [{ law: 'seniority' }]);
});
