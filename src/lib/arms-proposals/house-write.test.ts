// node --test src/lib/arms-proposals/house-write.test.ts — the one plan that writes a house's arms: while an arms vote for
// the house is unsettled its arms are frozen (a name or motto save still goes through), the vote's own settlement may
// write them, a vote that starts between the plan's reads and its batch is caught by the batch's guard, and a plan run
// for the family's vote credits the history to that vote rather than to whoever asked. A scratch family; never data/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { House } from '../types.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-house-write-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const { openSqlite } = await import('../store/node.ts');
const { db, graph, houseWritePlan, once, updateHouse } = await import('../db.server.ts');
const { actingAs, FAMILY_VOTE } = await import('../history.server.ts');
const { VOTE_AUTHOR } = await import('../history.ts');
const { authorName } = await import('../history-text.ts');
const { translate } = await import('../i18n/dictionary.ts');
const { asV2, storeV2 } = await import('../heraldry/convert.ts');

const TREE = 'housewrite';
const ARMS: House['arms'] = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' };
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
const startVote = (id: string, settled: string | null = null) =>
  db(TREE).run(
    `INSERT INTO vote (id, account, author_name, question, kind, secret, closes_at, created_at, subject_kind, subject, settled_at)
     VALUES (?, 'u-ada', 'Ada', 'New arms for Birch?', 'ranked', 1, '2026-11-22T10:00:00.000Z', '2026-11-15T10:00:00.000Z', 'house', 'h1', ?)`,
    id, settled,
  );
const removeVotes = () => db(TREE).run('DELETE FROM vote');
const lastHistory = async () => ({ ...(await db(TREE).get<{ account: string | null; name: string; kind: string; record: string; fn: string }>('SELECT account, name, kind, record, fn FROM history ORDER BY id DESC LIMIT 1')) });

test('a steward cannot change the arms while an arms vote for the house runs; a name or motto save still goes through', async () => {
  await startVote('v1');
  try {
    const before = await opened();
    await assert.rejects(updateHouse(TREE, 'h1', { ...before, arms: { ...ARMS, charge: 'stag' } }, before), (e: Error) => e.message === 'arms.err.frozen');
    assert.equal((await opened()).arms.charge, 'lion');
    // The same arms with their keys in another order are no change of the arms.
    const reordered = Object.fromEntries(Object.entries(before.arms).reverse()) as typeof before.arms;
    const h = await updateHouse(TREE, 'h1', { name: 'Birch Hall', motto: 'Rooted', arms: reordered }, before);
    assert.equal(h.name, 'Birch Hall');
    assert.deepEqual(await opened(), { name: 'Birch Hall', motto: 'Rooted', arms: ARMS });
  } finally {
    await removeVotes();
  }
});

test('the designer\'s save of v1 arms (their design, as v2) with a new motto goes through a vote, and leaves the stored arms as they were', async () => {
  await startVote('v-design');
  try {
    const before = await opened();
    const stored = await db(TREE).get<{ arms: string }>("SELECT arms FROM house WHERE id = 'h1'");
    // The designer always sends the design it shows: the v1 arms read as v2, with their v1 summary beside it.
    const h = await updateHouse(TREE, 'h1', { name: before.name, motto: 'Bend, then grow', arms: storeV2(asV2(before.arms)) }, before);
    assert.equal(h.motto, 'Bend, then grow');
    // The arms are written back exactly as stored: the vote's Keep snapshot still matches them.
    assert.equal((await db(TREE).get<{ arms: string }>("SELECT arms FROM house WHERE id = 'h1'"))!.arms, stored!.arms);
    await assert.rejects(updateHouse(TREE, 'h1', { ...before, motto: 'Bend, then grow', arms: storeV2({ ...asV2(before.arms), field: { ...asV2(before.arms).field, tinctures: ['vert'] } }) }, { ...before, motto: 'Bend, then grow' }),
      (e: Error) => e.message === 'arms.err.frozen');
  } finally {
    await removeVotes();
    const now = await opened();
    await updateHouse(TREE, 'h1', { ...now, motto: 'Bend, not break' }, now);
  }
});

