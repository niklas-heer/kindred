// node --test src/lib/campaign/engine.test.ts — the Campaign's rules: the map is one piece and the same for the same
// seed, its terrain is dealt in fair shares and each kind keeps its one rule, the odds an attack shows are exact, moves
// are refused when the rules say so and never change the position they were given, regents play only by the rules, a
// reign's moves replay to the same score and a forged list is refused, and a reign between regents stays open to the end.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CampaignError, MAP_H, MAP_W, RULES, adjacent, battle, buildMap, capOf, levyOf, neighbours, openReign, play, provincesOf, regentMoves,
  regentTurn, replay, scoreOf, setupField, standings, startState, terrainOf, troopsOf, winChance,
  type GameMap, type Move, type PlaceIn, type Reign, type State,
} from './engine.ts';
import { RENOWN_STEPS, renownOf } from './renown.ts';
import { rng } from './rng.ts';

const places = (n: number, seed = 'places'): PlaceIn[] => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({ name: `Place ${i}`, lat: 44 + r() * 8, lng: r() * 12, people: 100 - i }));
};
const SIDES = ['ash', 'birch', 'cedar', 'dale'];
const reignOf = (seed = 's1', extra: Partial<Reign> = {}) => {
  const field = setupField(places(30, `p:${seed}`), SIDES, seed);
  const reign: Reign = { map: field.map, sides: SIDES, player: 'ash', seed, renown: 0, grant: 0, ...extra };
  return { field, reign, state: openReign(field.start, reign) };
};
const refused = (code: string) => (e: unknown) => e instanceof CampaignError && e.code === code && e.message === `campaign.err.${code}`;
const reachable = (map: GameMap) => {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) for (const n of neighbours(map, queue.pop()!)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return seen.size;
};
/** A position nobody could have reached by a move is a bug: every province held with at least one troop, none over its cap. */
const sound = (state: State, map: GameMap) => state.holder.length === map.provinces.length && state.troops.every((t, i) => Number.isInteger(t) && t >= 1 && t <= capOf(map, i));
/** A whole reign with a regent playing the player's side too. */
const regentReign = (seed: string, extra: Partial<Reign> = {}) => {
  const { field, reign, state } = reignOf(seed, extra);
  let s = state;
  const moves: Move[] = [];
  const leaders: string[] = [];
  while (s.turn < RULES.TURNS) {
    for (const m of regentMoves(s, reign)) { s = play(s, reign, m).state; moves.push(m); }
    leaders.push(standings(s, SIDES)[0].side);
  }
  return { field, reign, state: s, moves, leaders };
};

