// node --test src/lib/campaign/engine.test.ts — the Campaign's rules: the map is one piece and the same for the same
// seed, orders are refused when the rules say so and never change the position they were given, the dice follow Risk's
// rules, the regent and the nights are deterministic, and a season between regents stays close.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CampaignError, MAP_H, MAP_W, RULES, addLevy, adjacent, applyOrder, battle, buildMap, endDay, levyOf, neighbours, ordersOn, provinceCount,
  provincesOf, regentTurn, standings, startState, troopsOf, validState, type GameMap, type PlaceIn, type SideRules, type State,
} from './engine.ts';
import { RENOWN_STEPS, renownOf } from './renown.ts';
import { rng } from './rng.ts';

const places = (n: number, seed = 'places'): PlaceIn[] => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({ name: `Place ${i}`, lat: 44 + r() * 8, lng: r() * 12, people: 100 - i }));
};
const SIDES = ['ash', 'birch', 'cedar', 'dale'];
const rules = (ids = SIDES): SideRules[] => ids.map((id) => ({ id, bonus: 1, temper: 'bold' }));
const game = (seed = 's1', ids = SIDES) => {
  const map = buildMap(places(30), provinceCount(ids.length), seed);
  return { map, state: addLevy(startState(map, ids, seed), rules(ids)) };
};
const refused = (code: string) => (e: unknown) => e instanceof CampaignError && e.code === code && e.message === `campaign.err.${code}`;
const reachable = (map: GameMap) => {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) for (const n of neighbours(map, queue.pop()!)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return seen.size;
};
/** A position nobody could have reached by an order is a bug: every province held with at least one troop, none over the cap. */
const sound = (state: State, map: GameMap) => validState(state, map) && state.troops.every((t) => t >= 1 && t <= RULES.GARRISON_MAX + 3);

test('the map has four provinces for each side, within ten and twenty-four, and is the same for the same seed', () => {
  assert.equal(provinceCount(1), 10);
  assert.equal(provinceCount(4), 16);
  assert.equal(provinceCount(6), 24);
  assert.equal(provinceCount(9), 24);
  const a = buildMap(places(30), 16, 'seed');
  assert.deepEqual(a, buildMap(places(30), 16, 'seed'));
  assert.notDeepEqual(a.provinces.map((p) => [p.x, p.y]), buildMap(places(30), 16, 'other').provinces.map((p) => [p.x, p.y]));
  assert.equal(a.provinces.length, 16);
});

test('the map takes the places most people are linked to, keeps every banner inside the box, and is one piece', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    for (const count of [10, 16, 24]) {
      const map = buildMap(places(40, seed), count, seed);
      assert.deepEqual(map.provinces.map((p) => p.name).sort(), Array.from({ length: count }, (_, i) => `Place ${i}`).sort());
      assert.equal(reachable(map), count, `${seed}/${count} is in one piece`);
      for (const p of map.provinces) {
        assert.ok(p.x > 0 && p.x < MAP_W && p.y > 0 && p.y < MAP_H);
        assert.ok(p.cell.length >= 3, 'every province has land');
        assert.ok(neighbours(map, p.id).length >= 1);
      }
      for (const [x, y] of map.borders) assert.ok(x < y && adjacent(map, x, y) && adjacent(map, y, x));
    }
  }
});

test('a family with few places gets invented marches, and one with none still gets a whole map', () => {
  const few = buildMap(places(3), 10, 'few');
  assert.equal(few.provinces.length, 10);
  assert.equal(few.provinces.filter((p) => p.real).length, 3);
  assert.equal(new Set(few.provinces.map((p) => p.name)).size, 10);
  const none = buildMap([], 10, 'none');
  assert.equal(none.provinces.filter((p) => p.real).length, 0);
  assert.equal(reachable(none), 10);
  // Two places at the same spot, and one with no coordinates: still a map.
  const odd = buildMap([{ name: 'A', lat: 50, lng: 8, people: 3 }, { name: 'B', lat: 50, lng: 8, people: 2 }, { name: 'C', lat: Number.NaN, lng: 0, people: 9 }], 10, 'odd');
  assert.equal(reachable(odd), 10);
  assert.ok(!odd.provinces.some((p) => p.name === 'C'));
});

test('every side opens with a seat of its own and a neighbouring province, and the rest are free marches', () => {
  const { map, state } = game();
  const seats = Object.values(state.seats);
  assert.equal(new Set(seats).size, SIDES.length);
  for (const side of SIDES) {
    assert.equal(state.holder[state.seats[side]], side);
    assert.ok(provincesOf(state, side) >= 1 && provincesOf(state, side) <= 2);
    assert.ok(state.pool[side] >= RULES.BASE_LEVY);
  }
  assert.ok(state.holder.filter((h) => h === null).length >= map.provinces.length - 2 * SIDES.length);
  assert.ok(sound(state, map));
});

