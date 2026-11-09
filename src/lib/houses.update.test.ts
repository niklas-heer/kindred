// node --test src/lib/houses.update.test.ts — a house's name, motto and arms are saved only over what the designer
// opened: a change someone else saved meanwhile is refused, never silently replaced. Houses have no revision, so the
// save restates the three values it was opened with. A scratch family; never data/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-house-update-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { db, graph, updateHouse, HOUSE_CHANGED } = await import('./db.server.ts');

const TREE = 'houses';
const ARMS = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' } as const;
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Houses'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO house (id, name, motto, arms) VALUES ('h1', 'Birch', 'Bend, not break', '${JSON.stringify(ARMS)}')`);
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

const opened = async () => {
  const h = (await graph(TREE)).houses.find((x) => x.id === 'h1')!;
  return { name: h.name, motto: h.motto ?? null, arms: h.arms };
};

test('a save over the house as it was opened goes through', async () => {
  const before = await opened();
  const h = await updateHouse(TREE, 'h1', { name: 'Birch', motto: 'Bend, never break', arms: { ...ARMS, charge: 'stag' } }, before);
  assert.equal(h.motto, 'Bend, never break');
  assert.equal((await opened()).arms.charge, 'stag');
});

test('a save over a house someone else changed meanwhile is refused and changes nothing', async () => {
  const before = await opened();
  await db(TREE).run("UPDATE house SET motto = 'Rooted' WHERE id = 'h1'");
  await assert.rejects(updateHouse(TREE, 'h1', { name: 'Birch Hall', motto: before.motto, arms: before.arms }, before), (e: Error) => e.message === HOUSE_CHANGED);
  const now = await opened();
  assert.equal(now.name, 'Birch');
  assert.equal(now.motto, 'Rooted');
});

test('arms changed meanwhile are refused as well, whatever order their keys were sent in', async () => {
  const before = await opened();
  const reordered = Object.fromEntries(Object.entries(before.arms).reverse()) as typeof before.arms;
  await updateHouse(TREE, 'h1', { name: 'Birch', motto: 'Rooted', arms: before.arms }, { ...before, arms: reordered });
  await db(TREE).run(`UPDATE house SET arms = '${JSON.stringify({ ...ARMS, charge: 'boar' })}' WHERE id = 'h1'`);
  await assert.rejects(updateHouse(TREE, 'h1', { name: 'Birch', motto: 'Rooted', arms: before.arms }, before), (e: Error) => e.message === HOUSE_CHANGED);
  assert.equal((await opened()).arms.charge, 'boar');
});