test('without a vote the same design is stored as sent; a vote starting after the plan read the house stops that batch', async () => {
  const d = db(TREE);
  const before = await opened();
  const v2 = storeV2(asV2(before.arms));
  const plan = await houseWritePlan(d, 'h1', { ...before, arms: v2 }, before);
  await startVote('v-upgrade');
  try {
    // Storing the v2 design now would make the arms differ from the new vote's Keep snapshot.
    await assert.rejects(d.batch(plan.writes));
    assert.equal((await opened()).arms.v2, undefined);
  } finally {
    await removeVotes();
  }
  await updateHouse(TREE, 'h1', { ...before, arms: v2 }, before);
  assert.deepEqual((await opened()).arms.v2, v2.v2, 'the design is stored when no vote holds the arms');
  // Back to the v1 arms the other tests start from.
  await d.run("UPDATE house SET arms = ? WHERE id = 'h1'", JSON.stringify(before.arms));
});

test('a settled arms vote, or a vote about something else, freezes nothing', async () => {
  await startVote('v-old', '2026-11-01T00:00:00.000Z');
  await db(TREE).run(
    `INSERT INTO vote (id, account, author_name, question, kind, closes_at, created_at) VALUES ('v-other', 'u-bo', 'Bo', 'Picnic?', 'single', '2026-11-22T10:00:00.000Z', '2026-11-15T10:00:00.000Z')`,
  );
  try {
    const before = await opened();
    await updateHouse(TREE, 'h1', { ...before, arms: { ...ARMS, charge: 'boar' } }, before);
    assert.equal((await opened()).arms.charge, 'boar');
  } finally {
    await removeVotes();
  }
});

test('the settling vote writes the arms it chose, credited to the family\'s vote however the request is credited', async () => {
  await startVote('v2');
  actingAs({ account: 'u-carl', name: 'Carl' });
  try {
    const before = await opened();
    const patch = { ...before, arms: { ...ARMS, charge: 'eagle' as const } };
    // Another vote's settlement does not lift this vote's freeze.
    await assert.rejects(once(TREE, undefined, 'settleArmsVote', (d) => houseWritePlan(d, 'h1', patch, before, { settlingVote: 'v-else' }), { actor: FAMILY_VOTE }), (e: Error) => e.message === 'arms.err.frozen');
    const h = await once(TREE, undefined, 'settleArmsVote', (d) => houseWritePlan(d, 'h1', patch, before, { settlingVote: 'v2' }), { actor: FAMILY_VOTE });
    assert.equal(h.arms.charge, 'eagle');
    assert.equal((await opened()).arms.charge, 'eagle');
    assert.deepEqual(await lastHistory(), { account: null, name: VOTE_AUTHOR, kind: 'house', record: 'h1', fn: 'settleArmsVote' });
  } finally {
    actingAs(undefined);
    await removeVotes();
  }
});

test('without an explicit actor, a change is still the requester\'s', async () => {
  actingAs({ account: 'u-carl', name: 'Carl' });
  try {
    const before = await opened();
    await updateHouse(TREE, 'h1', { ...before, motto: 'Still standing' }, before);
    assert.deepEqual(await lastHistory(), { account: 'u-carl', name: 'Carl', kind: 'house', record: 'h1', fn: 'updateHouse' });
  } finally {
    actingAs(undefined);
  }
});

test('a vote that starts after the plan read the house stops the batch', async () => {
  const d = db(TREE);
  const before = await opened();
  const plan = await houseWritePlan(d, 'h1', { ...before, arms: { ...ARMS, charge: 'tower' } }, before);
  await startVote('v3');
  try {
    await assert.rejects(d.batch(plan.writes));
    assert.notEqual((await opened()).arms.charge, 'tower');
  } finally {
    await removeVotes();
  }
});

test('the history names the family\'s vote in the reader\'s language, and Kindred for an empty name', () => {
  const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate('de', key, vars);
  assert.equal(authorName(t, VOTE_AUTHOR), translate('de', 'history.vote'));
  assert.notEqual(translate('de', 'history.vote'), translate('en', 'history.vote'));
  assert.equal(authorName(t, ''), translate('de', 'history.kindred'));
  assert.equal(authorName(t, 'Ada'), 'Ada');
});
