// node --test src/lib/campaign/campaign.server.test.ts — the Campaign on the server: off until a steward turns it on, a
// member plays their own house on the week's field (the same for everyone all week, from a seed no browser can work out
// ahead), the server never takes a score but replays the moves, a reign is counted once and a forged one not at all, the
// tables add up, the old shared season is closed once into the hall of fame, and the family's records are never written.
// A scratch family and accounts database; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-campaign-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'campaign-test-secret';
after(() => rmSync(dir, { recursive: true, force: true }));

const { openSqlite } = await import('../store/node.ts');
const { db } = await import('../db.server.ts');
const store = await import('../auth/store.server.ts');
const game = await import('./campaign.server.ts');
const { RULES, openReign, play, regentMoves, replay } = await import('./engine.ts');
const { planTables } = await import('../../../scripts/lib/d1-transfer.ts');
type Who = import('./campaign.server.ts').Who;
type Move = import('./engine.ts').Move;
type RunStart = import('./types.ts').RunStart;

const ARMS = JSON.stringify({ field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' });
const HOUSES = ['ash', 'birch', 'cedar'];
const DAY = 86_400_000;
// A Wednesday: the ISO week 2026-W10 runs from Monday 2 March to Sunday 8 March.
const T0 = new Date('2026-03-04T09:00:00Z');
const later = (days: number, from = T0) => new Date(from.getTime() + days * DAY);

/** A family of three houses of four people each, twelve places, and one person in no house. */
function family(tree: string, houses = HOUSES) {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'Testers'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  for (let i = 0; i < 12; i++) d.exec(`INSERT INTO place (name, lat, lng) VALUES ('Town ${i}', ${48 + (i % 4) * 1.3}, ${7 + Math.floor(i / 4) * 2.1 + (i % 3) * 0.4})`);
  houses.forEach((h, k) => {
    d.exec(`INSERT INTO house (id, name, arms) VALUES ('${h}', 'House ${h}', '${ARMS}')`);
    for (let i = 0; i < 4; i++) d.exec(`INSERT INTO person (id, given, house, born, born_place, living) VALUES ('${h}${i}', 'P${i}', '${h}', ${i < 2 ? "'1950-01-02'" : 'NULL'}, 'Town ${(k * 4 + i) % 12}', 1)`);
  });
  d.exec("INSERT INTO person (id, given, living) VALUES ('loner', 'Lo', 1)");
  d.exec(`INSERT INTO story (person, kind, body, author, at) VALUES ('${houses.length ? `${houses[0]}0` : 'loner'}', 'memory', 'A day at the lake', 'T', '2026-01-01')`);
  d.close();
}

async function account(tree: string, name: string, person: string | null, role: 'viewer' | 'steward' = 'viewer'): Promise<Who> {
  const { user, insert } = store.newUser(name, null);
  await store.accounts().batch([insert, store.upsertMembership(user.id, tree, role)]);
  if (person) await store.accounts().run('UPDATE membership SET person = ? WHERE user = ? AND tree = ?', person, user.id, tree);
  return { account: user.id, name, person };
}

const key = () => `k${crypto.randomUUID()}`;
const count = async (tree: string, table: string, where = '1 = 1') => (await db(tree).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const records = async (tree: string) => JSON.stringify(await Promise.all(['meta', 'house', 'person', 'parent', 'partnership', 'story', 'place', 'photo', 'person_field'].map((t) => db(tree).all(`SELECT * FROM ${t}`))));
const reignOf = (run: RunStart) => ({ map: run.field.map, sides: run.field.sides.map((s) => s.id), player: run.side, seed: run.seed, renown: run.renown, grant: run.grant });
/** A whole reign's moves, with a regent playing the member's side: legal moves a browser could send. */
function movesFor(run: RunStart): Move[] {
  const reign = reignOf(run);
  let s = openReign(run.field.start, reign);
  const moves: Move[] = [];
  while (s.turn < RULES.TURNS) for (const m of regentMoves(s, reign)) { s = play(s, reign, m).state; moves.push(m); }
  return moves;
}
async function on(tree: string, houses = HOUSES) {
  family(tree, houses);
  const steward = await account(tree, 'Sten', houses.length ? `${houses[0]}0` : null, 'steward');
  await game.setCampaignEnabled(tree, true, steward.account, T0);
  return steward;
}

test('the game is off until a steward turns it on: the practice has its kit, and no reign can begin', async () => {
  family('off');
  const ada = await account('off', 'Ada', 'ash0');
  const view = await game.campaignView('off', ada, T0);
  assert.equal(view.enabled, false);
  assert.equal(view.challenge, undefined);
  assert.equal(view.kit.sides.length, RULES.SIDES);
  assert.ok(view.kit.places.length >= 10, 'the practice is dealt from the family’s places');
  assert.equal(view.mySide, 'ash');
  assert.deepEqual(await game.campaignStatus('off', ada, T0), { enabled: false });
  await assert.rejects(game.startRun('off', ada, null, T0), /campaign\.err\.off/);
  assert.equal(await count('off', 'campaign_run'), 0);
  assert.deepEqual(await game.campaignSettings('off'), { enabled: false });
});

test('the week’s challenge: four sides, the reader’s own house, a seed from the server’s secret that changes with the week and the family', async () => {
  const steward = await on('week');
  const lo = await account('week', 'Lo', 'loner');
  const view = await game.campaignView('week', steward, T0);
  const c = view.challenge!;
  assert.equal(c.week, '2026-W10');
  assert.equal(c.ends, '2026-03-08');
  assert.match(c.seed, /^[0-9a-f]{24}$/);
  assert.deepEqual(c.field.sides.map((s) => s.id), [...HOUSES, 'rival:greywatch']);
  assert.equal(c.field.map.provinces.length, RULES.PROVINCES);
  assert.equal(c.side, 'ash');
  assert.equal(c.chooses, false);
  assert.equal((await game.campaignView('week', lo, T0)).challenge!.side, null, 'a member who stands for nobody chooses');
  assert.equal((await game.campaignView('week', lo, T0)).challenge!.chooses, true);
  assert.equal(await game.weekSeed('week', '2026-W10'), c.seed, 'the same all week');
  assert.notEqual(await game.weekSeed('week', '2026-W11'), c.seed);
  assert.notEqual(await game.weekSeed('other', '2026-W10'), c.seed);
  assert.equal(view.board!.week.length, 0);
  assert.deepEqual(await game.campaignStatus('week', steward, T0), { enabled: true, week: '2026-W10', best: null, runs: 0, rank: null, of: 0 });
});

test('a reign is begun on the server, played in the browser and scored by the server replaying its moves, once', async () => {
  const steward = await on('play');
  const run = await game.startRun('play', steward, 'birch', T0);
  assert.equal(run.side, 'ash', 'a member with a house plays it, whatever is asked');
  assert.match(run.id, /^[0-9a-f-]{36}$/);
  const moves = movesFor(run);
  const expected = replay(run.field.start, reignOf(run), moves).score;
  const op = { key: key() };
  const done = await game.finishRun('play', steward, run.id, moves, op, later(0.01));
  assert.deepEqual(done.score, expected);
  assert.deepEqual({ best: done.best, rank: done.rank, of: done.of, personalBest: done.personalBest }, { best: expected.total, rank: 1, of: 1, personalBest: true });
  // The same request again (a retry) gets the same answer; a new request to finish it again is refused.
  assert.deepEqual(await game.finishRun('play', steward, run.id, moves, op, later(0.02)), done);
  await assert.rejects(game.finishRun('play', steward, run.id, moves, { key: key() }, later(0.02)), /campaign\.err\.finished/);
  const row = (await db('play').get<{ score: number; orders: string; finished_at: string }>('SELECT score, orders, finished_at FROM campaign_run WHERE id = ?', run.id))!;
  assert.equal(row.score, expected.total);
  assert.equal(JSON.parse(row.orders).length, moves.length);
  const status = await game.campaignStatus('play', steward, T0);
  assert.deepEqual(status, { enabled: true, week: '2026-W10', best: expected.total, runs: 1, rank: 1, of: 1 });
});

test('a forged or unfinished list of moves is refused and the reign stays open; someone else cannot finish it', async () => {
  const steward = await on('forge');
  const other = await account('forge', 'Bo', 'birch0');
  const run = await game.startRun('forge', steward, null, T0);
  const moves = movesFor(run);
  const seat = run.field.start.seats.ash;
  const theirs = run.field.start.seats.birch;
  // A troop placed on another house's seat, a fourth order in a turn, a reign that stops early, and a score-only list.
  const forged: Move[][] = [
    [{ t: 'place', to: theirs }, ...moves],
    [...Array.from({ length: 4 }, () => ({ t: 'march', from: seat, to: seat === 0 ? 1 : 0, troops: 1 }) as Move), ...moves],
    moves.slice(0, -1),
    [],
  ];
  for (const list of forged) await assert.rejects(game.finishRun('forge', steward, run.id, list, { key: key() }, T0), /campaign\.err\.forged/);
  await assert.rejects(game.finishRun('forge', other, run.id, moves, { key: key() }, T0), /campaign\.err\.no_run/);
  await assert.rejects(game.finishRun('forge', steward, crypto.randomUUID(), moves, { key: key() }, T0), /campaign\.err\.no_run/);
  assert.equal(await count('forge', 'campaign_run', 'finished_at IS NOT NULL'), 0);
  // The honest list still counts.
  await game.finishRun('forge', steward, run.id, moves, { key: key() }, T0);
  assert.equal(await count('forge', 'campaign_run', 'finished_at IS NOT NULL'), 1);
});

test('everyone plays the same field all week, even when the family changes; renown and the reward are fixed when a reign begins', async () => {
  const steward = await on('field');
  const lo = await account('field', 'Lo', 'loner');
  const first = await game.startRun('field', steward, null, T0);
  // The family adds a place and records more: the week's field stays, the next reign's renown may change.
  await db('field').run("INSERT INTO place (name, lat, lng) VALUES ('New Town', 52, 13)");
  await db('field').run("UPDATE person SET born = '1960-01-01', died = '2020-01-01', living = 0 WHERE house = 'ash'");
  const second = await game.startRun('field', lo, 'cedar', later(2));
  assert.equal(second.side, 'cedar');
  assert.deepEqual(second.field, first.field);
  // The dice are each reign's own, from the secret and the reign's id: playing the week again meets new dice.
  assert.notEqual(second.seed, first.seed);
  assert.match(first.seed, /^[0-9a-f]{24}$/);
  assert.equal(first.seed, await game.reignSeed(first.id));
  assert.notEqual(first.seed, await game.weekSeed('field', first.week), 'not the week\'s seed, which every browser sees');
  assert.equal((await db('field').get<{ seed: string }>('SELECT seed FROM campaign_run WHERE id = ?', first.id))!.seed, first.seed);
  // A reign begun before the edits is replayed with the renown it began with.
  const kept = JSON.parse((await db('field').get<{ field: string }>('SELECT field FROM campaign_run WHERE id = ?', first.id))!.field) as { renown: number; grant: number };
  assert.equal(kept.renown, first.renown);
  const moves = movesFor(first);
  assert.deepEqual((await game.finishRun('field', steward, first.id, moves, { key: key() }, later(3))).score, replay(first.field.start, reignOf(first), moves).score);
  // The member who began the week leaves (their reigns go): the week's field stays, as it is kept on its own.
  await db('field').run('DELETE FROM campaign_run WHERE account = ?', steward.account);
  assert.deepEqual((await game.startRun('field', lo, 'cedar', later(3))).field, first.field);
  assert.deepEqual((await game.campaignView('field', lo, later(3))).challenge!.field.map, first.field.map);
  // The next week is a new field from a new seed.
  const next = await game.startRun('field', steward, null, later(7));
  assert.equal(next.week, '2026-W11');
  assert.notEqual(next.seed, first.seed);
  assert.ok(next.field.map.provinces.some((p) => p.name === 'New Town'), 'the new week sees the new place');
});

test('two first reigns begun at once share one field, and the quiz’s reward is taken by one reign a day', async () => {
  const steward = await on('race');
  const lo = await account('race', 'Lo', 'loner');
  // Lo's first reign is decided, and before its batch is written, Sten's begins and is stored, on a family that has
  // changed meanwhile, so the two fields laid out would differ. Lo's batch then finds the week taken and reads it back.
  const d = db('race');
  const write = d.batch.bind(d);
  let a: RunStart | undefined;
  d.batch = (async (qs: Parameters<typeof write>[0]) => {
    if (!a && qs.some((x) => /INSERT INTO campaign_run/.test(x.sql))) {
      d.batch = write;
      await d.run("INSERT INTO place (name, lat, lng) VALUES ('Raced Town', 50, 9)");
      await d.run("UPDATE place SET lat = lat + 0.7 WHERE name = 'Town 0'");
      a = await game.startRun('race', steward, null, T0);
    }
    return write(qs);
  }) as typeof d.batch;
  const b = await game.startRun('race', lo, 'cedar', T0);
  d.batch = write;
  assert.ok(a);
  assert.deepEqual(b.field, a.field, 'the reign that came second plays the stored field');
  assert.equal(await count('race', 'campaign_week'), 1);
  for (const run of [a, b]) assert.deepEqual(JSON.parse((await db('race').get<{ field: string }>('SELECT field FROM campaign_week'))!.field), run.field);

  // A right answer in today's quiz adds to the levy of one reign begun today, however many begin at once.
  const today = T0.toISOString().slice(0, 10);
  await db('race').run("INSERT INTO quiz_day (day, kind, about, question, answer) VALUES (?, 'k', NULL, '{}', '0')", today);
  await db('race').run("INSERT INTO quiz_answer (day, account, choice, correct, house, at) VALUES (?, ?, '0', 1, NULL, ?)", today, lo.account, T0.toISOString());
  // The same again: one reign decided with the reward, another taking it before the first is written.
  let other: RunStart | undefined;
  d.batch = (async (qs: Parameters<typeof write>[0]) => {
    if (!other && qs.some((x) => /INSERT INTO campaign_run/.test(x.sql))) {
      d.batch = write;
      other = await game.startRun('race', lo, 'cedar', later(0.01));
    }
    return write(qs);
  }) as typeof d.batch;
  const first = await game.startRun('race', lo, 'cedar', later(0.01));
  d.batch = write;
  assert.deepEqual([first.grant, other!.grant].sort(), [0, RULES.QUIZ_LEVY]);
  assert.equal((await game.startRun('race', lo, 'cedar', later(0.02))).grant, 0, 'spent for the day');
});

test('without the server’s secret no reign is ranked, and nothing is written; the week is still shown', async () => {
  const steward = await on('nosecret');
  const { store: driver } = await import('../db.server.ts');
  const kept = driver.secret;
  driver.secret = () => { throw new Error('KINDRED_SECRET is not set.'); };
  try {
    await assert.rejects(game.startRun('nosecret', steward, null, T0), /campaign\.err\.no_secret/);
    await assert.rejects(game.reignSeed('anything'), /campaign\.err\.no_secret/);
    assert.equal(await count('nosecret', 'campaign_run'), 0);
    assert.equal(await count('nosecret', 'campaign_week'), 0);
    assert.ok((await game.campaignView('nosecret', steward, T0)).challenge, 'the field is shown, for a practice');
  } finally {
    driver.secret = kept;
  }
});

test('the tables: each member’s best this week with their count of reigns, the all-time list, and each house’s total', async () => {
  const steward = await on('table');
  const bo = await account('table', 'Bo', 'birch0');
  const lo = await account('table', 'Lo', 'loner');
  const finish = async (who: Who, side: string | null, when: Date) => {
    const run = await game.startRun('table', who, side, when);
    return game.finishRun('table', who, run.id, movesFor(run), { key: key() }, when);
  };
  const a1 = await finish(steward, null, T0);
  const a2 = await finish(steward, null, later(0.1));
  const b1 = await finish(bo, null, later(0.2));
  const l1 = await finish(lo, 'ash', later(0.3));
  // An unfinished reign does not count.
  await game.startRun('table', bo, null, later(0.4));
  const view = await game.campaignView('table', steward, later(0.5));
  const board = view.board!;
  const best = Math.max(a1.score.total, a2.score.total);
  assert.deepEqual(board.week.map((r) => r.name).sort(), ['Bo', 'Lo', 'Sten']);
  const sten = board.week.find((r) => r.name === 'Sten')!;
  assert.deepEqual({ score: sten.score, runs: sten.runs, mine: sten.mine, side: sten.side }, { score: best, runs: 2, mine: true, side: 'ash' });
  assert.deepEqual(board.week.map((r) => r.score), [...board.week.map((r) => r.score)].sort((x, y) => y - x), 'best first');
  assert.equal(board.me.best, best);
  assert.equal(board.me.runs, 2);
  assert.equal(board.me.of, 3);
  assert.equal(board.allTime.length, 4);
  assert.equal(board.allTime[0].score, Math.max(a1.score.total, a2.score.total, b1.score.total, l1.score.total));
  const ash = board.houses.find((h) => h.side === 'ash')!;
  assert.deepEqual({ total: ash.total, members: ash.members }, { total: best + l1.score.total, members: 2 });
  assert.equal(board.houses.find((h) => h.side === 'birch')!.total, b1.score.total);
  // Names are kept as they were; no account id reaches the page.
  assert.ok(!JSON.stringify(board).includes(steward.account));
});

test('a family with fewer than four houses plays against invented regents, and one without houses may play a regent company', async () => {
  const solo = await on('solo', ['ash']);
  const c = (await game.campaignView('solo', solo, T0)).challenge!;
  assert.deepEqual(c.field.sides.map((s) => s.id), ['ash', 'rival:greywatch', 'rival:marchwardens', 'rival:emberguard']);
  await on('none', []);
  const lo = await account('none', 'Lo', 'loner');
  const none = (await game.campaignView('none', lo, T0)).challenge!;
  assert.ok(none.field.sides.every((s) => s.rival));
  await assert.rejects(game.startRun('none', lo, null, T0), /campaign\.err\.no_side/);
  assert.equal((await game.startRun('none', lo, 'rival:emberguard', T0)).side, 'rival:emberguard');
});

test('a season of the old shared game still running is closed once into the hall of fame; nothing of it is played again', async () => {
  family('old');
  const steward = await account('old', 'Sten', 'ash0', 'steward');
  const d = db('old');
  const sides = [{ id: 'ash', name: 'House ash', arms: JSON.parse(ARMS), rival: false, houses: ['ash'], allies: [] }, { id: 'birch', name: 'House birch', arms: JSON.parse(ARMS), rival: false, houses: ['birch'], allies: [] }];
  const state = { day: 9, holder: ['ash', 'ash', 'birch', null], troops: [3, 2, 5, 2], pool: {}, seats: { ash: 0, birch: 2 }, acted: [] };
  await d.run("INSERT INTO campaign (id, enabled, season) VALUES (1, 1, 2)");
  await d.run("INSERT INTO campaign_season (season, seed, started, map, sides, state, ended, winner, result) VALUES (1, 's', 1, '{}', ?, '{}', '2026-01-01T00:00:00Z', 'birch', ?)", JSON.stringify(sides), JSON.stringify({ winner: { id: 'birch', name: 'House birch', arms: JSON.parse(ARMS) }, standings: [] }));
  await d.run("INSERT INTO campaign_season (season, seed, started, map, sides, state) VALUES (2, 's', 1, '{}', ?, ?)", JSON.stringify(sides), JSON.stringify(state));
  const view = await game.campaignView('old', steward, T0);
  assert.deepEqual(view.fame.map((f) => [f.season, f.winner?.id]), [[2, 'ash'], [1, 'birch']]);
  assert.deepEqual(view.fame[0].standings.map((s) => [s.id, s.provinces]), [['ash', 2], ['birch', 1]]);
  const closed = await d.get<{ ended: string; rev: number }>('SELECT ended, rev FROM campaign_season WHERE season = 2');
  assert.equal(closed!.ended, T0.toISOString());
  await game.campaignView('old', steward, later(1));
  assert.deepEqual(await d.get<{ ended: string; rev: number }>('SELECT ended, rev FROM campaign_season WHERE season = 2'), closed, 'closed once');
  assert.ok(view.challenge, 'the game goes on as the weekly challenge');
});

test('the game never writes to the family’s records', async () => {
  family('pure');
  const steward = await account('pure', 'Sten', 'ash0', 'steward');
  const lo = await account('pure', 'Lo', 'loner');
  const before = await records('pure');
  await game.setCampaignEnabled('pure', true, steward.account, T0);
  const run = await game.startRun('pure', steward, null, T0);
  await game.finishRun('pure', steward, run.id, movesFor(run), { key: key() }, T0);
  await game.startRun('pure', lo, 'cedar', T0);
  await game.campaignView('pure', steward, later(1));
  await game.setCampaignEnabled('pure', false, steward.account, later(2));
  assert.equal(await records('pure'), before);
});

test('renown counts how well a house is recorded, its life events and cited sources too', async () => {
  family('renown');
  const sides = await game.sidesOf('renown');
  const before = (await game.renownOfSides('renown', sides)).get('ash')!;
  assert.deepEqual(before.parts.map((p) => [p.key, p.have]), [['portraits', 0], ['dates', 2], ['places', 4], ['memories', 1], ['events', 0], ['sources', 0]]);
  assert.equal(before.score, 0 + 10 + 20 + 10 + 0 + 0);
  const at = T0.toISOString();
  await db('renown').batch(['ash0', 'ash1', 'ash2', 'ash3'].map((p) => ({
    sql: 'INSERT INTO life_event (id, person, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', params: [`ev-${p}`, p, 'baptism', at, at],
  })));
  await db('renown').run('INSERT INTO source (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', 's1', 'Parish register', at, at);
  await db('renown').run("INSERT INTO citation (id, source, fact, person, created_at, updated_at) VALUES ('c1', 's1', 'birth', 'ash0', ?, ?)", at, at);
  const after = (await game.renownOfSides('renown', sides)).get('ash')!;
  assert.equal(after.parts.find((p) => p.key === 'events')!.points, 10);
  assert.equal(after.parts.find((p) => p.key === 'sources')!.points, 5);
  assert.equal(after.score, before.score + 15);
});

test('small houses fight beside the house they are nearest to by marriage, and a house married into none sits out', async () => {
  const houses = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  family('allies', houses);
  const d = db('allies');
  // h5 and h6 are the smallest: make them so, and marry h5 into h2.
  await d.run("DELETE FROM person WHERE id IN ('h52', 'h53', 'h61', 'h62', 'h63')");
  await d.run("INSERT INTO partnership (id, a, b) VALUES ('u1', 'h50', 'h20'), ('u2', 'h51', 'h21'), ('u3', 'h50', 'h30')");
  const sides = await game.sidesOf('allies');
  assert.equal(sides.length, RULES.SIDES);
  assert.deepEqual(sides.find((s) => s.id === 'h2')!.houses, ['h2', 'h5']);
  assert.ok(!sides.some((s) => s.houses.includes('h6')));
  const wed = await account('allies', 'Wed', 'h50', 'steward');
  await game.setCampaignEnabled('allies', true, wed.account, T0);
  assert.equal((await game.campaignView('allies', wed, T0)).challenge!.side, 'h2');
});

test('the D1 transfer leaves the game’s tables out and still finds every table of the family', async () => {
  family('transfer');
  const names = (await db('transfer').all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  const plan = planTables(names);
  for (const table of ['campaign', 'campaign_log', 'campaign_member', 'campaign_push', 'campaign_season', 'campaign_run', 'campaign_week']) {
    assert.ok(plan.leftOut.includes(table), table);
    assert.ok(!plan.copy.includes(table));
  }
});