test('a house is seated where its own people are, when the map has that place', () => {
  const map = buildMap(places(30), 16, 'home');
  const home = map.provinces[7].name;
  const state = startState(map, SIDES, 'home', { cedar: { [home]: 12 } });
  assert.equal(state.seats.cedar, 7);
});

test('the dice follow Risk: three against two at most, the highest compared, ties to the defender, three rounds at most', () => {
  for (let i = 0; i < 300; i++) {
    const a = 1 + (i % 9), d = 1 + (i % 7);
    const fought = battle(a, d, `dice${i}`);
    assert.deepEqual(fought, battle(a, d, `dice${i}`), 'the same seed rolls the same dice');
    assert.ok(fought.rounds.length >= 1 && fought.rounds.length <= RULES.BATTLE_ROUNDS);
    let left = a, held = d;
    for (const r of fought.rounds) {
      assert.equal(r.a.length, Math.min(3, left));
      assert.equal(r.d.length, Math.min(2, held));
      assert.deepEqual(r.a, [...r.a].sort((x, y) => y - x));
      for (const die of [...r.a, ...r.d]) assert.ok(die >= 1 && die <= 6);
      const pairs = Math.min(r.a.length, r.d.length);
      let aLost = 0;
      for (let k = 0; k < pairs; k++) if (r.a[k] <= r.d[k]) aLost++;
      assert.equal(r.aLost, aLost);
      assert.equal(r.dLost, pairs - aLost);
      left -= r.aLost;
      held -= r.dLost;
    }
    assert.equal(fought.aLost, a - left);
    assert.equal(fought.dLost, d - held);
    assert.ok(left >= 0 && held >= 0);
  }
});

test('muster places waiting levy on a province of the house, up to five and up to what the province feeds', () => {
  const { map, state } = game();
  const seat = state.seats.ash;
  const before = JSON.stringify(state);
  const done = applyOrder(state, map, 'ash', { type: 'muster', to: seat, troops: 2 }, 'x');
  assert.equal(JSON.stringify(state), before, 'the position given is not changed');
  assert.equal(done.state.troops[seat], state.troops[seat] + 2);
  assert.equal(done.state.pool.ash, state.pool.ash - 2);
  assert.deepEqual(done.state.acted, ['ash']);
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'muster', to: state.seats.birch, troops: 1 }, 'x'), refused('not_yours'));
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'muster', to: seat, troops: state.pool.ash + 1 }, 'x'), refused('troops'));
  assert.throws(() => applyOrder({ ...state, pool: { ...state.pool, ash: 12 } }, map, 'ash', { type: 'muster', to: seat, troops: 6 }, 'x'), refused('troops'));
  assert.throws(() => applyOrder({ ...state, pool: { ...state.pool, ash: 0 } }, map, 'ash', { type: 'muster', to: seat, troops: 1 }, 'x'), refused('no_levy'));
  const full = { ...state, troops: state.troops.map((t, i) => (i === seat ? RULES.GARRISON_MAX - 1 : t)) };
  assert.throws(() => applyOrder(full, map, 'ash', { type: 'muster', to: seat, troops: 2 }, 'x'), refused('full'));
  for (const troops of [0, -1, 1.5, Number.NaN]) assert.throws(() => applyOrder(state, map, 'ash', { type: 'muster', to: seat, troops }, 'x'), refused('troops'));
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'muster', to: 99, troops: 1 }, 'x'), refused('no_province'));
});

test('march moves troops between neighbouring provinces of the house, and one always stays behind', () => {
  const { map, state } = game();
  const seat = state.seats.ash;
  const own = neighbours(map, seat).find((n) => state.holder[n] === 'ash')!;
  const free = map.provinces.find((p) => state.holder[p.id] === null && adjacent(map, seat, p.id))!.id;
  const far = map.provinces.find((p) => !adjacent(map, seat, p.id) && p.id !== seat)!.id;
  const done = applyOrder(state, map, 'ash', { type: 'march', from: seat, to: own, troops: 3 }, 'x');
  assert.equal(done.state.troops[seat], state.troops[seat] - 3);
  assert.equal(done.state.troops[own], state.troops[own] + 3);
  assert.equal(troopsOf(done.state, 'ash'), troopsOf(state, 'ash'));
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'march', from: seat, to: own, troops: state.troops[seat] }, 'x'), refused('stay_one'));
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'march', from: seat, to: free, troops: 1 }, 'x'), refused('not_yours'));
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'march', from: seat, to: far, troops: 1 }, 'x'), refused('not_adjacent'));
  assert.throws(() => applyOrder(state, map, 'birch', { type: 'march', from: seat, to: own, troops: 1 }, 'x'), refused('not_yours'));
});