test('a reign’s map has sixteen provinces, and the same seed gives the same field', () => {
  const a = setupField(places(30), SIDES, 'seed');
  assert.deepEqual(a, setupField(places(30), SIDES, 'seed'));
  assert.notDeepEqual(a.map.provinces.map((p) => [p.x, p.y]), setupField(places(30), SIDES, 'other').map.provinces.map((p) => [p.x, p.y]));
  assert.equal(a.map.provinces.length, RULES.PROVINCES);
  assert.equal(reachable(a.map), RULES.PROVINCES);
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


test('a house is seated where its own people are, when the map has that place', () => {
  const map = buildMap(places(30), 16, 'home');
  const home = map.provinces[7].name;
  const state = startState(map, SIDES, 'home', { cedar: { [home]: 12 } });
  assert.equal(state.seats.cedar, 7);
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

test('every side opens with a seat and a neighbouring province; the player’s first levy waits with three orders', () => {
  const { field, reign, state } = reignOf();
  assert.equal(new Set(Object.values(state.seats)).size, SIDES.length);
  for (const side of SIDES) {
    assert.equal(state.holder[state.seats[side]], side);
    assert.ok(provincesOf(state, side) >= 1 && provincesOf(state, side) <= 2);
  }
  assert.equal(state.turn, 0);
  assert.equal(state.orders, RULES.ORDERS_PER_TURN);
  assert.equal(state.pool.ash, levyOf(state, field.map, 'ash').total);
  assert.equal(state.pool.birch, undefined, 'a regent’s levy arrives in its own turn');
  assert.ok(sound(state, field.map));
  assert.deepEqual(field.start.pool, {}, 'the opening itself is shared by every player and holds no levy');
  // The quiz's reward comes once, on the first turn.
  assert.equal(openReign(field.start, { ...reign, grant: RULES.QUIZ_LEVY }).pool.ash, state.pool.ash + RULES.QUIZ_LEVY);
});

test('terrain: every seat is a town, so is the most-peopled place, about half the land is plains, and forest and highland share the rest', () => {
  let plains = 0, total = 0;
  for (const seed of ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']) {
    const { map, start } = setupField(places(30, seed), SIDES, seed);
    for (const seat of Object.values(start.seats)) assert.equal(terrainOf(map, seat), 'town');
    assert.equal(terrainOf(map, 0), 'town', 'the place most people are linked to');
    const kinds = map.provinces.map((p) => p.terrain);
    assert.ok(kinds.every((k) => k === 'plains' || k === 'forest' || k === 'highland' || k === 'town'));
    assert.ok(kinds.includes('forest') && kinds.includes('highland'));
    plains += kinds.filter((k) => k === 'plains').length;
    total += kinds.length;
  }
  assert.ok(Math.abs(plains / total - RULES.PLAINS_SHARE) < 0.05, `plains are ${(plains / total).toFixed(2)} of the land`);
  // A map stored before there was terrain reads as plains everywhere.
  const old = buildMap(places(20), 12, 'old');
  for (const p of old.provinces) delete p.terrain;
  assert.equal(terrainOf(old, 3), 'plains');
  assert.equal(capOf(old, 3), RULES.GARRISON_MAX);
});

test('the dice follow Risk: three against two at most, the highest compared, ties to the defender, three rounds at most', () => {
  for (let i = 0; i < 200; i++) {
    const b = battle(6, 5, `dice${i}`);
    assert.deepEqual(b, battle(6, 5, `dice${i}`), 'the same seed rolls the same dice');
    assert.ok(b.rounds.length >= 1 && b.rounds.length <= RULES.BATTLE_ROUNDS);
    for (const r of b.rounds) {
      assert.ok(r.a.length <= 3 && r.d.length <= 2);
      assert.equal(r.aLost + r.dLost, Math.min(r.a.length, r.d.length));
      const pairs = Math.min(r.a.length, r.d.length);
      let dLost = 0;
      for (let k = 0; k < pairs; k++) if (r.a[k] > r.d[k]) dLost++;
      assert.equal(r.dLost, dLost, 'the highest are compared, and a tie goes to the defender');
    }
    assert.equal(b.aLost, b.rounds.reduce((n, r) => n + r.aLost, 0));
  }
});

test('forest raises the defender’s highest die by one, highland lets the attacker roll two dice at most', () => {
  for (let i = 0; i < 200; i++) {
    const plain = battle(5, 3, `t${i}`);
    const forest = battle(5, 3, `t${i}`, 'forest');
    // The first round is rolled from the same numbers: only the defender's best die differs.
    assert.deepEqual(forest.rounds[0].a, plain.rounds[0].a);
    assert.equal(forest.rounds[0].d[0], Math.min(6, plain.rounds[0].d[0] + 1));
    assert.equal(forest.rounds[0].d[1], plain.rounds[0].d[1]);
    for (const r of battle(6, 4, `h${i}`, 'highland').rounds) assert.ok(r.a.length <= 2);
    for (const r of battle(2, 4, `h${i}`, 'town').rounds) assert.ok(r.a.length <= 2 && r.d.length <= 2);
  }
});

test('winChance is exact: one die against one, and the terrain’s rule in the odds', () => {
  assert.equal(winChance(1, 1), 15 / 36);
  assert.equal(winChance(1, 1, 'highland'), 15 / 36, 'one die is one die');
  assert.equal(winChance(1, 1, 'forest'), 10 / 36);
  assert.equal(winChance(0, 3), 0);
  assert.equal(winChance(3, 0), 1);
  // Three rounds remove at most six defenders.
  assert.equal(winChance(12, 7), 0);
  for (const terrain of ['plains', 'forest', 'highland', 'town'] as const) {
    for (let d = 1; d <= 5; d++) {
      for (let a = 1; a < 10; a++) assert.ok(winChance(a + 1, d, terrain) >= winChance(a, d, terrain) - 1e-12, 'more attackers never lower the chance');
    }
  }
  assert.ok(winChance(4, 2, 'forest') < winChance(4, 2));
  assert.ok(winChance(4, 2, 'highland') < winChance(4, 2));
  assert.equal(winChance(4, 2, 'town'), winChance(4, 2), 'a town has no battle rule');
  // The exact number agrees with the dice themselves.
  for (const [a, d, terrain] of [[4, 2, 'forest'], [5, 3, 'highland'], [3, 2, 'plains']] as const) {
    let took = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) if (battle(a, d, `mc${i}`, terrain).dLost >= d) took++;
    assert.ok(Math.abs(took / n - winChance(a, d, terrain)) < 0.025, `${a} against ${d} in ${terrain}: ${took / n} vs ${winChance(a, d, terrain)}`);
  }
});

test('placing the levy costs no order, needs levy, a province of one’s own and room in it; a town holds more', () => {
  const { reign, state } = reignOf('place');
  const seat = state.seats.ash;
  const placed = play(state, reign, { t: 'place', to: seat }).state;
  assert.equal(placed.troops[seat], state.troops[seat] + 1);
  assert.equal(placed.pool.ash, state.pool.ash - 1);
  assert.equal(placed.orders, RULES.ORDERS_PER_TURN);
  assert.equal(capOf(reign.map, seat), RULES.TOWN_GARRISON_MAX);
  const other = state.holder.findIndex((h) => h !== 'ash');
  assert.throws(() => play(state, reign, { t: 'place', to: other }), refused('not_yours'));
  assert.throws(() => play({ ...state, pool: { ash: 0 } }, reign, { t: 'place', to: seat }), refused('no_levy'));
  assert.throws(() => play({ ...state, troops: state.troops.map((t, i) => (i === seat ? RULES.TOWN_GARRISON_MAX : t)) }, reign, { t: 'place', to: seat }), refused('full'));
  assert.throws(() => play(state, reign, { t: 'place', to: 99 }), refused('no_province'));
});

test('marches and attacks take one of three orders a turn; one troop stays behind; seats and far provinces are refused', () => {
  const { reign, state } = reignOf('orders');
  const map = reign.map;
  const seat = state.seats.ash;
  const own = neighbours(map, seat).find((n) => state.holder[n] === 'ash')!;
  const rich = { ...state, troops: state.troops.map((t, i) => (i === seat ? 9 : t)) };
  let s = rich;
  for (let k = 0; k < RULES.ORDERS_PER_TURN; k++) s = play(s, reign, { t: 'march', from: seat, to: own, troops: 1 }).state;
  assert.equal(s.orders, 0);
  assert.equal(s.troops[own], rich.troops[own] + 3);
  assert.throws(() => play(s, reign, { t: 'march', from: seat, to: own, troops: 1 }), refused('no_orders'));
  assert.throws(() => play(rich, reign, { t: 'march', from: seat, to: own, troops: 9 }), refused('stay_one'));
  assert.throws(() => play(rich, reign, { t: 'attack', from: seat, to: own, troops: 2 }), refused('own_province'));
  const far = map.provinces.find((p) => p.id !== seat && !adjacent(map, seat, p.id))!.id;
  assert.throws(() => play(rich, reign, { t: 'attack', from: seat, to: far, troops: 2 }), refused('not_adjacent'));
  // Another house's seat next door is locked.
  const next = neighbours(map, seat).find((n) => n !== own)!;
  const beside = { ...rich, holder: rich.holder.map((h, i) => (i === next ? 'birch' : h)), seats: { ...rich.seats, birch: next } };
  assert.throws(() => play(beside, reign, { t: 'attack', from: seat, to: next, troops: 2 }), refused('seat'));
  // A refused move changes nothing it was given.
  assert.deepEqual(rich, { ...state, troops: state.troops.map((t, i) => (i === seat ? 9 : t)) });
  assert.throws(() => play({ ...state, turn: RULES.TURNS }, reign, { t: 'end' }), refused('over'));
});

test('an attack is fought with the troops sent and counted: survivors move in, losses and wins are kept for the score', () => {
  const { reign, state } = reignOf('attack');
  const map = reign.map;
  const seat = state.seats.ash;
  const free = neighbours(map, seat).find((n) => state.holder[n] === null)!;
  let won = 0, held = 0;
  for (let i = 0; i < 60; i++) {
    const strong = { ...state, attacks: i, troops: state.troops.map((t, k) => (k === seat ? 8 : t)) };
    const { state: after, events } = play(strong, reign, { t: 'attack', from: seat, to: free, troops: 5 });
    const e = events[0];
    assert.ok(e.t === 'attack');
    if (e.t !== 'attack') continue;
    assert.equal(e.terrain, terrainOf(map, free));
    assert.deepEqual({ rounds: e.rounds, aLost: e.aLost, dLost: e.dLost }, battle(5, strong.troops[free], `${reign.seed}:t0:p${i}`, e.terrain), 'the dice are the reign’s, numbered by attack');
    assert.equal(after.attacks, i + 1);
    assert.equal(after.lost.ash ?? 0, e.aLost);
    if (e.took) {
      won++;
      assert.equal(after.holder[free], 'ash');
      assert.equal(after.troops[free], 5 - e.aLost);
      assert.equal(after.won.ash, 1);
    } else {
      held++;
      assert.equal(after.holder[free], null);
      assert.equal(after.troops[seat], 8 - e.aLost);
      assert.equal(after.won.ash ?? 0, 0);
    }
    assert.ok(sound(after, map));
  }
  assert.ok(won > 0 && held > 0, 'both outcomes happen');
});

test('the levy is the base, one for each town held, and renown up to two', () => {
  const { reign, state } = reignOf('levy');
  const map = reign.map;
  const towns = state.holder.filter((h, i) => h === 'ash' && terrainOf(map, i) === 'town').length;
  assert.deepEqual(levyOf(state, map, 'ash', 0), { base: RULES.BASE_LEVY, towns, renown: 0, grant: 0, total: RULES.BASE_LEVY + towns });
  assert.equal(levyOf(state, map, 'ash', 9).renown, RULES.RENOWN_MAX_BONUS);
  const town = map.provinces.find((p) => p.terrain === 'town' && state.holder[p.id] === null);
  if (town) assert.equal(levyOf({ ...state, holder: state.holder.map((h, i) => (i === town.id ? 'ash' : h)) }, map, 'ash').towns, towns + 1);
});

test('ending the turn lets every regent play by the rules, then the next turn’s levy and orders arrive', () => {
  const { reign, state } = reignOf('end', { renown: 2 });
  const after = play(state, reign, { t: 'end' });
  assert.deepEqual(after, play(state, reign, { t: 'end' }), 'the same turn ends the same way');
  assert.equal(after.state.turn, 1);
  assert.equal(after.state.orders, RULES.ORDERS_PER_TURN);
  assert.ok(after.events.every((e) => e.side !== 'ash'), 'the regents play only their own sides');
  assert.ok(after.state.pool.ash >= state.pool.ash + RULES.BASE_LEVY + 2, 'unplaced levy is kept, and renown adds to the next');
  assert.ok(sound(after.state, reign.map));
  for (const side of ['birch', 'cedar', 'dale']) {
    const r = regentTurn(state, reign, side);
    assert.deepEqual(r, regentTurn(state, reign, side));
    assert.ok(r.events.length <= RULES.ORDERS_PER_TURN);
    assert.ok(r.events.filter((e) => e.t === 'attack').length <= RULES.REGENT_ATTACKS);
  }
});

test('the score: ten a province, twenty a town, two a battle won, one off for each troop lost', () => {
  const { reign, state } = reignOf('score');
  const map = reign.map;
  const s = { ...state, holder: state.holder.map((h, i) => (i < 6 ? 'ash' : h === 'ash' ? 'birch' : h)), won: { ash: 4 }, lost: { ash: 7 } };
  const towns = s.holder.filter((h, i) => h === 'ash' && terrainOf(map, i) === 'town').length;
  assert.deepEqual(scoreOf(s, map, 'ash'), { provinces: 6, towns, won: 4, lost: 7, total: (6 - towns) * 10 + towns * 20 + 8 - 7 });
  assert.equal(scoreOf({ ...s, lost: { ash: 999 } }, map, 'ash').total, 0, 'never below nothing');
});

test('a reign replays to the same position and score; the moves after its end, a forged move and an unfinished list are refused', () => {
  const { field, reign, state, moves } = regentReign('replay');
  assert.equal(state.turn, RULES.TURNS);
  assert.equal(moves.filter((m) => m.t === 'end').length, RULES.TURNS);
  const once = replay(field.start, reign, moves);
  assert.deepEqual(once.state, state);
  assert.deepEqual(once, replay(field.start, reign, moves), 'the same moves, the same score');
  assert.deepEqual(once.score, scoreOf(state, reign.map, 'ash'));
  assert.throws(() => replay(field.start, reign, [...moves, { t: 'end' }]), refused('over'));
  assert.throws(() => replay(field.start, reign, moves.slice(0, -1)), refused('unfinished'));
  assert.throws(() => replay(field.start, reign, Array.from({ length: RULES.MAX_MOVES + 1 }, () => ({ t: 'end' }) as Move)), refused('too_long'));
  // A fourth order in the first turn, a troop placed on a province of another house, or a march to nowhere.
  const seat = field.start.seats.ash;
  const own = neighbours(reign.map, seat).find((n) => field.start.holder[n] === 'ash')!;
  assert.throws(() => replay(field.start, reign, [...Array.from({ length: 4 }, () => ({ t: 'march', from: seat, to: own, troops: 1 }) as Move), ...moves]), (e: unknown) => e instanceof CampaignError);
  assert.throws(() => replay(field.start, reign, [{ t: 'place', to: field.start.seats.birch }, ...moves]), refused('not_yours'));
  assert.throws(() => replay(field.start, reign, [{ t: 'march', from: seat, to: 999, troops: 1 }, ...moves]), refused('no_province'));
  assert.throws(() => replay(field.start, reign, [{ t: 'fly' } as unknown as Move, ...moves]), refused('no_province'));
  // Renown is part of the reign: the same moves with more of it end elsewhere, so the server replays with what it stored.
  const idle = Array.from({ length: RULES.TURNS }, () => ({ t: 'end' }) as Move);
  assert.notDeepEqual(replay(field.start, { ...reign, renown: 2 }, idle).state.pool, replay(field.start, reign, idle).state.pool);
});

test('a reign between regents: no seat falls, scores spread, and the lead can still change on the last turn', () => {
  const scores: number[] = [];
  let lastTurnChanges = 0, changes = 0;
  const runs = 60;
  for (let i = 0; i < runs; i++) {
    const { state, reign, leaders } = regentReign(`season${i}`, { player: SIDES[i % 4], renown: 1 });
    for (const side of SIDES) assert.equal(state.holder[state.seats[side]], side, 'a seat never falls');
    assert.ok(sound(state, reign.map));
    const table = standings(state, SIDES);
    assert.ok(table.at(-1)!.provinces >= 1, 'nobody is out');
    assert.ok(table[0].provinces <= 11, 'nobody runs away with the whole map');
    scores.push(scoreOf(state, reign.map, reign.player).total);
    if (leaders.at(-1) !== leaders.at(-2)) lastTurnChanges++;
    for (let k = 1; k < leaders.length; k++) if (leaders[k] !== leaders[k - 1]) changes++;
    assert.ok(troopsOf(state, reign.player) >= 1);
  }
  scores.sort((a, b) => a - b);
  const at = (f: number) => scores[Math.floor(f * (scores.length - 1))];
  assert.ok(at(0.9) - at(0.1) >= 30, `scores spread from ${at(0.1)} to ${at(0.9)}`);
  assert.ok(lastTurnChanges > 0, 'some reigns are decided only on the last turn');
  assert.ok(changes / runs >= 1.5, `the lead changes ${(changes / runs).toFixed(1)} times a reign`);
});
