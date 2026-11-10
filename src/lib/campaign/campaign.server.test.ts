// node --test src/lib/campaign/campaign.server.test.ts — the Campaign on the server: off until a steward turns it on, a
// member acts only for their own house and only with orders they have, the dice are the server's, the nights are played
// once however many requests arrive, seasons end into the hall of fame, and the family's records are never written.
// A scratch family and accounts database; never data/.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-campaign-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
after(() => rmSync(dir, { recursive: true, force: true }));

const { openSqlite } = await import('../store/node.ts');
const { db } = await import('../db.server.ts');
const store = await import('../auth/store.server.ts');
const game = await import('./campaign.server.ts');
const { notifyFallen } = await import('./push.server.ts');
const { RULES, battle, neighbours } = await import('./engine.ts');
const { b64url } = await import('../webpush.ts');
const { planTables } = await import('../../../scripts/lib/d1-transfer.ts');
type Who = import('./campaign.server.ts').Who;
type Order = import('./engine.ts').Order;

const ARMS = JSON.stringify({ field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' });
const HOUSES = ['ash', 'birch', 'cedar'];
const DAY = 86_400_000;
const T0 = new Date('2026-03-02T09:00:00Z');
const later = (days: number, from = T0) => new Date(from.getTime() + days * DAY);

/** A family of three houses of four people each, twelve places, and one person in no house. */
function family(tree: string, houses = HOUSES) {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'Testers'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  for (let i = 0; i < 12; i++) d.exec(`INSERT INTO place (name, lat, lng) VALUES ('Town ${i}', ${48 + (i % 4) * 1.3}, ${7 + Math.floor(i / 4) * 2.1 + (i % 3) * 0.4})`);
  houses.forEach((h, k) => {
    d.exec(`INSERT INTO house (id, name, arms) VALUES ('${h}', 'House ${h}', '${ARMS}')`);
    for (let i = 0; i < 4; i++) d.exec(`INSERT INTO person (id, given, house, born, born_place, living) VALUES ('${h}${i}', 'P${i}', '${h}', ${i < 2 ? "'1950-01-02'" : 'NULL'}, 'Town ${k * 4 + i}', 1)`);
  });
  d.exec("INSERT INTO person (id, given, living) VALUES ('loner', 'Lo', 1)");
  d.exec(`INSERT INTO story (person, kind, body, author, at) VALUES ('${houses[0]}0', 'memory', 'A day at the lake', 'T', '2026-01-01')`);
  d.close();
}

async function account(tree: string, name: string, person: string | null, role: 'viewer' | 'steward' = 'viewer'): Promise<Who> {
  const { user, insert } = store.newUser(name, null);
  await store.accounts().batch([insert, store.upsertMembership(user.id, tree, role)]);
  if (person) await store.accounts().run('UPDATE membership SET person = ? WHERE user = ? AND tree = ?', person, user.id, tree);
  return { account: user.id, name, person };
}

const key = () => `k${crypto.randomUUID()}`;
const season = async (tree: string) => {
  const row = (await db(tree).get<{ season: number; state: string; map: string; sides: string; rev: number }>('SELECT * FROM campaign_season ORDER BY season DESC LIMIT 1'))!;
  return { number: row.season, rev: row.rev, state: JSON.parse(row.state) as import('./engine.ts').State, map: JSON.parse(row.map) as import('./engine.ts').GameMap, sides: JSON.parse(row.sides) as { id: string; rival: boolean }[] };
};
const count = async (tree: string, table: string, where = '1 = 1') => (await db(tree).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const records = async (tree: string) => JSON.stringify(await Promise.all(['meta', 'house', 'person', 'parent', 'partnership', 'story', 'place', 'photo', 'person_field'].map((t) => db(tree).all(`SELECT * FROM ${t}`))));
const muster = (to: number): Order => ({ type: 'muster', to, troops: 1 });

test('the game is off until a steward turns it on: nothing can be played, and no bonus is given', async () => {
  family('off');
  const ada = await account('off', 'Ada', 'ash0');
  const { view } = await game.campaignView('off', ada, T0);
  assert.equal(view.enabled, false);
  assert.equal(view.state, undefined);
  assert.ok(view.board.map.provinces.length >= RULES.MIN_PROVINCES, 'the practice skirmish still has its map');
  assert.deepEqual(await game.campaignStatus('off', ada, T0), { enabled: false });
  await assert.rejects(game.giveOrder('off', ada, muster(0), null, { key: key() }, T0), /campaign\.err\.off/);
  await assert.rejects(game.pledge('off', ada, 'ash', T0), /campaign\.err\.off/);
  assert.deepEqual(await game.grantOrder('off', ada.account, 'quiz', T0), { granted: false });
  assert.deepEqual(await game.advance('off', later(3)), []);
  assert.equal(await count('off', 'campaign_season'), 0);
});

test('turning it on starts season one on a map of the family’s places, with every house as a side', async () => {
  family('on');
  const steward = await account('on', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('on', true, steward.account, T0);
  assert.deepEqual(await game.campaignSettings('on'), { enabled: true, season: 1 });
  const { view } = await game.campaignView('on', steward, T0);
  assert.equal(view.enabled, true);
  assert.deepEqual(view.season, { number: 1, day: 0, days: 28, started: '2026-03-02', ends: '2026-03-30' });
  assert.deepEqual(view.board.sides.map((s) => s.id).sort(), HOUSES);
  assert.equal(view.board.map.provinces.length, 12);
  assert.ok(view.board.map.provinces.every((p) => p.real && p.name.startsWith('Town')));
  assert.deepEqual(view.me, { side: 'ash', chooses: false, orders: RULES.ORDERS_PER_DAY, bonusToday: false });
  // A house is seated among its own people's places.
  const seat = view.board.map.provinces[view.state!.seats.cedar].name;
  assert.ok(['Town 8', 'Town 9', 'Town 10', 'Town 11'].includes(seat), seat);
  assert.equal(view.log!.at(-1)!.kind, 'season_start');
  // Turning it on twice, or off and on, starts nothing new.
  await game.setCampaignEnabled('on', true, steward.account, T0);
  await game.setCampaignEnabled('on', false, steward.account, T0);
  await game.setCampaignEnabled('on', true, steward.account, T0);
  assert.equal(await count('on', 'campaign_season'), 1);
});

test('a family with fewer than three houses plays against regent companies, and one with no places gets invented marches', async () => {
  family('small', ['ash']);
  await db('small').run('DELETE FROM place');
  const ada = await account('small', 'Ada', 'ash0', 'steward');
  await game.setCampaignEnabled('small', true, ada.account, T0);
  const { view } = await game.campaignView('small', ada, T0);
  assert.equal(view.board.sides.length, RULES.MIN_SIDES);
  assert.equal(view.board.sides.filter((s) => s.rival).length, 2);
  assert.equal(view.board.map.provinces.length, 12);
  assert.ok(view.board.map.provinces.every((p) => !p.real));
  assert.equal(view.me!.side, 'ash');
});

test('a member gives orders for their own house only, each one costs an order, and they cannot spend more than they have', async () => {
  family('orders');
  const steward = await account('orders', 'Sten', 'ash0', 'steward');
  const bea = await account('orders', 'Bea', 'birch1');
  await game.setCampaignEnabled('orders', true, steward.account, T0);
  const s = await season('orders');
  const mine = s.state.seats.birch, theirs = s.state.seats.ash;

  await assert.rejects(game.giveOrder('orders', bea, muster(theirs), null, { key: key() }, T0), /campaign\.err\.not_yours/);
  assert.equal((await season('orders')).rev, s.rev, 'a refused order writes nothing');
  assert.equal(await count('orders', 'campaign_member'), 0);

  const first = await game.giveOrder('orders', bea, muster(mine), '  For   Grandma!  ', { key: key() }, T0);
  assert.equal(first.result.orders, 2);
  assert.equal((await season('orders')).state.troops[mine], s.state.troops[mine] + 1);
  const logged = (await game.campaignView('orders', bea, T0)).view.log![0];
  assert.deepEqual({ kind: logged.kind, name: logged.name, mine: logged.mine, side: logged.side, cry: logged.cry }, { kind: 'muster', name: 'Bea', mine: true, side: 'birch', cry: 'For Grandma!' });

  // Five more at once, with two orders left: exactly two are played.
  const many = await Promise.allSettled(Array.from({ length: 5 }, () => game.giveOrder('orders', bea, muster(mine), null, { key: key() }, T0)));
  assert.equal(many.filter((r) => r.status === 'fulfilled').length, 2);
  for (const r of many) if (r.status === 'rejected') assert.match(String(r.reason), /campaign\.err\.(no_orders|no_levy)|family changed/);
  assert.equal((await season('orders')).state.troops[mine], s.state.troops[mine] + 3);
  assert.equal((await game.campaignView('orders', bea, T0)).view.me!.orders, 0);
  await assert.rejects(game.giveOrder('orders', bea, muster(mine), null, { key: key() }, T0), /campaign\.err\.no_orders/);

  // The next day brings three more, and they save up to six and no further.
  assert.equal((await game.campaignView('orders', bea, later(1))).view.me!.orders, 3);
  assert.equal((await game.campaignView('orders', bea, later(5))).view.me!.orders, RULES.ORDERS_BANK);
});

test('an order sent twice with the same key is played once, and a key used for another order is refused', async () => {
  family('retry');
  const steward = await account('retry', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('retry', true, steward.account, T0);
  const s = await season('retry');
  const seat = s.state.seats.ash;
  const k = key();
  const a = await game.giveOrder('retry', steward, muster(seat), null, { key: k }, T0);
  const b = await game.giveOrder('retry', steward, muster(seat), null, { key: k }, T0);
  assert.deepEqual(a.result, b.result);
  assert.equal((await season('retry')).state.troops[seat], s.state.troops[seat] + 1);
  assert.equal((await game.campaignView('retry', steward, T0)).view.me!.orders, 2);
  await assert.rejects(game.giveOrder('retry', steward, { type: 'muster', to: seat, troops: 2 }, null, { key: k }, T0), /already sent as something else/);
});

test('the dice are the server’s: an attack keeps its seed, and the seed rolls exactly the dice it reported', async () => {
  family('dice');
  const steward = await account('dice', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('dice', true, steward.account, T0);
  const s = await season('dice');
  const seat = s.state.seats.ash;
  const target = neighbours(s.map, seat).find((n) => s.state.holder[n] !== 'ash' && !Object.values(s.state.seats).includes(n))!;
  const k = key();
  const { result } = await game.giveOrder('dice', steward, { type: 'attack', from: seat, to: target, troops: 3 }, 'Onward', { key: k }, T0);
  const e = result.event;
  assert.equal(e.t, 'attack');
  if (e.t !== 'attack') return;
  assert.match(e.seed, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ rounds: e.rounds, aLost: e.aLost, dLost: e.dLost }, battle(3, s.state.troops[target], e.seed));
  const now = await season('dice');
  assert.equal(now.state.holder[target], e.took ? 'ash' : s.state.holder[target]);
  // The same key again: the same battle, not a second roll.
  assert.deepEqual((await game.giveOrder('dice', steward, { type: 'attack', from: seat, to: target, troops: 3 }, 'Onward', { key: k }, T0)).result, result);
  assert.equal((await season('dice')).rev, now.rev);
  await assert.rejects(game.giveOrder('dice', steward, { type: 'attack', from: seat, to: s.state.seats.birch, troops: 1 }, null, { key: key() }, T0), /campaign\.err\.(seat|not_adjacent)/);
});

test('a member who stands for nobody in a house chooses one for the season, once, and never a regent company', async () => {
  family('pledge', ['ash', 'birch']);
  const steward = await account('pledge', 'Sten', 'ash0', 'steward');
  const lo = await account('pledge', 'Lo', 'loner');
  const guestish = await account('pledge', 'Browsing', '-');
  await game.setCampaignEnabled('pledge', true, steward.account, T0);
  const s = await season('pledge');
  const rival = s.sides.find((x) => x.rival)!.id;
  assert.deepEqual((await game.campaignView('pledge', lo, T0)).view.me, { side: null, chooses: true, orders: 3, bonusToday: false });
  await assert.rejects(game.giveOrder('pledge', lo, muster(s.state.seats.ash), null, { key: key() }, T0), /campaign\.err\.no_side/);
  await assert.rejects(game.pledge('pledge', lo, rival, T0), /campaign\.err\.no_such_side/);
  await assert.rejects(game.pledge('pledge', lo, 'nobody', T0), /campaign\.err\.no_such_side/);
  await assert.rejects(game.pledge('pledge', steward, 'birch', T0), /campaign\.err\.has_house/);
  await game.pledge('pledge', lo, 'birch', T0);
  assert.equal((await game.campaignView('pledge', lo, T0)).view.me!.side, 'birch');
  await assert.rejects(game.pledge('pledge', lo, 'ash', T0), /campaign\.err\.pledged/);
  // Now Lo plays for birch, and only for birch.
  await game.giveOrder('pledge', lo, muster(s.state.seats.birch), null, { key: key() }, T0);
  await assert.rejects(game.giveOrder('pledge', lo, muster(s.state.seats.ash), null, { key: key() }, T0), /campaign\.err\.not_yours/);
  assert.equal((await game.campaignView('pledge', guestish, T0)).view.me!.chooses, true);
  assert.equal((await game.campaignView('pledge', steward, T0)).view.board.sides.find((x) => x.id === 'birch')!.members, 1);
});

test('grantOrder gives one extra order a day at most, on top of the bank, and only to a member', async () => {
  family('bonus');
  const steward = await account('bonus', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('bonus', true, steward.account, T0);
  assert.deepEqual(await game.grantOrder('bonus', steward.account, 'quiz', T0), { granted: true, orders: 4 });
  assert.deepEqual(await game.grantOrder('bonus', steward.account, 'quiz', T0), { granted: false, orders: 4 });
  assert.deepEqual(await game.grantOrder('bonus', steward.account, 'another-reason', later(0.2)), { granted: false, orders: 4 });
  const { view } = await game.campaignView('bonus', steward, T0);
  assert.equal(view.me!.orders, 4);
  assert.equal(view.me!.bonusToday, true);
  assert.equal(view.log![0].kind, 'bonus');
  // The next day: the bank fills to six, and the day's bonus sits on top.
  assert.deepEqual(await game.grantOrder('bonus', steward.account, 'quiz', later(1)), { granted: true, orders: RULES.ORDERS_MAX });
  assert.deepEqual(await game.grantOrder('bonus', 'nobody-here', 'quiz', later(1)), { granted: false });
  await assert.rejects(game.grantOrder('bonus', steward.account, 'Not A Code!', later(1)), /campaign\.err\.reason/);
});

test('the nights that passed are played once, in order, however many requests open the game at the same moment', async () => {
  family('nights');
  family('nights2');
  const steward = await account('nights', 'Sten', 'ash0', 'steward');
  const other = await account('nights2', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('nights', true, steward.account, T0);
  await game.setCampaignEnabled('nights2', true, other.account, T0);
  // Six requests at once, three nights later.
  await Promise.all(Array.from({ length: 6 }, () => game.campaignView('nights', steward, later(3))));
  const s = await season('nights');
  assert.equal(s.state.day, 3);
  const attacks = await count('nights', 'campaign_log', "kind = 'attack'");
  assert.ok(attacks >= 3, 'the regents attacked');
  // Asking again, at the same moment or later the same day, plays nothing more.
  await game.advance('nights', later(3));
  await game.advance('nights', later(3.4));
  assert.equal(await count('nights', 'campaign_log', "kind = 'attack'"), attacks);
  assert.equal((await season('nights')).rev, s.rev);
  // Played a day at a time, as the daily job does, the nights are each played once too.
  for (const day of [1, 2, 3]) await game.advance('nights2', later(day));
  assert.equal((await season('nights2')).state.day, 3);
  assert.deepEqual((await db('nights2').all<{ day: number }>("SELECT DISTINCT day FROM campaign_log WHERE kind = 'attack' ORDER BY day")).map((r) => r.day), [0, 1, 2]);
  // A regent never moves a house whose member gave an order that day.
  const before = await season('nights');
  await game.giveOrder('nights', steward, muster(before.state.seats.ash), null, { key: key() }, later(3));
  await game.advance('nights', later(4));
  const night = await db('nights').all<{ side: string }>("SELECT side FROM campaign_log WHERE kind = 'attack' AND day = 3 AND account IS NULL");
  assert.ok(!night.some((r) => r.side === 'ash'));
});

test('a season ends after twenty-eight days: the winner goes to the hall of fame and a new season starts on a fresh map', async () => {
  family('seasons');
  const steward = await account('seasons', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('seasons', true, steward.account, T0);
  await game.grantOrder('seasons', steward.account, 'quiz', T0);
  const { view } = await game.campaignView('seasons', steward, later(30));
  assert.equal(view.season!.number, 2);
  assert.equal(view.season!.started, '2026-03-30', 'the next season follows without a gap');
  assert.equal(view.season!.day, 2);
  assert.equal(view.fame.length, 1);
  assert.equal(view.fame[0].season, 1);
  assert.ok(HOUSES.includes(view.fame[0].winner!.id));
  assert.deepEqual(view.fame[0].standings.map((r) => r.provinces), [...view.fame[0].standings.map((r) => r.provinces)].sort((a, b) => b - a));
  assert.equal(view.fame[0].standings.reduce((n, r) => n + r.provinces, 0) <= 12, true);
  assert.equal(view.board.sides.find((s) => s.id === view.fame[0].winner!.id)!.laurels, 1);
  assert.equal(view.me!.orders, 3, 'a new season starts everyone with three orders');
  // A game left alone for longer than a season does not replay every empty season: the next one starts today.
  const late = (await game.campaignView('seasons', steward, later(200))).view;
  assert.equal(late.season!.started, later(200).toISOString().slice(0, 10));
  assert.ok(late.season!.number <= 4);
  // Only the last two seasons keep their chronicle and members' rows.
  assert.equal(await count('seasons', 'campaign_log', `season < ${late.season!.number - 1}`), 0);
  assert.equal(await count('seasons', 'campaign_member', `season < ${late.season!.number - 1}`), 0);
});

test('a steward can end the season now', async () => {
  family('endnow');
  const steward = await account('endnow', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('endnow', true, steward.account, T0);
  await game.endSeasonNow('endnow', later(4));
  const { view } = await game.campaignView('endnow', steward, later(4));
  assert.equal(view.season!.number, 2);
  assert.equal(view.season!.day, 0);
  assert.equal(view.season!.started, later(4).toISOString().slice(0, 10));
  assert.equal(view.fame.length, 1);
  await game.setCampaignEnabled('endnow', false, steward.account, later(4));
  await assert.rejects(game.endSeasonNow('endnow', later(4)), /campaign\.err\.off/);
});

test('the map shows what changed hands since the member last looked, until they have seen it', async () => {
  family('seen');
  const steward = await account('seen', 'Sten', 'ash0', 'steward');
  await game.setCampaignEnabled('seen', true, steward.account, T0);
  const { view } = await game.campaignView('seen', steward, later(4));
  const taken = view.log!.filter((l) => l.kind === 'attack' && l.event?.t === 'attack' && l.event.took).map((l) => (l.event as { to: number }).to);
  assert.ok(taken.length > 0);
  assert.deepEqual([...view.changed!].sort(), [...new Set(taken)].sort());
  await game.markSeen('seen', steward, view.log![0].id);
  assert.deepEqual((await game.campaignView('seen', steward, later(4))).view.changed, []);
  await game.markSeen('seen', steward, 0);
  assert.deepEqual((await game.campaignView('seen', steward, later(4))).view.changed, [], 'the mark never moves back');
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
  // One citation names its person, the other an event of theirs: both count for the house.
  await db('renown').run("INSERT INTO citation (id, source, fact, person, created_at, updated_at) VALUES ('c1', 's1', 'birth', 'ash0', ?, ?)", at, at);
  const after = (await game.renownOfSides('renown', sides)).get('ash')!;
  assert.equal(after.parts.find((p) => p.key === 'events')!.points, 10);
  assert.equal(after.parts.find((p) => p.key === 'sources')!.points, 5);
  assert.equal(after.score, before.score + 15);
  await db('renown').run("INSERT INTO citation (id, source, fact, event, created_at, updated_at) VALUES ('c2', 's1', 'event', 'ev-ash1', ?, ?)", at, at);
  const more = (await game.renownOfSides('renown', sides)).get('ash')!;
  assert.ok(more.parts.find((p) => p.key === 'sources')!.have === 2);
});

test('small houses fight beside the house they are nearest to by marriage, and a house married into none sits out', async () => {
  const houses = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];
  family('allies', houses);
  const d = db('allies');
  // h7 and h8 are the smallest: make them so, and marry h7 into h2.
  await d.run("DELETE FROM person WHERE id IN ('h72', 'h73', 'h81', 'h82', 'h83')");
  assert.equal(await count('allies', 'person', "house = 'h7'"), 2);
  await d.run("INSERT INTO partnership (id, a, b) VALUES ('u1', 'h70', 'h20'), ('u2', 'h71', 'h21'), ('u3', 'h70', 'h30')");
  const sides = await game.sidesOf('allies');
  assert.equal(sides.length, RULES.MAX_SIDES);
  assert.deepEqual(sides.find((s) => s.id === 'h2')!.houses, ['h2', 'h7']);
  assert.ok(!sides.some((s) => s.houses.includes('h8')));
  const wed = await account('allies', 'Wed', 'h70', 'steward');
  const out = await account('allies', 'Out', 'h80');
  await game.setCampaignEnabled('allies', true, wed.account, T0);
  assert.equal((await game.campaignView('allies', wed, T0)).view.me!.side, 'h2');
  assert.deepEqual((await game.campaignView('allies', out, T0)).view.me, { side: null, chooses: true, orders: 3, bonusToday: false });
});

test('the game never writes to the family’s records', async () => {
  family('pure');
  const steward = await account('pure', 'Sten', 'ash0', 'steward');
  const lo = await account('pure', 'Lo', 'loner');
  const before = await records('pure');
  await game.setCampaignEnabled('pure', true, steward.account, T0);
  const s = await season('pure');
  await game.giveOrder('pure', steward, muster(s.state.seats.ash), 'Hurrah', { key: key() }, T0);
  await game.pledge('pure', lo, 'cedar', T0);
  await game.grantOrder('pure', lo.account, 'quiz', T0);
  await game.campaignView('pure', steward, later(31));
  await game.endSeasonNow('pure', later(32));
  await game.markSeen('pure', steward, 5);
  await game.setCampaignEnabled('pure', false, steward.account, later(32));
  assert.equal(await records('pure'), before);
});

test('the D1 transfer leaves the game’s tables out and still finds every table of the family', async () => {
  family('transfer');
  const names = (await db('transfer').all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  const plan = planTables(names);
  for (const table of ['campaign', 'campaign_log', 'campaign_member', 'campaign_push', 'campaign_season']) {
    assert.ok(plan.leftOut.includes(table), table);
    assert.ok(!plan.copy.includes(table));
  }
});

test('a house that loses a province is told once a day, and only members with reminders on', async () => {
  family('push');
  const steward = await account('push', 'Sten', 'ash0', 'steward');
  const bea = await account('push', 'Bea', 'birch0');
  const bo = await account('push', 'Bo', 'birch1');
  await game.setCampaignEnabled('push', true, steward.account, T0);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  // Bea has reminders on in this family; Bo does not.
  await store.accounts().run(
    "INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen) VALUES ('d1', ?, 'push', 'https://web.push.apple.com/bea', ?, ?, '[0]', '[\"birthday\"]', 'de', ?, ?)",
    bea.account, p256dh, auth, T0.getTime(), T0.getTime(),
  );
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:family@example.org' };
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { sent.push(String(url)); return new Response(null, { status: 201 }); }) as typeof fetch;
  const fallen = [{ season: 1, day: 0, province: 'Town 5', from: 'birch', to: 'ash', by: steward.account }];
  assert.equal(await notifyFallen('push', fallen, { now: T0, vapid, fetchImpl }), 1);
  assert.deepEqual(sent, ['https://web.push.apple.com/bea']);
  assert.equal(await notifyFallen('push', fallen, { now: T0, vapid, fetchImpl }), 0, 'one a day');
  assert.equal(await notifyFallen('push', fallen, { now: later(1), vapid, fetchImpl }), 1, 'and again the next day');
  assert.equal(await notifyFallen('push', fallen, { now: later(2), vapid: null, fetchImpl }), 0, 'nothing without VAPID keys');
  // The member who took the province is not told about it, even when it was their own house's ally who lost it.
  assert.equal(await notifyFallen('push', [{ ...fallen[0], by: bea.account }], { now: later(3), vapid, fetchImpl }), 0);
  assert.equal(await count('push', 'campaign_push'), 2);
  assert.ok(bo.account);
});