test('an attack is fought with the troops sent: a fallen province is taken by the survivors, a held one costs only the losses', () => {
  const { map, state } = game();
  const seat = state.seats.ash;
  const free = map.provinces.find((p) => state.holder[p.id] === null && adjacent(map, seat, p.id))!.id;
  let won = 0, held = 0;
  for (let i = 0; i < 80; i++) {
    const strong = { ...state, troops: state.troops.map((t, k) => (k === seat ? 8 : t)) };
    const { state: after, event } = applyOrder(strong, map, 'ash', { type: 'attack', from: seat, to: free, troops: 5 }, `attack${i}`);
    assert.equal(event.t, 'attack');
    if (event.t !== 'attack') continue;
    assert.equal(event.defender, null);
    assert.equal(event.seed, `attack${i}`);
    assert.deepEqual({ rounds: event.rounds, aLost: event.aLost, dLost: event.dLost }, battle(5, strong.troops[free], `attack${i}`), 'the dice are the seed’s dice');
    if (event.took) {
      won++;
      assert.equal(after.holder[free], 'ash');
      assert.equal(after.troops[free], 5 - event.aLost);
      assert.equal(after.troops[seat], 3);
    } else {
      held++;
      assert.equal(after.holder[free], null);
      assert.equal(after.troops[free], strong.troops[free] - event.dLost);
      assert.equal(after.troops[seat], 8 - event.aLost);
    }
    assert.ok(sound(after, map));
  }
  assert.ok(won > 0 && held > 0, 'both outcomes happen');
});

test('nobody attacks their own province, a seat, a province that is not a neighbour, or with the troop that must stay', () => {
  const { map, state } = game('s3');
  const seat = state.seats.ash;
  const own = neighbours(map, seat).find((n) => state.holder[n] === 'ash')!;
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'attack', from: seat, to: own, troops: 1 }, 'x'), refused('own_province'));
  assert.throws(() => applyOrder(state, map, 'ash', { type: 'attack', from: seat, to: neighbours(map, seat)[0], troops: state.troops[seat] }, 'x'), refused('stay_one'));
  // Put another house's seat next door: it is still safe.
  const next = neighbours(map, seat).find((n) => n !== own)!;
  const beside = { ...state, holder: state.holder.map((h, i) => (i === next ? 'birch' : h)), seats: { ...state.seats, birch: next } };
  assert.throws(() => applyOrder(beside, map, 'ash', { type: 'attack', from: seat, to: next, troops: 2 }, 'x'), refused('seat'));
  assert.throws(() => applyOrder({ ...state, day: RULES.SEASON_DAYS }, map, 'ash', { type: 'muster', to: seat, troops: 1 }, 'x'), refused('season_over'));
});

test('the levy is the base, plus renown up to two, plus one for each province behind the leader up to two', () => {
  const { state } = game();
  const lead = { ...state, holder: state.holder.map((h, i) => (h === null && i % 2 === 0 ? 'ash' : h)) };
  assert.deepEqual(levyOf(state, 'ash', 0, SIDES), { base: RULES.BASE_LEVY, renown: 0, rally: 0, total: RULES.BASE_LEVY });
  assert.equal(levyOf(state, 'ash', 9, SIDES).renown, RULES.RENOWN_MAX_BONUS);
  assert.equal(levyOf(lead, 'ash', 1, SIDES).rally, 0);
  assert.equal(levyOf(lead, 'birch', 1, SIDES).rally, RULES.RALLY_MAX);
  assert.equal(levyOf(lead, 'birch', 1, SIDES).total, RULES.BASE_LEVY + 1 + RULES.RALLY_MAX);
  assert.ok(addLevy({ ...state, pool: { ash: RULES.POOL_CAP } }, rules()).pool.ash === RULES.POOL_CAP, 'the waiting levy stops at its cap');
});

test('a regent plays the same day the same way, only ever by the rules, and attacks once a day at most', () => {
  for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5']) {
    let { map, state } = game(seed);
    for (let day = 0; day < 12; day++) {
      for (const side of SIDES) {
        const a = regentTurn(state, map, side, `${seed}:${day}`);
        assert.deepEqual(a, regentTurn(state, map, side, `${seed}:${day}`));
        assert.ok(a.events.length <= RULES.ORDERS_PER_DAY);
        assert.ok(a.events.filter((e) => e.t === 'attack').length <= RULES.REGENT_ATTACKS);
        assert.ok(a.events.every((e) => e.side === side));
        assert.ok(sound(a.state, map));
        state = a.state;
      }
      state = addLevy({ ...state, day: state.day + 1, acted: [] }, rules());
    }
  }
});

test('at nightfall a regent plays the sides nobody gave an order for, then the next day’s levy arrives', () => {
  const { map, state } = game('n1');
  const seat = state.seats.ash;
  const mine = applyOrder(state, map, 'ash', { type: 'muster', to: seat, troops: 1 }, 'x').state;
  const night = endDay(mine, map, rules(), 'n1');
  assert.deepEqual(night, endDay(mine, map, rules(), 'n1'), 'the same night comes out the same');
  assert.equal(night.state.day, 1);
  assert.deepEqual(night.state.acted, []);
  assert.ok(!night.events.some((e) => e.side === 'ash'), 'a house a member played is left alone');
  assert.ok(new Set(night.events.map((e) => e.side)).size >= 2, 'the others were played');
  assert.ok(night.state.pool.ash >= mine.pool.ash + RULES.BASE_LEVY);
  // The last night brings no levy, and a finished season stays as it is.
  const last = endDay({ ...state, day: RULES.SEASON_DAYS - 1 }, map, rules(), 'n1');
  assert.equal(last.state.day, RULES.SEASON_DAYS);
  assert.deepEqual(endDay(last.state, map, rules(), 'n1'), { state: last.state, events: [] });
});

test('a season stays close: nobody is ever out, no house runs away with the map, and the lead changes hands', () => {
  let changes = 0, share = 0;
  const runs = 30;
  for (let i = 0; i < runs; i++) {
    const seed = `season${i}`;
    let { map, state } = game(seed);
    let leader = '';
    for (let day = 0; day < RULES.SEASON_DAYS; day++) {
      state = endDay(state, map, rules(), seed).state;
      assert.ok(sound(state, map));
      for (const side of SIDES) assert.equal(state.holder[state.seats[side]], side, 'a seat never falls');
      const top = standings(state, SIDES)[0].side;
      if (day > 6 && top !== leader) { leader = top; changes++; }
    }
    assert.equal(state.day, RULES.SEASON_DAYS);
    const table = standings(state, SIDES);
    assert.ok(table.at(-1)!.provinces >= 1);
    assert.ok(table[0].provinces / map.provinces.length <= 0.7, `${seed}: the winner holds ${table[0].provinces} of ${map.provinces.length}`);
    share += table[0].provinces / map.provinces.length;
  }
  assert.ok(share / runs < 0.5, `the winner holds ${(share / runs).toFixed(2)} of the map on average`);
  assert.ok(changes / runs >= 2, `the lead changes ${(changes / runs).toFixed(1)} times a season after the first week`);
});

test('the standings put most provinces first, then most troops', () => {
  const { state } = game();
  const s: State = { ...state, holder: ['ash', 'birch', 'birch', 'cedar', 'cedar', ...state.holder.slice(5).map(() => null)], troops: [9, 1, 1, 4, 4, ...state.troops.slice(5)] };
  assert.deepEqual(standings(s, SIDES).map((r) => r.side), ['cedar', 'birch', 'ash', 'dale']);
});

test('orders: three more each day, saved up to six, and a bonus on top is kept', () => {
  assert.equal(ordersOn(4, 3, 4), 3);
  assert.equal(ordersOn(5, 0, 4), 3);
  assert.equal(ordersOn(5, 2, 4), 5);
  assert.equal(ordersOn(6, 2, 4), RULES.ORDERS_BANK);
  assert.equal(ordersOn(40, 0, 4), RULES.ORDERS_BANK);
  assert.equal(ordersOn(5, RULES.ORDERS_MAX, 4), RULES.ORDERS_MAX);
  assert.equal(ordersOn(3, 2, 4), 2, 'a count from a later day is not changed');
});

test('renown is a share of the house’s own people, so a small house recorded with care outshines a large one that is not', () => {
  const none = renownOf({ people: 0, portraits: 0, dated: 0, placed: 0, memories: 0, events: 0, sources: 0 });
  assert.equal(none.score, 0);
  assert.equal(none.bonus, 0);
  const small = renownOf({ people: 5, portraits: 5, dated: 5, placed: 5, memories: 5, events: 5, sources: 5 });
  assert.equal(small.score, 100);
  assert.equal(small.bonus, RULES.RENOWN_MAX_BONUS);
  assert.equal(small.toNext, null);
  assert.deepEqual(small.tips, []);
  const large = renownOf({ people: 50, portraits: 2, dated: 30, placed: 10, memories: 4, events: 0, sources: 0 });
  assert.ok(large.score < small.score);
  assert.equal(large.bonus, large.score >= RENOWN_STEPS[1] ? 2 : large.score >= RENOWN_STEPS[0] ? 1 : 0);
  assert.equal(large.tips[0], 'portraits', 'the first tip is where the most points are still to be had');
  assert.equal(large.toNext, RENOWN_STEPS[large.bonus] - large.score);
  // More than one memory each does not count twice.
  assert.equal(renownOf({ people: 2, portraits: 0, dated: 0, placed: 0, memories: 40, events: 0, sources: 0 }).score, 20);
});
